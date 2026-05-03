import { createBrowserClient } from '@supabase/ssr';

/**
 * Клиент Supabase для браузера (publishable / anon key).
 * Используйте для будущих вызовов с фронта (например Auth, Realtime).
 * Загрузка фото сейчас идёт через Express + service_role — ключ сервера не в клиенте.
 */
export function createClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY (см. .env.example)',
    );
  }
  return createBrowserClient(url, key);
}
