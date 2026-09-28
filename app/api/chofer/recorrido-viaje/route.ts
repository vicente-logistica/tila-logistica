import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolverUsuario } from "../../../lib/auth/sesion";
import { esCoordenadaValida } from "../../../lib/geo/haversine";
import { calcularLegsReales, claveCacheGps } from "../../../lib/geo/calculoDistanciaCarga";
import { paradasPendientes, armarDesgloseRecorrido } from "../../../lib/geo/desgloseRecorrido";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (chofer/recorrido-viaje)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (chofer/recorrido-viaje)");

const supabaseAdmin = createClient(_url, _roleKey);

// Estados en los que el viaje está asignado y todavía en curso (hay recorrido por delante).
const ESTADOS_EN_CURSO = ["Chofer asignado", "En camino", "Carga retirada", "En ruta", "Descarga completada"];

/**
 * Desglose del recorrido RESTANTE de un viaje aceptado, para la planilla 📋 de
 * viaje-activo: GPS actual del chofer → paradas pendientes (en su orden real) → destino
 * final, con km + tiempo por tramo y totales. SOLO LECTURA — no escribe nada.
 *
 * Reutiliza calcularLegsReales (Directions + caché en memoria de 3 min por posición
 * redondeada) — los refrescos periódicos de la planilla desde la misma zona no vuelven a
 * llamar a Google. Si Directions falla, responde error: nunca km_estimados ni un número
 * inventado.
 */
export async function POST(req: Request) {
  // ── 1. Auth: chofer autenticado ───────────────────────────────────────────
  const userId = resolverUsuario(req).userId;
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios").select("id, rol").eq("id", userId).single();
  if (userError || !usuario) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (usuario.rol !== "chofer") return NextResponse.json({ error: "Prohibido" }, { status: 403 });

  // ── 2. Body ────────────────────────────────────────────────────────────────
  let carga_id: unknown, lat: unknown, lng: unknown;
  try {
    const body = await req.json();
    carga_id = body?.carga_id; lat = body?.lat; lng = body?.lng;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }
  if (!carga_id) return NextResponse.json({ error: "Falta carga_id" }, { status: 400 });
  if (!esCoordenadaValida(lat, lng)) {
    return NextResponse.json({ error: "Sin ubicación GPS válida", codigo: "sin_gps" }, { status: 400 });
  }
  const gps = { lat: lat as number, lng: lng as number };

  // ── 3. El viaje tiene que estar asignado a ESTE chofer y en curso ─────────────
  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas").select("id, chofer_id, estado, origen, destino").eq("id", carga_id).single();
  if (cargaError || !carga) return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 });
  if (String(carga.chofer_id) !== String(userId)) {
    return NextResponse.json({ error: "Este viaje no está asignado a tu cuenta" }, { status: 403 });
  }
  if (!ESTADOS_EN_CURSO.includes(carga.estado)) {
    return NextResponse.json({ error: "El viaje no está en curso", codigo: "no_en_curso" }, { status: 409 });
  }

  // ── 4. Paradas pendientes, en su orden real (fuente: paradas_viaje) ───────────
  const { data: paradas, error: paradasError } = await supabaseAdmin
    .from("paradas_viaje").select("orden, direccion, tipo, estado").eq("carga_id", carga.id).order("orden", { ascending: true });
  if (paradasError) return NextResponse.json({ error: "Error al leer paradas" }, { status: 500 });

  const pendientes = paradasPendientes(paradas, carga);
  if (pendientes.length === 0) {
    return NextResponse.json({ ok: true, tramos: [], totalTexto: null, totalDuracionTexto: null, sinPendientes: true });
  }

  // ── 5. Directions (con caché) + desglose ──────────────────────────────────────
  const apiKey = process.env.GOOGLE_SERVER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No se pudo calcular el recorrido", codigo: "error_calculo" }, { status: 503 });

  const puntos = pendientes.map(p => p.direccion);
  // La clave incluye las direcciones pendientes: al completarse una parada cambia el
  // recorrido y no se reusa una entrada vieja.
  const claveCache = `recorrido:${carga.id}:${puntos.join("|")}:${claveCacheGps(gps)}`;
  const legs = await calcularLegsReales(gps, puntos, apiKey, claveCache);
  const desglose = armarDesgloseRecorrido(pendientes, legs);
  if (!desglose) {
    return NextResponse.json({ error: "No se pudo calcular el recorrido", codigo: "error_calculo" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, ...desglose, sinPendientes: false });
}
