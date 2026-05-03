import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

function jwtPayloadRole(key: string): string | undefined {
  try {
    const parts = key.split('.');
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { role?: string };
    return payload.role;
  } catch {
    return undefined;
  }
}

function assertServiceRoleKey(key: string) {
  if (key.startsWith('sb_publishable_')) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY: указан publishable-ключ. Нужен секрет service_role (JWT из Dashboard → API). Положите publishable в VITE_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  const role = jwtPayloadRole(key);
  if (role && role !== 'service_role') {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY: в ключе указана роль "${role}". Нужен отдельный секрет **service_role** (Dashboard → Settings → API → API Keys → service_role), не anon и не publishable.`,
    );
  }
}

export function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('Задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env');
  }
  assertServiceRoleKey(key);
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function getBucket(): string {
  return process.env.SUPABASE_BUCKET?.trim() || 'wedding-photos';
}
