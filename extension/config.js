// --- EDRSR-AI Extension Configuration ---

export const API_BASE_URL = 'https://edrsr-ai-server.fun/api';
export const WS_URL = 'wss://edrsr-ai-server.fun';
// Supabase (dev): fill with your project values
export const SUPABASE_URL = 'https://hosvrzhfdotstghdoycv.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhvc3ZyemhmZG90c3RnaGRveWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDc2ODQsImV4cCI6MjA4Mzc4MzY4NH0.7duRICE5bhuJP-amqapCPJfngGYBfN9EgPBSfi4ewhw';
// URL для редиректа после восстановления пароля (добавьте в Redirect URLs в Supabase Settings → Auth → URL Configuration)
// Куда Supabase будет возвращать пользователя после подтверждения/восстановления.
// Для разработки: локальный сервер этого проекта.
export const SUPABASE_REDIRECT_TO = 'https://edrsr-ai-server.fun/auth/callback';
