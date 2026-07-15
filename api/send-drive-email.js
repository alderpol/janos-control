import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Envia por mail (SMTP Zoho) el link de Drive con las fotos y videos de un
// cliente. Se dispara a mano desde el boton "Enviar material" en la ficha
// del cliente (app.js / cloud.js::sendDriveEmailNow) — no hay cron.
//
// Vive en Vercel (no en Supabase Edge Functions) porque Supabase le pone un
// limite de 2s de CPU a sus funciones, y el handshake SMTP+TLS con Zoho
// siempre lo supera (error 546), aunque el mail termine llegando. Vercel no
// tiene esa restriccion.
//
// La cuenta de envio se elige asi: primero se fija si el usuario logueado
// cargo su propia cuenta de Zoho en su perfil (Ajustes > "Mi cuenta de
// email" -> profiles.zoho_email/zoho_app_password). Si no cargo nada, se
// usa el mapa fijo ACCOUNTS segun clients.salon (Quinta o Pilar Hotel),
// cuyas variables ZOHO_*_USER / ZOHO_*_PASS se configuran en Vercel
// (Project Settings > Environment Variables), no viven en el repo.
//
// Usa el JWT del propio usuario (no service role), asi que el RLS de
// Supabase ya limita la lectura/escritura del cliente a sus propias filas.

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No autorizado" });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return res.status(401).json({ error: "No autorizado" });

    const { clientId } = req.body || {};
    if (!clientId) return res.status(400).json({ error: "Falta clientId" });

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id,honoree,client_name,client_email,drive_url,salon")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) return res.status(500).json({ error: clientError.message });
    if (!client) return res.status(404).json({ error: "Cliente no encontrado" });
    if (!client.client_email) return res.status(400).json({ error: "El cliente no tiene email cargado" });
    if (!client.drive_url) return res.status(400).json({ error: "El cliente no tiene link de Drive cargado" });

    // Cada usuario (colega) puede cargar su propia cuenta de Zoho en su perfil
    // (Ajustes > "Mi cuenta de email"). Si la cargó, se usa esa en vez de las
    // 2 cuentas fijas por salón (pensadas originalmente solo para Quinta/Pilar
    // Hotel, que no tienen sentido para otro fotógrafo/colega con otro salón).
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("display_name,zoho_email,zoho_app_password,zoho_from_name")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return res.status(500).json({ error: profileError.message });

    let account;
    if (profile?.zoho_email && profile?.zoho_app_password) {
      account = {
        user: profile.zoho_email,
        pass: profile.zoho_app_password,
        fromName: profile.zoho_from_name || profile.display_name || "Janos Fotografía y Video",
      };
    } else {
      account = ACCOUNTS[client.salon];
      if (!account) {
        return res.status(400).json({ error: `No tenés una cuenta de Zoho propia cargada (Ajustes > Mi cuenta de email), y no hay una cuenta general para el salón "${client.salon}"` });
      }
      if (!account.user || !account.pass) {
        return res.status(500).json({ error: `Faltan las variables de Zoho para "${client.salon}" en Vercel` });
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

    await transporter.sendMail({
      from: `"${account.fromName}" <${account.user}>`,
      to: client.client_email,
      subject: "Tu material de fotos y video ya está disponible",
      html,
    });

    const { error: updateError } = await supabase
      .from("clients")
      .update({ link_sent_at: sentAt.toISOString() })
      .eq("id", clientId);

    if (updateError) {
      return res.status(200).json({
        ok: true,
        warning: `El mail se envió, pero no se pudo guardar la fecha: ${updateError.message}`,
        sentAt: sentAt.toISOString(),
        availableUntil: addDays(sentAt, 180).toISOString(),
      });
    }

    return res.status(200).json({ ok: true, sentAt: sentAt.toISOString(), availableUntil: addDays(sentAt, 180).toISOString() });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
