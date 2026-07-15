-- Fix #1: las rendiciones manuales pierden is_manual / event_date / salon
-- al pasar por la nube porque las columnas no existen en la tabla.
-- Estas columnas permiten que syncCloudState las persista y loadCloudState
-- las reconstruya, evitando que aparezcan como "Cliente eliminado" tras
-- recargar desde otro dispositivo.

ALTER TABLE renditions ADD COLUMN IF NOT EXISTS is_manual  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE renditions ADD COLUMN IF NOT EXISTS event_date DATE;
ALTER TABLE renditions ADD COLUMN IF NOT EXISTS salon      TEXT;

-- Backfill defensivo: cualquier rendición existente sin cliente asociado
-- solo pudo haberse creado manualmente (client_id ya es nullable desde la
-- migración que habilitó rendiciones manuales).
UPDATE renditions SET is_manual = TRUE WHERE client_id IS NULL AND is_manual = FALSE;
