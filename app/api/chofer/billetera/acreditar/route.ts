import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (chofer/billetera/acreditar)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (chofer/billetera/acreditar)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function POST(req: Request) {
  // ── 1. Leer header de identificación ──────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });
  }

  // ── 2. Verificar que el usuario existe y es chofer ─────────────────────────
  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", userId)
    .single();

  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  if (usuario.rol !== "chofer") {
    return NextResponse.json({ error: "Prohibido: se requiere rol chofer" }, { status: 403 });
  }

  // ── 3. Leer viaje_id del body ──────────────────────────────────────────────
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

  // ── 4. Buscar la carga y validar ───────────────────────────────────────────
  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas")
    .select("id, chofer_id, estado, pago_chofer")
    .eq("id", viaje_id)
    .single();

  if (cargaError || !carga) {
    return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
  }

  if (carga.chofer_id !== userId) {
    return NextResponse.json({ error: "Prohibido: esta carga no pertenece al chofer" }, { status: 403 });
  }

  if (carga.estado !== "Viaje finalizado") {
    return NextResponse.json({ error: "La carga no está en estado Viaje finalizado" }, { status: 422 });
  }

  const monto = Number(carga.pago_chofer || 0);
  if (!monto || monto <= 0) {
    return NextResponse.json({ error: "pago_chofer inválido o cero" }, { status: 422 });
  }

  // ── 5. Verificar idempotencia ──────────────────────────────────────────────
  const { data: existente } = await supabaseAdmin
    .from("billetera_chofer")
    .select("id")
    .eq("viaje_id", viaje_id)
    .maybeSingle();

  if (existente) {
    return NextResponse.json({ ok: true, alreadyExists: true });
  }

  // ── 6. Insertar acreditación ───────────────────────────────────────────────
  const { error: insertError } = await supabaseAdmin
    .from("billetera_chofer")
    .insert([{ chofer_id: userId, viaje_id, monto }]);

  if (insertError) {
    console.error("[chofer/billetera/acreditar] error insertando:", insertError.message);
    return NextResponse.json({ error: "Error interno al acreditar billetera" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: true });
}
