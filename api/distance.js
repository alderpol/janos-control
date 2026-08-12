// Calcula la distancia en auto (ida) entre dos direcciones usando la
// Directions API de Google. Se usa desde la calculadora de viáticos
// (public/viaticos.html), que es una página pública sin login, por eso
// este endpoint no exige autenticación de Supabase como los demás en /api.
// La API key de Google vive solo en el servidor (GOOGLE_MAPS_API_KEY) para
// no quedar expuesta en el HTML público.
// Usamos Directions (con alternatives=true) en vez de Distance Matrix: Distance
// Matrix devuelve una sola ruta (la que Google arma como "mejor", priorizando
// tiempo/tráfico, que puede ser más larga en km por ir toda por autopista) y no
// deja elegir otra. Pedimos las rutas alternativas y, según el parámetro
// `routeType` que manda el front (shortest | longest | fastest), nos quedamos
// con la de menor distancia, mayor distancia, o menor duración.

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

    const { origin, destination, routeType } = JSON.parse(event.body || "{}");
    if (!origin || !destination) return json(400, { error: "Faltan origin y/o destination" });
    const type = ["shortest", "longest", "fastest"].includes(routeType) ? routeType : "shortest";

    const params = new URLSearchParams({
      origin,
      destination,
      alternatives: "true",
      units: "metric",
      mode: "driving",
      language: "es",
      key: process.env.GOOGLE_MAPS_API_KEY,
    });

    const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.status !== "OK") {
      return json(502, { error: data.error_message || `Google Maps respondió: ${data.status || res.status}` });
    }

    const routes = (data.routes || []).filter(r => r.legs?.[0]?.distance?.value != null);
    if (!routes.length) {
      return json(422, { error: "No se pudo calcular la ruta entre esas direcciones. Verificá que estén bien escritas." });
    }

    // De todas las rutas alternativas, elegimos según el criterio pedido.
    const best = routes.reduce((acc, r) => {
      if (type === "longest") return r.legs[0].distance.value > acc.legs[0].distance.value ? r : acc;
      if (type === "fastest") return r.legs[0].duration.value < acc.legs[0].duration.value ? r : acc;
      return r.legs[0].distance.value < acc.legs[0].distance.value ? r : acc; // shortest
    });
    const leg = best.legs[0];

    return json(200, {
      km: Math.round((leg.distance.value / 1000) * 10) / 10,
      distanceText: leg.distance.text,
      durationText: leg.duration.text,
      originAddress: leg.start_address || origin,
      destinationAddress: leg.end_address || destination,
      routeType: type,
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
