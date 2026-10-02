#!/usr/bin/env node

// Token verification must survive a short Supabase outage without logging users out, and must never
// accept a token Supabase rejected. Offline: a fake Supabase client and an injected clock.

import assert from 'node:assert/strict';
import { clearTokenCache, isSupabaseNetworkError, verifyAccessToken } from '../auth/verifyToken.js';

const makeToken = (expSeconds) =>
  [
    'aGVhZGVy',
    Buffer.from(JSON.stringify({ sub: 'u1', exp: expSeconds })).toString('base64url'),
    'c2ln',
  ].join('.');

const USER = { id: 'user-1', email: 'a@example.com' };
const fetchFailed = Object.assign(new TypeError('fetch failed'), {
  cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
});

function fakeSupa(handler) {
  const supa = { calls: 0, auth: {} };
  supa.auth.getUser = async (token) => {
    supa.calls += 1;
    return handler(token, supa.calls);
  };
  return supa;
}

let nowMs = 1_800_000_000_000;
const now = () => nowMs;
const tokenValidFor = (ms) => makeToken(Math.floor((nowMs + ms) / 1000));

// 1. a successful check is reused for the fresh window, then Supabase is asked again
{
  clearTokenCache();
  const supa = fakeSupa(() => ({ data: { user: USER }, error: null }));
  const token = tokenValidFor(3_600_000);
  assert.deepEqual((await verifyAccessToken(supa, token, now)).user, USER);
  await verifyAccessToken(supa, token, now);
  assert.equal(supa.calls, 1, 'second call within 2 min is served from the cache');
  nowMs += 121_000;
  await verifyAccessToken(supa, token, now);
  assert.equal(supa.calls, 2, 'after the fresh window Supabase is asked again');
}

// 2. Supabase unreachable (thrown or returned): a recently validated token is still accepted...
for (const failure of [
  () => {
    throw fetchFailed;
  },
  () => ({
    data: { user: null },
    error: Object.assign(new Error('x'), { name: 'AuthRetryableFetchError', status: 0 }),
  }),
  () => ({ data: { user: null }, error: Object.assign(new Error('bad gateway'), { status: 502 }) }),
]) {
  clearTokenCache();
  let down = false;
  const supa = fakeSupa(() => (down ? failure() : { data: { user: USER }, error: null }));
  const token = tokenValidFor(3_600_000);
  await verifyAccessToken(supa, token, now);
  down = true;
  nowMs += 300_000; // fresh window over, still inside the 30 min grace
  const result = await verifyAccessToken(supa, token, now);
  assert.deepEqual(result.user, USER, 'validated token survives a Supabase outage');
  assert.equal(result.stale, true);

  nowMs += 31 * 60_000; // grace over
  const late = await verifyAccessToken(supa, token, now);
  assert.equal(late.user, null, 'the grace period is bounded');
  assert.ok(late.error, 'the network error is reported');
}

// 3. a token Supabase never validated is NOT accepted during an outage
{
  clearTokenCache();
  const supa = fakeSupa(() => {
    throw fetchFailed;
  });
  const result = await verifyAccessToken(supa, tokenValidFor(3_600_000), now);
  assert.equal(result.user, null);
  assert.ok(result.error);
}

// 4. an auth rejection from Supabase is final: never stale, and it evicts the cached entry
{
  clearTokenCache();
  let rejected = false;
  const supa = fakeSupa(() =>
    rejected
      ? {
          data: { user: null },
          error: Object.assign(new Error('invalid JWT'), { name: 'AuthApiError', status: 401 }),
        }
      : { data: { user: USER }, error: null }
  );
  const token = tokenValidFor(3_600_000);
  await verifyAccessToken(supa, token, now);
  rejected = true;
  nowMs += 130_000;
  assert.equal((await verifyAccessToken(supa, token, now)).user, null, 'revoked token is refused');
  // even if Supabase then becomes unreachable, the evicted token stays refused
  supa.auth.getUser = async () => {
    throw fetchFailed;
  };
  assert.equal(
    (await verifyAccessToken(supa, token, now)).user,
    null,
    'rejection cleared the cache'
  );
}

