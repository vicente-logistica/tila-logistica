import { esCoordenadaValida, type PuntoGeo } from "./haversine.ts";

/**
 * Geografía de una carga al PUBLICARSE — lógica pura + una llamada a Google Directions con
 * fetch inyectable (testeable sin red). Una sola llamada con TODOS los puntos (origen,
 * paradas como waypoints, destino) devuelve a la vez:
 *   - km por tramo y total (misma regla que la vista previa de /publicar hoy: cada tramo
 *     redondeado hacia arriba a km enteros, y la suma de esos tramos);
 *   - place_id de cada punto (geocoded_waypoints) — Google permite conservarlo;
 *   - lat/lng de cada punto (legs[i].start_location; el último, end_location del último
 *     tramo) — Google permite conservarlas hasta 30 días (ver coordenadasVigentes).
 * No toca la navegación activa del chofer (MapaTILA / viaje-activo no usan este módulo).
 */

export const DIAS_VIGENCIA_COORDENADAS = 30;
const MS_VIGENCIA_COORDENADAS = DIAS_VIGENCIA_COORDENADAS * 24 * 60 * 60 * 1000;
// Tolerancia a relojes desfasados entre la base (que fija geo_obtenido_at) y el servidor:
// una fecha levemente "futura" sigue siendo válida; una muy futura es un dato corrupto.
const MS_TOLERANCIA_RELOJ = 5 * 60 * 1000;

// Origen + hasta 4 paradas + destino (MAX_PARADAS de /publicar) — Directions admite hasta
// 25 waypoints, pero no se acepta más de lo que la publicación permite.
export const MAXIMO_PUNTOS_RUTA = 6;

export interface PuntoRuta extends PuntoGeo {
  placeId: string | null;
}

export type ResultadoRutaPublicacion =
  | { ok: true; kmTotal: number; kmPorTramo: number[]; puntos: PuntoRuta[] }
  | { ok: false; motivo: string };

// Mismo sufijo que /api/distancia y los demás cálculos server-side.
const conPais = (direccion: string) => `${direccion.trim()}, Argentina`;

/** null si la lista no es válida para pedir una ruta (menos de 2 o más del máximo, o vacíos). */
export function validarPuntosRuta(direcciones: unknown): string[] | null {
  if (!Array.isArray(direcciones)) return null;
  if (direcciones.length < 2 || direcciones.length > MAXIMO_PUNTOS_RUTA) return null;
  const limpias = direcciones.map(d => (typeof d === "string" ? d.trim() : ""));
  return limpias.every(d => d.length > 0) ? limpias : null;
}

/**
 * Puntos pedidos a /api/distancia: `?punto=A&punto=B&punto=C` (formato actual, todos los
 * puntos en orden) o el formato simple anterior `?origen=A&destino=B`. Devuelve la lista
 * cruda — validarPuntosRuta decide si es usable.
 */
export function puntosDesdeParametros(q: { getAll: (k: string) => string[]; get: (k: string) => string | null }): string[] {
  const puntos = q.getAll("punto");
  if (puntos.length > 0) return puntos;
  const origen = q.get("origen"), destino = q.get("destino");
  return origen !== null && destino !== null ? [origen, destino] : [];
}

/** URL de Directions con origen, paradas intermedias como waypoints (en orden, sin
 *  optimizar) y destino. */
export function construirUrlRutaPublicacion(direcciones: string[], apiKey: string): string {
  const origen = direcciones[0];
  const destino = direcciones[direcciones.length - 1];
  const intermedias = direcciones.slice(1, -1);
  let url =
    `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(conPais(origen))}` +
    `&destination=${encodeURIComponent(conPais(destino))}`;
  if (intermedias.length > 0) {
    url += `&waypoints=${encodeURIComponent(intermedias.map(conPais).join("|"))}`;
  }
  return `${url}&mode=driving&language=es&region=ar&key=${encodeURIComponent(apiKey)}`;
}

const aPunto = (l: unknown): PuntoGeo | null => {
  const p = l as { lat?: unknown; lng?: unknown } | null | undefined;
  return p && esCoordenadaValida(p.lat, p.lng) ? { lat: p.lat as number, lng: p.lng as number } : null;
};

