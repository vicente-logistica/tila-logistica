import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const _anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

if (!_url)     throw new Error("Falta SUPABASE_URL (chofer/vehiculos/[id]/docs)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (chofer/vehiculos/[id]/docs)");

const supabaseAdmin = createClient(_url, _roleKey);

const CAMPOS_DOC_PERMITIDOS = ["cedula_verde_url", "seguro_url", "vtv_rto_url"] as const;
const BUCKETS_PERMITIDOS = ["documentacion-choferes", "vehiculos"];

function urlPertenecaAlChofer(url: string, choferId: string): boolean {
  try {
    const parsed = new URL(url);
    const expectedHost = new URL(_anonUrl).host;
    if (parsed.host !== expectedHost) return false;

    // /storage/v1/object/public/{bucket}/{choferId}/...
    const segments = parsed.pathname.split("/");
    const bucketIdx = segments.indexOf("public") + 1;
    const bucket = segments[bucketIdx];
    const ownerSegment = segments[bucketIdx + 1];

    if (!BUCKETS_PERMITIDOS.includes(bucket)) return false;
    if (ownerSegment !== choferId) return false;

    return true;
  } catch {
    return false;
  }
}

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

  // ── 3. Construir updateData con whitelist de campos de documentación ────────
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const updateData: Record<string, any> = { updated_at: new Date().toISOString() };

  for (const campo of CAMPOS_DOC_PERMITIDOS) {
    if (campo in body && body[campo] !== undefined) {
      const url = body[campo];
      if (typeof url !== "string" || !urlPertenecaAlChofer(url, userId)) {
        return NextResponse.json(
          { error: `La URL para ${campo} no pertenece al storage del chofer autenticado` },
          { status: 403 }
        );
      }
      updateData[campo] = url;
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
    console.error("[chofer/vehiculos/[id]/docs] ❌ error UPDATE:", error.message);
    return NextResponse.json({ error: "Error al guardar documentación del vehículo" }, { status: 500 });
  }

  console.log("[chofer/vehiculos/[id]/docs] ✅ docs actualizados — id:", vehiculoId, "| campos:", Object.keys(updateData).filter(k => k !== "updated_at").join(", "));
  return NextResponse.json({ ok: true });
}
