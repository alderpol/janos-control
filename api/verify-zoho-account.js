import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import ws from "ws";

// Prueba en el momento si el email + contraseña de aplicación de Zoho que
// el usuario cargó en Ajustes > "Mi cuenta de email" son válidos, sin
// mandar ningún mail (transporter.verify() solo hace el login SMTP).
// Se llama automáticamente después de guardar esa cuenta (ver
// app.js::saveZohoAccount).
//
// Migrada de Vercel a Netlify Functions (julio 2026). Lógica idéntica,
// solo cambia la forma de leer el request/devolver la respuesta.

const CORS = {
  "Access-Control-Allow-Origin": "https://janos-control.netlify.app",
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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("zoho_accounts")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return json(500, { error: profileError.message });

    const account = profile?.zoho_accounts?.[salon];
    if (!account?.email || !account?.password) {
      return json(400, { error: `No tenés una cuenta de Zoho propia cargada para "${salon}"` });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.zoho.com",
      port: 465,
      secure: true,
      auth: { user: account.email, pass: account.password },
    });

    try {
      await transporter.verify();
    } catch (verifyError) {
      if (verifyError?.responseCode === 535 || verifyError?.code === "EAUTH") {
        return json(400, { error: "Zoho rechazó el email o la contraseña de aplicación cargados.", invalid: true });
      }
      return json(500, { error: `No se pudo conectar con Zoho: ${String(verifyError?.message || verifyError)}` });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("verify-zoho-account error:", err);
    return json(500, { error: String(err?.message || "Error interno del servidor") });
  }
}
