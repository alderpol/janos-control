-- Fixes a real access-control bug: new signups were getting status='active'
-- automatically (DB default was 'active', and no profile row existed until
-- the client's first cloud sync, which never set status explicitly). The
-- "pending approval" screen in app.js never actually blocked anyone.
--
-- Fix: create the profile row server-side, at the moment the auth user is
-- created, already status='blocked'. This works even if the browser never
-- calls syncCloudState (e.g. the user is blocked before ever touching data).

-- 1) Safer default: any future direct insert without an explicit status
--    starts blocked instead of active.
alter table public.profiles
  alter column status set default 'blocked';

-- 2) Auto-create the profile row on signup, already blocked, using the
--    metadata passed to supabase.auth.signUp() (first_name/last_name/whatsapp).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email, whatsapp, status, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email,
    new.raw_user_meta_data->>'whatsapp',
    'blocked',
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Note: this trigger only affects NEW signups going forward. It does not
-- touch any existing profiles row, so current active users are unaffected.
-- If you ever rebuild the DB from scratch, remember the very first user
-- won't be admin/active automatically anymore (the old bootstrap query in
-- 20260622_user_access_control.sql only sets role='admin', not status) —
-- you'd need to manually set status='active' for that first admin account.
