import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { PuntoGeo } from "../../../lib/geo/haversine";
import { interpretarLegs } from "../../../lib/geo/interpretarLegs";
import {
  geocodificarParaPrefiltro, calcularLegsReales, claveCacheGps, conConcurrenciaLimitada, pasaPrefiltroRadio,
} from "../../../lib/geo/calculoDistanciaCarga";
import { CONCURRENCIA_MAXIMA_DIRECTIONS } from "../../../lib/geo/config";
import { leerRadioMatching } from "../../../lib/configuracionRadio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (chofer/distancias-cercanas)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (chofer/distancias-cercanas)");

const supabaseAdmin = createClient(_url, _roleKey);

// Geocode/Directions y sus cachés viven en app/lib/geo/calculoDistanciaCarga.ts — mismo
// módulo que usa /api/cargas/aceptar para la validación server-side del radio, así ambos
// endpoints comparten caché (una carga ya vista en el listado no vuelve a pedirse a
// Google al tocar ACEPTAR) y la regla de negocio existe en un solo lugar.

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
  /** Duración de todo GPS→A→...→destino final (suma de los mismos legs). */
  totalDuracionTexto: string | null;
  /** Sólo la duración del tramo GPS→A (ETA hasta el retiro) — Google ya la trae en la
   *  misma respuesta de Directions, sin request adicional. La duración total del
   *  recorrido está en totalDuracionTexto. */
  duracionHastaCargaTexto: string | null;
  estado: "ok" | "fuera_de_rango" | "sin_datos_a" | "error_directions";
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
  // Radio de matching vigente (Panel Admin → Configuración; 35 km si no hay configuración).
  // El MISMO valor usa /api/cargas/aceptar para revalidar — se usa tanto para el prefiltro
  // Haversine como para la decisión final por distancia de ruta.
  const { radioKm } = await leerRadioMatching(supabaseAdmin);

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
    if (!pasaPrefiltroRadio(gpsChofer, coordsA, radioKm)) {
      resultados[id] = base(id, "fuera_de_rango");
      return;
    }
    candidatos.push({ id, puntos });
  });

  // ── 7. ETAPA 2 — distancia vial real (Directions) SOLO para los candidatos ────────
  // calcularLegsReales cachea los legs crudos por (id, posición) — comparte caché con la
  // validación server-side de /api/cargas/aceptar sobre la MISMA carga/posición.
  await conConcurrenciaLimitada(candidatos, CONCURRENCIA_MAXIMA_DIRECTIONS, async ({ id, puntos }) => {
    const legs = await calcularLegsReales(gpsChofer, puntos, apiKey, `${id}:${claveCacheGps(gpsChofer)}`);
    const interpretado = legs ? interpretarLegs(legs, radioKm, radioKm) : null;
    if (!interpretado) {
      resultados[id] = base(id, "error_directions");
      return;
    }
    resultados[id] = { id, estado: "ok", ...interpretado };
  });

  return NextResponse.json({ resultados });
}

function base(id: number, estado: ResultadoDistanciaCarga["estado"]): ResultadoDistanciaCarga {
  return {
    id, dentroRadioInicial: false, dentroRadioMaximo: false,
    hastaCargaKm: null, hastaCargaTexto: null,
    recorridoCargaKm: null, recorridoCargaTexto: null, recorridoCargaDuracionTexto: null,
    totalKm: null, totalTexto: null, totalDuracionTexto: null, duracionHastaCargaTexto: null,
    estado,
  };
}
