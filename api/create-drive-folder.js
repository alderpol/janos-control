import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import ws from "ws";

// Crea (o reutiliza si ya existe) la carpeta de un cliente en Google Drive,
// con la estructura: {AÑO}/{MES}/{AAAAMMDD}_{NOMBRE} #{codigo}/{FOTOS,VIDEOS}
// Se dispara a mano desde el botón "Crear carpeta en Drive" en la ficha del
// cliente (app.js / cloud.js::createDriveFolderNow).
//
// Cada salón tiene su PROPIA cuenta de servicio (no una compartida entre
// los dos), para que:
//   - En el Drive de cada salón aparezca solo "su" cuenta técnica (Quinta /
//     Pilar Hotel) como colaboradora, no una cuenta genérica ajena.
//   - Si algún día se filtra la clave de un salón, el otro salón no queda
//     expuesto (cada una solo tiene acceso a la carpeta compartida de su
//     propio Drive).
// En vez de autenticar como la cuenta de Gmail real del salón (lo que
// requeriría un token OAuth de usuario, con más alcance y que en modo
// "Testing" de Google expira cada 7 días), cada cuenta de servicio es una
// identidad de máquina sin Drive propio, a la que se le comparte
// manualmente la carpeta del año en el Drive de ese salón.
//
// Configuración necesaria en Netlify (Site configuration > Environment
// variables):
//   GOOGLE_SERVICE_ACCOUNT_JSON         -> JSON de la cuenta de servicio "Quinta"
//   GOOGLE_SERVICE_ACCOUNT_JSON_PILAR   -> JSON de la cuenta de servicio "Pilar Hotel"
//   GOOGLE_DRIVE_ROOT_FOLDER_QUINTA     -> ID de la carpeta del año (ej. "2026")
//                                          compartida con la cuenta de servicio
//                                          "Quinta", en quinta.janosfyv@gmail.com
//   GOOGLE_DRIVE_ROOT_FOLDER_PILAR      -> ídem, con la cuenta de servicio
//                                          "Pilar Hotel", en pilarhoteljanos@gmail.com
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

const SERVICE_ACCOUNT_ENV = {
  Quinta: "GOOGLE_SERVICE_ACCOUNT_JSON",
  "Pilar Hotel": "GOOGLE_SERVICE_ACCOUNT_JSON_PILAR",
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

    const serviceAccountEnvVar = SERVICE_ACCOUNT_ENV[client.salon];
    if (!serviceAccountEnvVar) return json(400, { error: `No hay una cuenta de servicio de Drive configurada para el salón "${client.salon}"` });
    if (!process.env[serviceAccountEnvVar]) return json(500, { error: `Falta la variable ${serviceAccountEnvVar} en Netlify` });
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(process.env[serviceAccountEnvVar]);
    } catch {
      return json(500, { error: `${serviceAccountEnvVar} en Netlify no es un JSON válido` });
    }

    const eventDate = String(client.event_date || "").slice(0, 10); // YYYY-MM-DD
    const [year, month] = eventDate.split("-");
    if (!year || !month) return json(400, { error: "El cliente no tiene fecha de evento válida" });

    const monthFolderName = `${month}-${MESES[Number(month) - 1]}`;
    const clientFolderName = `${eventDate.replaceAll("-", "")}_${String(client.honoree || "").toUpperCase()} #${client.code}`;

    const accessToken = await getServiceAccountAccessToken(serviceAccount, "https://www.googleapis.com/auth/drive");

    // rootFolderId apunta directamente a la carpeta DEL AÑO (ej. "2026")
    // compartida con la cuenta de servicio de ese salón — no a "Mi unidad"
    // (esa no se puede compartir como carpeta). OJO: esto significa que cada
    // enero hay que compartir la carpeta del año nuevo con la cuenta de
    // servicio correspondiente y actualizar esta variable de entorno; si
    // no, esta función va a fallar apenas empiece el año siguiente.
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
    return json(500, { error: String(err?.message || err) });
  }
}
