alter table public.profiles
  add column if not exists email text,
  add column if not exists whatsapp text,
  add column if not exists role text not null default 'user' check (role in ('user', 'admin')),
  add column if not exists status text not null default 'active' check (status in ('active', 'blocked')),
  add column if not exists last_seen_at timestamptz;

update public.profiles
set role = 'admin'
where id = (select id from auth.users order by created_at asc limit 1);

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_app_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read on public.profiles
for select to authenticated
using (public.is_app_admin());

create or replace function public.admin_set_user_status(target_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Acceso de administrador requerido';
  end if;
  if target_id = auth.uid() then
    raise exception 'No puedes bloquear tu propia cuenta';
  end if;
  if new_status not in ('active', 'blocked') then
    raise exception 'Estado inválido';
  end if;
  update public.profiles set status = new_status where id = target_id;
end;
$$;

grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.is_app_active() to authenticated;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;

revoke insert, update on table public.profiles from authenticated;
grant insert (id, display_name, email, whatsapp, last_seen_at, settings) on public.profiles to authenticated;
grant update (id, display_name, email, whatsapp, last_seen_at, settings) on public.profiles to authenticated;

drop policy if exists clients_own_rows on public.clients;
create policy clients_own_rows on public.clients for all to authenticated
using (owner_id = (select auth.uid()) and public.is_app_active())
with check (owner_id = (select auth.uid()) and public.is_app_active());

drop policy if exists rates_own_rows on public.rates;
create policy rates_own_rows on public.rates for all to authenticated
using (owner_id = (select auth.uid()) and public.is_app_active())
with check (owner_id = (select auth.uid()) and public.is_app_active());

drop policy if exists tasks_own_rows on public.tasks;
create policy tasks_own_rows on public.tasks for all to authenticated
using (owner_id = (select auth.uid()) and public.is_app_active())
with check (owner_id = (select auth.uid()) and public.is_app_active());

drop policy if exists renditions_own_rows on public.renditions;
create policy renditions_own_rows on public.renditions for all to authenticated
using (owner_id = (select auth.uid()) and public.is_app_active())
with check (owner_id = (select auth.uid()) and public.is_app_active());
