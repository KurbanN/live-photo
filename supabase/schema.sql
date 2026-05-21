-- Полная схема Guestroll / live-photo (новые установки)
create extension if not exists "pgcrypto";

create table if not exists public.photos (
  id uuid primary key,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  author text,
  event_id uuid,
  status text not null default 'approved'
);

create table if not exists public.organizers (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  organizer_id uuid references public.organizers (id) on delete set null,
  title text not null default 'Мероприятие',
  pin_hash text,
  pin_enabled boolean not null default true,
  status text not null default 'active',
  plan text not null default 'party',
  photo_limit int not null default 2000,
  moderation_enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.photos
  add constraint photos_event_id_fkey foreign key (event_id) references public.events (id) on delete cascade;

create table if not exists public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  status text not null default 'pending',
  storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.photos enable row level security;
alter table public.events enable row level security;
alter table public.organizers enable row level security;

-- Storage: bucket wedding-photos (public read). Upload только через API + service_role.
