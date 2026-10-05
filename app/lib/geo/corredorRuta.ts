import type { PuntoGeo } from "./haversine.ts";
import { decodificarPolyline } from "./vueltaACasa.ts";

/**
 * Corredor de regreso de "Vuelta a Casa": la ruta real B → A de Google Directions
 * (overview_polyline decodificada). SÓLO LECTURA, sin efectos más allá de la llamada a
 * Google. Caché en memoria por (B, A) durante 24 h — B y A de un viaje no cambian, así que
 * cada viaje activo consulta Directions una sola vez por instancia.
 * Si Google falla, devuelve null (el endpoint responde sin oportunidades, nunca inventa).
 */

const TTL_CORREDOR_MS = 24 * 60 * 60 * 1000;
const TTL_FALLO_MS = 5 * 60 * 1000; // un fallo de Google se reintenta pronto, no en 24 h
const cache = new Map<string, { puntos: PuntoGeo[] | null; ts: number }>();

export async function obtenerCorredorRuta(dirB: string, dirA: string, apiKey: string): Promise<PuntoGeo[] | null> {
  const clave = `${dirB.trim().toLowerCase()}|${dirA.trim().toLowerCase()}`;
  const c = cache.get(clave);
  if (c && Date.now() - c.ts < (c.puntos ? TTL_CORREDOR_MS : TTL_FALLO_MS)) return c.puntos;
  let puntos: PuntoGeo[] | null = null;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(`${dirB}, Argentina`)}` +
      `&destination=${encodeURIComponent(`${dirA}, Argentina`)}&mode=driving&language=es&region=ar&key=${apiKey}`;
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json();
    const poly = data?.routes?.[0]?.overview_polyline?.points;
    if (data?.status === "OK" && typeof poly === "string" && poly.length > 0) puntos = decodificarPolyline(poly);
  } catch { /* puntos queda null */ }
  cache.set(clave, { puntos, ts: Date.now() });
  return puntos;
}
