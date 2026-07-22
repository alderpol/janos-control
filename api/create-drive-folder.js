import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { getAccessToken } from "./_drive-auth.js";

// Crea (o reutiliza si ya existe) la carpeta de un cliente en Google Drive,
// con la estructura: {AÑO}/{MES}/{AAAAMMDD}_{NOMBRE} #{codigo}/{FOTOS,VIDEOS}
// Se dispara a mano desde el botón "Crear carpeta en Drive" en la ficha del
// cliente (app.js / cloud.js::createDriveFolderNow).
//
// Cada salón se autentica con su PROPIA cuenta real de Google (OAuth,
// quinta.janosfyv@gmail.com / pilarhoteljanos@gmail.com), no con una cuenta
// de servicio. Así las carpetas quedan a nombre del salón desde el momento
// en que se crean — no hace falta ningún paso de transferencia de
// propiedad después (Google no permite forzar eso por API entre cuentas
// personales, así que la única forma real de que el dueño sea el salón es
// que la cuenta real sea la que crea el archivo).
//
// Cada salón autorizó el acceso una sola vez (ver api/oauth-drive-start.js
// y api/oauth-drive-callback.js) y esa autorización quedó guardada como un
// refresh_token en la tabla `google_service_accounts` de Supabase. Esta
// función lo usa para pedir un access_token nuevo en cada llamada.
//
// Las credenciales NO viven como variable de entorno de Netlify: además de
// no ser necesario, juntar credenciales de dos salones ahí puede superar el
// límite de 4KB por función que impone AWS Lambda. En vez de eso, se
// guardan en Supabase y esta función las busca en el momento,
// autenticándose con la SUPABASE_SERVICE_ROLE_KEY (que sí es chica). Esa
// tabla tiene RLS activado sin ninguna política, así que solo la service
// role (nunca el usuario final) puede leerla.
//
// Configuración necesaria en Netlify (Site configuration > Environment
// variables):
//   SUPABASE_SERVICE_ROLE_KEY           -> clave "service_role" del proyecto
//                                          (Supabase > Project Settings > API)
//   GOOGLE_OAUTH_CLIENT_ID              -> del cliente OAuth "Janos Drive
//   GOOGLE_OAUTH_CLIENT_SECRET             Ownership" en Google Cloud Console
//   GOOGLE_DRIVE_ROOT_FOLDER_QUINTA     -> ID de la carpeta del año (ej. "2026")
//                                          en el Drive de quinta.janosfyv@gmail.com
//   GOOGLE_DRIVE_ROOT_FOLDER_PILAR      -> ídem, en pilarhoteljanos@gmail.com
//
// Configuración necesaria en Supabase (tabla `google_service_accounts`):
//   salon="Quinta"      -> credentials = { refresh_token } de esa cuenta
//   salon="Pilar Hotel" -> ídem, de la cuenta de Pilar Hotel
//   (formato viejo, todavía soportado como respaldo: { client_email, private_key }
//   de una cuenta de servicio, firmado con JWT en vez de refresh_token)
//
// Para leer/escribir el cliente se sigue usando el JWT del propio usuario
// (no service role), así el RLS de Supabase limita ese resultado a sus
// propias filas. La service role solo se usa para la tabla de credenciales.