/**
 * Interpreta la respuesta JSON de Directions para `cantidadPuntos` puntos. Exige status OK,
 * exactamente cantidadPuntos − 1 tramos con distancia válida y coordenadas válidas en cada
 * punto. place_id puede faltar (queda null) sin invalidar la ruta.
 */
export function interpretarRutaPublicacion(data: unknown, cantidadPuntos: number): ResultadoRutaPublicacion {
  const d = data as {
    status?: unknown;
    routes?: { legs?: { distance?: { value?: unknown }; start_location?: unknown; end_location?: unknown }[] }[];
    geocoded_waypoints?: { geocoder_status?: unknown; place_id?: unknown }[];
  } | null | undefined;
  if (!d || d.status !== "OK") return { ok: false, motivo: `directions_${typeof d?.status === "string" ? d.status : "sin_status"}` };
  const legs = d.routes?.[0]?.legs;
  if (!Array.isArray(legs) || legs.length !== cantidadPuntos - 1) return { ok: false, motivo: "tramos_inesperados" };

  const kmPorTramo: number[] = [];
  for (const leg of legs) {
    const metros = leg?.distance?.value;
    if (typeof metros !== "number" || !Number.isFinite(metros) || metros < 0) return { ok: false, motivo: "distancia_invalida" };
    kmPorTramo.push(Math.ceil(metros / 1000));
  }
  const kmTotal = kmPorTramo.reduce((a, k) => a + k, 0);
  if (!(kmTotal > 0)) return { ok: false, motivo: "distancia_cero" };

  const waypoints = Array.isArray(d.geocoded_waypoints) ? d.geocoded_waypoints : [];
  const puntos: PuntoRuta[] = [];
  for (let i = 0; i < cantidadPuntos; i++) {
    const coords = i < legs.length ? aPunto(legs[i]?.start_location) : aPunto(legs[legs.length - 1]?.end_location);
    if (!coords) return { ok: false, motivo: "coordenadas_invalidas" };
    const w = waypoints[i];
    const placeId = w && w.geocoder_status === "OK" && typeof w.place_id === "string" && w.place_id.trim()
      ? w.place_id
      : null;
    puntos.push({ ...coords, placeId });
  }
  return { ok: true, kmTotal, kmPorTramo, puntos };
}

type FetchLike = (url: string, init?: { cache?: "no-store" }) => Promise<{ json: () => Promise<unknown> }>;

/** Una llamada a Directions para toda la ruta. Nunca lanza: errores de red/JSON → ok:false. */
export async function obtenerRutaPublicacion(
  direcciones: unknown, apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ResultadoRutaPublicacion> {
  const puntos = validarPuntosRuta(direcciones);
  if (!puntos) return { ok: false, motivo: "puntos_invalidos" };
  try {
    const res = await fetchImpl(construirUrlRutaPublicacion(puntos, apiKey), { cache: "no-store" });
    return interpretarRutaPublicacion(await res.json(), puntos.length);
  } catch {
    return { ok: false, motivo: "error_red" };
  }
}

/**
 * ¿Se pueden usar estas coordenadas guardadas? Sólo si son válidas y fueron obtenidas hace
 * menos de DIAS_VIGENCIA_COORDENADAS días (límite de almacenamiento de Google). Pasado
 * ese plazo hay que ignorarlas (y la purga diaria las borra); place_id se conserva.
 */
export function coordenadasVigentes(
  lat: unknown, lng: unknown, obtenidoAt: string | Date | null | undefined, ahora: Date = new Date(),
): boolean {
  if (!esCoordenadaValida(lat, lng)) return false;
  if (obtenidoAt === null || obtenidoAt === undefined) return false;
  const ts = obtenidoAt instanceof Date ? obtenidoAt.getTime() : Date.parse(obtenidoAt);
  if (!Number.isFinite(ts)) return false;
  const edad = ahora.getTime() - ts;
  return edad >= -MS_TOLERANCIA_RELOJ && edad < MS_VIGENCIA_COORDENADAS;
}
