import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Devuelve, para el usuario logueado, el estado de su cuenta de Drive en
// cada uno de sus salones: si ya conectó una cuenta (OAuth) y si ya cargó
// la carpeta raíz. Se usa en Ajustes para pintar el panel "Cuentas de
// Drive" (ver driveAccountsPanelBody() en app.js).
//
// La tabla google_service_accounts tiene RLS activo pero SIN políticas
// (a propósito: solo el service_role puede leerla/escribirla), así que
// esta lectura tiene que pasar por acá con la service role key, nunca
// directo desde el navegador. Nunca se devuelve el refresh_token al
// cliente, solo un booleano `connected`.

const CORS = {
    "Access-Control-Allow-Origin": "https://janos-control.vercel.app",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, body) {
    return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
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

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel" });
        const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        const { data: rows, error: readError } = await supabaseAdmin
            .from("google_service_accounts")
            .select("salon,credentials,root_folder_id")
            .eq("owner_id", userData.user.id);
        if (readError) return json(500, { error: readError.message });

        const accounts = {};
        for (const row of rows || []) {
            accounts[row.salon] = {
                connected: Boolean(row.credentials?.refresh_token),
                rootFolderId: row.root_folder_id || null,
            };
        }

        return json(200, { accounts });
    } catch (err) {
        console.error("get-drive-accounts error:", err);
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
