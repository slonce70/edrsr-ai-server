// --- EDRSR-AI Extension Configuration ---

const BUILD_ENV = 'development';

export const API_BASE_URL = 'http://localhost:4000/api';
export const WS_URL = 'ws://localhost:4000';
export const SUPABASE_URL = 'https://dhgqmkhkptbzlwskktte.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2RoZ3Fta2hrcHRiemx3c2trdHRlLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJyZWYiOiJkaGdxbWtoa3B0Ynpsd3Nra3R0ZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzUxNDQ5MjY4LCJleHAiOjIwNjcwMjUyNjh9.CHMYGthrxj1-6uNAB29O5M0-8aA1Vaocmh86KAm3W98';
export const SUPABASE_REDIRECT_TO = 'http://localhost:4000/auth/callback';
export const DEV_AUTH_ENABLED = false;

function assertConfigured(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[config] ${name} must be configured for ${BUILD_ENV} builds`);
  }
}

function assertValidUrl(name, value, protocols) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[config] ${name} must be a valid URL for ${BUILD_ENV} builds`);
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(
      `[config] ${name} must use one of: ${protocols.join(', ')} for ${BUILD_ENV} builds`
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    throw new Error(`[config] ${name} must not point to localhost for ${BUILD_ENV} builds`);
  }
}

function validateProdLikeConfig() {
  const configEntries = {
    API_BASE_URL,
    WS_URL,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_REDIRECT_TO,
  };
  Object.entries(configEntries).forEach(([key, value]) => assertConfigured(key, value));
  assertValidUrl('API_BASE_URL', API_BASE_URL, ['https:']);
  assertValidUrl('WS_URL', WS_URL, ['wss:']);
  assertValidUrl('SUPABASE_URL', SUPABASE_URL, ['https:']);
  assertValidUrl('SUPABASE_REDIRECT_TO', SUPABASE_REDIRECT_TO, ['https:']);
}

if (BUILD_ENV === 'production' || BUILD_ENV === 'staging') {
  validateProdLikeConfig();
}

export const EXTENSION_BUILD_ENV = BUILD_ENV;
