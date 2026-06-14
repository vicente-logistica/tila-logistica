import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (admin/billetera)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (admin/billetera)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function GET(req: Request) {
  // ── 1. Leer header de identificación ──────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });
  }

  // ── 2. Verificar que el usuario existe y es admin ──────────────────────────
  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", userId)
    .single();

  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  if (usuario.rol !== "admin") {
    return NextResponse.json({ error: "Prohibido: se requiere rol admin" }, { status: 403 });
  }

  // ── 3. Leer billetera completa ─────────────────────────────────────────────
  const { data, error } = await supabaseAdmin
    .from("billetera_chofer")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/billetera] error leyendo billetera_chofer:", error.message);
    return NextResponse.json({ error: "Error interno al leer billetera" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(req: Request) {
  // ── 1. Leer header de identificación ──────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });
  }

  // ── 2. Verificar que el usuario existe y es admin ──────────────────────────
  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", userId)
    .single();

  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  if (usuario.rol !== "admin") {
    return NextResponse.json({ error: "Prohibido: se requiere rol admin" }, { status: 403 });
  }

  // ── 3. Leer viaje_id del body ──────────────────────────────────────────────
  let viaje_id: string | undefined;
  try {
    const body = await req.json();
    viaje_id = body?.viaje_id;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!viaje_id) {
    return NextResponse.json({ error: "Falta viaje_id en el body" }, { status: 400 });
  }

  // ── 4. Borrar entradas de billetera para ese viaje ─────────────────────────
  const { error } = await supabaseAdmin
    .from("billetera_chofer")
    .delete()
    .eq("viaje_id", viaje_id);

  if (error) {
    console.error("[admin/billetera DELETE] error:", error.message);
    return NextResponse.json({ error: "Error interno al borrar billetera" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
