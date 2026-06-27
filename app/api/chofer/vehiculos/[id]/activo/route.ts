import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (chofer/vehiculos/[id]/activo)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (chofer/vehiculos/[id]/activo)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: vehiculoId } = await params;

  // ── 1. Verificar caller ────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // ── 2. Verificar ownership ─────────────────────────────────────────────────
  const { data: vehiculo } = await supabaseAdmin
    .from("vehiculos")
    .select("id, chofer_id")
    .eq("id", vehiculoId)
    .maybeSingle();

  if (!vehiculo) return NextResponse.json({ error: "Vehículo no encontrado" }, { status: 404 });
  if (String(vehiculo.chofer_id) !== String(userId)) {
    return NextResponse.json({ error: "No autorizado para este vehículo" }, { status: 403 });
  }

  // ── 3. Desactivar todos los vehículos del chofer, luego activar este ───────
  const { error: errDesactivar } = await supabaseAdmin
    .from("vehiculos")
    .update({ activo: false })
    .eq("chofer_id", userId);

  if (errDesactivar) {
    console.error("[chofer/vehiculos/[id]/activo] ❌ error desactivar:", errDesactivar.message);
    return NextResponse.json({ error: "Error al actualizar vehículo activo" }, { status: 500 });
  }

  const { error: errActivar } = await supabaseAdmin
    .from("vehiculos")
    .update({ activo: true })
    .eq("id", vehiculoId);

  if (errActivar) {
    console.error("[chofer/vehiculos/[id]/activo] ❌ error activar:", errActivar.message);
    return NextResponse.json({ error: "Error al activar vehículo" }, { status: 500 });
  }

  // ── 4. Actualizar vehiculo_activo_id en usuarios ───────────────────────────
  const { error: errUsuario } = await supabaseAdmin
    .from("usuarios")
    .update({ vehiculo_activo_id: vehiculoId })
    .eq("id", userId);

  if (errUsuario) {
    console.error("[chofer/vehiculos/[id]/activo] ❌ error usuarios:", errUsuario.message);
    return NextResponse.json({ error: "Error al actualizar perfil del chofer" }, { status: 500 });
  }

  console.log("[chofer/vehiculos/[id]/activo] ✅ vehiculo activo — id:", vehiculoId, "| chofer:", userId);
  return NextResponse.json({ ok: true });
}
