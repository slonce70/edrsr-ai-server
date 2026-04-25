// --- EDRSR-AI Extension Configuration ---

const BUILD_ENV = 'production';

export const API_BASE_URL = 'https://edrsr-ai-server.fun/api';
export const WS_URL = 'wss://edrsr-ai-server.fun';
export const SUPABASE_URL = 'https://hosvrzhfdotstghdoycv.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhvc3ZyemhmZG90c3RnaGRveWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDc2ODQsImV4cCI6MjA4Mzc4MzY4NH0.7duRICE5bhuJP-amqapCPJfngGYBfN9EgPBSfi4ewhw';
export const SUPABASE_REDIRECT_TO = 'https://edrsr-ai-server.fun/auth/callback';
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