// 5. the token's own expiry always wins, also inside the grace period
{
  clearTokenCache();
  let down = false;
  const supa = fakeSupa(() =>
    down ? Promise.reject(fetchFailed) : { data: { user: USER }, error: null }
  );
  const token = tokenValidFor(10 * 60_000);
  await verifyAccessToken(supa, token, now);
  down = true;
  nowMs += 11 * 60_000;
  assert.equal(
    (await verifyAccessToken(supa, token, now)).user,
    null,
    'expired token is not accepted'
  );
}

// 6. error classification and cache bounds
assert.equal(isSupabaseNetworkError(fetchFailed), true);
assert.equal(
  isSupabaseNetworkError(
    Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
  ),
  true
);
assert.equal(
  isSupabaseNetworkError(Object.assign(new Error('invalid JWT'), { status: 401 })),
  false
);
assert.equal(
  isSupabaseNetworkError(Object.assign(new Error('JWT expired'), { status: 403 })),
  false
);
assert.equal(isSupabaseNetworkError(null), false);
{
  clearTokenCache();
  const supa = fakeSupa(() => ({ data: { user: USER }, error: null }));
  for (let i = 0; i < 2100; i += 1) {
    await verifyAccessToken(supa, `${tokenValidFor(3_600_000)}-${i}`, now);
  }
  assert.equal(supa.calls, 2100);
  // the oldest entries were dropped, the newest are still cached
  await verifyAccessToken(supa, `${tokenValidFor(3_600_000)}-2099`, now);
  assert.equal(supa.calls, 2100, 'recent entry still cached');
  await verifyAccessToken(supa, `${tokenValidFor(3_600_000)}-0`, now);
  assert.equal(supa.calls, 2101, 'oldest entry was evicted (cache is bounded)');
}

// 7. an explicit 4xx verdict is final even when its message sounds like a network problem
{
  clearTokenCache();
  let rejected = false;
  const supa = fakeSupa(() =>
    rejected
      ? {
          data: { user: null },
          error: Object.assign(new Error('network access denied'), {
            name: 'AuthApiError',
            status: 401,
          }),
        }
      : { data: { user: USER }, error: null }
  );
  const token = tokenValidFor(3_600_000);
  await verifyAccessToken(supa, token, now);
  rejected = true;
  nowMs += 130_000;
  assert.equal(
    (await verifyAccessToken(supa, token, now)).user,
    null,
    'a 401 is never turned into a stale accept by its message text'
  );
  assert.equal(isSupabaseNetworkError(Object.assign(new Error('timeout'), { status: 403 })), false);
  assert.equal(
    isSupabaseNetworkError(Object.assign(new Error('slow down'), { status: 429 })),
    true
  );
  assert.equal(isSupabaseNetworkError(Object.assign(new Error('x'), { status: 408 })), true);
}

// 8. a token without a usable exp is never cached and never accepted stale
for (const exp of [undefined, 0, 'soon', NaN, nowMs * 5]) {
  clearTokenCache();
  let down = false;
  const supa = fakeSupa(() =>
    down ? Promise.reject(fetchFailed) : { data: { user: USER }, error: null }
  );
  const token = [
    'aGVhZGVy',
    Buffer.from(JSON.stringify({ sub: 'u1', exp })).toString('base64url'),
    'c2ln',
  ].join('.');
  await verifyAccessToken(supa, token, now);
  await verifyAccessToken(supa, token, now);
  assert.equal(supa.calls, 2, `exp=${String(exp)} must not be cached`);
  down = true;
  assert.equal(
    (await verifyAccessToken(supa, token, now)).user,
    null,
    `exp=${String(exp)} not stale`
  );
}

// 9. concurrent calls with one token share a single Supabase call and one verdict
{
  clearTokenCache();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const supa = fakeSupa(async () => {
    await gate;
    return {
      data: { user: null },
      error: Object.assign(new Error('invalid JWT'), { name: 'AuthApiError', status: 401 }),
    };
  });
  const token = tokenValidFor(3_600_000);
  const both = Promise.all([
    verifyAccessToken(supa, token, now),
    verifyAccessToken(supa, token, now),
  ]);
  release();
  const [a, b] = await both;
  assert.equal(supa.calls, 1, 'one in-flight request per token');
  assert.equal(a.user, null);
  assert.equal(b.user, null);
}

console.log('Token verification regressions passed.');
