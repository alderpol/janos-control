-- ROLLBACK / RESPALDO — no se aplica solo, es la copia de como estaban las
-- cosas ANTES del hardening de seguridad del 2026-07-15 (ver migracion
-- 20260715_security_hardening.sql). Si algo se rompe (login, registro,
-- bloqueo de usuarios), correr este archivo entero restaura el estado
-- anterior exacto.

-- 1) is_admin(): funcion vieja sin uso que se borro. Para restaurarla:
create or replace function public.is_admin()
 returns boolean
 language sql
 security definer
as $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$function$;
grant execute on function public.is_admin() to public;

-- 2) custom_access_token_hook: volver a dejarla ejecutable por cualquiera
-- (como estaba antes: permiso directo a anon y authenticated, no via
-- "public"). El cuerpo de la funcion no se toco, solo el permiso.
grant execute on function public.custom_access_token_hook(jsonb) to anon, authenticated;

-- 3) handle_new_user: volver a dejarla ejecutable por cualquiera (como
-- estaba antes: permiso directo a anon y authenticated). El cuerpo de la
-- funcion no se toco, solo el permiso.
grant execute on function public.handle_new_user() to anon, authenticated;

-- 4) admin_set_user_status: volver a dejarla ejecutable tambien por
-- usuarios no logueados (anon), como estaba antes.
grant execute on function public.admin_set_user_status(uuid, text) to anon;

-- 5) custom_access_token_hook: search_path mutable (como estaba antes).
alter function public.custom_access_token_hook(jsonb) reset search_path;
