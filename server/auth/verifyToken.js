import crypto from 'node:crypto';
import { logger } from '../utils.js';

// Every authenticated HTTP request and every WebSocket auth calls Supabase `auth.getUser(token)`.
// When the VPS briefly cannot reach Supabase, that turned into 401 / `auth_required` closes, and the
// extension then refreshes its session or even signs the user out. So:
//  - a successful check is reused for FRESH_MS (also saves a round trip per request);
//  - if Supabase is unreachable (a network failure, never an auth rejection), a token that Supabase
//    validated within STALE_MS is still accepted, until the token's own `exp`.
// An invalid/expired/revoked answer from Supabase is never cached and clears the entry.
const FRESH_MS = 2 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 2000;

const cache = new Map(); // sha256(token) -> { user, checkedAt, expMs }

const keyOf = (token) => crypto.createHash('sha256').update(token).digest('base64');

function tokenExpMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

export function isSupabaseNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AuthRetryableFetchError') return true;
  if (typeof err.status === 'number' && (err.status === 0 || err.status >= 500)) return true;
  const code = String(err.cause?.code || err.code || '');
  if (/^(UND_ERR|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)/.test(code)) {
    return true;
  }
  return /fetch failed|network|timed? ?out/i.test(String(err.message || ''));
}

function remember(key, user, token, now) {
  cache.delete(key);
  cache.set(key, { user, checkedAt: now, expMs: tokenExpMs(token) });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

const stillValid = (entry, now, windowMs) =>
  now - entry.checkedAt < windowMs && (!entry.expMs || now < entry.expMs);

/**
 * @param {{auth: {getUser: (token: string) => Promise<{data: any, error: any}>}}} supa
 * @param {string} token
 * @returns {Promise<{user: object|null, error?: any, stale?: boolean}>}
 */
export async function verifyAccessToken(supa, token, now = Date.now) {
  const key = keyOf(token);
  const hit = cache.get(key);
  if (hit && stillValid(hit, now(), FRESH_MS)) return { user: hit.user };

  let result;
  try {
    result = await supa.auth.getUser(token);
  } catch (thrown) {
    result = { data: null, error: thrown };
  }
  const { data, error } = result;

  if (!error && data?.user) {
    remember(key, data.user, token, now());
    return { user: data.user };
  }

  if (error && isSupabaseNetworkError(error)) {
    if (hit && stillValid(hit, now(), STALE_MS)) {
      logger.warn('[AUTH] Supabase unreachable, accepting a recently validated token');
      return { user: hit.user, stale: true };
    }
    return { user: null, error };
  }

  cache.delete(key);
  return { user: null, error };
}

export function clearTokenCache() {
  cache.clear();
}
