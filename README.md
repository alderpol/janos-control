# Janos Control

## Stack
- **Frontend:** Vanilla JavaScript (sin frameworks)
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
| `supabase/functions/` | Edge Functions deployadas via WSL |

---

## Edge Functions

Deployar con:
```bash
npx supabase functions deploy <nombre> --project-ref mybeysibpwoaudohxomr
```

| Función | Descripción | JWT |
|---|---|---|
| `notify-user-approved` | Email al usuario cuando el admin lo aprueba | Requerido |
| `list-profiles` | Lista todos los perfiles (bypasea RLS con service role) | Requerido |
| `delete-user` | Elimina usuario de Auth y profiles | Requerido |
| `backup-daily` | Exporta todos los datos y los envía por email (cron: 8hs, 14hs, 23hs ARG) | Requerido |
| `export-user` | Exporta datos de un usuario específico | Requerido |
| `google-calendar-auth` | Recibe redirect OAuth de Google, intercambia código por tokens y guarda refresh_token en profiles | **`--no-verify-jwt`** |
| `google-calendar-events` | Lee eventos del Google Calendar del usuario usando su refresh_token guardado | Requerido |

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

---

## Autenticación

- **Admin:** `fotoyvideojanosquinta@gmail.com`
- Nuevos usuarios quedan con `status=blocked` hasta que el admin los aprueba
- Email via Resend (`onboarding@resend.dev`), solo puede enviar a emails verificados en Resend
- **Confirm email: DESACTIVADO** en Supabase

### RLS profiles
- `SELECT`: `auth.uid() = id` (evita recursión)
- Para que admin vea todos los perfiles usa la Edge Function `list-profiles`

---

## Google Calendar Integration

- **Google Cloud proyecto:** `control-janos` (ID: `985985340766`)
- **OAuth Client ID:** `985985340766-fjj6i28rq0gg4ei2o6igddva253v4ead.apps.googleusercontent.com`
- **Redirect URI:** `https://mybeysibpwoaudohxomr.supabase.co/functions/v1/google-calendar-auth`
- **Scope:** `https://www.googleapis.com/auth/calendar.readonly` (solo lectura)
- **Modo:** Testing — agregar emails de usuarios en Google Auth Platform → Público → Usuarios de prueba
- Cada usuario conecta su propio Google Calendar; el token se guarda en `profiles.google_refresh_token`
- Los eventos aparecen en azul claro en la vista Calendario, junto a los eventos de clientes (dorados)

---

## Variables de entorno en Supabase

```
RESEND_API_KEY
SUPABASE_SERVICE_ROLE_KEY   ← disponible nativamente en Edge Functions
SUPABASE_URL                ← disponible nativamente en Edge Functions
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

---

## Decisiones técnicas importantes

- No usar JWT hooks (requiere plan Team/Enterprise)
- No usar `localStorage` en artifacts de Claude
- Patrón deploy: GitHub web o WSL → Vercel auto-deploy
- Pablo recibe archivos completos modificados para subir a GitHub
- Para reemplazos complejos en `app.js`: usar Python3 inline via `bash_tool` en lugar de `sed`
- El prefijo `SUPABASE_` no se puede usar para secretos custom, pero `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` están disponibles nativamente en Edge Functions

---

## Estética

Dark/cinematic · Acentos dorados (`#c9a84c`) · Tipografía Inter

---

## Reglas de trabajo con Claude

1. **Al inicio de cada sesión** donde se modifique `app.js`, `styles.css` o `index.html`: preguntar si los archivos del proyecto están actualizados antes de tocar nada.
2. Siempre usar el archivo con más líneas / más reciente como base.
3. Nunca trabajar desde `/mnt/project/` si hay un output más actualizado en la sesión actual.
4. Después de cada sesión: subir los outputs a la carpeta local → GitHub → y al proyecto de Claude.
