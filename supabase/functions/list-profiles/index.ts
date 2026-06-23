import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401 });

    // Verificar que el usuario que llama es admin
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role")
      .maybeSingle();

    if (profileError || profile?.role !== "admin") {
      return new Response("Forbidden", { status: 403 });
    }

    // Usar service role para traer todos los perfiles
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await adminClient
      .from("profiles")
      .select("id,display_name,email,whatsapp,role,status,created_at,last_seen_at")
      .order("created_at");

    if (error) throw error;

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});
