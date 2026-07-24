import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptSecret } from "../_shared/crypto.ts";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const CORS = {
    "Access-Control-Allow-Origin": "https://janos-control.vercel.app",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

async function getAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  return data.access_token || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get user from JWT
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) return new Response("Unauthorized", { status: 401, headers: CORS });

    // Get refresh token for this user
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("google_refresh_token")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.google_refresh_token) {
      return new Response(JSON.stringify({ error: "not_connected" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getAccessToken(await decryptSecret(profile.google_refresh_token));
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "token_expired" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Get month range from query params
    const url = new URL(req.url);
    const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    const [year, mon] = month.split("-").map(Number);
    const timeMin = new Date(year, mon - 1, 1).toISOString();
    const timeMax = new Date(year, mon, 1).toISOString();

    // Fetch events from Google Calendar
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
      }),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const calData = await calRes.json();

    if (!calRes.ok) {
      return new Response(JSON.stringify({ error: calData.error?.message || "calendar_error" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const events = (calData.items || []).map((e: any) => ({
      id: e.id,
      title: e.summary || "(Sin título)",
      date: (e.start?.date || e.start?.dateTime || "").slice(0, 10),
      time: e.start?.dateTime ? e.start.dateTime.slice(11, 16) : null,
      allDay: !!e.start?.date,
      location: e.location || null,
      description: e.description || null,
    }));

    return new Response(JSON.stringify({ events }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "server_error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
