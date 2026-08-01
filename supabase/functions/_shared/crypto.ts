// Cifrado de secretos en reposo (refresh_token de Google Calendar) para las
// Edge Functions de Supabase. AES-256-GCM con una clave maestra que vive SOLO
// como secreto de las funciones (SECRETS_ENCRYPTION_KEY), nunca en la base.
//
// Formato:  "v1:<iv_base64>:<ciphertext_base64>". Un valor sin el prefijo
// "v1:" se considera texto plano viejo y se devuelve tal cual (compatibilidad
// hacia atrás; queda cifrado la próxima vez que se escribe).
//
// La clave (mismo valor base64) tiene que coincidir con la de Vercel
// (ver api/_crypto.js), porque las contraseñas de Zoho se cifran/descifran
// del lado de Vercel.

const ENC_PREFIX = "v1:";

function getKeyBytes(): Uint8Array {
  const b64 = Deno.env.get("SECRETS_ENCRYPTION_KEY");
  if (!b64) throw new Error("Falta SECRETS_ENCRYPTION_KEY");
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("SECRETS_ENCRYPTION_KEY debe ser 32 bytes codificados en base64");
  return raw;
}

async function importKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", getKeyBytes(), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function encryptSecret(plaintext: string): Promise<string> {
  if (!plaintext) return plaintext;
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext))
  );
  return ENC_PREFIX + b64encode(iv) + ":" + b64encode(ct);
}

export async function decryptSecret(value: string | null): Promise<string | null> {
  if (!value || typeof value !== "string" || !value.startsWith(ENC_PREFIX)) return value;
  const [, ivB64, ctB64] = value.split(":");
  const key = await importKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(ivB64) }, key, b64decode(ctB64));
  return new TextDecoder().decode(pt);
}
