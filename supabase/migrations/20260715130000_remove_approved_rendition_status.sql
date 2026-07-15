-- El estado "approved" de las rendiciones no se usaba (0 filas con ese
-- valor) y no aportaba nada al flujo real (pendiente -> rendido -> pagado).
-- Se saca de los valores permitidos. Ver tambien RENDITION_STATUS en app.js.
alter table public.renditions drop constraint if exists renditions_status_check;
alter table public.renditions add constraint renditions_status_check check (status = any (array['pending'::text,'submitted'::text,'paid'::text]));
