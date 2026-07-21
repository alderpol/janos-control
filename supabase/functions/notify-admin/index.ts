import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "fotoyvideojanosquinta@gmail.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Esta funcion se llama justo despues de signUp(), antes de que exista
    // sesion de admin, asi que no puede exigir un JWT de admin como las
    // otras. Para que no sirva de relay de spam, solo envia el aviso si el
    // email/nombre corresponden a un perfil recien creado y realmente
    // bloqueado (el trigger on_auth_user_created lo crea asi automaticamente
    // apenas alguien se registra) — no se puede disparar para cualquier
    // direccion arbitraria.
    const { email, name } = await req.json();
    if (!email) return new Response("Email requerido", { status: 400, headers: corsHeaders });

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await adminClient
      .from("profiles")
      .select("id,status,created_at")
      .eq("email", email)
      .eq("status", "blocked")
      .maybeSingle();

    if (!profile) {
      // No hay ningun perfil bloqueado con ese email: no hacemos nada.
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: ADMIN_EMAIL,
        subject: "Nuevo usuario esperando aprobación — Janos Control",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#c9a84c">Janos Control</h2>
            <p>Se registró un usuario nuevo y está esperando tu aprobación:</p>
            <p><strong>${name || "(sin nombre)"}</strong><br>${email}</p>
            <a href="https://janos-control.netlify.app"
               style="display:inline-block;margin-top:16px;padding:12px 24px;background:#c9a84c;color:#0f0a18;border-radius:8px;text-decoration:none;font-weight:700">
              Ir a Janos Control → Usuarios
            </a>
            <p style="margin-top:24px;color:#888;font-size:12px">Janos Fotografía · Quinta y Pilar Hotel</p>
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
    return new Response(String(err), { status: 500, headers: corsHeaders });
  }
});
