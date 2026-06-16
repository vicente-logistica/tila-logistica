import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/historial-chofer)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/historial-chofer)");

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

  console.log("[DIAG historial-chofer] userId:", userId, "userError:", userError?.message, "usuario:", usuario);
  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  if (usuario.rol !== "chofer") {
    return NextResponse.json({ error: "Prohibido: solo choferes pueden acceder a esta ruta" }, { status: 403 });
  }

  // ── 3. Consultar cargas del chofer ────────────────────────────────────────
  const { data, error } = await supabaseAdmin
    .from("cargas")
    .select("*")
    .eq("chofer_id", userId)
    .neq("oculto_chofer", true)
    .order("created_at", { ascending: false });

  console.log("[DIAG historial-chofer] data.length:", data?.length, "error:", error?.message);
  if (error) {
    console.error("[cargas/historial-chofer] error SELECT:", error.message);
    return NextResponse.json({ error: "Error al obtener cargas" }, { status: 500 });
  }

  return NextResponse.json({ cargas: data ?? [] });
}
