# Janos Control

MVP local para seguimiento de clientes, tareas y rendiciones de fotografía y video.

## Uso

Crear `.env.local` a partir de `.env.example` y ejecutar:

```bash
pnpm install
pnpm dev
```

Con variables de Supabase configuradas, los datos se sincronizan con la nube y `localStorage` funciona como respaldo local. Desde Configuración se puede exportar e importar una copia JSON.

El esquema preparado para la migración a Supabase está en `supabase/migrations/20260619_initial_schema.sql` e incluye RLS para aislar los datos de cada usuario.

## Registro con código por email

La aplicación permite crear una cuenta con nombre, apellido, WhatsApp y email. Supabase guarda esos datos en los metadatos del usuario y RLS mantiene separados los clientes y trabajos de cada cuenta.

Para que Supabase envíe un código de seis dígitos en lugar de un enlace, abrir **Authentication > Emails > Templates > Magic Link** y usar `{{ .Token }}` en el cuerpo del mensaje. Por ejemplo:

```html
<h2>Tu código de seguridad</h2>
<p>Ingresá este código en Janos Control:</p>
<p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">{{ .Token }}</p>
<p>El código vence pronto y solo puede utilizarse una vez.</p>
```

## Alcance inicial

- Alta y edición de clientes.
- Importación masiva de clientes desde CSV con actualización por código de evento.
- Packs Silver, Golden/All Inclusive, VIP e Informal.
- Adicionales y selecciones Mini Flex/Flex.
- Checklist operativo por cliente.
- Generación automática de rendiciones al completar tareas remuneradas.
- Estados de rendición y tarifas editables.
- Diseño adaptable a escritorio y celular.
