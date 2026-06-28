import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Verificar que el solicitante es admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401 });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Verificar rol del usuario que hace el request
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: profile } = await userClient.from("profiles").select("role").maybeSingle();
    if (profile?.role !== "admin") return new Response("Forbidden", { status: 403 });

    const { userId } = await req.json();
    if (!userId) return new Response("userId requerido", { status: 400 });

    // Obtener datos del usuario con service role (bypasea RLS)
    const [clientsRes, tasksRes, renditionsRes, ratesRes, profileRes] = await Promise.all([
      supabaseAdmin.from("clients").select("*").eq("owner_id", userId),
      supabaseAdmin.from("tasks").select("*").eq("owner_id", userId),
      supabaseAdmin.from("renditions").select("*").eq("owner_id", userId),
      supabaseAdmin.from("rates").select("*").eq("owner_id", userId),
      supabaseAdmin.from("profiles").select("*").eq("id", userId).maybeSingle(),
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      user: profileRes.data || { id: userId },
      clients: clientsRes.data || [],
      tasks: tasksRes.data || [],
      renditions: renditionsRes.data || [],
      rates: ratesRes.data || [],
    };

    return new Response(JSON.stringify(backup), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
