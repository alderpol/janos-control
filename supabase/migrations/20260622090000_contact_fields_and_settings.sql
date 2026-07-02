alter table public.clients
  add column if not exists client_phone text,
  add column if not exists contacted_at timestamptz;

alter table public.profiles
  add column if not exists settings jsonb not null default '{}'::jsonb;

