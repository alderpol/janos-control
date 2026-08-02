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

### Pendiente: 11 migraciones aplicadas a mano sin archivo en git (01/08/2026)
Al reconciliar el historial de migraciones (`supabase db push`/`db pull`) se
detectaron 11 versiones ya aplicadas en producción entre el 14/07, 15/07 y
24/07/2026 (timestamps `20260714220004`, `20260714220536`, `20260714231333`,
`20260715022843`, `20260715024505`, `20260715032759`, `20260715032937`,
`20260715033204`, `20260715034523`, `20260715043044`, `20260724064855`) que
no tienen archivo `.sql` correspondiente en `supabase/migrations/` — se
aplicaron directo por el SQL Editor de Supabase o desde otra máquina, nunca
se commitearon. Se marcaron como `reverted` en la tabla de control de
Supabase (`supabase migration repair --status reverted ...`) solo para que
la CLI deje de bloquear `db push`/`db pull` por el desfasaje — **eso no
deshace sus cambios, siguen aplicados y funcionando en la base real**, sólo
quedan sin documentar en git.
**Para terminar de reconciliarlo:** correr `supabase db pull` con Docker
Desktop instalado y corriendo (lo usa para armar una base "sombra" temporal
y calcular el diff exacto), revisar el/los archivo(s) de migración que
genere antes de commitear, y confirmar con Pablo que el contenido tiene
sentido antes de subirlo.

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
- Patrón deploy: editar con Claude (Read/Edit directo sobre el repo) → Pablo corre `git add/commit/push` desde su terminal → Vercel auto-deploy. **Nunca** "Add file → Upload files" en la web de GitHub para tocar código versionado (ver incidente #9 más abajo) — esa regla vieja de "Pablo recibe archivos completos para subir a GitHub" quedó descartada por eso mismo.
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
6. **Nunca usar "Add file → Upload files" en la web de GitHub para modificar `app.js`, `cloud.js` u otro archivo de código versionado.** Esa función sube el archivo tal cual está en la compu de Pablo en ese momento y pisa lo que haya en el repo sin fusionar ni avisar de conflicto — si es una copia vieja, borra en silencio trabajo más nuevo. El flujo correcto es: Claude edita el archivo directo en el repo (Read/Edit) → Pablo corre `git add/commit/push` desde su terminal. Esto ya pasó dos veces (ver incidente #9).

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

---

## Historial de incidentes y por qué el código es así (17/07/2026)

Esta sección documenta bugs reales que causaron pérdida de datos o bloquearon
el guardado en producción, ya corregidos. El objetivo es que un cambio futuro
(de Pablo o de otra sesión de Claude) no reintroduzca alguno de estos por no
conocer la razón detrás de código que puede parecer innecesario o raro a
primera vista. **No revertir ni "simplificar" nada de esto sin entender el
motivo de abajo primero.**

### 1. Pérdida silenciosa de datos por el límite de 1000 filas de PostgREST (CRÍTICO)
Supabase/PostgREST corta cualquier `select()` sin paginar en 1000 filas
("Max Rows" del proyecto), **sin avisar**. Con esta cuenta superando los
1000 registros de `tasks`, tanto `loadCloudState()` (`cloud.js`) como el
backup diario (`backup-daily`) y el export de "mis datos" (`export-user`)
traían solo una porción parcial de los datos — y esa porción incompleta se
guardaba/exportaba como si fuera el estado completo, con riesgo de que un
guardado posterior borrara de la base lo que en realidad sí existía pero no
se había llegado a leer. Esto causó pérdida real de datos durante semanas
antes de detectarse (backups diarios truncados, tareas ya completadas que
aparecían como pendientes).
**Fix:** `fetchAllRows()`/`fetchAll()` — pagina con `.range()` + un
desempate por `id` hasta traer todas las filas, sin importar cuántas sean.
**Regla:** cualquier `select()` nuevo sobre `clients`, `tasks` o
`renditions` que pueda devolver más de 1000 filas tiene que usar este
helper, nunca un `.select("*")` directo.

### 2. Guardado de tareas en loop de error 409 (`tasks_client_id_task_key_key`)
`upsertInBatches` usaba el conflicto por default de Supabase (`id`). Si una
tarea cambiaba de id localmente o quedaba un id viejo huérfano de otra
sesión/dispositivo, el upsert intentaba un INSERT que chocaba contra la
restricción única real `(client_id, task_key)`, y frenaba TODA la
sincronización en loop.
**Fix:** `onConflict: "client_id,task_key"` en el upsert de tareas.

### 3. Rendiciones duplicadas al re-tildar una tarea ya completada
Mismo mecanismo que el punto 2, pero en `renditions`: sin `onConflict`
explícito, un reintento de guardado podía crear una rendición duplicada
para la misma tarea (esto le pasó a un cliente real: la rendición se
cargaba dos veces al re-tildar checkboxes que habían quedado sin guardar).
El índice único de `renditions` además era **parcial**
(`where task_id is not null`), y `ON CONFLICT` no puede apuntar a un índice
parcial sin repetir su condición — algo que la API de PostgREST no permite.
**Fix:** migración `20260717150000_renditions_full_unique_constraint.sql`
cambia el índice parcial por un `unique constraint (owner_id, task_id)`
normal (por semántica estándar de SQL, `NULL` nunca es igual a otro `NULL`,
así que varias rendiciones manuales con `task_id` null siguen coexistiendo
sin chocar, igual que con el índice parcial — ver punto 4). El upsert de
rendiciones ligadas a tarea usa `onConflict: "owner_id,task_id"`.

### 4. Rendiciones MANUALES (`task_id` null) chocaban con la primary key en cada guardado
Consecuencia no obvia del punto 3: en SQL, `NULL` nunca es igual a otro
`NULL`, así que `ON CONFLICT (owner_id, task_id)` **nunca encuentra** una
fila manual ya existente (task_id null) como "la misma". Postgres intentaba
reinsertarla en cada sincronización, chocando contra la primary key
(`renditions_pkey`) — y como un solo error en el batch frena el resto, esto
bloqueaba el guardado de TODAS las rendiciones, no solo las manuales, en
cada carga de la app.
**Fix:** las rendiciones se suben en dos tandas separadas — las ligadas a
tarea con `onConflict: "owner_id,task_id"`, las manuales con
`onConflict: "id"` (su identidad real). **No unificar esto en un solo
upsert de nuevo:** volvería a romper el guardado de rendiciones manuales.

### 5. `id` viejo resucitado al recrear una rendición de una tarea
Si se borraba una rendición pero la tarea seguía marcada "hecha",
`updateTask()` podía generar más tarde una rendición nueva (id fresco) para
esa misma tarea. Si en la nube ya existía una fila para
`(owner_id, task_id)` con otro id, el upsert intentaba reemplazarle el id
a esa fila, arriesgando otro choque de primary key.
**Fix:** antes de borrar/subir rendiciones, `syncCloudState()` adopta el id
que ya existe en la nube para cada tarea, así el upsert siempre actualiza
la misma fila en vez de moverle el id.

### 6. Salvaguarda anti-borrado-masivo en `deleteMissing()` — y sus dos excepciones necesarias
Como red de seguridad ante cualquier futura repetición del punto 1 (un
estado local vacío o incompleto por error), `deleteMissing()` frena y avisa
si de una sola sincronización se intentaría borrar más de la mitad de las
filas existentes de una tabla (con más de 10 filas). Esto **ya bloqueó dos
usos legítimos** hasta que se corrigieron:
- **"Borrar todos los datos" / "Importar copia" (Ajustes):** son borrados/
  reemplazos totales intencionales. Antes de esos flujos, la app llama a
  `approveMassDeletion()` (`cloud.js`), que deja una autorización con
  vencimiento de 15 minutos que la salvaguarda respeta.
- **Rendiciones:** borrar varias de una vez (limpiar las ya cobradas/
  procesadas) es un uso normal y frecuente, no una excepción. La tabla
  `renditions` está **exenta** de este límite (`MASS_DELETION_EXEMPT_TABLES`
  en `cloud.js`); `clients` y `tasks` sí mantienen la protección estricta.
**Si se agrega un flujo nuevo de borrado masivo intencional** (de clientes
o tareas), tiene que llamar a `approveMassDeletion()` antes, o la
sincronización se va a frenar con "no se pudo guardar en la nube" y, al
reabrir la app, el borrado va a parecer que "no se aplicó" (en realidad
nunca llegó a subirse).

### 7. "Importar copia" podía corromper el estado con el archivo equivocado
El backup diario que llega por mail tiene formato de base de datos
(`clients` sin `.tasks` anidadas) — no es intercambiable con "Exportar
copia JSON" de Ajustes, aunque ambos sean `.json`. Importar el backup
diario por error corrompía el estado local y rompía la app hasta limpiar
el navegador.
**Fix:** `importBackup` valida que `clients[].tasks` sea un array antes de
reemplazar el estado, y si detecta el formato del backup diario
(`profiles`+`tasks` en la raíz), lo explica en vez de aceptarlo.

### 8. Archivos fantasma sin usar, trackeados en git
`app..js`, `index..html`, `styles..css` y `app.js.bak` eran copias viejas
sin usar (el `index.html` real referencia `app.js` y `styles.css`, no las
variantes con doble punto) que quedaron trackeadas en git y generaban ruido
constante de "modificado" en `git status`. Se eliminaron del repo. **No
volver a crear archivos con nombres similares** — si hace falta un backup
de un archivo antes de una edición grande, usar `git` (branch o commit),
no una copia manual en el mismo directorio.

### 9. "Add file → Upload files" de GitHub pisó `app.js` y borró dos features enteras (01/08/2026)
El commit `d4a4383` ("Add files via upload") subió una copia vieja de
`app.js` a mano desde la web de GitHub, sobrescribiendo el archivo entero en
vez de fusionar cambios. Eso borró silenciosamente dos features que ya
estaban terminadas y funcionando (commits `7a47f8c` y `08b5949`, del mismo
día): el panel "Cuentas de Drive" en Ajustes (conectar/reconectar cuenta de
Google Drive por salón vía OAuth, guardar carpeta raíz, desconectar) y el
selector de salón de la ficha de cliente poblado según `accessProfile.salons`
del usuario (antes de eso, volvió a estar hardcodeado a
Quinta/Pilar Hotel/Otro). El backend de ambas features (`cloud.js`,
`api/get-drive-accounts.js`, `api/save-drive-root-folder.js`,
`api/clear-drive-account.js`) no se vio afectado — sólo `app.js`, porque
aparentemente solo ese archivo se subió a mano. Nadie lo notó hasta que un
cliente con WhatsApp +34 no pudo guardarse (bug no relacionado que llevó a
revisar `app.js` a fondo) y, por separado, hasta que faltó el botón
"Crear carpeta en Drive" para un salón nuevo.
**Fix:** se recuperó el código exacto de ambos commits (`git show
7a47f8c -- app.js`, `git show 08b5949 -- app.js`) y se reintegró a mano en
`app.js`, ya que un simple `git revert`/`cherry-pick` de `d4a4383` no
aplicaba limpio contra los commits hechos después. **Regla:** ver punto 6
de "Reglas de trabajo con Claude" — nunca más subir `app.js` (ni ningún
archivo de código) a mano por la web de GitHub.

---
