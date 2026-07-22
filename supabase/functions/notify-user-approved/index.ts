import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://janos-control.netlify.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(value: string): string {
  return String(value ?? "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c] as string)
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    // Solo un admin activo puede disparar este email. Antes cualquiera con
    // la anon key (publica en el frontend) podia usar esta funcion como
    // relay de mails arbitrarios a cualquier direccion.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const { data: profile } = await userClient.from("profiles").select("role,status").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin" || profile?.status !== "active") {
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }

    const { email, name } = await req.json();
    if (!email) return new Response("Email requerido", { status: 400, headers: corsHeaders });

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: email,
        subject: "Tu cuenta en Janos Control fue aprobada",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#c9a84c">Janos Control</h2>
            <p>Hola ${escapeHtml(name || "")}!</p>
            <p>Tu cuenta fue aprobada. Ya podes ingresar a la app:</p>
            <a href="https://janos-control.netlify.app" 
               style="display:inline-block;margin-top:16px;padding:12px 24px;background:#c9a84c;color:#0f0a18;border-radius:8px;text-decoration:none;font-weight:700">
              Ingresar a Janos Control
            </a>
            <p style="margin-top:24px;color:#888;font-size:12px">Janos Fotografia · Quinta y Pilar Hotel</p>
          </div>
        `,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: res.ok ? 200 : 400,
    });
  } catch (err) {
    console.error("notify-user-approved error:", err);
    return new Response("Error interno del servidor", { status: 500, headers: corsHeaders });
  }
});
