import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  RECHAZOS, validarGpsAceptacion, validarRadioAceptacion, asignarChoferAtomico,
  type RechazoAceptacion,
} from "../../../lib/aceptarCarga";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/aceptar)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/aceptar)");

const supabaseAdmin = createClient(_url, _roleKey);

// Rechazos de la aceptación con `codigo` estable (sin_gps / fuera_de_radio /
// error_distancia / ya_tomado) para que el cliente pueda distinguirlos.
const rechazar = ({ status, codigo, error }: RechazoAceptacion) =>
  NextResponse.json({ error, codigo }, { status });

export async function POST(req: Request) {
  // ── 1. Leer x-user-id ────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });
  }

  // ── 2. Verificar usuario en BD ────────────────────────────────────────────
  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol, eliminado, estado_aprobacion")
    .eq("id", userId)
    .single();

  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  // ── 3. Validar estado del usuario ─────────────────────────────────────────
  if (usuario.eliminado) {
    return NextResponse.json({ error: "Esta cuenta ha sido eliminada." }, { status: 403 });
  }

  if (usuario.rol !== "chofer") {
    return NextResponse.json({ error: "Prohibido: solo choferes pueden aceptar viajes" }, { status: 403 });
  }

  if (usuario.estado_aprobacion === "suspendido") {
    return NextResponse.json({ error: "Tu cuenta está suspendida. Contactá al administrador para reactivarla." }, { status: 403 });
  }

  // ── 4. Leer body ──────────────────────────────────────────────────────────
  // lat/lng: posición GPS ACTUAL del chofer — la misma que ya usa useCargasCercanas
  // para el listado — ahora obligatoria también para poder aceptar (ver punto 5b: el
  // radio de 35km deja de ser sólo una protección visual del cliente).
  let carga_id: unknown, lat: unknown, lng: unknown;
  try {
    const body = await req.json();
    carga_id = body?.carga_id;
    lat = body?.lat;
    lng = body?.lng;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!carga_id) {
    return NextResponse.json({ error: "Falta carga_id" }, { status: 400 });
  }

  // Sin GPS válido no se puede validar el radio de 35km — FAIL-CLOSED: se rechaza la
  // aceptación (nunca se asume "está cerca" a falta de datos).
  const gpsValidado = validarGpsAceptacion(lat, lng);
  if (!gpsValidado.ok) return rechazar(gpsValidado);

  // ── 5. Verificar que la carga existe, está pendiente y sin chofer ─────────
  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas")
    .select("id, estado, chofer_id, origen, destino")
    .eq("id", carga_id)
    .single();

  if (cargaError || !carga) {
    return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
  }

  if (carga.estado !== "pendiente") return rechazar(RECHAZOS.ya_tomado);

  if (carga.chofer_id) return rechazar(RECHAZOS.ya_tomado);

  // ── 5b. Validar radio de 35km — regla de negocio server-side, NO sólo visual ──────
  // Reusa la MISMA lógica (Haversine como prefiltro + distancia vial real de Directions)
  // que /api/chofer/distancias-cercanas, vía app/lib/geo/calculoDistanciaCarga.ts —
  // incluso comparte su caché: si el chofer ya vio esta carga en el listado desde esta
  // misma posición, no se vuelve a llamar a Google acá.
  const { data: paradas } = await supabaseAdmin
    .from("paradas_viaje")
    .select("orden, direccion")
    .eq("carga_id", carga.id)
    .order("orden", { ascending: true });
  const puntosCarga = paradas && paradas.length >= 2
    ? paradas.map((p) => p.direccion)
    : [carga.origen, carga.destino];

  // Misma convención de clave que usa distancias-cercanas/route.ts (`${id}:${gps}`) —
  // a propósito, para que sea la MISMA entrada de caché (ver calculoDistanciaCarga.ts).
  // fuera_de_rango → fuera_de_radio (403); sin API key / sin geocode de A / Directions
  // falló → error_distancia (503). SIEMPRE se rechaza: nunca se acepta "por las dudas"
  // cuando no se pudo confirmar la distancia vial real.
  const validacion = await validarRadioAceptacion(
    gpsValidado.gps,
    puntosCarga,
    process.env.GOOGLE_SERVER_API_KEY,
    String(carga.id),
  );
  if (!validacion.ok) return rechazar(validacion);

  // ── 6. Asignar chofer con UPDATE atómico ─────────────────────────────────
  // El doble filtro (estado=pendiente + chofer_id IS NULL) previene race condition
  const asignacion = await asignarChoferAtomico(supabaseAdmin, carga_id, userId);
  if (!asignacion.ok) return rechazar(asignacion);

  return NextResponse.json({ ok: true, viaje_id: asignacion.viajeId });
}
