import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/activa)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/activa)");

const supabaseAdmin = createClient(_url, _roleKey);

const ESTADOS_ACTIVOS = [
  "Chofer asignado",
  "En camino",
  "Carga retirada",
  "En ruta",
  "Descarga completada",
];

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

  if (usuario.rol !== "chofer") {
    return NextResponse.json({ error: "Prohibido: solo choferes pueden acceder a esta ruta" }, { status: 403 });
  }

  // ── 3. Leer query param opcional ──────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const cargaId = searchParams.get("carga_id");

  if (cargaId) {
    // ── Modo: buscar carga específica por id (viaje-activo) ─────────────────
    const { data: carga, error: cargaError } = await supabaseAdmin
      .from("cargas")
      .select("*")
      .eq("id", cargaId)
      .single();

    if (cargaError || !carga) {
      return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
    }

    if (String(carga.chofer_id) !== String(userId)) {
      return NextResponse.json({ error: "Prohibido: este viaje no te pertenece" }, { status: 403 });
    }

    return NextResponse.json({ carga });
  }

  // ── Modo: buscar viaje activo del chofer (panel-chofer) ───────────────────
  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas")
    .select("id, origen, destino, estado, pago_chofer")
    .eq("chofer_id", userId)
    .in("estado", ESTADOS_ACTIVOS)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cargaError) {
    console.error("[cargas/activa] error SELECT viaje activo:", cargaError.message);
    return NextResponse.json({ error: "Error al buscar viaje activo" }, { status: 500 });
  }

  return NextResponse.json({ carga: carga ?? null });
}
