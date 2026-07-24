import crypto from "node:crypto";

// Funciones compartidas para autenticarse contra la API de Drive con las
// credenciales guardadas en Supabase (tabla `google_service_accounts`), sea
// el flujo nuevo (OAuth, cuenta real del salón) o el viejo (cuenta de
// servicio, JWT) como respaldo. Usado por api/create-drive-folder.js y
// api/check-drive-folder.js.

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Cambia el refresh_token de la cuenta real del salón (obtenido una vez vía
// OAuth, ver api/oauth-drive-callback.js) por un access_token nuevo.
export async function getOAuthAccessToken(refreshToken) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Falta GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET en Vercel");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "No se pudo renovar el acceso a la cuenta de Google del salón");
  return data.access_token;
}

// Respaldo: firma un JWT con la clave privada de una cuenta de servicio y
// lo cambia por un access_token (flujo "JWT Bearer" para cuentas de
// servicio). Solo se usa si en Supabase todavía queda guardada una
// credencial en formato viejo (client_email + private_key) para algún
// salón que no haya migrado a OAuth.
export async function getServiceAccountAccessToken(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope,
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(serviceAccount.private_key);
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "No se pudo autenticar la cuenta de servicio con Google");
  return data.access_token;
}

// Decide qué flujo de autenticación usar según la forma de las credenciales
// guardadas en Supabase para ese salón.
export async function getAccessToken(credentials) {
  if (credentials.refresh_token) return getOAuthAccessToken(credentials.refresh_token);
  if (credentials.client_email && credentials.private_key) {
    return getServiceAccountAccessToken(credentials, "https://www.googleapis.com/auth/drive");
  }
  throw new Error("Credenciales de Drive con formato desconocido (ni refresh_token ni client_email/private_key)");
}
