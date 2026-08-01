import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptSecret } from "../_shared/crypto.ts";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const GOOGLE_OAUTH_STATE_SECRET = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET")!;
const REDIRECT_URI = "https://mybeysibpwoaudohxomr.supabase.co/functions/v1/google-calendar-auth";
const APP_URL = "https://janos-control.vercel.app";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos de validez para el "state"

const CORS = {
    "Access-Control-Allow-Origin": "https://janos-control.vercel.app",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Firma HMAC del "state" (evita que alguien arme la URL de Google a mano
// con el id de otra persona como state, como advierte el comentario de
// connectGoogleCalendar() en app.js) ---
async function hmacHex(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(GOOGLE_OAUTH_STATE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function signState(userId: string): Promise<string> {
  const payload = `${userId}:${Date.now()}`;
  const sig = await hmacHex(payload);
  return `${payload}:${sig}`;
}

async function verifyState(state: string): Promise<string | null> {
  const parts = state.split(":");
  if (parts.length !== 3) return null;
  const [userId, ts, sig] = parts;
  const expected = await hmacHex(`${userId}:${ts}`);
  if (!timingSafeEqual(sig, expected)) return null;
  if (Date.now() - Number(ts) > STATE_TTL_MS) return null;
  return userId;
}

// @ts-ignore
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Paso 2: Google redirige acá con ?code=...&state=... después del consentimiento.
  if (code || stateParam || error) {
    if (error) {
      return Response.redirect(`${APP_URL}?calendar_error=${encodeURIComponent(error)}`);
    }
    if (!code || !stateParam) {
      return new Response("Missing code or state", { status: 400 });
    }

    const userId = await verifyState(stateParam);
    if (!userId) {
      console.error("Invalid or expired OAuth state");
      return Response.redirect(`${APP_URL}?calendar_error=invalid_state`);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.refresh_token) {
      console.error("No refresh token received:", tokens);
      return Response.redirect(`${APP_URL}?calendar_error=no_refresh_token`);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: dbError } = await supabase
      .from("profiles")
      .update({ google_refresh_token: await encryptSecret(tokens.refresh_token) })
      .eq("id", userId);

    if (dbError) {
      console.error("DB error:", dbError);
      return Response.redirect(`${APP_URL}?calendar_error=db_error`);
    }

    return Response.redirect(`${APP_URL}?calendar_connected=1`);
  }

  // Paso 1: el frontend (connectGoogleCalendar en app.js) pide acá la URL de
  // consentimiento de Google. Esta rama no existía en la versión anterior,
  // por eso el botón "Conectar Google Calendar" siempre tiraba error.
  if (req.method === "POST") {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const state = await signState(user.id);
    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      state,
    });

    return new Response(JSON.stringify({ authUrl }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405, headers: CORS });
});
