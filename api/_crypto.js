import { webcrypto } from "node:crypto";

// Cifrado de secretos en reposo (contraseñas de Zoho) para las funciones de
// Vercel. Usa AES-256-GCM con una clave maestra que vive SOLO como variable
// de entorno (SECRETS_ENCRYPTION_KEY en Vercel), nunca en la base.
//
// Formato del valor guardado:  "v1:<iv_base64>:<ciphertext_base64>"
// El prefijo "v1:" permite distinguir un valor cifrado de uno viejo en texto
// plano: decryptSecret() devuelve tal cual cualquier valor sin ese prefijo,
// así los datos que ya estaban guardados siguen funcionando hasta que se
// vuelvan a escribir (momento en que quedan cifrados).
//
// La misma clave (mismo valor base64) tiene que estar cargada en Vercel y en
// las Edge Functions de Supabase (ver supabase/functions/_shared/crypto.ts),
// porque el refresh_token de Google se cifra/descifra del lado de Supabase.

const ENC_PREFIX = "v1:";

function getKeyBytes() {
  const b64 = process.env.SECRETS_ENCRYPTION_KEY;
  if (!b64) throw new Error("Falta SECRETS_ENCRYPTION_KEY en Vercel");
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("SECRETS_ENCRYPTION_KEY debe ser 32 bytes codificados en base64");
  return raw;
}

async function importKey() {
  return webcrypto.subtle.importKey("raw", getKeyBytes(), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext) {
  if (!plaintext) return plaintext;
  const key = await importKey();
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  return ENC_PREFIX + Buffer.from(iv).toString("base64") + ":" + Buffer.from(ct).toString("base64");
}

export async function decryptSecret(value) {
  if (!value || typeof value !== "string" || !value.startsWith(ENC_PREFIX)) return value; // texto plano viejo o vacío
  const [, ivB64, ctB64] = value.split(":");
  const key = await importKey();
  const pt = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(Buffer.from(ivB64, "base64")) },
    key,
    new Uint8Array(Buffer.from(ctB64, "base64"))
  );
  return new TextDecoder().decode(pt);
}
