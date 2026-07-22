import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { getAccessToken } from "./_drive-auth.js";

// Chequea si la carpeta de Drive guardada en drive_url para un cliente
// sigue existiendo (no fue borrada/vaciada de la papelera a mano). Se
// dispara al tocar "Ver Drive" en la ficha del cliente, ANTES de abrir el
// link: si la carpeta ya no está, el frontend ofrece recrearla en vez de
// abrir un link roto.
//
// Es una sola llamada liviana (un GET a la API de Drive) por click del
// usuario en un cliente puntual — no hay chequeo automático ni en
// background para el resto de los clientes.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROOT_FOLDER_ENV = {
  Quinta: "GOOGLE_DRIVE_ROOT_FOLDER_QUINTA",
  "Pilar Hotel": "GOOGLE_DRIVE_ROOT_FOLDER_PILAR",
};

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function extractFolderId(url) {
  const m = String(url || "").match(/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
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
      .select("id,salon,drive_url")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) return json(500, { error: clientError.message });
    if (!client) return json(404, { error: "Cliente no encontrado" });

    // Si el salón no es uno de los que manejamos con cuenta propia (Quinta /
    // Pilar Hotel), o el link no tiene forma de carpeta de Drive (por ej. fue
    // pegado a mano), no hay nada que verificar por API: asumimos que existe.
    const folderId = extractFolderId(client.drive_url);
    if (!ROOT_FOLDER_ENV[client.salon] || !folderId) {
      return json(200, { checked: false, exists: true });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Falta la variable SUPABASE_SERVICE_ROLE_KEY en Netlify" });

    const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: credRow, error: credError } = await supabaseAdmin
      .from("google_service_accounts")
      .select("credentials")
      .eq("salon", client.salon)
      .maybeSingle();

    if (credError) return json(500, { error: `Error leyendo credenciales de Drive: ${credError.message}` });
    if (!credRow?.credentials) return json(200, { checked: false, exists: true });

    const accessToken = await getAccessToken(credRow.credentials);

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?${new URLSearchParams({ fields: "id,trashed", supportsAllDrives: "true" })}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (res.status === 404) return json(200, { checked: true, exists: false });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || "Error consultando la carpeta en Drive");

    return json(200, { checked: true, exists: !data.trashed, _debugFolderId: folderId, _debugDriveResponse: data, _debugStatus: res.status });
  } catch (err) {
    return json(500, { error: String(err?.message || err) });
  }
}
