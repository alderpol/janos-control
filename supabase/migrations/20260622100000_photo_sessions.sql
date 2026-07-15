alter table public.clients
  add column if not exists photo_session jsonb;