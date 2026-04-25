import type { Session, User } from '@supabase/supabase-js';

const STORAGE_KEY = 'edrsr-dev-auth-session';

function hashStringToHex(input: string) {
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

  const parts = [h1, h2, h3, h4].map((value) => (value >>> 0).toString(16).padStart(8, '0'));
  return parts.join('');
}

function uuidFromEmail(email: string) {
  const chars = hashStringToHex(email.trim().toLowerCase()).slice(0, 32).split('');
  chars[12] = '4';
  const variant = Number.parseInt(chars[16], 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function encodeBase64Url(value: string) {
  const utf8 = new TextEncoder().encode(value);
  let binary = '';
  utf8.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildDevUser(email: string): User {
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();
  return {
    id: uuidFromEmail(normalizedEmail),
    email: normalizedEmail,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { devAuth: true },
    identities: [],
    created_at: now,
    updated_at: now,
    is_anonymous: false,
    phone: '',
    confirmed_at: now,
    last_sign_in_at: now,
  } as User;
}

export function createDevSession(email: string): Session {
  const user = buildDevUser(email);
  const expiresAt = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const accessToken = `dev:${encodeBase64Url(JSON.stringify({ id: user.id, email: user.email }))}`;

  return {
    access_token: accessToken,
    refresh_token: '',
    expires_in: 365 * 24 * 60 * 60,
    expires_at: expiresAt,
    token_type: 'bearer',
    user,
  } as Session;
}

export function getStoredDevSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function storeDevSession(session: Session) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredDevSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
