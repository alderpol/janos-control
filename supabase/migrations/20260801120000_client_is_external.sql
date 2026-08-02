alter table public.clients
  add column if not exists is_external boolean not null default false;
