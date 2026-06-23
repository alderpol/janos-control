drop policy if exists profiles_own_rows on public.profiles;
drop policy if exists profiles_admin_read on public.profiles;

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
