import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Guarda la carpeta raíz de Drive (la del año, ej. "2026") para un salón
// del usuario logueado. El OAuth (api/oauth-drive-callback.js) solo deja
// conectada la cuenta; no hay forma de que la app adivine cuál carpeta de
// esa cuenta es la raíz de trabajo, así que el usuario pega acá el link
// (o el ID) de esa carpeta una vez.
//
// Requiere que ya exista una fila en google_service_accounts para
// (owner_id, salon) -es decir, que el usuario ya haya conectado la cuenta
// de Drive de ese salón desde "Conectar cuenta de Drive"-, para no crear
// filas sueltas sin credenciales.

const CORS = {
    "Access-Control-Allow-Origin": "https://janos-control.vercel.app",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, body) {
    return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// Acepta tanto un link de Drive (varios formatos posibles) como un ID
// pegado directo, y devuelve el ID de la carpeta.
function extractFolderId(input) {
    const value = String(input || "").trim();
    if (!value) return "";
    const patterns = [/\/folders\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/];
    for (const re of patterns) {
        const match = value.match(re);
        if (match) return match[1];
    }
    // Si no matcheó ningún patrón de URL, asumimos que ya es un ID (sin espacios ni "/").
    if (!/[\s/]/.test(value)) return value;
    return "";
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

        const { salon, rootFolder } = JSON.parse(event.body || "{}");
        if (!salon) return json(400, { error: "Falta el salón" });

        const folderId = extractFolderId(rootFolder);
        if (!folderId) return json(400, { error: "No se pudo reconocer el link de la carpeta. Pegá el link completo de la carpeta en Drive." });

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel" });
        const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        const { data: current, error: readError } = await supabaseAdmin
            .from("google_service_accounts")
            .select("credentials")
            .eq("owner_id", userData.user.id)
            .eq("salon", salon)
            .maybeSingle();
        if (readError) return json(500, { error: readError.message });
        if (!current?.credentials?.refresh_token) {
            return json(400, { error: `Primero conectá la cuenta de Drive de "${salon}" con el botón "Conectar cuenta de Drive".` });
        }

        const { error: updateError } = await supabaseAdmin
            .from("google_service_accounts")
            .update({ root_folder_id: folderId, updated_at: new Date().toISOString() })
            .eq("owner_id", userData.user.id)
            .eq("salon", salon);
        if (updateError) return json(500, { error: updateError.message });

        return json(200, { ok: true, rootFolderId: folderId });
    } catch (err) {
        console.error("save-drive-root-folder error:", err);
        return json(500, { error: String(err?.message || "Error interno del servidor") });
    }
}

// Adaptador para Vercel: las funciones serverless de Vercel usan un export
// default (req, res) (estilo Express), a diferencia del export nombrado
// `handler(event)` que se usa arriba. Este adaptador traduce uno al otro
// para no tener que reescribir la lógica de arriba.
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
