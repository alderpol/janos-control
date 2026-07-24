import { createClient } from "@supabase/supabase-js";
import { verifyState } from "./_drive-auth.js";

// Recibe la vuelta del flujo de OAuth iniciado en api/oauth-drive-start.js:
// cambia el "code" que manda Google por un refresh_token, y lo guarda en la
// tabla `google_service_accounts` de Supabase (columna credentials, como
// { refresh_token }), asociado al usuario y salon que vienen codificados y
// firmados en el "state" (ver signState/verifyState en api/_drive-auth.js)
// - asi nadie puede pisar la cuenta de Drive de otro usuario armando la
// URL a mano.
//
// De aca en adelante, api/create-drive-folder.js usa ese refresh_token
// para autenticarse como la cuenta real del salon (no una cuenta de
// servicio), asi que las carpetas que cree quedan a nombre del salon desde
// el vamos.

const REDIRECT_URI = "https://janos-control.vercel.app/api/oauth-drive-callback";

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
          return paginaHtml("No se completo la conexion", `Google devolvio: ${oauthError}. Podes cerrar esta pestaña e intentarlo de nuevo.`, false);
  }
      if (!code || !state) {
              return paginaHtml("Link invalido", "Falta el codigo de Google o el state. Volve a abrir el link de conexion desde Ajustes.", false);
      }

  const verified = verifyState(state);
      if (!verified) {
              return paginaHtml("Link vencido o invalido", "Este link de conexion vencio o no es valido. Volve a Ajustes y toca \"Conectar cuenta de Drive\" de nuevo.", false);
      }
      const { userId, salon } = verified;

  try {
          const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
          const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
          if (!clientId || !clientSecret) {
                    return paginaHtml("Falta configuracion", "Faltan GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET en Vercel.", false);
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
                    return paginaHtml("Error de Google", tokenData.error_description || tokenData.error || "No se pudo canjear el codigo.", false);
          }
          if (!tokenData.refresh_token) {
                    return paginaHtml(
                                "No se recibio refresh_token",
                                "Google no mando un refresh_token (puede pasar si esta cuenta ya habia autorizado la app antes). Revoca el acceso en myaccount.google.com/permissions y volve a intentar.",
                                false
                              );
          }

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
                  return paginaHtml("Falta configuracion", "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel.", false);
        }
          const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
          const { error: dbError } = await supabaseAdmin
            .from("google_service_accounts")
            .upsert(
                { owner_id: userId, salon, credentials: { refresh_token: tokenData.refresh_token }, updated_at: new Date().toISOString() },
                { onConflict: "owner_id,salon" }
                      );

        if (dbError) {
                  return paginaHtml("Error guardando en Supabase", dbError.message, false);
        }

        return paginaHtml("Cuenta conectada", `El Drive de "${salon}" quedo conectado. Ya podes cerrar esta pestaña y volver a la app.`, true);
  } catch (err) {
          return paginaHtml("Error inesperado", String(err?.message || err), false);
  }
}

// Adaptador para Vercel: las funciones serverless de Vercel usan un export
// default (req, res) (estilo Express), a diferencia del export nombrado
// `handler(event)` que se usa arriba. Este adaptador
// traduce uno al otro para no tener que reescribir la logica de arriba.
export default async function (req, res) {
      const event = {
              httpMethod: req.method,
              headers: req.headers,
              queryStringParameters: req.query,
      };
      const result = await handler(event);
      res.status(result.statusCode);
      for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
      res.send(result.body ?? "");
}
