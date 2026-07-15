-- Janos Control - initial database schema
-- Run as a single migration in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  code text not null,
  event_date date not null,
  salon text not null,
  event_type text not null default 'Otro',
  honoree text not null,
  client_name text,
  guests integer not null default 0 check (guests >= 0),
  pack text not null check (pack in ('silver', 'gold', 'vip', 'informal')),
  addons jsonb not null default '[]'::jsonb,
  flex_services jsonb not null default '[]'::jsonb,
  notes text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, code)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  task_key text not null,
  title text not null,
  phase text not null,
  status text not null default 'pending' check (status in ('pending', 'waiting', 'progress', 'done', 'na')),
  responsible text,
  notes text,
  completed_at timestamptz,
  payable boolean not null default false,
  rendition_category text,
  rendition_work text,
  rate_key text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, task_key)
);

create table if not exists public.renditions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  category text not null,
  work text not null,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'submitted', 'approved', 'paid')),
  observations text,
  submitted_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists renditions_owner_task_unique
  on public.renditions (owner_id, task_id)
  where task_id is not null;

create table if not exists public.rates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  rate_key text not null,
  label text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  unique (owner_id, rate_key, valid_from)
);

create index if not exists clients_owner_event_date_idx on public.clients (owner_id, event_date);
create index if not exists tasks_owner_status_idx on public.tasks (owner_id, status);
create index if not exists tasks_client_idx on public.tasks (client_id);
create index if not exists renditions_owner_status_idx on public.renditions (owner_id, status);
create index if not exists rates_owner_lookup_idx on public.rates (owner_id, rate_key, valid_from desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at before update on public.clients
for each row execute function public.set_updated_at();
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.set_updated_at();
drop trigger if exists renditions_set_updated_at on public.renditions;
create trigger renditions_set_updated_at before update on public.renditions
for each row execute function public.set_updated_at();
drop trigger if exists rates_set_updated_at on public.rates;
create trigger rates_set_updated_at before update on public.rates
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.tasks enable row level security;
alter table public.renditions enable row level security;
alter table public.rates enable row level security;

drop policy if exists profiles_own_rows on public.profiles;
create policy profiles_own_rows on public.profiles
for all to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists clients_own_rows on public.clients;
create policy clients_own_rows on public.clients
for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists tasks_own_rows on public.tasks;
create policy tasks_own_rows on public.tasks
for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.clients
    where clients.id = tasks.client_id
      and clients.owner_id = (select auth.uid())
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.clients
    where clients.id = tasks.client_id
      and clients.owner_id = (select auth.uid())
  )
);

drop policy if exists renditions_own_rows on public.renditions;
create policy renditions_own_rows on public.renditions
for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.clients
    where clients.id = renditions.client_id
      and clients.owner_id = (select auth.uid())
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.clients
    where clients.id = renditions.client_id
      and clients.owner_id = (select auth.uid())
  )
);

drop policy if exists rates_own_rows on public.rates;
create policy rates_own_rows on public.rates
for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

revoke all on table public.profiles, public.clients, public.tasks, public.renditions, public.rates from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.profiles, public.clients, public.tasks, public.renditions, public.rates to authenticated;

