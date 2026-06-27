import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (cargas/evidencia)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (cargas/evidencia)");

const supabaseAdmin = createClient(_url, _roleKey);

const EVENTOS_PERMITIDOS = [
  "viaje_aceptado",
  "chofer_en_camino",
  "carga_retirada",
  "en_ruta",
  "descarga_completada",
  "viaje_finalizado",
] as const;

// Estados en los que tiene sentido registrar una evidencia
const ESTADOS_OPERATIVOS = [
  "Chofer asignado",
  "En camino",
  "Carga retirada",
  "En ruta",
  "Descarga completada",
];

export async function POST(req: Request) {
  // ── 1. Verificar caller ────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", userId)
    .maybeSingle();

  if (!usuario || usuario.rol !== "chofer") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // ── 2. Leer body ───────────────────────────────────────────────────────────
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { carga_id, evento } = body ?? {};

  if (!carga_id) return NextResponse.json({ error: "carga_id requerido" }, { status: 400 });

  if (!evento || !EVENTOS_PERMITIDOS.includes(evento)) {
    return NextResponse.json(
      { error: `Evento inválido. Permitidos: ${EVENTOS_PERMITIDOS.join(", ")}` },
      { status: 400 }
    );
  }

  // ── 3. Verificar que la carga exista y pertenezca al chofer ───────────────
  const { data: carga } = await supabaseAdmin
    .from("cargas")
    .select("id, chofer_id, estado")
    .eq("id", Number(carga_id))
    .maybeSingle();

  if (!carga) return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 });

  if (String(carga.chofer_id) !== String(userId)) {
    return NextResponse.json({ error: "No autorizado para este viaje" }, { status: 403 });
  }

  // ── 4. Validar estado operativo ────────────────────────────────────────────
  if (!ESTADOS_OPERATIVOS.includes(carga.estado)) {
    return NextResponse.json(
      { error: `No se pueden registrar evidencias con estado: ${carga.estado}` },
      { status: 400 }
    );
  }

  // ── 5. Construir payload con whitelist — rol_usuario siempre forzado ───────
  const payload: Record<string, any> = {
    carga_id:     Number(carga_id),
    evento,
    rol_usuario:  "chofer", // siempre forzado server-side — nunca del body
    usuario_id:   userId,
    estado_viaje: body.estado_viaje  ?? null,
    lat:          body.lat           ?? null,
    lng:          body.lng           ?? null,
  };

  // Campos opcionales permitidos explícitamente
  if (body.nombre_receptor) payload.nombre_receptor = body.nombre_receptor;
  if (body.recibio_nombre)  payload.recibio_nombre  = body.recibio_nombre;
  if (body.entrego_nombre)  payload.entrego_nombre  = body.entrego_nombre;
  if (body.tipo_operacion)  payload.tipo_operacion  = body.tipo_operacion;
  if (body.tipo_carga)      payload.tipo_carga      = body.tipo_carga;
  if (body.observacion)     payload.observacion     = body.observacion;
  if (body.foto_url)        payload.foto_url        = body.foto_url;

  // ── 6. INSERT ──────────────────────────────────────────────────────────────
  const { error } = await supabaseAdmin.from("viaje_evidencias").insert([payload]);

  if (error) {
    console.error("[cargas/evidencia] ❌ error INSERT:", error.message);
    return NextResponse.json({ error: "Error al registrar evidencia" }, { status: 500 });
  }

  console.log("[cargas/evidencia] ✅ evento:", evento, "| carga:", carga_id, "| chofer:", userId);
  return NextResponse.json({ ok: true });
}
