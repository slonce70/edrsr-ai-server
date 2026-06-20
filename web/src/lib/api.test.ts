import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiRequest, ApiError } from './api';
import { setUnauthorizedHandler } from './authBridge';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('apiRequest 401 handling', () => {
  it('refreshes once and retries with the new token on 401', async () => {
    const calls: (string | null)[] = [];
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      calls.push(auth);
      if (calls.length === 1) return jsonResponse(401, { error: 'expired' });
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;
    setUnauthorizedHandler(async () => 'NEW');

    const result = await apiRequest<{ ok: boolean }>('/x', { token: 'OLD' });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['Bearer OLD', 'Bearer NEW']);
  });

  it('throws ApiError(401) when refresh yields no token', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { error: 'expired' })) as unknown as typeof fetch;
    setUnauthorizedHandler(async () => null);
    await expect(apiRequest('/x', { token: 'OLD' })).rejects.toMatchObject({ status: 401 });
  });

  it('does not attempt refresh when no token was sent', async () => {
    const handler = vi.fn(async () => 'NEW');
    setUnauthorizedHandler(handler);
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { error: 'nope' })) as unknown as typeof fetch;
    await expect(apiRequest('/x', {})).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });
});
