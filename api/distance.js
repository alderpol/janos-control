// Calcula la distancia en auto (ida) entre dos direcciones usando la
// Distance Matrix API de Google. Se usa desde la calculadora de viáticos
// (public/viaticos.html), que es una página pública sin login, por eso
// este endpoint no exige autenticación de Supabase como los demás en /api.
// La API key de Google vive solo en el servidor (GOOGLE_MAPS_API_KEY) para
// no quedar expuesta en el HTML público.

const CORS = {
  "Access-Control-Allow-Origin": "https://janos-control.vercel.app",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return json(500, { error: "Falta la variable GOOGLE_MAPS_API_KEY en Vercel" });
    }

    const { origin, destination } = JSON.parse(event.body || "{}");
    if (!origin || !destination) return json(400, { error: "Faltan origin y/o destination" });

    const params = new URLSearchParams({
      origins: origin,
      destinations: destination,
      units: "metric",
      mode: "driving",
      language: "es",
      key: process.env.GOOGLE_MAPS_API_KEY,
    });

    const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.status !== "OK") {
      return json(502, { error: data.error_message || `Google Maps respondió: ${data.status || res.status}` });
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") {
      return json(422, { error: "No se pudo calcular la ruta entre esas direcciones. Verificá que estén bien escritas." });
    }

    return json(200, {
      km: Math.round((element.distance.value / 1000) * 10) / 10,
      distanceText: element.distance.text,
      durationText: element.duration.text,
      originAddress: data.origin_addresses?.[0] || origin,
      destinationAddress: data.destination_addresses?.[0] || destination,
    });
  } catch (err) {
    console.error("distance error:", err);
    return json(500, { error: String(err?.message || "Error interno del servidor") });
  }
}

// Adaptador para Vercel (ver check-drive-folder.js para más contexto de por
// qué existe este puente entre el estilo `handler(event)` y el estilo
// `(req, res)` que espera Vercel).
export default async function (req, res) {
  const event = {
    httpMethod: req.method,
    headers: req.headers,
    body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
  };
  const result = await handler(event);
  res.status(result.statusCode);
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.send(result.body);
}
