import { createClient } from "@supabase/supabase-js";

// Recibe la vuelta del flujo de OAuth iniciado en api/oauth-drive-start.js:
// cambia el "code" que manda Google por un refresh_token, y lo guarda en la
// tabla `google_service_accounts` de Supabase (columna credentials, como
// { refresh_token }), reemplazando lo que hubiera antes para ese salón —
// incluida una cuenta de servicio vieja, si la había.
//
// De acá en adelante, api/create-drive-folder.js usa ese refresh_token
// para autenticarse como la cuenta real del salón (no una cuenta de
// servicio), así que las carpetas que cree quedan a nombre del salón desde
// el vamos.

const REDIRECT_URI = "https://janos-control.netlify.app/api/oauth-drive-callback";
const SALONES_VALIDOS = ["Quinta", "Pilar Hotel"];

function paginaHtml(titulo, mensaje, ok) {
  return {
    statusCode: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>
      <style>body{font-family:sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
      .card{max-width:420px;text-align:center;padding:2rem}
      h1{font-size:1.3rem}
      </style></head>
      <body><div class="card"><h1>${titulo}</h1><p>${mensaje}</p></div></body></html>`,
  };
}

export async function handler(event) {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method not allowed" };

  const { code, state, error: oauthError } = event.queryStringParameters || {};

  if (oauthError) {
    return paginaHtml("No se completó la conexión", `Google devolvió: ${oauthError}. Podés cerrar esta pestaña e intentarlo de nuevo.`, false);
  }
  if (!code || !SALONES_VALIDOS.includes(state)) {
    return paginaHtml("Link inválido", "Falta el código de Google o el salón no es válido. Volvé a abrir el link de conexión.", false);
  }

  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return paginaHtml("Falta configuración", "Faltan GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET en Netlify.", false);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return paginaHtml("Error de Google", tokenData.error_description || tokenData.error || "No se pudo canjear el código.", false);
    }
    if (!tokenData.refresh_token) {
      return paginaHtml(
        "No se recibió refresh_token",
        "Google no mandó un refresh_token (puede pasar si esta cuenta ya había autorizado la app antes de esta actualización). Revocá el acceso en myaccount.google.com/permissions y volvé a intentar.",
        false
      );
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return paginaHtml("Falta configuración", "Falta SUPABASE_SERVICE_ROLE_KEY en Netlify.", false);
    }
    const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error: dbError } = await supabaseAdmin
      .from("google_service_accounts")
      .upsert({ salon: state, credentials: { refresh_token: tokenData.refresh_token }, updated_at: new Date().toISOString() }, { onConflict: "salon" });

    if (dbError) {
      return paginaHtml("Error guardando en Supabase", dbError.message, false);
    }

    return paginaHtml("Cuenta conectada ✓", `El Drive de "${state}" quedó conectado. Ya podés cerrar esta pestaña.`, true);
  } catch (err) {
    return paginaHtml("Error inesperado", String(err?.message || err), false);
  }
}
