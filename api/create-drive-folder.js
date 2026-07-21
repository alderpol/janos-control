import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// Crea (o reutiliza si ya existe) la carpeta de un cliente en Google Drive,
// con la estructura: {AÑO}/{MES}/{AAAAMMDD}_{NOMBRE} #{codigo}/{FOTOS,VIDEOS}
// Se dispara a mano desde el botón "Crear carpeta en Drive" en la ficha del
// cliente (app.js / cloud.js::createDriveFolderNow).
//
// A diferencia de Zoho (una cuenta por salón pero configurable por
// usuario), acá hay una única cuenta de Drive fija por salón — pero en vez
// de autenticar como esa cuenta de Gmail (lo que requeriría un token OAuth
// de usuario, que en modo "Testing" de Google expira cada 7 días y da
// acceso a TODO el Drive de esa cuenta si se filtra), usamos una "cuenta de
// servicio" de Google: una identidad de máquina sin Drive propio, a la que
// se le comparte manualmente UNA carpeta puntual en cada cuenta (Quinta y
// Pilar Hotel), igual que se comparte una carpeta con un colega. Así:
//   - No expira nunca (no depende del modo Testing de la app OAuth).
//   - Si el secreto se filtra, solo se puede tocar esa carpeta compartida,
//     no el resto del Drive de esas cuentas.
//
// Configuración necesaria en Netlify (Site configuration > Environment
// variables):
//   GOOGLE_SERVICE_ACCOUNT_JSON        -> contenido completo del JSON de la
//                                          cuenta de servicio (Google Cloud
//                                          > IAM > Cuentas de servicio > Claves)
//   GOOGLE_DRIVE_ROOT_FOLDER_QUINTA    -> ID de la carpeta del año (ej. "2026")
//                                          compartida con la cuenta de servicio
//                                          en el Drive de quinta.janosfyv@gmail.com
//   GOOGLE_DRIVE_ROOT_FOLDER_PILAR     -> ídem, en pilarhoteljanos@gmail.com
//
// Usa el JWT del propio usuario (no service role) para leer/escribir el
// cliente, así el RLS de Supabase ya limita el resultado a sus propias filas.

const CORS = {
  "Access-Control-Allow-Origin": "*",
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

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Arma y firma un JWT con la clave privada de la cuenta de servicio, y lo
// cambia por un access_token de Google (flujo "JWT Bearer" para cuentas de
// servicio: https://developers.google.com/identity/protocols/oauth2/service-account).
async function getServiceAccountAccessToken(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope,
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(serviceAccount.private_key);
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "No se pudo autenticar la cuenta de servicio con Google");
  return data.access_token;
}

function escapeForQuery(name) {
  return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Busca una subcarpeta por nombre dentro de parentId; si no existe, la crea.
// Devuelve { id, webViewLink }.
async function getOrCreateFolder(accessToken, name, parentId) {
  const q = `name='${escapeForQuery(name)}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id,webViewLink)", spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: "true" })}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();
  if (!searchRes.ok) throw new Error(searchData.error?.message || "Error buscando carpeta en Drive");
  if (searchData.files?.length) return searchData.files[0];

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
  return createData;
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
      { global: { headers: { Authorization: authHeader } } }
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

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return json(500, { error: "Falta la variable GOOGLE_SERVICE_ACCOUNT_JSON en Netlify" });
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      return json(500, { error: "GOOGLE_SERVICE_ACCOUNT_JSON en Netlify no es un JSON válido" });
    }

    const eventDate = String(client.event_date || "").slice(0, 10); // YYYY-MM-DD
    const [year, month] = eventDate.split("-");
    if (!year || !month) return json(400, { error: "El cliente no tiene fecha de evento válida" });

    const monthFolderName = `${month}-${MESES[Number(month) - 1]}`;
    const clientFolderName = `${eventDate.replaceAll("-", "")}_${String(client.honoree || "").toUpperCase()} #${client.code}`;

    const accessToken = await getServiceAccountAccessToken(serviceAccount, "https://www.googleapis.com/auth/drive");

    // rootFolderId apunta directamente a la carpeta DEL AÑO (ej. "2026")
    // compartida con la cuenta de servicio — no a "Mi unidad" (esa no se
    // puede compartir como carpeta). OJO: esto significa que cada enero hay
    // que compartir la carpeta del año nuevo con la cuenta de servicio y
    // actualizar esta variable de entorno; si no, esta función va a fallar
    // apenas empiece el año siguiente.
    const monthFolder = await getOrCreateFolder(accessToken, monthFolderName, rootFolderId);
    const clientFolder = await getOrCreateFolder(accessToken, clientFolderName, monthFolder.id);
    await getOrCreateFolder(accessToken, "FOTOS", clientFolder.id);
    await getOrCreateFolder(accessToken, "VIDEOS", clientFolder.id);

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
    return json(500, { error: String(err?.message || err) });
  }
}
