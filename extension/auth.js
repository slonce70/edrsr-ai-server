// Minimal Supabase auth client for MV3 (no external libs)
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_REDIRECT_TO } from './config.js';

const SESSION_KEY = 'sb_session';

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
  const nowSec = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at > nowSec + 30) {
    return session.access_token;
  }
  // Try refresh
  if (session.refresh_token) {
    const refreshed = await refresh(session.refresh_token);
    if (refreshed) return refreshed.access_token;
  }
  return null;
}

export async function signInWithPassword(email, password) {
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
  await chrome.storage.local.remove(SESSION_KEY);
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
  const json = await res.json();
  if (!res.ok) return null;
  const session = normalizeSession(json);
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return session;
}

// Force refresh the access token using the stored refresh token.
// Returns the new session or null on failure.
export async function forceRefresh() {
  const data = await chrome.storage.local.get(SESSION_KEY);
  const current = data[SESSION_KEY];
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