const CORS = {
  "Access-Control-Allow-Origin": "https://janos-control.netlify.app",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROOT_FOLDER_ENV = {
  Quinta: "GOOGLE_DRIVE_ROOT_FOLDER_QUINTA",
  "Pilar Hotel": "GOOGLE_DRIVE_ROOT_FOLDER_PILAR",
};

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function escapeForQuery(name) {
  return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Busca una subcarpeta por nombre dentro de parentId; si no existe, la crea.
// Devuelve { id, webViewLink, created } — created=true solo si la acabamos
// de crear en esta llamada.
async function getOrCreateFolder(accessToken, name, parentId) {
  const q = `name='${escapeForQuery(name)}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id,webViewLink)", spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: "true" })}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();
  if (!searchRes.ok) throw new Error(searchData.error?.message || "Error buscando carpeta en Drive");
  if (searchData.files?.length) return { ...searchData.files[0], created: false };

  const createRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ fields: "id,webViewLink", supportsAllDrives: "true" })}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
    }
  );
  const createData = await createRes.json();
  if (!createRes.ok) throw new Error(createData.error?.message || "Error creando carpeta en Drive");
  return { ...createData, created: true };
}

// Deja la carpeta como "cualquiera con el link puede ver y descargar, no
// editar" (rol reader), sin depender de que la carpeta padre ("2026")
// mantenga esa configuración para siempre. Es el link que se manda a los
// clientes por mail.
async function makeReaderForAnyone(accessToken, fileId) {
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  } catch {
    // No crítico.
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) return json(401, { error: "No autorizado" });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      { global: { headers: { Authorization: authHeader } }, realtime: { transport: ws } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return json(401, { error: "No autorizado" });

    const { clientId } = JSON.parse(event.body || "{}");
    if (!clientId) return json(400, { error: "Falta clientId" });

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id,honoree,code,event_date,salon,drive_url")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) return json(500, { error: clientError.message });
    if (!client) return json(404, { error: "Cliente no encontrado" });

    const rootEnvVar = ROOT_FOLDER_ENV[client.salon];
    if (!rootEnvVar) return json(400, { error: `No hay una carpeta de Drive configurada para el salón "${client.salon}"` });
    const rootFolderId = process.env[rootEnvVar];
    if (!rootFolderId) return json(500, { error: `Falta la variable ${rootEnvVar} en Netlify` });

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Falta la variable SUPABASE_SERVICE_ROLE_KEY en Netlify" });

    // Cliente aparte con la service role, solo para leer las credenciales
    // de Drive de este salón desde `google_service_accounts` (tabla con
    // RLS sin políticas: nadie más puede leerla).
    const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: credRow, error: credError } = await supabaseAdmin
      .from("google_service_accounts")
      .select("credentials")
      .eq("salon", client.salon)
      .maybeSingle();

    if (credError) return json(500, { error: `Error leyendo credenciales de Drive: ${credError.message}` });
    if (!credRow?.credentials) {
      return json(500, {
        error: `No hay credenciales de Drive guardadas para el salón "${client.salon}". Conectala primero desde /api/oauth-drive-start?salon=${encodeURIComponent(client.salon)}`,
      });
    }

    const eventDate = String(client.event_date || "").slice(0, 10); // YYYY-MM-DD
    const [year, month] = eventDate.split("-");
    if (!year || !month) return json(400, { error: "El cliente no tiene fecha de evento válida" });

    const monthFolderName = `${month}-${MESES[Number(month) - 1]}`;
    const clientFolderName = `${eventDate.replaceAll("-", "")}_${String(client.honoree || "").toUpperCase()} #${client.code}`;

    const accessToken = await getAccessToken(credRow.credentials);

    // rootFolderId apunta directamente a la carpeta DEL AÑO (ej. "2026")
    // dentro del Drive del salón — no a "Mi unidad" (esa no se puede
    // compartir/referenciar como carpeta). OJO: esto significa que cada
    // enero hay que crear/ubicar la carpeta del año nuevo y actualizar esta
    // variable de entorno; si no, esta función va a fallar apenas empiece
    // el año siguiente.
    const monthFolder = await getOrCreateFolder(accessToken, monthFolderName, rootFolderId);
    const clientFolder = await getOrCreateFolder(accessToken, clientFolderName, monthFolder.id);
    await getOrCreateFolder(accessToken, "FOTOS", clientFolder.id);
    await getOrCreateFolder(accessToken, "VIDEOS", clientFolder.id);

    // La carpeta del cliente es la que se linkea por mail — la dejamos
    // explícitamente en "cualquiera con el link puede ver y descargar"
    // (los sub-permisos de FOTOS/VIDEOS se heredan de acá).
    if (clientFolder.created) {
      await makeReaderForAnyone(accessToken, clientFolder.id);
    }

    const driveUrl = clientFolder.webViewLink || `https://drive.google.com/drive/folders/${clientFolder.id}`;

    const { error: updateError } = await supabase
      .from("clients")
      .update({ drive_url: driveUrl })
      .eq("id", clientId);

    if (updateError) {
      return json(200, { ok: true, driveUrl, warning: `La carpeta se creó, pero no se pudo guardar el link: ${updateError.message}` });
    }

    return json(200, { ok: true, driveUrl });
  } catch (err) {
    console.error("create-drive-folder error:", err);
    return json(500, { error: String(err?.message || "Error interno del servidor") });
  }
}
