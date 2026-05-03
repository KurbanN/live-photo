/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable (sb_publishable_…) или legacy anon — только для `src/lib/supabase/client.ts`. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Базовый URL API для статической сборки (GitHub Pages + бэкенд на другом хосте). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
