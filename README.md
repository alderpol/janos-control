# Janos Control

## Stack
- **Frontend:** Vanilla JavaScript (sin frameworks), bundleado con Vite
- **Backend:** Supabase (proyecto: `mybeysibpwoaudohxomr`)
- **Deploy:** Vercel (auto-deploy desde GitHub)
- **Repo:** github.com/alderpol/janos-control
- **URL producción:** janos-control.vercel.app

---

## Archivos principales

| Archivo | Descripción |
|---|---|
| `app.js` | Lógica completa de la app |
| `cloud.js` | Integración con Supabase Auth y base de datos |
| `index.html` | Estructura HTML |
| `styles.css` | Estilos dark/gold (variables CSS: `--gold`, `--surface`, `--muted`, `--red`, etc.) |
| `supabase/functions/` | Edge Functions — **siempre deployar desde este repo, nunca a mano sin commitear después** (esto ya nos hizo perder código dos veces) |

---

## Edge Functions

Deployar con:
```bash
npx supabase functions deploy <nombre> --project-ref mybeysibpwoaudohxomr
```

| Función | Descripción | JWT |
|---|---|---|
| `notify-user-approved` | Email al usuario cuando el admin lo aprueba. Requiere ser admin activo (verificado adentro de la función). | Requerido |
| `notify-admin` | Avisa al admin por email cuando hay un usuario nuevo esperando aprobación. Solo envía si existe un perfil `blocked` con ese email/nombre (evita spam). | Requerido (pero no exige rol admin — se llama antes de que exista sesión de admin) |
| `list-profiles` | Lista todos los perfiles (bypasea RLS con service role). Requiere admin. | Requerido |
| `delete-user` | Elimina usuario de Auth y profiles. Requiere admin. | Requerido |
| `export-user` | Exporta los datos propios del usuario autenticado (usa su JWT, no service role — el RLS ya limita el resultado). | Requerido |
| `backup-daily` | Exporta todos los datos y los envía por email (cron: 8hs, 14hs, 23hs ARG). Requiere el header `x-cron-secret` con el valor de `BACKUP_CRON_SECRET` — configurar ese header en el cron job. | **`--no-verify-jwt`** (la autorización es el secreto propio, no un JWT) |
| `google-calendar-auth` | Dos modos: `POST` (con JWT del usuario) devuelve una URL de consentimiento con `state` firmado (HMAC); `GET` es el callback de Google, verifica el `state`, intercambia el código por tokens y guarda `refresh_token` en `profiles`. | **`--no-verify-jwt`** (Google llama al callback sin nuestro JWT) |
| `google-calendar-events` | Lee eventos del Google Calendar del usuario del mes pedido, usando su `refresh_token` guardado. | Requerido |

---

## Base de datos (tablas)

`profiles`, `clients`, `tasks`, `renditions`, `rates`

### Cambios de esquema importantes
```sql
-- Permite rendiciones manuales sin cliente asociado
ALTER TABLE renditions ALTER COLUMN client_id DROP NOT NULL;

-- Token de Google Calendar por usuario
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;
```

### Orden de migraciones
Las migraciones se aplican en orden por nombre de archivo. Si algún día se
agrega una que dependa de una función/policy definida en otra, verificar que
el nombre (fecha) quede *después* de esa dependencia, o un `supabase db
reset` desde cero se rompe a mitad de camino. (Esto ya pasó una vez con
`is_app_admin()` — ver `20260623_fix_profiles_rls.sql`.)

---

## Autenticación

- **Admin:** `fotoyvideojanosquinta@gmail.com`
- Nuevos usuarios quedan con `status=blocked` hasta que el admin los aprueba.
  Esto lo garantiza un trigger en `auth.users` (`handle_new_user`, ver
  `20260701_block_new_users_by_default.sql`) que crea el perfil ya bloqueado
  apenas se registra alguien — no depende de que el navegador sincronice nada.
- Email via Resend (`onboarding@resend.dev`), solo puede enviar a emails verificados en Resend
- **Confirm email: DESACTIVADO** en Supabase

