// --- EDRSR-AI Extension Configuration ---

export const API_BASE_URL = 'http://localhost:4000/api';
export const WS_URL = 'ws://localhost:4000';
// Supabase (dev): fill with your project values
export const SUPABASE_URL = 'https://dhgqmkhkptbzlwskktte.supabase.co';
export const SUPABASE_ANON_KEY ='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoZ3Fta2hrcHRiemx3c2trdHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE0NDkyNjgsImV4cCI6MjA2NzAyNTI2OH0.CHMYGthrxj1-6uNAB29O5M0-8aA1Vaocmh86KAm3W98';
// URL для редиректа после восстановления пароля (добавьте в Redirect URLs в Supabase Settings → Auth → URL Configuration)
// Куда Supabase будет возвращать пользователя после подтверждения/восстановления.
// Для разработки: локальный сервер этого проекта.
export const SUPABASE_REDIRECT_TO = 'http://localhost:4000/auth/callback';
