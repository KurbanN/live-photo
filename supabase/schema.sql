-- 1) Таблица метаданных (SQL Editor → Run)
create extension if not exists "pgcrypto";

create table if not exists public.photos (
  id uuid primary key,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  author text
);

alter table public.photos enable row level security;

-- Запросы к таблице только с service_role (ваш Node-сервер). Политики anon не нужны.

-- 2) Bucket в Dashboard: Storage → New bucket → имя wedding-photos → Public ✓
--    Либо (опционально) через SQL:
-- insert into storage.buckets (id, name, public)
-- values ('wedding-photos', 'wedding-photos', true)
-- on conflict (id) do update set public = excluded.public;

-- Для публичного чтения объектов в открытом bucket политики Storage создаются автоматически в UI.
-- Загрузка идёт только с сервера с service_role, клиент напрямую в Storage не ходит.
