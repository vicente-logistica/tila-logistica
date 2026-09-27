import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { distanciaHaversineKm, type PuntoGeo } from "../../../lib/geo/haversine";
import { interpretarLegs, type ResultadoDistanciaLegs } from "../../../lib/geo/interpretarLegs";
import {
  RADIO_INICIAL_KM, RADIO_MAXIMO_KM,
  TTL_GEOCODE_MS, TTL_DISTANCIA_MS,
  DECIMALES_CACHE_GPS, CONCURRENCIA_MAXIMA_DIRECTIONS,
} from "../../../lib/geo/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (chofer/distancias-cercanas)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (chofer/distancias-cercanas)");

const supabaseAdmin = createClient(_url, _roleKey);

// ═══════════════════════════════════════════════════════════════════════════════════
// Cachés EN MEMORIA del proceso — se pierden en un cold start de la función serverless,
// pero mientras la instancia sigue caliente evitan volver a pedirle a Google lo mismo una
// y otra vez (ver TTL_GEOCODE_MS/TTL_DISTANCIA_MS en app/lib/geo/config.ts para el porqué
// de cada duración). No hay ningún estado persistente ni tabla nueva involucrada.
// ═══════════════════════════════════════════════════════════════════════════════════
const cacheGeocode    = new Map<string, { coords: PuntoGeo | null; ts: number }>();
const cacheDistancia  = new Map<string, { resultado: ResultadoDistanciaCarga; ts: number }>();

interface ResultadoDistanciaCarga {
  id: number;
  dentroRadioInicial: boolean;
  dentroRadioMaximo: boolean;
  hastaCargaKm: number | null;
  hastaCargaTexto: string | null;
  recorridoCargaKm: number | null;
  recorridoCargaTexto: string | null;
  /** Duración estimada del recorrido propio de la carga (A→...→destino final),
   *  EXCLUYENDO GPS→A — es lo que hoy se muestra como "⏱️ Tiempo estimado" en la tarjeta
   *  principal. Sale de los mismos legs ya obtenidos de Directions, nunca de una llamada
   *  adicional. */
  recorridoCargaDuracionTexto: string | null;
  totalKm: number | null;
  totalTexto: string | null;
  /** Sólo la duración del tramo GPS→A (ETA hasta el retiro) — Google ya la trae en la
   *  misma respuesta de Directions, sin request adicional. Deliberadamente NO se suma
   *  una "duración total" (ver PASO 9 del pedido: no agregar complejidad sólo por ETA). */
  duracionHastaCargaTexto: string | null;
  estado: "ok" | "fuera_de_rango" | "sin_datos_a" | "error_directions";
}

const normalizarDireccion = (direccion: string) => direccion.trim().toLowerCase().replace(/\s+/g, " ");
const redondearGps = (n: number) => Number(n.toFixed(DECIMALES_CACHE_GPS));

/** Geocodifica UNA dirección (sólo para el prefiltro de cercanía) — cacheada por texto
 *  normalizado, TTL largo (una dirección publicada no se mueve nunca). Nunca se muestra
 *  este resultado al chofer: sólo alimenta distanciaHaversineKm más abajo. */
