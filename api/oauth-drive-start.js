// Arranca el flujo de OAuth para que la cuenta REAL de un salón
// (quinta.janosfyv@gmail.com / pilarhoteljanos@gmail.com) autorice a esta
// app a crear carpetas en su Drive. Es un paso manual, de una sola vez por
// salón: alguien entra a esta URL con esa cuenta de Google logueada en el
// navegador y confirma el permiso.
//
// Uso: /api/oauth-drive-start?salon=Quinta
//      /api/oauth-drive-start?salon=Pilar%20Hotel
//
// Después de confirmar, Google redirige a api/oauth-drive-callback.js, que
// guarda el refresh_token resultante en Supabase (tabla
// google_service_accounts). A partir de ahí, api/create-drive-folder.js lo
// usa para autenticarse como esa cuenta real — sin cuenta de servicio y sin
// necesidad de transferir la propiedad de nada después.

const REDIRECT_URI = "https://janos-control.vercel.app/api/oauth-drive-callback";
const SALONES_VALIDOS = ["Quinta", "Pilar Hotel"];

export async function handler(event) {
    if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method not allowed" };

  const salon = event.queryStringParameters?.salon || "";
    if (!SALONES_VALIDOS.includes(salon)) {
          return { statusCode: 400, body: `Salón inválido. Usá uno de: ${SALONES_VALIDOS.join(", ")}` };
    }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) return { statusCode: 500, body: "Falta GOOGLE_OAUTH_CLIENT_ID en Vercel" };

  const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        access_type: "offline", // pide refresh_token, no solo access_token
        prompt: "consent", // fuerza a que Google reemita el refresh_token aunque ya se haya autorizado antes
        include_granted_scopes: "true",
        scope: "https://www.googleapis.com/auth/drive",
        state: salon,
  });

  return {
        statusCode: 302,
        headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
  };
}

// Adaptador para Vercel: las funciones serverless de Vercel usan un export
// default (req, res) (estilo Express), a diferencia del export nombrado
// `handler(event)` de Netlify Functions que se usa arriba. Este adaptador
// traduce uno al otro para no tener que reescribir la lógica de arriba.
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
