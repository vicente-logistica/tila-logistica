import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (chat/mensajes-viaje)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (chat/mensajes-viaje)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function DELETE(req: Request) {
  // ── 1. Leer x-user-id ────────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });
  }

  // ── 2-3. Verificar usuario en BD ─────────────────────────────────────────────
  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", userId)
    .single();

  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  // ── 4. Verificar rol admin ────────────────────────────────────────────────────
  if (usuario.rol !== "admin") {
    return NextResponse.json({ error: "Prohibido: se requiere rol admin" }, { status: 403 });
  }

  // ── 5. Leer viaje_id del body ─────────────────────────────────────────────────
  let viaje_id: string | undefined;
  try {
    const body = await req.json();
    viaje_id = body?.viaje_id !== undefined ? String(body.viaje_id) : undefined;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!viaje_id) {
    return NextResponse.json({ error: "Falta viaje_id en el body" }, { status: 400 });
  }

  // ── 6. Verificar que la carga existe ─────────────────────────────────────────
  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas")
    .select("id")
    .eq("id", viaje_id)
    .single();

  if (cargaError || !carga) {
    return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
  }

  // ── 7. DELETE mensajes del viaje ──────────────────────────────────────────────
  const { error: deleteError } = await supabaseAdmin
    .from("mensajes_viaje")
    .delete()
    .eq("viaje_id", viaje_id);

  if (deleteError) {
    console.error("[chat/mensajes-viaje DELETE] error:", deleteError.message);
    return NextResponse.json({ error: "Error interno al borrar mensajes" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
