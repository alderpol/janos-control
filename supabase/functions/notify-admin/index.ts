import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://janos-control.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "fotoyvideojanosquinta@gmail.com";

// Ventana en la que se acepta avisar tras el registro. Como esta función no
// exige login (se llama justo después de signUp, cuando todavía no hay
// sesión), esto acota el abuso: solo dispara si el perfil bloqueado se creó
// recién. Un atacante que conozca el email de un usuario pendiente no puede
// usarla para bombardear al admin indefinidamente.
const SIGNUP_NOTIFY_WINDOW_MS = 15 * 60 * 1000;

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

    // Solo avisar si el perfil se creó recién (ventana de registro). Fuera de
    // esa ventana no se manda nada: evita usar esta función como relay de
    // spam/phishing hacia el admin para cuentas pendientes viejas.
    const createdAtMs = profile.created_at ? new Date(profile.created_at).getTime() : 0;
    if (!createdAtMs || Date.now() - createdAtMs > SIGNUP_NOTIFY_WINDOW_MS) {
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
            <p><strong>${escapeHtml(name || "(sin nombre)")}</strong><br>${escapeHtml(email)}</p>
                        <a href="https://janos-control.vercel.app"
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
    console.error("notify-admin error:", err);
    return new Response("Error interno del servidor", { status: 500, headers: corsHeaders });
  }
});