async function geocodificarParaPrefiltro(direccion: string, apiKey: string): Promise<PuntoGeo | null> {
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

/** Distancia vial REAL vía Directions: origin = GPS del chofer (lat,lng), waypoints =
 *  todos los puntos de la carga salvo el último (A + paradas intermedias, en orden),
 *  destination = el último punto (B o la entrega final). Devuelve TODOS los legs, sin
 *  procesar — quien llama decide cómo sumarlos (hastaCarga = legs[0], resto = recorrido
 *  de la carga en sí). Nunca usa línea recta como resultado: si Directions falla, se
 *  devuelve null explícito, nunca un número inventado. */
async function calcularLegsReales(
  gps: PuntoGeo, puntosCarga: string[], apiKey: string
): Promise<Array<{ distanciaMetros: number; distanciaTexto: string; duracionTexto: string; duracionSegundos: number }> | null> {
  if (puntosCarga.length === 0) return null;
  const destinoFinal   = puntosCarga[puntosCarga.length - 1];
  const puntosPrevios  = puntosCarga.slice(0, -1); // A + intermedias — nunca vacío (A siempre está)
  const origin         = `${gps.lat},${gps.lng}`;
  const waypointsParam  = puntosPrevios.length
    ? `&waypoints=${puntosPrevios.map(p => encodeURIComponent(`${p}, Argentina`)).join("|")}`
    : "";
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(`${destinoFinal}, Argentina`)}${waypointsParam}` +
      `&mode=driving&language=es&region=ar&key=${apiKey}`;
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json();
    if (data.status !== "OK" || !data.routes?.[0]?.legs?.length) return null;
    return data.routes[0].legs.map((leg: any) => ({
      distanciaMetros:  leg.distance?.value ?? 0,
      distanciaTexto:   leg.distance?.text  ?? "",
      duracionTexto:    leg.duration?.text  ?? "",
      duracionSegundos: leg.duration?.value ?? 0, // mismos legs ya obtenidos, sin request extra
    }));
  } catch {
    return null;
  }
}

/** Ejecuta `fn` sobre `items` con un máximo de `limite` en simultáneo — evita disparar
 *  todas las llamadas a Directions de los candidatos post-prefiltro a la vez. */
async function conConcurrenciaLimitada<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export async function POST(req: Request) {
  // ── 1. Auth: mismo patrón que /api/cargas/disponibles ─────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "missing x-user-id" }, { status: 401 });

  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios").select("id, rol").eq("id", userId).single();
  if (userError || !usuario) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (usuario.rol !== "chofer") return NextResponse.json({ error: "Prohibido" }, { status: 403 });

  // ── 2. Body ────────────────────────────────────────────────────────────────
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }); }
  const { lat, lng, cargaIds } = body ?? {};
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Faltan lat/lng numéricos del chofer" }, { status: 400 });
  }
  if (!Array.isArray(cargaIds) || cargaIds.length === 0) {
    return NextResponse.json({ resultados: {} });
  }
  const idsValidos = cargaIds.filter((n: any) => Number.isFinite(n)).map(Number);

  const apiKey = process.env.GOOGLE_SERVER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Falta GOOGLE_SERVER_API_KEY en variables de entorno" }, { status: 500 });

  const gpsChofer: PuntoGeo = { lat, lng };
  const gpsCacheKey = `${redondearGps(lat)},${redondearGps(lng)}`;

  // ── 3. Traer origen/destino de las cargas pedidas — SOLO LECTURA, sólo pendientes ──
  const { data: cargas, error: errCargas } = await supabaseAdmin
    .from("cargas")
    .select("id, origen, destino")
    .in("id", idsValidos)
    .eq("estado", "pendiente")
    .is("chofer_id", null);
  if (errCargas) return NextResponse.json({ error: "Error al leer cargas" }, { status: 500 });

  // ── 4. Traer paradas_viaje de esas mismas cargas — SOLO LECTURA ────────────────────
  const { data: paradas } = await supabaseAdmin
    .from("paradas_viaje")
    .select("carga_id, orden, direccion")
    .in("carga_id", (cargas ?? []).map(c => c.id))
    .order("orden", { ascending: true });
  const paradasPorCarga = new Map<number, string[]>();
  (paradas ?? []).forEach(p => {
    const arr = paradasPorCarga.get(p.carga_id) ?? [];
    arr.push(p.direccion);
    paradasPorCarga.set(p.carga_id, arr);
  });

  // ── 5. Armar los "puntos" de cada carga (A, [intermedias], B) ──────────────────────
  // Si hay filas en paradas_viaje (2+: multietapa) se usan tal cual, en orden — la
  // primera SIEMPRE es el retiro (A) porque así las inserta app/publicar/page.tsx. Si no
  // hay filas (carga simple), se sintetiza [origen, destino] — origen ES el punto A en
  // ambos casos (el mismo texto que usaría paradas_viaje si existiera, ver publicar/page.tsx).
  const puntosPorCarga = new Map<number, string[]>();
  for (const c of cargas ?? []) {
    const propias = paradasPorCarga.get(c.id);
    puntosPorCarga.set(c.id, propias && propias.length >= 2 ? propias : [c.origen, c.destino]);
  }

  // ── 6. ETAPA 1 — prefiltro barato (Haversine) contra el punto A únicamente ────────
  // La decisión de "cerca o no" usa EXCLUSIVAMENTE la distancia chofer→A — nunca B ni el
  // total (regla de negocio explícita: B no decide cercanía).
  const candidatos: { id: number; puntos: string[] }[] = [];
  const resultados: Record<number, ResultadoDistanciaCarga> = {};

  await conConcurrenciaLimitada([...puntosPorCarga.entries()], CONCURRENCIA_MAXIMA_DIRECTIONS, async ([id, puntos]) => {
    const puntoA = puntos[0];
    const coordsA = await geocodificarParaPrefiltro(puntoA, apiKey);
    if (!coordsA) {
      resultados[id] = base(id, "sin_datos_a");
      return;
    }
    const distanciaLineaRecta = distanciaHaversineKm(gpsChofer, coordsA);
    if (distanciaLineaRecta > RADIO_MAXIMO_KM) {
      resultados[id] = base(id, "fuera_de_rango");
      return;
    }
    candidatos.push({ id, puntos });
  });

  // ── 7. ETAPA 2 — distancia vial real (Directions) SOLO para los candidatos ────────
  await conConcurrenciaLimitada(candidatos, CONCURRENCIA_MAXIMA_DIRECTIONS, async ({ id, puntos }) => {
    const claveCache = `${id}:${gpsCacheKey}`;
    const cacheada = cacheDistancia.get(claveCache);
    if (cacheada && Date.now() - cacheada.ts < TTL_DISTANCIA_MS) {
      resultados[id] = cacheada.resultado;
      return;
    }
    const legs = await calcularLegsReales(gpsChofer, puntos, apiKey);
    const interpretado = legs ? interpretarLegs(legs, RADIO_INICIAL_KM, RADIO_MAXIMO_KM) : null;
    if (!interpretado) {
      resultados[id] = base(id, "error_directions");
      return;
    }
    const resultado: ResultadoDistanciaCarga = { id, estado: "ok", ...interpretado };
    cacheDistancia.set(claveCache, { resultado, ts: Date.now() });
    resultados[id] = resultado;
  });

  return NextResponse.json({ resultados });
}

function base(id: number, estado: ResultadoDistanciaCarga["estado"]): ResultadoDistanciaCarga {
  return {
    id, dentroRadioInicial: false, dentroRadioMaximo: false,
    hastaCargaKm: null, hastaCargaTexto: null,
    recorridoCargaKm: null, recorridoCargaTexto: null, recorridoCargaDuracionTexto: null,
    totalKm: null, totalTexto: null, duracionHastaCargaTexto: null,
    estado,
  };
}