### RLS profiles
- `SELECT`: `auth.uid() = id` **o** `is_app_admin()` (función `security definer`, evita recursión)
- `INSERT`/`UPDATE`: solo la propia fila (`id = auth.uid()`), y solo columnas no sensibles (`display_name`, `email`, `whatsapp`, `last_seen_at`, `settings`) — `role`, `status` y `google_refresh_token` no son escribibles por el cliente
- Para que admin vea todos los perfiles también existe la Edge Function `list-profiles` (usa service role)

### RLS clients / tasks / renditions / rates
Aisladas por `owner_id = auth.uid()`: cada usuario solo ve **sus propios**
clientes/tareas/rendiciones/tarifas, ni siquiera el admin ve las de otros
salvo vía Edge Functions con service role. Esto es una decisión de diseño
pendiente de confirmar si se ajusta a cómo trabaja el equipo (¿cartera
compartida entre fotógrafos o cada uno la suya?).

---

## Google Calendar Integration

- **Google Cloud proyecto:** `control-janos` (ID: `985985340766`)
- **OAuth Client ID:** `985985340766-fjj6i28rq0gg4ei2o6igddva253v4ead.apps.googleusercontent.com`
- **Redirect URI:** `https://mybeysibpwoaudohxomr.supabase.co/functions/v1/google-calendar-auth`
- **Scope:** `https://www.googleapis.com/auth/calendar.readonly` (solo lectura)
- **Modo:** Testing — agregar emails de usuarios en Google Auth Platform → Público → Usuarios de prueba
- Cada usuario conecta su propio Google Calendar; el token se guarda en `profiles.google_refresh_token`
- El botón "Conectar Google Calendar" ahora pide primero un `state` firmado
  (HMAC con `GOOGLE_OAUTH_STATE_SECRET`) a `google-calendar-auth` antes de
  redirigir a Google — evita que alguien arme la URL a mano con el id de
  otra persona como `state`.
- Los eventos aparecen en azul claro en la vista Calendario, junto a los eventos de clientes (dorados)

---

## Variables de entorno en Supabase

```
RESEND_API_KEY
SUPABASE_SERVICE_ROLE_KEY   ← disponible nativamente en Edge Functions
SUPABASE_URL                ← disponible nativamente en Edge Functions
SUPABASE_ANON_KEY           ← disponible nativamente en Edge Functions
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_OAUTH_STATE_SECRET   ← nuevo: string random largo, para firmar el state del OAuth
BACKUP_CRON_SECRET          ← nuevo: string random, configurar el mismo valor como header x-cron-secret en el cron que llama a backup-daily
```

Generar secretos random, por ejemplo:
```bash
openssl rand -hex 32
```

---

## Decisiones técnicas importantes

- No usar JWT hooks (requiere plan Team/Enterprise)
- No usar `localStorage` en artifacts de Claude
- Patrón deploy: GitHub web o WSL → Vercel auto-deploy
- Pablo recibe archivos completos modificados para subir a GitHub
- Para reemplazos complejos en `app.js`: usar Python3 inline via `bash_tool` en lugar de `sed`
- El prefijo `SUPABASE_` no se puede usar para secretos custom, pero `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` están disponibles nativamente en Edge Functions
- Todo Edge Function que dispare un email o modifique datos debe verificar quién la llama (JWT + rol, o un secreto compartido si la llama un cron) — no confiar en que la anon key ya es suficiente autorización

---

## Estética

Dark/cinematic · Acentos dorados (`#c9a84c`) · Tipografía Inter

---

## Reglas de trabajo con Claude

1. **Al inicio de cada sesión** donde se modifique `app.js`, `styles.css` o `index.html`: preguntar si los archivos del proyecto están actualizados antes de tocar nada.
2. Siempre usar el archivo con más líneas / más reciente como base.
3. Nunca trabajar desde `/mnt/project/` si hay un output más actualizado en la sesión actual.
4. Después de cada sesión: subir los outputs a la carpeta local → GitHub → y al proyecto de Claude.
5. **Nunca deployar una Edge Function sin commitear su código al repo primero** (o inmediatamente después). Esto ya causó que `export-user` y toda la integración de Google Calendar quedaran huérfanas — funcionando en producción pero invisibles en git.

