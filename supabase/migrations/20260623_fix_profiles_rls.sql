-- Renamed from 20260622_fix_profiles_rls.sql to 20260623 so it runs AFTER
-- 20260622_user_access_control.sql, which defines public.is_app_admin().
-- Running in the old order broke a fresh `supabase db reset` / db push
-- from scratch ("function public.is_app_admin() does not exist").
-- This also removes the redundant profiles_admin_read policy created in
-- user_access_control.sql, since profiles_select already covers admins.
-- Uses drop-if-exists on every policy so it's safe to re-run regardless
-- of whether an earlier manual fix already created these.
drop policy if exists profiles_own_rows on public.profiles;
drop policy if exists profiles_admin_read on public.profiles;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;

create policy profiles_select on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or public.is_app_admin()
);

create policy profiles_insert on public.profiles
for insert to authenticated
with check (id = (select auth.uid()));

create policy profiles_update on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));
