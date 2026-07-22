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

// Supabase/PostgREST corta cualquier select() sin paginar en 1000 filas (limite
// "Max Rows" del proyecto), en silencio. Con >1000 tareas en la cuenta esto
// hacia que el backup diario quedara truncado hace semanas sin que nadie lo
// notara (el asunto del mail siempre decia "1000 tareas" seas cuantos
// clientes hubiera). fetchAll pagina con .range() + un desempate por "id"
// hasta traer todas las filas.
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

    // NO incluir secretos en el backup: zoho_accounts (contraseñas de
    // aplicación de Zoho) y google_refresh_token quedan fuera a propósito,
    // para no mandarlos en texto plano por email. Si se agregan columnas
    // nuevas no sensibles a profiles, sumalas acá a mano.
    const PROFILE_BACKUP_COLUMNS = "id,display_name,email,whatsapp,role,status,created_at,last_seen_at,salons,settings";
    const [profiles, clients, tasks, renditions, rates] = await Promise.all([
      fetchAll(() => supabase.from("profiles").select(PROFILE_BACKUP_COLUMNS)),
      fetchAll(() => supabase.from("clients").select("*")),
      fetchAll(() => supabase.from("tasks").select("*")),
      fetchAll(() => supabase.from("renditions").select("*")),
      fetchAll(() => supabase.from("rates").select("*")),
    ]);

    const backup = {
      generated_at: new Date().toISOString(),
      profiles,
      clients,
      tasks,
      renditions,
      rates,
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
    console.error("backup-daily error:", err);
    return new Response("Error interno del servidor", { status: 500 });
  }
});
