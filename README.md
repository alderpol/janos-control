# Janos Control

MVP local para seguimiento de clientes, tareas y rendiciones de fotografía y video.

## Uso

Abrir `index.html` en un navegador moderno o servir la carpeta con un servidor HTTP local.

Los datos se guardan en `localStorage` del navegador. Desde Configuración se puede exportar e importar una copia JSON.

El esquema preparado para la migración a Supabase está en `supabase/migrations/20260619_initial_schema.sql` e incluye RLS para aislar los datos de cada usuario.

## Alcance inicial

- Alta y edición de clientes.
- Importación masiva de clientes desde CSV con actualización por código de evento.
- Packs Silver, Golden/All Inclusive, VIP e Informal.
- Adicionales y selecciones Mini Flex/Flex.
- Checklist operativo por cliente.
- Generación automática de rendiciones al completar tareas remuneradas.
- Estados de rendición y tarifas editables.
- Diseño adaptable a escritorio y celular.
