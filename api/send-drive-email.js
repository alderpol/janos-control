import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Envia por mail (SMTP Zoho) el link de Drive con las fotos y videos de un
// cliente. Se dispara a mano desde el boton "Enviar material" en la ficha
// del cliente (app.js / cloud.js::sendDriveEmailNow) — no hay cron.
//
// Migrada de Vercel a Netlify Functions (julio 2026, tras perder el acceso
// a la cuenta de Vercel). La logica es identica; solo cambia la forma de
// leer el request y devolver la respuesta (event/context en vez de
// req/res). netlify.toml redirige /api/* -> /.netlify/functions/*, asi que
// las rutas que ya usa cloud.js no cambian.
//
// Vive en una funcion serverless "de verdad" (no Supabase Edge Functions)
// porque Supabase le pone un limite de 2s de CPU a sus funciones, y el
// handshake SMTP+TLS con Zoho siempre lo supera (error 546), aunque el mail
// termine llegando.
//
// La cuenta de envio se elige asi: primero se fija si el usuario logueado
// cargo su propia cuenta de Zoho PARA EL SALON DE ESTE CLIENTE, en su perfil
// (Ajustes > "Mi cuenta de email" -> profiles.zoho_accounts[client.salon],
// un usuario puede tener una cuenta distinta por cada salon en el que
// trabaja). Si no cargo nada para ese salon, se usa el mapa fijo ACCOUNTS
// segun clients.salon (Quinta o Pilar Hotel), cuyas variables ZOHO_*_USER /
// ZOHO_*_PASS se configuran en Netlify (Site configuration > Environment
// variables), no viven en el repo.
//
// Usa el JWT del propio usuario (no service role), asi que el RLS de
// Supabase ya limita la lectura/escritura del cliente a sus propias filas.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACCOUNTS = {
  Quinta: {
    user: process.env.ZOHO_QUINTA_USER,
    pass: process.env.ZOHO_QUINTA_PASS,
    fromName: "Janos Quinta · Foto y Video",
  },
  "Pilar Hotel": {
    user: process.env.ZOHO_PILAR_USER,
    pass: process.env.ZOHO_PILAR_PASS,
    fromName: "Janos Pilar Hotel · Foto y Video",
  },
};

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDateEs(date) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) return json(401, { error: "No autorizado" });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return json(401, { error: "No autorizado" });

    const { clientId } = JSON.parse(event.body || "{}");
    if (!clientId) return json(400, { error: "Falta clientId" });

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id,honoree,client_name,client_email,drive_url,salon")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) return json(500, { error: clientError.message });
    if (!client) return json(404, { error: "Cliente no encontrado" });
    if (!client.client_email) return json(400, { error: "El cliente no tiene email cargado" });
    if (!client.drive_url) return json(400, { error: "El cliente no tiene link de Drive cargado" });

    // Cada usuario (colega) puede cargar su propia cuenta de Zoho en su perfil
    // (Ajustes > "Mi cuenta de email"), una por cada salón en el que trabaja
    // (zoho_accounts es un jsonb {salon: {email,password,fromName}}). Si
    // tiene una cargada para el salón de ESTE cliente, se usa esa.
    //
    // Las 2 cuentas fijas (ZOHO_QUINTA_*/ZOHO_PILAR_*) son las cuentas
    // personales del administrador — SOLO el administrador puede usarlas
    // como respaldo si no cargó una cuenta propia.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("display_name,role,status,zoho_accounts")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return json(500, { error: profileError.message });

    const isAdmin = profile?.role === "admin" && profile?.status === "active";
    const personalAccount = profile?.zoho_accounts?.[client.salon];
    let account;
    if (personalAccount?.email && personalAccount?.password) {
      account = {
        user: personalAccount.email,
        pass: personalAccount.password,
        fromName: personalAccount.fromName || profile.display_name || "Janos Fotografía y Video",
      };
    } else if (!isAdmin) {
      return json(400, { error: `No tenés una cuenta de Zoho propia cargada para "${client.salon}". Cargala en Ajustes > Mi cuenta de email para poder enviar el material.` });
    } else {
      account = ACCOUNTS[client.salon];
      if (!account) {
        return json(400, { error: `No tenés una cuenta de Zoho propia cargada para "${client.salon}" (Ajustes > Mi cuenta de email), y no hay una cuenta general para ese salón` });
      }
      if (!account.user || !account.pass) {
        return json(500, { error: `Faltan las variables de Zoho para "${client.salon}" en Netlify` });
      }
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

    const transporter = nodemailer.createTransport({
      host: "smtp.zoho.com",
      port: 465,
      secure: true,
      auth: { user: account.user, pass: account.pass },
    });

    try {
      await transporter.sendMail({
        from: `"${account.fromName}" <${account.user}>`,
        to: client.client_email,
        subject: "Tu material de fotos y video ya está disponible",
        html,
      });
    } catch (sendError) {
      if (sendError?.responseCode === 535 || sendError?.code === "EAUTH") {
        const who = personalAccount?.email && personalAccount?.password ? `tu cuenta personal de "${client.salon}" (Ajustes > Mi cuenta de email)` : `la cuenta configurada para "${client.salon}"`;
        return json(400, { error: `Zoho rechazó el email o la contraseña de aplicación de ${who}. Revisalos y volvé a intentar.` });
      }
      throw sendError;
    }

    const { error: updateError } = await supabase
      .from("clients")
      .update({ link_sent_at: sentAt.toISOString() })
      .eq("id", clientId);

    if (updateError) {
      return json(200, {
        ok: true,
        warning: `El mail se envió, pero no se pudo guardar la fecha: ${updateError.message}`,
        sentAt: sentAt.toISOString(),
        availableUntil: addDays(sentAt, 180).toISOString(),
      });
    }

    return json(200, { ok: true, sentAt: sentAt.toISOString(), availableUntil: addDays(sentAt, 180).toISOString() });
  } catch (err) {
    return json(500, { error: String(err?.message || err) });
  }
}
