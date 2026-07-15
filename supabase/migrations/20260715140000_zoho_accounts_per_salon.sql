-- Reemplaza las 3 columnas planas (zoho_email/zoho_app_password/zoho_from_name,
-- agregadas en 20260714130000_zoho_account_per_profile.sql) por una sola
-- columna jsonb que permite guardar una cuenta de Zoho DISTINTA por cada
-- salon en el que trabaja el usuario, ej:
--   {"Quinta": {"email":"...","password":"...","fromName":"..."}, "Pilar Hotel": {...}}
-- Motivo: un usuario que trabaja en 2 salones (como Pablo, con Quinta y
-- Pilar Hotel) necesita 2 cuentas de Zoho distintas, no una sola.
-- Nadie habia cargado datos todavia en las columnas viejas al momento de
-- este cambio, asi que no hizo falta migrar datos existentes.
alter table public.profiles add column if not exists zoho_accounts jsonb not null default '{}'::jsonb;
alter table public.profiles drop column if exists zoho_email;
alter table public.profiles drop column if exists zoho_app_password;
alter table public.profiles drop column if exists zoho_from_name;

-- Mismo motivo que el grant de 20260714140000: solo esta columna, no toda
-- la tabla (profiles tiene role/status que no deben ser editables por el
-- propio usuario vía este permiso).
grant update (zoho_accounts) on public.profiles to authenticated;
