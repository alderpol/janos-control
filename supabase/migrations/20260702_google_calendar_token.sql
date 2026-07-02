-- Reconstruida: esta columna existía en producción (mencionada en el
-- README) pero nunca se había subido como migración al repo.
alter table public.profiles
  add column if not exists google_refresh_token text;

-- El refresh token es sensible: nadie más allá del propio dueño de la fila
-- (o un admin, cubierto por profiles_select) debería poder leerlo vía
-- select *, así que no se agrega ninguna policy nueva — ya queda cubierto
-- por profiles_select / profiles_update. Las Edge Functions que necesitan
-- leerlo/escribirlo (google-calendar-auth, google-calendar-events) usan el
-- service role, no el cliente del navegador.
