import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { signState } from "./_drive-auth.js";

// Arranca el flujo de OAuth para que un usuario autorice a esta app a crear
// carpetas en el Drive de un salon. Ya no es un link fijo por salon: ahora
// requiere que el usuario este logueado en la app (manda su JWT) y elige a
// que salon (de los suyos) quiere conectarle una cuenta de Drive. El
// "state" que se manda a Google va firmado con GOOGLE_OAUTH_STATE_SECRET
// (ver signState en api/_drive-auth.js) para que nadie pueda armar el link
// a mano y pisar la cuenta de otro usuario.
//
// Se llama desde connectDriveAccount(salon) en cloud.js, con el JWT del
// usuario en el header Authorization. Devuelve { authUrl } - el frontend
// redirige el navegador ahi.

const REDIRECT_URI = "https://janos-control.vercel.app/api/oauth-drive-callback";

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
      if (!salon || typeof salon !== "string") return json(400, { error: "Falta salon" });

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      if (!clientId) return json(500, { error: "Falta GOOGLE_OAUTH_CLIENT_ID en Vercel" });
      if (!process.env.GOOGLE_OAUTH_STATE_SECRET) return json(500, { error: "Falta GOOGLE_OAUTH_STATE_SECRET en Vercel" });

  const state = signState(userData.user.id, salon);

  const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          response_type: "code",
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
          scope: "https://www.googleapis.com/auth/drive",
          state,
  });

  return json(200, { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
}

// Adaptador para Vercel: las funciones serverless de Vercel usan un export
// default (req, res) (estilo Express), a diferencia del export nombrado
// `handler(event)` que se usa arriba. Este adaptador
// traduce uno al otro para no tener que reescribir la logica de arriba.
export default async function (req, res) {
      const event = {
              httpMethod: req.method,
              headers: req.headers,
              body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
      };
      const result = await handler(event);
      res.status(result.statusCode);
      for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
      res.send(result.body ?? "");
}
