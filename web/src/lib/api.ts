import { API_BASE } from './config';
import { requestTokenRefresh } from './authBridge';

type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

type RequestOptions = {
  method?: string;
  token?: string | null;
  body?: unknown;
  query?: Record<string, QueryValue>;
  workspaceId?: string | null;
  signal?: AbortSignal;
};

export class ApiError extends Error {
  status: number;
  info?: unknown;

  constructor(message: string, status: number, info?: unknown) {
    super(message);
    this.status = status;
    this.info = info;
  }
}

function buildQuery(query?: Record<string, QueryValue>) {
  if (!query) return '';
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === null || typeof value === 'undefined') return;
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)));
      return;
    }
    params.set(key, String(value));
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function parseJsonSafe(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}) {
  const { method = 'GET', token, body, query, signal, workspaceId } = options;

  const finalQuery = { ...(query || {}) } as Record<string, QueryValue>;
  // Portal routes keep stable REST paths and pass workspace context via query.
  // Callers can still override this explicitly by providing query.workspaceId.
  if (workspaceId && typeof finalQuery.workspaceId === 'undefined') {
    finalQuery.workspaceId = workspaceId;
  }
  const qs = buildQuery(finalQuery);
  const url = `${API_BASE}${path}${qs}`;

  const doFetch = (authToken?: string | null) => {
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  };

  let res = await doFetch(token);

  // On a 401 with an existing token, attempt a single refresh-and-retry.
  // Never refresh more than once; if no fresh token is returned, fall through
  // to the normal error path below.
  if (res.status === 401 && token) {
    const newToken = await requestTokenRefresh();
    if (newToken) {
      res = await doFetch(newToken);
    }
  }

  if (!res.ok) {
    const info = await parseJsonSafe(res);
    const message =
      (info && typeof info === 'object' && 'error' in info && info.error) ||
      res.statusText ||
      'Request failed';
    throw new ApiError(String(message), res.status, info);
  }

  if (res.status === 204) return null as T;
  const data = await parseJsonSafe(res);
  return data as T;
}
