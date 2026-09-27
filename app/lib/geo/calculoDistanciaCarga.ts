import { distanciaHaversineKm, type PuntoGeo } from "./haversine.ts";
import { interpretarLegs, type LegSimple } from "./interpretarLegs.ts";
import {
  RADIO_INICIAL_KM, RADIO_MAXIMO_KM,
  TTL_GEOCODE_MS, TTL_DISTANCIA_MS,
  DECIMALES_CACHE_GPS,
} from "./config.ts";

/**
 * Cálculo de distancia GPS→A→...→B server-side — usado por DOS endpoints:
 *  - app/api/chofer/distancias-cercanas/route.ts (listado, filtro visual)
 *  - app/api/cargas/aceptar/route.ts (validación server-side ANTES de asignar la carga)
 *
 * Se extrajo a un módulo compartido para que la regla de negocio (radio 35km sobre
 * legs[0]=GPS→A, vía Directions) exista en UN SOLO lugar — nunca duplicada — y para que
 * ambos endpoints reusen la MISMA caché de geocodes/Directions: si el chofer ya vio esta
 * carga en el listado (misma posición redondeada), aceptar no vuelve a llamar a Google.
 */

// ═══════════════════════════════════════════════════════════════════════════════════
// Cachés EN MEMORIA del proceso — oportunistas, se pierden en cold start / nueva
// instancia serverless (ver auditoría: NO es una caché persistente garantizada en
// Vercel). Sirven mientras la misma instancia siga caliente entre requests.
// ═══════════════════════════════════════════════════════════════════════════════════
const cacheGeocode: Map<string, { coords: PuntoGeo | null; ts: number }> = new Map();
const cacheLegs: Map<string, { legs: LegSimple[] | null; ts: number }> = new Map();

export const normalizarDireccion = (direccion: string) => direccion.trim().toLowerCase().replace(/\s+/g, " ");
export const redondearGps = (n: number) => Number(n.toFixed(DECIMALES_CACHE_GPS));
export const claveCacheGps = (gps: PuntoGeo) => `${redondearGps(gps.lat)},${redondearGps(gps.lng)}`;

/** Geocodifica UNA dirección (sólo para el prefiltro de cercanía) — cacheada por texto
 *  normalizado, TTL largo (una dirección publicada no se mueve nunca). Nunca se muestra
 *  este resultado al chofer: sólo alimenta distanciaHaversineKm más abajo. */
export async function geocodificarParaPrefiltro(direccion: string, apiKey: string): Promise<PuntoGeo | null> {
  const clave = normalizarDireccion(direccion);
  const cacheada = cacheGeocode.get(clave);
  if (cacheada && Date.now() - cacheada.ts < TTL_GEOCODE_MS) return cacheada.coords;
  let coords: PuntoGeo | null = null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${direccion}, Argentina`)}&region=ar&key=${apiKey}`;
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json();
    if (data.status === "OK" && data.results?.[0]) {
      const loc = data.results[0].geometry.location;
      coords = { lat: loc.lat, lng: loc.lng };
    }
  } catch { /* coords queda null — se trata igual que "no se pudo determinar" */ }
  cacheGeocode.set(clave, { coords, ts: Date.now() });
  return coords;
}

/** Distancia vial REAL vía Directions: origin = GPS del chofer, waypoints = todos los
 *  puntos de la carga salvo el último (A + intermedias), destination = el último punto.
 *  Devuelve TODOS los legs, sin procesar. Cacheado por `claveCache` (típicamente
 *  `${identificadorCarga}:${claveCacheGps(gps)}`) con TTL corto — así una carga ya
 *  consultada en el listado no vuelve a pedirse a Google al tocar ACEPTAR. Nunca usa
 *  línea recta como resultado: si Directions falla, devuelve null explícito. */
