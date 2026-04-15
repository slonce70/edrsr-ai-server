// Minimal Supabase auth client for MV3 (no external libs)
import {
  DEV_AUTH_ENABLED,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_REDIRECT_TO,
} from './config.js';

const SESSION_KEY = 'sb_session';

function hashStringToHex(input) {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  let h3 = 0xc0decafe ^ input.length;
  let h4 = 0x9e3779b9 ^ input.length;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
    h3 = Math.imul(h3 ^ code, 2246822507);
    h4 = Math.imul(h4 ^ code, 3266489909);
  }

  return [h1, h2, h3, h4].map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

function uuidFromEmail(email) {
  const chars = hashStringToHex(
    String(email || '')
      .trim()
      .toLowerCase()
  )
    .slice(0, 32)
    .split('');
  chars[12] = '4';
  const variant = Number.parseInt(chars[16], 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function encodeBase64Url(value) {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createDevSession(email) {
  const normalizedEmail = String(email || '')
    .trim()
    .toLowerCase();
  const expires_at = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const id = uuidFromEmail(normalizedEmail);
  return {
    access_token: `dev:${encodeBase64Url(JSON.stringify({ id, email: normalizedEmail }))}`,
    refresh_token: '',
    expires_at,
    user: { id, email: normalizedEmail },
  };
}

export async function clearSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

export async function isAuthenticated() {
  // "Authenticated" should mean we can actually make authenticated API calls.
  // This avoids UI loops where an expired/invalid session still has an access_token string.
  const token = await getAccessToken();
  return !!token;
}

export async function getSession() {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return data[SESSION_KEY] || null;
}

export async function getAccessToken() {
  const session = await getSession();
  if (!session) return null;
  if (
    DEV_AUTH_ENABLED &&
    typeof session.access_token === 'string' &&
    session.access_token.startsWith('dev:')
  ) {
    return session.access_token;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at > nowSec + 30) {
    return session.access_token;
  }
  // Try refresh
  if (session.refresh_token) {
    const refreshed = await refresh(session.refresh_token);
    if (refreshed) return refreshed.access_token;
  }
  await clearSession();
  return null;
}

export async function signInWithPassword(email, password) {
  if (DEV_AUTH_ENABLED) {
    if (!String(email || '').trim()) throw new Error('Email is required');
    if (!String(password || '').trim()) throw new Error('Password is required');
    const session = createDevSession(email);
    await chrome.storage.local.set({ [SESSION_KEY]: session });
    return session;
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || 'Auth failed');
  const session = normalizeSession(json);
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return session;
}

export async function signOut() {
  await clearSession();
}

async function refresh(refresh_token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ refresh_token }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(json.error_description || json.error || '').toLowerCase();
    if (
      message.includes('invalid') ||
      message.includes('expired') ||
      message.includes('revoked') ||
      message.includes('refresh')
    ) {
      await clearSession();
    }
    return null;
  }
  const session = normalizeSession(json);
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return session;
}

// Force refresh the access token using the stored refresh token.
// Returns the new session or null on failure.
export async function forceRefresh() {
  const data = await chrome.storage.local.get(SESSION_KEY);
  const current = data[SESSION_KEY];
  if (
    DEV_AUTH_ENABLED &&
    typeof current?.access_token === 'string' &&
    current.access_token.startsWith('dev:')
  ) {
    return current;
  }
  if (!current?.refresh_token) return null;
  try {
    const session = await refresh(current.refresh_token);
    return session;
  } catch {
    return null;
  }
}

function normalizeSession(json) {
  // Supabase returns { access_token, refresh_token, expires_in, token_type, user }
  const expires_at = Math.floor(Date.now() / 1000) + (json.expires_in || 3600);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at,
    user: json.user || null,
  };
}

// --- Registration ---
export async function signUpWithPassword(email, password) {
  if (DEV_AUTH_ENABLED) {
    if (!String(email || '').trim()) throw new Error('Email is required');
    if (!String(password || '').trim()) throw new Error('Password is required');
    const session = createDevSession(email);
    await chrome.storage.local.set({ [SESSION_KEY]: session });
    return { status: 'signed_in', session };
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    // Пробуем явно указать redirect, чтобы письмо подтверждения вело на наш колбэк
    body: JSON.stringify({
      email,
      password,
      // Оба поля на случай различий в API версий GoTrue
      redirect_to: SUPABASE_REDIRECT_TO,
      email_redirect_to: SUPABASE_REDIRECT_TO,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || 'Sign up failed');

  // If email confirmation is disabled, Supabase may return a session here.
  if (json.access_token) {
    const session = normalizeSession(json);
    await chrome.storage.local.set({ [SESSION_KEY]: session });
    return { status: 'signed_in', session };
  }
  // If confirmation is required, no session will be returned.
  return { status: 'confirmation_sent', user: json.user };
}

export async function recoverPassword(email, redirectTo = null) {
  if (DEV_AUTH_ENABLED) {
    if (!String(email || '').trim()) throw new Error('Email is required');
    return true;
  }
  const body = redirectTo ? { email, redirect_to: redirectTo } : { email };
  const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error_description || json.error || 'AUTH_RECOVER_FAILED');
  }
  return true;
}
