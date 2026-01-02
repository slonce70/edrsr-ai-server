const env = import.meta.env;

export const APP_NAME = env.VITE_APP_NAME || 'EDRSR AI Portal';
export const API_BASE = env.VITE_API_BASE || '/api';
export const WS_PATH = env.VITE_WS_PATH || '/ws';
export const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://dhgqmkhkptbzlwskktte.supabase.co';
export const SUPABASE_ANON_KEY =
  env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoZ3Fta2hrcHRiemx3c2trdHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE0NDkyNjgsImV4cCI6MjA2NzAyNTI2OH0.CHMYGthrxj1-6uNAB29O5M0-8aA1Vaocmh86KAm3W98';
export const WS_URL_OVERRIDE = env.VITE_WS_URL || '';

export function getWsUrl() {
  if (WS_URL_OVERRIDE) return WS_URL_OVERRIDE;
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${WS_PATH}`;
}
