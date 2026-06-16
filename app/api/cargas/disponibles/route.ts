import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/disponibles)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/disponibles)");

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

  console.log("[DIAG cargas/disponibles] userId:", userId, "userError:", userError?.message, "usuario:", usuario);
  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  if (usuario.rol !== "chofer") {
    return NextResponse.json({ error: "Prohibido: solo choferes pueden ver cargas disponibles" }, { status: 403 });
  }

  // ── 3. Consultar cargas pendientes sin chofer asignado ────────────────────
  const { data, error } = await supabaseAdmin
    .from("cargas")
    .select(
      "id, origen, destino, tipo_vehiculo, vehiculo, categoria_legal, tipo_carga, " +
      "km_estimados, peso, pago_chofer, pago_estado, detalles, estado, created_at"
    )
    .eq("estado", "pendiente")
    .is("chofer_id", null)
    .order("created_at", { ascending: true });

  console.log("[DIAG cargas/disponibles] data.length:", data?.length, "error:", error?.message);
  if (error) {
    console.error("[cargas/disponibles] error SELECT:", error.message);
    return NextResponse.json({ error: "Error al obtener cargas" }, { status: 500 });
  }

  return NextResponse.json({ cargas: data ?? [] });
}
