-- El índice único de renditions era PARCIAL (where task_id is not null). Eso
-- impide usar ON CONFLICT (owner_id, task_id) desde supabase-js/PostgREST sin
-- repetir también ese predicado -algo que la API no permite pasar-, así que
-- el upsert de rendiciones fallaría con "no unique or exclusion constraint
-- matching ON CONFLICT specification" para TODAS las filas si se intentara
-- ese fix directamente sobre el índice parcial actual.
--
-- Un UNIQUE constraint normal logra exactamente el mismo comportamiento de
-- negocio: por semántica estándar de SQL, un NULL nunca se considera igual a
-- otro NULL en una restricción única, así que varias rendiciones manuales
-- (task_id null) siguen pudiendo coexistir sin chocar entre sí, igual que
-- con el índice parcial. La única diferencia es que ahora sí se puede usar
-- como target de ON CONFLICT.
--
-- Mismo motivo por el que ya se corrigió el guardado de tareas (ver el
-- comentario sobre tasks_client_id_task_key_key en cloud.js): si una
-- rendición ya existente cambia de id localmente, o queda un id viejo
-- huérfano de otra sesión/dispositivo, el upsert por id chocaba contra esta
-- restricción y frenaba toda la sincronización con un 409 en loop.
drop index if exists public.renditions_owner_task_unique;
alter table public.renditions
  add constraint renditions_owner_task_unique unique (owner_id, task_id);
