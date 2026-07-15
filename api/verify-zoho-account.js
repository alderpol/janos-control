import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Prueba en el momento si el email + contraseña de aplicación de Zoho que
// el usuario cargó en Ajustes > "Mi cuenta de email" son válidos, sin
// mandar ningún mail (transporter.verify() solo hace el login SMTP).
// Se llama automáticamente después de guardar esa cuenta (ver
// app.js::saveZohoAccount), así el usuario se entera al toque si escribió
// mal el usuario o la contraseña, en vez de descubrirlo recién cuando le
// intenta mandar el material a un cliente real.

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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("zoho_email,zoho_app_password")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return res.status(500).json({ error: profileError.message });

    if (!profile?.zoho_email || !profile?.zoho_app_password) {
      return res.status(400).json({ error: "No tenés una cuenta de Zoho propia cargada" });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.zoho.com",
      port: 465,
      secure: true,
      auth: { user: profile.zoho_email, pass: profile.zoho_app_password },
    });

    try {
      await transporter.verify();
    } catch (verifyError) {
      if (verifyError?.responseCode === 535 || verifyError?.code === "EAUTH") {
        return res.status(400).json({ error: "Zoho rechazó el email o la contraseña de aplicación cargados." });
      }
      return res.status(500).json({ error: `No se pudo conectar con Zoho: ${String(verifyError?.message || verifyError)}` });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
