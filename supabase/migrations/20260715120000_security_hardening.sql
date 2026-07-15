-- Endurecimiento de seguridad pedido por el usuario el 2026-07-15.
-- Backup del estado anterior en ROLLBACK_20260715_security_hardening.sql
-- (mismo directorio).
--
-- Hallazgo: estas funciones son SECURITY DEFINER (corren con privilegios
-- elevados, saltando RLS) y estaban con permiso de ejecucion directo para
-- anon/authenticated via /rest/v1/rpc/<nombre>, cuando en realidad solo
-- deberian dispararlas el propio sistema de autenticacion de Supabase
-- (custom_access_token_hook, handle_new_user) o quedar mas acotadas
-- (admin_set_user_status).

-- 1) custom_access_token_hook: arma los claims del JWT al loguearse.
-- Solo debe poder invocarla supabase_auth_admin (el servicio de Auth).
-- Sin esto, cualquier usuario logueado (o anonimo) podia llamarla
-- directamente con un userId ajeno y averiguar si esa persona es admin.
revoke execute on function public.custom_access_token_hook(jsonb) from anon, authenticated;

-- 2) handle_new_user: crea la fila de profiles al registrarse. Solo se
-- dispara como trigger en auth.users (insert); no necesita ser ejecutable
-- directamente por nadie via API.
revoke execute on function public.handle_new_user() from anon, authenticated;

-- 3) admin_set_user_status: bloquea/reactiva usuarios. Ya validaba
-- internamente que quien llama sea admin activo, pero no hacia falta que
-- estuviera expuesta a usuarios anonimos (no logueados).
revoke execute on function public.admin_set_user_status(uuid, text) from anon;

-- 4) is_admin(): funcion vieja sin uso (no la referencia ninguna politica
-- RLS ni funcion del proyecto — confirmado por grep en el repo y consulta
-- a pg_policies). Ademas tenia el search_path mutable (otro warning del
-- linter). Se borra en vez de parchearla.
drop function if exists public.is_admin();

-- 5) custom_access_token_hook tenia el search_path mutable (mismo tipo de
-- warning que is_admin). No cambia la logica, solo lo fija para que no
-- pueda ser manipulado.
alter function public.custom_access_token_hook(jsonb) set search_path = public;