export async function calcularLegsReales(
  gps: PuntoGeo, puntosCarga: string[], apiKey: string, claveCache: string
): Promise<LegSimple[] | null> {
  const cacheada = cacheLegs.get(claveCache);
  if (cacheada && Date.now() - cacheada.ts < TTL_DISTANCIA_MS) return cacheada.legs;

  if (puntosCarga.length === 0) { cacheLegs.set(claveCache, { legs: null, ts: Date.now() }); return null; }
  const destinoFinal  = puntosCarga[puntosCarga.length - 1];
  const puntosPrevios = puntosCarga.slice(0, -1); // A + intermedias — nunca vacío (A siempre está)
  const origin        = `${gps.lat},${gps.lng}`;
  const waypointsParam = puntosPrevios.length
    ? `&waypoints=${puntosPrevios.map(p => encodeURIComponent(`${p}, Argentina`)).join("|")}`
    : "";
  let legs: LegSimple[] | null = null;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(`${destinoFinal}, Argentina`)}${waypointsParam}` +
      `&mode=driving&language=es&region=ar&key=${apiKey}`;
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json();
    if (data.status === "OK" && data.routes?.[0]?.legs?.length) {
      legs = data.routes[0].legs.map((leg: any) => ({
        distanciaMetros:  leg.distance?.value ?? 0,
        distanciaTexto:   leg.distance?.text  ?? "",
        duracionTexto:    leg.duration?.text  ?? "",
        duracionSegundos: leg.duration?.value ?? 0,
      }));
    }
  } catch { /* legs queda null */ }
  cacheLegs.set(claveCache, { legs, ts: Date.now() });
  return legs;
}

export interface ResultadoValidacionRadio {
  ok: boolean;
  motivo?: "sin_datos_a" | "fuera_de_rango" | "error_directions";
  hastaCargaKm?: number;
}

/**
 * Regla de negocio ÚNICA de "¿esta carga está dentro del radio inicial (35km) desde esta
 * posición GPS?" — usada tanto para el listado (visual) como para la validación
 * server-side al aceptar (obligatoria, no sólo protección visual).
 *
 * `puntosCarga` = [A, ...intermedias, B] (mismo armado que ya usa distancias-cercanas:
 * paradas_viaje si hay 2+, si no [origen, destino]). `claveCacheBase` identifica la carga
 * (por ej. su id) para poder cachear los legs por (carga, posición).
 *
 * Nunca usa SOLO Haversine como validación final — Haversine es prefiltro barato para
 * descartar casos obviamente lejanos (>50km) sin gastar una llamada a Directions; la
 * regla final siempre es la distancia VIAL de legs[0] vía interpretarLegs.
 */
export async function validarRadioInicial(
  gps: PuntoGeo, puntosCarga: string[], apiKey: string, claveCacheBase: string
): Promise<ResultadoValidacionRadio> {
  const puntoA = puntosCarga?.[0];
  if (!puntoA) return { ok: false, motivo: "sin_datos_a" };

  const coordsA = await geocodificarParaPrefiltro(puntoA, apiKey);
  if (!coordsA) return { ok: false, motivo: "sin_datos_a" };

  if (distanciaHaversineKm(gps, coordsA) > RADIO_MAXIMO_KM) {
    return { ok: false, motivo: "fuera_de_rango" };
  }

  const legs = await calcularLegsReales(gps, puntosCarga, apiKey, `${claveCacheBase}:${claveCacheGps(gps)}`);
  if (!legs) return { ok: false, motivo: "error_directions" };

  const interpretado = interpretarLegs(legs, RADIO_INICIAL_KM, RADIO_MAXIMO_KM);
  if (!interpretado) return { ok: false, motivo: "error_directions" };

  if (!interpretado.dentroRadioInicial) {
    return { ok: false, motivo: "fuera_de_rango", hastaCargaKm: interpretado.hastaCargaKm };
  }
  return { ok: true, hastaCargaKm: interpretado.hastaCargaKm };
}

/** Ejecuta `fn` sobre `items` con un máximo de `limite` en simultáneo. */
export async function conConcurrenciaLimitada<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < items.length) {
      const idx = siguiente++;
      resultados[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, trabajador));
  return resultados;
}
