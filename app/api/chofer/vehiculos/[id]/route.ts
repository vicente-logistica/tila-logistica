import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (chofer/vehiculos/[id])");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (chofer/vehiculos/[id])");

const supabaseAdmin = createClient(_url, _roleKey);

const CAMPOS_EDITABLES = [
  "marca", "modelo", "anio", "patente",
  "tipo_vehiculo", "seguro_vencimiento", "vtv_rto_vencimiento",
] as const;

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

  // ── 3. Construir updateData con whitelist ──────────────────────────────────
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const campo of CAMPOS_EDITABLES) {
    if (campo in body && body[campo] !== undefined) {
      updateData[campo] = campo === "anio" ? (body[campo] ? Number(body[campo]) : null)
                        : campo === "patente" ? String(body[campo]).trim().toUpperCase()
                        : body[campo];
    }
  }

  if (Object.keys(updateData).length === 1) { // solo updated_at
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  // ── 4. UPDATE ──────────────────────────────────────────────────────────────
  const { error } = await supabaseAdmin
    .from("vehiculos")
    .update(updateData)
    .eq("id", vehiculoId);

  if (error) {
    console.error("[chofer/vehiculos/[id]] ❌ error UPDATE:", error.message);
    return NextResponse.json({ error: "Error al actualizar vehículo" }, { status: 500 });
  }

  console.log("[chofer/vehiculos/[id]] ✅ actualizado — id:", vehiculoId, "| campos:", Object.keys(updateData).filter(k => k !== "updated_at").join(", "));
  return NextResponse.json({ ok: true });
}
