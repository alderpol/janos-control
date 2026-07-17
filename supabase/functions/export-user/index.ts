import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Reconstruida: la version original se deployaba directo desde WSL y nunca
// se subio al repo (.gitignore la excluia). Esta version usa el JWT del
// propio usuario (no service role), asi que el RLS ya limita el resultado a
// sus propias filas — no hace falta logica extra de autorizacion.

// Mismo limite silencioso de 1000 filas ("Max Rows" del proyecto) que ya
// causo perdida de datos en otros dos lugares (loadCloudState en cloud.js y
// el backup diario). Esta cuenta ya supera las 1000 tareas, asi que sin
// paginar, el export de "mis datos" tambien quedaria truncado en silencio.
async function fetchAll(builderFn: () => any) {
  const pageSize = 1000;
  let rows: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await builderFn().order("id").range(from, from + pageSize - 1);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const [profile, clients, tasks, renditions, rates] = await Promise.all([
      userClient.from("profiles").select("*").eq("id", userData.user.id).maybeSingle(),
      fetchAll(() => userClient.from("clients").select("*")),
      fetchAll(() => userClient.from("tasks").select("*")),
      fetchAll(() => userClient.from("renditions").select("*")),
      fetchAll(() => userClient.from("rates").select("*")),
    ]);

    const payload = {
      generated_at: new Date().toISOString(),
      user: { id: userData.user.id, email: userData.user.email },
      profile: profile.data || null,
      clients: clients || [],
      tasks: tasks || [],
      renditions: renditions || [],
      rates: rates || [],
    };

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="janos-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
      status: 200,
    });
  } catch (err) {
    return new Response(String(err), { status: 500, headers: corsHeaders });
  }
});
