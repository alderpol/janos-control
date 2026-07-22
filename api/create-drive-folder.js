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
//
// Las dos claves privadas NO viven como variable de entorno de Netlify:
// juntas superan el límite de 4KB por función que impone AWS Lambda (la
// base sobre la que corren las Netlify Functions clásicas). En vez de eso,
// se guardan en la tabla `google_service_accounts` de Supabase y esta
// función las busca ahí en el momento, autenticándose con la
// SUPABASE_SERVICE_ROLE_KEY (que sí es chica y no tiene problema de
// tamaño). Esa tabla tiene RLS activado sin ninguna política, así que solo
// la service role (nunca el usuario final) puede leerla.
//
// Configuración necesaria en Netlify (Site configuration > Environment
// variables):
//   SUPABASE_SERVICE_ROLE_KEY           -> clave "service_role" del proyecto
//                                          (Supabase > Project Settings > API)
//   GOOGLE_DRIVE_ROOT_FOLDER_QUINTA     -> ID de la carpeta del año (ej. "2026")
//                                          compartida con la cuenta de servicio
//                                          "Quinta", en quinta.janosfyv@gmail.com
//   GOOGLE_DRIVE_ROOT_FOLDER_PILAR      -> ídem, con la cuenta de servicio
//                                          "Pilar Hotel", en pilarhoteljanos@gmail.com
//
// Configuración necesaria en Supabase (tabla `google_service_accounts`):
//   salon="Quinta"      -> credentials = { client_email, private_key } de esa cuenta
//   salon="Pilar Hotel" -> ídem, de la cuenta de Pilar Hotel
//
// Para leer/escribir el cliente se sigue usando el JWT del propio usuario
// (no service role), así el RLS de Supabase limita ese resultado a sus
// propias filas. La service role solo se usa para la tabla de credenciales.
//
// Propietario en Drive: como el creador de una carpeta es su dueño por
// defecto, las carpetas nuevas quedan a nombre de la cuenta de servicio
// (no de la cuenta real del salón). Para disimular esto, cada carpeta
// nueva (cliente, FOTOS, VIDEOS) queda con una transferencia de
// propiedad PENDIENTE hacia SALON_OWNER_EMAIL — Google no deja forzarla
// entre cuentas personales, así que alguien tiene que entrar de vez en
// cuando a esa cuenta y aceptar las solicitudes acumuladas en Drive.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROOT_FOLDER_ENV = {
  Quinta: "GOOGLE_DRIVE_ROOT_FOLDER_QUINTA",
  "Pilar Hotel": "GOOGLE_DRIVE_ROOT_FOLDER_PILAR",
};

// Cuenta personal (Gmail, no Workspace) de cada salón, dueña del Drive
// donde vive la carpeta del año. Google no permite forzar por API la
// transferencia de propiedad entre cuentas personales: lo único que se
// puede hacer es dejar una solicitud pendiente (pendingOwner) que el
// dueño de esta cuenta tiene que aceptar a mano desde Drive (aparece
// como notificación / en "Compartidos conmigo"). Por eso conviene
// entrar de vez en cuando y aceptar las que se hayan acumulado.
const SALON_OWNER_EMAIL = {
  Quinta: "quinta.janosfyv@gmail.com",
  "Pilar Hotel": "pilarhoteljanos@gmail.com",
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

// Deja pedida la transferencia de propiedad a la cuenta real del salón.
// No la fuerza (Google no lo permite entre cuentas personales): el
// dueño tiene que entrar a Drive y aceptarla a mano. Mientras tanto la
// carpeta sigue funcionando igual, solo cambia quién figura como
// "Propietario".
async function requestOwnershipTransfer(accessToken, fileId, emailAddress) {
  if (!emailAddress) return;
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "writer", type: "user", emailAddress, pendingOwner: true }),
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

    // Cliente aparte con la service role, solo para leer la clave de Drive
    // de este salón desde `google_service_accounts` (tabla con RLS sin
    // políticas: nadie más puede leerla).
    const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: credRow, error: credError } = await supabaseAdmin
      .from("google_service_accounts")
      .select("credentials")
      .eq("salon", client.salon)
      .maybeSingle();

    if (credError) return json(500, { error: `Error leyendo credenciales de Drive: ${credError.message}` });
    if (!credRow?.credentials?.client_email || !credRow?.credentials?.private_key) {
      return json(500, { error: `No hay una cuenta de servicio de Drive guardada para el salón "${client.salon}" en Supabase (tabla google_service_accounts)` });
    }
    const serviceAccount = credRow.credentials;

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
    const fotosFolder = await getOrCreateFolder(accessToken, "FOTOS", clientFolder.id);
    const videosFolder = await getOrCreateFolder(accessToken, "VIDEOS", clientFolder.id);

    // La carpeta del cliente es la que se linkea por mail — la dejamos
    // explícitamente en "cualquiera con el link puede ver y descargar"
    // (los sub-permisos de FOTOS/VIDEOS se heredan de acá).
    if (clientFolder.created) {
      await makeReaderForAnyone(accessToken, clientFolder.id);
    }

    // Cada carpeta nueva queda a nombre de la cuenta de servicio (así
    // funciona Drive: el creador es el dueño). Dejamos pedida la
    // transferencia a la cuenta real del salón; hay que aceptarla a
    // mano desde esa cuenta cuando se pueda.
    const ownerEmail = SALON_OWNER_EMAIL[client.salon];
    if (ownerEmail) {
      if (clientFolder.created) await requestOwnershipTransfer(accessToken, clientFolder.id, ownerEmail);
      if (fotosFolder.created) await requestOwnershipTransfer(accessToken, fotosFolder.id, ownerEmail);
      if (videosFolder.created) await requestOwnershipTransfer(accessToken, videosFolder.id, ownerEmail);
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
