import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { encryptSecret } from "./_crypto.js";

// Guarda la cuenta de Zoho de un salón para el usuario logueado, CIFRANDO la
// contraseña de aplicación antes de escribirla en la base (columna
// profiles.zoho_accounts). El guardado se hace acá y no directo desde el
// navegador (como antes) justamente para que la clave de cifrado
// (SECRETS_ENCRYPTION_KEY) nunca esté del lado del cliente.
//
// Usa el JWT del propio usuario, así el RLS de Supabase limita el UPDATE a su
// propia fila (igual que cuando el guardado era browser-side).

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

      const { salon, email, password, fromName } = JSON.parse(event.body || "{}");
        if (!salon) return json(400, { error: "Falta el salón" });

      const { data: current, error: readError } = await supabase
          .from("profiles").select("zoho_accounts").eq("id", userData.user.id).maybeSingle();
        if (readError) return json(500, { error: readError.message });

      const accounts = { ...(current?.zoho_accounts || {}) };
        const existing = accounts[salon] || {};

      // Misma lógica de merge que antes: los 3 campos, si vienen vacíos,
      // conservan lo que ya estaba. La contraseña nueva se cifra; si no viene
      // una nueva, se mantiene el valor existente (que ya está cifrado).
      const trimmedEmail = String(email || "").trim();
        const trimmedFromName = String(fromName || "").trim();
        const newPassword = String(password || "");

      accounts[salon] = {
              email: trimmedEmail || existing.email || "",
              fromName: trimmedFromName || existing.fromName || "",
              password: newPassword ? await encryptSecret(newPassword) : (existing.password || ""),
      };

      const { error: updateError } = await supabase
          .from("profiles").update({ zoho_accounts: accounts }).eq("id", userData.user.id);
        if (updateError) return json(500, { error: updateError.message });

      return json(200, { ok: true });
  } catch (err) {
        console.error("save-zoho-account error:", err);
        return json(500, { error: String(err?.message || "Error interno del servidor") });
  }
}

// Adaptador para Vercel: las funciones serverless de Vercel usan un export
// default (req, res) (estilo Express), a diferencia del export nombrado
// `handler(event)` de Netlify Functions que se usa arriba. Este adaptador
// traduce uno al otro para no tener que reescribir la lógica de arriba.
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
