-- SaaS: events, organizers linkage, photos per event
create extension if not exists "pgcrypto";

-- Organizer profile (linked to Supabase Auth user id)
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
  status text not null default 'active' check (status in ('draft', 'active', 'ended', 'archived')),
  plan text not null default 'party' check (plan in ('lite', 'party', 'premium')),
  photo_limit int not null default 2000,
  moderation_enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_organizer_id_idx on public.events (organizer_id);
create index if not exists events_slug_idx on public.events (slug);

-- Extend photos (legacy rows get event_id via seed script)
alter table public.photos add column if not exists event_id uuid references public.events (id) on delete cascade;
alter table public.photos add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved', 'rejected'));

create index if not exists photos_event_id_created_at_idx on public.photos (event_id, created_at desc);
create index if not exists photos_event_status_idx on public.photos (event_id, status);

-- Export jobs (ZIP)
create table if not exists public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.events enable row level security;
alter table public.organizers enable row level security;
alter table public.export_jobs enable row level security;

-- API uses service_role; RLS blocks anon direct access
create policy "organizers_select_own" on public.organizers for select using (auth.uid() = id);
create policy "organizers_insert_own" on public.organizers for insert with check (auth.uid() = id);
create policy "events_select_own" on public.events for select using (auth.uid() = organizer_id);
create policy "events_insert_own" on public.events for insert with check (auth.uid() = organizer_id);
create policy "events_update_own" on public.events for update using (auth.uid() = organizer_id);
create policy "export_jobs_select_own" on public.export_jobs for select using (
  exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
);
