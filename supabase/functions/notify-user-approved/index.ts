import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const { email, name } = await req.json();
    if (!email) return new Response("Email requerido", { status: 400 });

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
            <p>Hola ${name || ""}!</p>
            <p>Tu cuenta fue aprobada. Ya podés ingresar a la app:</p>
            <a href="https://janos-control.vercel.app" 
               style="display:inline-block;margin-top:16px;padding:12px 24px;background:#c9a84c;color:#0f0a18;border-radius:8px;text-decoration:none;font-weight:700">
              Ingresar a Janos Control
            </a>
            <p style="margin-top:24px;color:#888;font-size:12px">Janos Fotografía · Quinta y Pilar Hotel</p>
          </div>
        `,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
      status: res.ok ? 200 : 400,
    });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});
