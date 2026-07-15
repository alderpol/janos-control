import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Envia por mail (SMTP Zoho) el link de Drive con las fotos y videos de un
// cliente. Se dispara a mano desde el boton "Enviar material" en la ficha del
// cliente (app.js / cloud.js::sendDriveEmailNow) — no hay cron ni disparo
// automatico por fecha. Usa el JWT del propio usuario (no service role), asi
// que el RLS ya limita la lectura del cliente a sus propias filas.
//
// La cuenta de envio (Quinta o Pilar Hotel) se elige segun clients.salon.
// Los secrets ZOHO_*_USER / ZOHO_*_PASS se configuran en el dashboard de
// Supabase (Project Settings > Edge Functions > Secrets), no viven en el
// repo.
//
// Ademas de mandar el mail, esta funcion guarda clients.link_sent_at ella
// misma (no depende de que app.js llegue a sincronizarlo con la nube), asi
// queda persistido aunque el navegador se cierre o recargue justo despues.

const ACCOUNTS: Record<string, { user: string | undefined; pass: string | undefined; fromName: string }> = {
  "Quinta": {
    user: Deno.env.get("ZOHO_QUINTA_USER"),
    pass: Deno.env.get("ZOHO_QUINTA_PASS"),
    fromName: "Janos Quinta · Foto y Video",
  },
  "Pilar Hotel": {
    user: Deno.env.get("ZOHO_PILAR_USER"),
    pass: Deno.env.get("ZOHO_PILAR_PASS"),
    fromName: "Janos Pilar Hotel · Foto y Video",
  },
};

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDateEs(date: Date) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No autorizado" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: "No autorizado" }, 401);

    const { clientId } = await req.json().catch(() => ({}));
    if (!clientId) return jsonResponse({ error: "Falta clientId" }, 400);

    const { data: client, error: clientError } = await userClient
      .from("clients")
      .select("id,honoree,client_name,client_email,drive_url,salon")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) return jsonResponse({ error: clientError.message }, 500);
    if (!client) return jsonResponse({ error: "Cliente no encontrado" }, 404);
    if (!client.client_email) return jsonResponse({ error: "El cliente no tiene email cargado" }, 400);
    if (!client.drive_url) return jsonResponse({ error: "El cliente no tiene link de Drive cargado" }, 400);

    const account = ACCOUNTS[client.salon];
    if (!account) return jsonResponse({ error: `No hay cuenta de Zoho configurada para el salón "${client.salon}"` }, 400);
    if (!account.user || !account.pass) {
      return jsonResponse({ error: `Faltan los secrets de Zoho para "${client.salon}" en Supabase` }, 500);
    }

    const sentAt = new Date();
    const availableUntil = formatDateEs(addDays(sentAt, 180));
    const displayName = client.client_name || client.honoree || "";

    const html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#222">
        <h2 style="color:#c9a84c;margin-bottom:4px">Janos Fotografía y Video</h2>
        <p>Hola${displayName ? " " + displayName : ""},</p>
        <p>¡Ya está listo el material de fotos y videos de <strong>${client.honoree}</strong>! Podés acceder desde este link:</p>
        <p style="margin:20px 0">
          <a href="${client.drive_url}"
             style="display:inline-block;padding:12px 24px;background:#c9a84c;color:#0f0a18;border-radius:8px;text-decoration:none;font-weight:700">
            Ver mis fotos y videos
          </a>
        </p>
        <p>Vas a poder descargarlo desde este link hasta el <strong>${availableUntil}</strong> (180 días desde este mail). Te recomendamos guardarlo en tu computadora o en tu propia nube antes de esa fecha, para tenerlo siempre a mano.</p>
        <p>¡Gracias por haber elegido a Janos para acompañarte en un día tan especial! Fue un placer para todo el equipo.</p>
        <p>Un abrazo,<br>El equipo de Janos Fotografía y Video</p>
        <p style="margin-top:24px;color:#888;font-size:12px">Janos Fotografía · ${client.salon}</p>
      </div>
    `;

    const smtp = new SMTPClient({
      connection: {
        hostname: "smtp.zoho.com",
        port: 465,
        tls: true,
        auth: { username: account.user, password: account.pass },
      },
    });

    await smtp.send({
      from: `${account.fromName} <${account.user}>`,
      to: client.client_email,
      subject: "Tu material de fotos y video ya está disponible",
      html,
    });
    // No esperamos al cierre de la conexion: una vez que send() resuelve, el
    // mail ya quedo en manos de Zoho. Esperar el cierre (QUIT/TLS shutdown)
    // hacia que la funcion se pasara del limite de CPU de Supabase (error 546)
    // y devolviera error aunque el mail ya se hubiera entregado bien.
    smtp.close().catch(() => {});

    // Guardamos link_sent_at aca mismo (no solo del lado de la app) para que
    // quede persistido incluso si el navegador se cierra o recarga antes de
    // que termine su propia sincronizacion con la nube.
    const { error: updateError } = await userClient
      .from("clients")
      .update({ link_sent_at: sentAt.toISOString() })
      .eq("id", clientId);
    if (updateError) {
      return jsonResponse({ ok: true, warning: `El mail se envió, pero no se pudo guardar la fecha: ${updateError.message}`, sentAt: sentAt.toISOString(), availableUntil: addDays(sentAt, 180).toISOString() });
    }

    return jsonResponse({ ok: true, sentAt: sentAt.toISOString(), availableUntil: addDays(sentAt, 180).toISOString() });
  } catch (err) {
    return jsonResponse({ error: String((err as Error)?.message || err) }, 500);
  }
});
