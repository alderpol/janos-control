import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const REDIRECT_URI = "https://mybeysibpwoaudohxomr.supabase.co/functions/v1/google-calendar-auth";
const APP_URL = "https://janos-control.vercel.app";

// @ts-ignore
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.redirect(`${APP_URL}?calendar_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  // Exchange code for tokens
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

  // Save refresh_token to profiles table using service role
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { error: dbError } = await supabase
    .from("profiles")
    .update({ google_refresh_token: tokens.refresh_token })
    .eq("id", state);

  if (dbError) {
    console.error("DB error:", dbError);
    return Response.redirect(`${APP_URL}?calendar_error=db_error`);
  }

  return Response.redirect(`${APP_URL}?calendar_connected=1`);
});
