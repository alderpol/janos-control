import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { getAccessToken } from "./_drive-auth.js";

// Crea (o reutiliza si ya existe) la carpeta de un cliente en Google Drive,
// con la estructura: {AÑO}/{MES}/{AAAAMMDD}_{NOMBRE} #{codigo}/{FOTOS,VIDEOS}
// Se dispara a mano desde el boton "Crear carpeta en Drive" en la ficha del
// cliente (app.js / cloud.js::createDriveFolderNow).
//
// Cada usuario conecta su PROPIA cuenta real de Google para cada salon en
// el que trabaja (ver api/oauth-drive-start.js y
// api/oauth-drive-callback.js, boton "Conectar cuenta de Drive" en
// Ajustes), no una cuenta de servicio compartida. Asi las carpetas quedan
// a nombre de esa cuenta desde el momento en que se crean.
//
// Las credenciales (refresh_token) y la carpeta raiz (root_folder_id, la
// carpeta del año, ej. "2026") se guardan en la tabla
// `google_service_accounts` de Supabase, con clave (owner_id, salon) - asi
// dos usuarios distintos con un salon de mismo nombre no se pisan las
// credenciales entre si. Esta funcion las busca en el momento,
// autenticandose con la SUPABASE_SERVICE_ROLE_KEY. Esa tabla tiene RLS
// activado sin ninguna politica, asi que solo la service role (nunca el
// usuario final) puede leerla.
//
// Configuracion necesaria en Vercel (Project Settings > Environment
// Variables):
//   SUPABASE_SERVICE_ROLE_KEY  -> clave "service_role" del proyecto
//                                 (Supabase > Project Settings > API)
//   GOOGLE_OAUTH_CLIENT_ID     -> del cliente OAuth "Janos Drive Ownership"
//   GOOGLE_OAUTH_CLIENT_SECRET    en Google Cloud Console
//   GOOGLE_OAUTH_STATE_SECRET  -> para firmar el "state" del flujo OAuth
//
// Para leer/escribir el cliente se sigue usando el JWT del propio usuario
// (no service role), asi el RLS de Supabase limita ese resultado a sus
// propias filas. La service role solo se usa para la tabla de credenciales.

const CORS = {
      "Access-Control-Allow-Origin": "https://janos-control.vercel.app",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

function json(statusCode, body) {
      return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function escapeForQuery(name) {
      return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Busca una subcarpeta por nombre dentro de parentId; si no existe, la crea.
// Devuelve { id, webViewLink, created } - created=true solo si la acabamos
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
// mantenga esa configuracion para siempre. Es el link que se manda a los
// clientes por mail.
async function makeReaderForAnyone(accessToken, fileId) {
      try {
              await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ role: "reader", type: "anyone" }),
              });
      } catch {
              // No critico.
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
            .select("id,owner_id,honoree,code,event_date,salon,drive_url")
            .eq("id", clientId)
            .maybeSingle();

        if (clientError) return json(500, { error: clientError.message });
          if (!client) return json(404, { error: "Cliente no encontrado" });

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Falta la variable SUPABASE_SERVICE_ROLE_KEY en Vercel" });

        // Cliente aparte con la service role, solo para leer las credenciales
        // de Drive de este usuario+salon desde `google_service_accounts`
        // (tabla con RLS sin politicas: nadie mas puede leerla).
        const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
          const { data: credRow, error: credError } = await supabaseAdmin
            .from("google_service_accounts")
            .select("credentials,root_folder_id")
            .eq("owner_id", client.owner_id)
            .eq("salon", client.salon)
            .maybeSingle();

        if (credError) return json(500, { error: `Error leyendo credenciales de Drive: ${credError.message}` });
          if (!credRow?.credentials) {
                    return json(500, {
                                error: `No tenes una cuenta de Drive conectada para el salon "${client.salon}". Conectala desde Ajustes > Cuentas de Drive.`,
                    });
          }
          if (!credRow.root_folder_id) {
                    return json(500, {
                                error: `No configuraste la carpeta raiz de Drive para el salon "${client.salon}". Completala desde Ajustes > Cuentas de Drive.`,
                    });
          }
          const rootFolderId = credRow.root_folder_id;

        const eventDate = String(client.event_date || "").slice(0, 10); // YYYY-MM-DD
        const [year, month] = eventDate.split("-");
          if (!year || !month) return json(400, { error: "El cliente no tiene fecha de evento valida" });

        const monthFolderName = `${month}-${MESES[Number(month) - 1]}`;
          const clientFolderName = `${eventDate.replaceAll("-", "")}_${String(client.honoree || "").toUpperCase()} #${client.code}`;

        const accessToken = await getAccessToken(credRow.credentials);

        // rootFolderId apunta directamente a la carpeta DEL AÑO (ej. "2026")
        // dentro del Drive conectado - no a "Mi unidad" (esa no se puede
        // compartir/referenciar como carpeta). OJO: esto significa que cada
        // enero hay que crear/ubicar la carpeta del año nuevo y actualizar
        // root_folder_id desde Ajustes; si no, esta funcion va a fallar apenas
        // empiece el año siguiente.
        const monthFolder = await getOrCreateFolder(accessToken, monthFolderName, rootFolderId);
          const clientFolder = await getOrCreateFolder(accessToken, clientFolderName, monthFolder.id);
          await getOrCreateFolder(accessToken, "FOTOS", clientFolder.id);
          await getOrCreateFolder(accessToken, "VIDEOS", clientFolder.id);

        // La carpeta del cliente es la que se linkea por mail - la dejamos
        // explicitamente en "cualquiera con el link puede ver y descargar"
        // (los sub-permisos de FOTOS/VIDEOS se heredan de aca).
        if (clientFolder.created) {
                  await makeReaderForAnyone(accessToken, clientFolder.id);
        }

        const driveUrl = clientFolder.webViewLink || `https://drive.google.com/drive/folders/${clientFolder.id}`;

        const { error: updateError } = await supabase
            .from("clients")
            .update({ drive_url: driveUrl })
            .eq("id", clientId);

        if (updateError) {
                  return json(200, { ok: true, driveUrl, warning: `La carpeta se creo, pero no se pudo guardar el link: ${updateError.message}` });
        }

        return json(200, { ok: true, driveUrl });
  } catch (err) {
          console.error("create-drive-folder error:", err);
          return json(500, { error: String(err?.message || "Error interno del servidor") });
  }
}

// Adaptador para Vercel: las funciones serverless de Vercel usan un export
// default (req, res) (estilo Express), a diferencia del export nombrado
// `handler(event)` que se usa arriba. Este adaptador
// traduce uno al otro para no tener que reescribir la logica de arriba.
export default async function (req, res) {
      const event = {
              httpMethod: req.method,
              headers: req.headers,
              body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
      };
      const result = await handler(event);
      res.status(result.statusCode);
      for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
      res.send(result.body);
}
