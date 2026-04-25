const env = import.meta.env;

const DEV_LOCALHOST_SUPABASE_URL = 'https://hosvrzhfdotstghdoycv.supabase.co';
const DEV_LOCALHOST_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhvc3ZyemhmZG90c3RnaGRveWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDc2ODQsImV4cCI6MjA4Mzc4MzY4NH0.7duRICE5bhuJP-amqapCPJfngGYBfN9EgPBSfi4ewhw';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocalhostRuntime() {
  if (typeof window === 'undefined') return false;
  return LOCAL_HOSTS.has(window.location.hostname);
}

function isFailClosedMode() {
  return env.PROD || env.MODE === 'staging';
}

function readRemoteConfig(value: string | undefined, envName: string, devFallback?: string) {
  if (value) return value;
  if (!isFailClosedMode() && isLocalhostRuntime() && devFallback) {
    return devFallback;
  }
  throw new Error(
    `Missing ${envName}. Set it explicitly for ${env.MODE || 'this environment'} runtime configuration.`
  );
}

export const APP_NAME = env.VITE_APP_NAME || 'EDRSR AI Portal';
export const API_BASE = env.VITE_API_BASE || '/api';
export const WS_PATH = env.VITE_WS_PATH || '/ws';
export const DEV_AUTH_ENABLED = env.VITE_DEV_AUTH_ENABLED === 'true';
export const SUPABASE_URL = readRemoteConfig(
  env.VITE_SUPABASE_URL,
  'VITE_SUPABASE_URL',
  DEV_LOCALHOST_SUPABASE_URL
);
export const SUPABASE_ANON_KEY = readRemoteConfig(
  env.VITE_SUPABASE_ANON_KEY,
  'VITE_SUPABASE_ANON_KEY',
  DEV_LOCALHOST_SUPABASE_ANON_KEY
);
export const WS_URL_OVERRIDE = env.VITE_WS_URL || '';

export function getWsUrl() {
  if (WS_URL_OVERRIDE) return WS_URL_OVERRIDE;
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${WS_PATH}`;
}
