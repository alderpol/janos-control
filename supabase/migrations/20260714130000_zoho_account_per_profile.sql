-- Cada usuario (colega) puede cargar su propia cuenta de Zoho Mail para
-- enviar el material al cliente, en vez de depender de las 2 cuentas fijas
-- (Quinta / Pilar Hotel) configuradas como variables de entorno en Vercel.
-- api/send-drive-email.js prioriza esta cuenta si está cargada; si no, cae
-- al mapa fijo por salón como hasta ahora.
alter table public.profiles
  add column if not exists zoho_email text,
  add column if not exists zoho_app_password text,
  add column if not exists zoho_from_name text;
