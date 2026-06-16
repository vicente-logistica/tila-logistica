import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/estado)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/estado)");

const supabaseAdmin = createClient(_url, _roleKey);

// Máquina de estados válidos — el chofer solo puede avanzar en este orden
const TRANSICIONES_VALIDAS: Record<string, string> = {
  "pendiente":           "Chofer asignado",
  "Chofer asignado":     "En camino",
  "En camino":           "Carga retirada",
  "Carga retirada":      "En ruta",
  "En ruta":             "Descarga completada",
  "Descarga completada": "Viaje finalizado",
};

export async function PATCH(req: Request) {
  // ── 1. Leer x-user-id ────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });
  }

  // ── 2. Verificar usuario en BD ────────────────────────────────────────────
  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", userId)
    .single();

  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  if (usuario.rol !== "chofer" && usuario.rol !== "admin") {
    return NextResponse.json({ error: "Prohibido: rol no autorizado" }, { status: 403 });
  }

  // ── 3. Leer body ──────────────────────────────────────────────────────────
  let carga_id: unknown;
  let nuevo_estado: unknown;
  try {
    const body = await req.json();
    carga_id     = body?.carga_id;
    nuevo_estado = body?.nuevo_estado;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!carga_id || !nuevo_estado || typeof nuevo_estado !== "string") {
    return NextResponse.json({ error: "Faltan campos obligatorios: carga_id, nuevo_estado" }, { status: 400 });
  }

  // ── 4. Verificar que la carga existe ─────────────────────────────────────
  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas")
    .select("id, estado, chofer_id")
    .eq("id", carga_id)
    .single();

  if (cargaError || !carga) {
    return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
  }

  // ── 5. Validar propiedad si rol=chofer ────────────────────────────────────
  if (usuario.rol === "chofer" && String(carga.chofer_id) !== String(userId)) {
    return NextResponse.json(
      { error: "Prohibido: este viaje no te pertenece" },
      { status: 403 },
    );
  }

  // ── 6. Validar transición de estado ──────────────────────────────────────
  const estadoActual = carga.estado as string;
  const estadoEsperado = TRANSICIONES_VALIDAS[estadoActual];

  if (!estadoEsperado) {
    return NextResponse.json(
      { error: `Estado "${estadoActual}" no tiene transición válida` },
      { status: 422 },
    );
  }

  if (nuevo_estado !== estadoEsperado) {
    return NextResponse.json(
      { error: `Transición inválida: "${estadoActual}" → "${nuevo_estado}". Se esperaba "${estadoEsperado}"` },
      { status: 422 },
    );
  }

  // ── 7. Construir campos adicionales según el estado nuevo ─────────────────
  const now = new Date().toISOString();
  const upd: Record<string, unknown> = { estado: nuevo_estado };

  if (nuevo_estado === "En camino")        upd.hora_inicio      = now;
  if (nuevo_estado === "Chofer asignado")  upd.hora_aceptacion  = now;
  if (nuevo_estado === "Viaje finalizado") { upd.tracking = false; upd.hora_finalizacion = now; }

  // ── 8. Ejecutar UPDATE ────────────────────────────────────────────────────
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("cargas")
    .update(upd)
    .eq("id", carga_id)
    .select()
    .single();

  if (updateError || !updated) {
    console.error("[cargas/estado] error UPDATE:", updateError?.message);
    return NextResponse.json({ error: "Error al actualizar estado" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, carga: updated });
}
