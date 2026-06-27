import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (admin/usuarios)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (admin/usuarios)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function GET(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Verificar que quien llama sea admin
  const { data: caller, error: callerErr } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", userId)
    .maybeSingle();

  if (callerErr || !caller || caller.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // Devolver solo los campos que el panel realmente usa — nunca password, hash, datos bancarios
  const { data, error } = await supabaseAdmin
    .from("usuarios")
    .select(
      "id, nombre, email, telefono, dni, vehiculo, rol, estado_aprobacion, eliminado, " +
      "categoria_legal, tipo_vehiculo, tipo_carroceria, online, " +
      "bateria_nivel, bateria_cargando, ultima_senal_at, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/usuarios] ❌ error SELECT:", error.message);
    return NextResponse.json({ error: "Error al cargar usuarios" }, { status: 500 });
  }

  return NextResponse.json({ usuarios: data ?? [] });
}
