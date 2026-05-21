-- Роли: admin (платформа) и organizer (может создавать мероприятия)
alter table public.organizers
  add column if not exists role text not null default 'pending'
  check (role in ('admin', 'organizer', 'pending'));

create table if not exists public.organizer_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  granted_by uuid references public.organizers (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists organizer_invites_email_idx on public.organizer_invites (lower(email));
