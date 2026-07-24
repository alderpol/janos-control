import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Desconecta la cuenta de Drive de un salón del usuario logueado: borra la
// fila de google_service_accounts (credenciales + carpeta raíz). Después
// de esto, ese salón vuelve a "Agregar Drive" manual hasta que se conecte
// una cuenta de nuevo.

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

        const { salon } = JSON.parse(event.body || "{}");
        if (!salon) return json(400, { error: "Falta el salón" });

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel" });
        const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        const { error: deleteError } = await supabaseAdmin
            .from("google_service_accounts")
            .delete()
            .eq("owner_id", userData.user.id)
            .eq("salon", salon);
        if (deleteError) return json(500, { error: deleteError.message });

        return json(200, { ok: true });
    } catch (err) {
        console.error("clear-drive-account error:", err);
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