---

## Importación masiva de clientes (CSV desde fotografia.janosgroup.com)

Pablo carga tandas nuevas de clientes (por salón: Pilar Hotel, Quinta, etc.) exportando PDFs desde `fotografia.janosgroup.com` (vista "Seguimiento", filtrada por salón + rango de fechas) y pidiendo que se arme el CSV para importar en Janos Control. Proceso a seguir:

**Formato del CSV** (separador `;`, UTF-8 con BOM), columnas en este orden:
`codigo;fecha_evento;salon;tipo;homenajeado;cliente;email;whatsapp;invitados;pack_upgrades;adicionales;servicios_flex;observaciones`

**Mapeo desde la tabla del PDF** (columnas: Fecha Evento, Codigo Evento, Tipo, Pack, Salon, Invitados, Fotografia, Cliente, Celular, Homenajead@):
- `salon`: debe coincidir EXACTO con una entrada de `MANAGED_SALONS` en `app.js` (ej. "Pilar Hotel", "Quinta"), no el texto crudo de la columna "Salon" del PDF (ej. "113 - Pilar Hotel").
- `homenajeado`: si el PDF trae "-" o "." (placeholder de vacío), dejarlo en blanco en el CSV — así el importador cae en el fallback al nombre de `cliente` en vez de guardar literalmente "-".
- `pack_upgrades`: copiar tal cual la columna "Fotografia" del PDF, ej. `(GOLD)(MAQUI)(PANT)` — `parsePack()`/`parseAddons()` en `app.js` interpretan pack (SILVER/GOLD/VIP/INFORMAL) y adicionales vía regex sobre ese texto entre paréntesis, tiene que mantener ese formato.
- `adicionales` y `servicios_flex`: vacíos (ya cubierto por `pack_upgrades`).
- `observaciones`: `Contrato: <valor>`, usando la columna "Pack" del PDF (All Inclusive / Boda / Golden Pack / Premium / Egresados VIP / Informal) — es una categoría distinta de `pack_upgrades` que no está modelada en Janos Control, se deja solo de referencia.
- `email`: **no viene en el PDF de Seguimiento.** Hay que buscarlo aparte (ver abajo). El importador de CSV recién soporta esta columna desde el fix del 17/07/2026 (acepta alias `email`/`correo`/`mail`/`email_cliente`/`correo_electronico`, escribe en `clientEmail`) — si en algún momento no aparece un campo Email en el formulario de cliente, puede ser que ese fix se haya perdido; revisar `importClientCsv()`.

**Cómo sacar el email:** cada cliente tiene una ficha en `https://fotografia.janosgroup.com/ver_seguimiento.php?id=<codigo_evento>` con una tabla "Informacion del cliente" (columnas Nombre y Apellido / Telefono 1 / Telefono 2 / Mail). Con la extensión de Chrome conectada (la sesión suele seguir logueada de usos anteriores), usar `browser_batch` combinando `navigate` + `get_page_text` por cada código, en tandas de ~15 códigos por llamada — mucho más rápido que uno por uno. No usar `fetch()` con `credentials:'include'` vía `javascript_tool`: lo bloquea el filtro de seguridad por verse como exfiltración de cookies/sesión.

**Verificación:** la extracción automática de tablas de `pdfplumber` no funciona bien con el layout de export de este sitio (fragmenta filas). Conviene transcribir leyendo el PDF renderizado y después validar cada código/teléfono contra `pdfplumber`'s `page.extract_text()` (texto plano, sí es confiable) para detectar errores de tipeo antes de dar el CSV por bueno.

**Entrega:** el CSV final va a la raíz de esta carpeta; Pablo lo importa él mismo desde Clientes → "Importar lote".
