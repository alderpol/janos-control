-- "Marcar resuelto" en las alertas de conflicto (ej. Libro Combo sin sesión) solo
-- vivía en localStorage: nunca se guardaba en la nube, así que cada vez que la app
-- recargaba el estado desde Supabase (loadCloudState) la alerta volvía a aparecer.
alter table public.clients
  add column if not exists dismissed_conflicts jsonb;
