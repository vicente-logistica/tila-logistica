import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (chofer/vehiculos)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (chofer/vehiculos)");

const supabaseAdmin = createClient(_url, _roleKey);

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

  // ── 2. Leer body y construir payload con whitelist ─────────────────────────
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { marca, modelo, anio, patente, tipo_vehiculo, capacidad_kg,
          seguro_vencimiento, vtv_rto_vencimiento } = body ?? {};

  if (!marca?.trim() || !modelo?.trim() || !patente?.trim() || !tipo_vehiculo) {
    return NextResponse.json({ error: "Campos requeridos: marca, modelo, patente, tipo_vehiculo" }, { status: 400 });
  }

  // ── 3. Verificar si es el primer vehículo del chofer ──────────────────────
  const { count } = await supabaseAdmin
    .from("vehiculos")
    .select("id", { count: "exact", head: true })
    .eq("chofer_id", userId);

  const esPrimero = (count ?? 0) === 0;

  // ── 4. INSERT — chofer_id y estado_validacion forzados server-side ─────────
  const { data: nuevo, error: insertErr } = await supabaseAdmin
    .from("vehiculos")
    .insert([{
      chofer_id:           userId,
      marca:               marca.trim(),
      modelo:              modelo.trim(),
      anio:                anio ? Number(anio) : null,
      patente:             patente.trim().toUpperCase(),
      tipo_vehiculo,
      capacidad_kg:        capacidad_kg ? Number(capacidad_kg) : null,
      seguro_vencimiento:  seguro_vencimiento ?? null,
      vtv_rto_vencimiento: vtv_rto_vencimiento ?? null,
      activo:              esPrimero,
      estado_validacion:   "pendiente", // siempre forzado server-side
    }])
    .select()
    .single();

  if (insertErr || !nuevo) {
    console.error("[chofer/vehiculos] ❌ error INSERT:", insertErr?.message);
    return NextResponse.json({ error: "Error al crear vehículo" }, { status: 500 });
  }

  // ── 5. Si es el primero, actualizar vehiculo_activo_id en usuarios ─────────
  if (esPrimero) {
    await supabaseAdmin
      .from("usuarios")
      .update({ vehiculo_activo_id: nuevo.id })
      .eq("id", userId);
  }

  console.log("[chofer/vehiculos] ✅ creado — id:", nuevo.id, "| chofer:", userId, "| primero:", esPrimero);
  return NextResponse.json({ vehiculo: nuevo }, { status: 201 });
}
