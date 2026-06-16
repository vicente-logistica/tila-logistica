import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/aceptar)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/aceptar)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function POST(req: Request) {
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

  // ── 3. Validar rol chofer ─────────────────────────────────────────────────
  if (usuario.rol !== "chofer") {
    return NextResponse.json({ error: "Prohibido: solo choferes pueden aceptar viajes" }, { status: 403 });
  }

  // ── 4. Leer body ──────────────────────────────────────────────────────────
  let carga_id: unknown;
  try {
    const body = await req.json();
    carga_id = body?.carga_id;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!carga_id) {
    return NextResponse.json({ error: "Falta carga_id" }, { status: 400 });
  }

  // ── 5. Verificar que la carga existe, está pendiente y sin chofer ─────────
  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas")
    .select("id, estado, chofer_id")
    .eq("id", carga_id)
    .single();

  if (cargaError || !carga) {
    return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
  }

  if (carga.estado !== "pendiente") {
    return NextResponse.json(
      { error: "Este viaje ya fue tomado por otro chofer" },
      { status: 409 },
    );
  }

  if (carga.chofer_id) {
    return NextResponse.json(
      { error: "Este viaje ya fue tomado por otro chofer" },
      { status: 409 },
    );
  }

  // ── 6. Asignar chofer con UPDATE atómico ─────────────────────────────────
  // El doble filtro (estado=pendiente + chofer_id IS NULL) previene race condition
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("cargas")
    .update({ estado: "Chofer asignado", chofer_id: userId, tracking: true })
    .eq("id", carga_id)
    .eq("estado", "pendiente")
    .is("chofer_id", null)
    .select("id")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "Este viaje ya fue tomado por otro chofer" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, viaje_id: updated.id });
}
