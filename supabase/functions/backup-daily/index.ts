import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// btoa() solo soporta Latin1: cualquier nombre con tilde o "ñ" (muy comun en
// clientes/staff en espanol) hacia que btoa(json) tirara una excepcion y el
// backup fallara en silencio. Esto codifica UTF-8 correctamente a base64.
function base64FromUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

serve(async (req) => {
  try {
    // Antes cualquiera podia invocar esta funcion (solo requeria la anon key
    // publica) y disparar un dump completo de la base + email al admin las
    // veces que quisiera. Ahora exige un secreto compartido que solo conoce
    // el cron que la llama.
    const cronSecret = Deno.env.get("BACKUP_CRON_SECRET");
    const providedSecret = req.headers.get("x-cron-secret");
    if (!cronSecret || providedSecret !== cronSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [profiles, clients, tasks, renditions, rates] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("clients").select("*"),
      supabase.from("tasks").select("*"),
      supabase.from("renditions").select("*"),
      supabase.from("rates").select("*"),
    ]);

    const backup = {
      generated_at: new Date().toISOString(),
      profiles: profiles.data || [],
      clients: clients.data || [],
      tasks: tasks.data || [],
      renditions: renditions.data || [],
      rates: rates.data || [],
    };

    const json = JSON.stringify(backup, null, 2);
    const date = new Date().toISOString().slice(0, 10);
    const resendKey = Deno.env.get("RESEND_API_KEY");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: "fotoyvideojanosquinta@gmail.com",
        subject: `Backup Janos Control — ${date}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#c9a84c">Janos Control</h2>
            <p>Backup automatico del <strong>${date}</strong></p>
            <ul style="color:#888">
              <li>${backup.clients.length} clientes</li>
              <li>${backup.tasks.length} tareas</li>
              <li>${backup.renditions.length} rendiciones</li>
              <li>${backup.profiles.length} usuarios</li>
            </ul>
            <p>El archivo JSON completo va adjunto a este email.</p>
            <p style="margin-top:24px;color:#888;font-size:12px">Janos Fotografia · Quinta y Pilar Hotel</p>
          </div>
        `,
        attachments: [
          {
            filename: `backup-janos-${date}.json`,
            content: base64FromUtf8(json),
          },
        ],
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
