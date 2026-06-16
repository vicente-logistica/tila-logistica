import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (admin/cargas)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (admin/cargas)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function GET(req: Request) {
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

  // ── 3. Validar rol admin ──────────────────────────────────────────────────
  if (usuario.rol !== "admin") {
    return NextResponse.json({ error: "Prohibido: solo administradores pueden ver todas las cargas" }, { status: 403 });
  }

  // ── 4. Consultar todas las cargas ─────────────────────────────────────────
  const { data, error } = await supabaseAdmin
    .from("cargas")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/cargas GET] error SELECT:", error.message);
    return NextResponse.json({ error: "Error al obtener cargas" }, { status: 500 });
  }

  return NextResponse.json({ cargas: data ?? [] });
}

export async function DELETE(req: Request) {
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

  // ── 3. Validar rol admin ──────────────────────────────────────────────────
  if (usuario.rol !== "admin") {
    return NextResponse.json({ error: "Prohibido: solo administradores pueden eliminar viajes" }, { status: 403 });
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

  // ── 5. Verificar que la carga existe ─────────────────────────────────────
  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas")
    .select("id")
    .eq("id", carga_id)
    .single();

  if (cargaError || !carga) {
    return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
  }

  // ── 6. Eliminar paradas_viaje relacionadas ────────────────────────────────
  const { error: paradasError } = await supabaseAdmin
    .from("paradas_viaje")
    .delete()
    .eq("carga_id", carga_id);

  if (paradasError) {
    console.error("[admin/cargas DELETE] error eliminando paradas:", paradasError.message);
    return NextResponse.json({ error: "Error al eliminar paradas del viaje" }, { status: 500 });
  }

  // ── 7. Eliminar la carga ──────────────────────────────────────────────────
  const { error: deleteError } = await supabaseAdmin
    .from("cargas")
    .delete()
    .eq("id", carga_id);

  if (deleteError) {
    console.error("[admin/cargas DELETE] error eliminando carga:", deleteError.message);
    return NextResponse.json({ error: "Error al eliminar el viaje" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
