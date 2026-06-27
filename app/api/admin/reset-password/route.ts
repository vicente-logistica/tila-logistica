import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (admin/reset-password)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (admin/reset-password)");

const supabaseAdmin = createClient(_url, _roleKey);

function generarPasswordTemporal(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `TILA-${num}`;
}

export async function POST(req: Request) {
  try {
    // ── 1. Verificar que quien llama es admin ─────────────────────────────────
    const adminId = req.headers.get("x-user-id");
    if (!adminId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: adminUser } = await supabaseAdmin
      .from("usuarios")
      .select("id, rol")
      .eq("id", adminId)
      .single();

    if (!adminUser || adminUser.rol !== "admin") {
      return NextResponse.json({ error: "Prohibido" }, { status: 403 });
    }

    // ── 2. Leer userId del body ────────────────────────────────────────────────
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }

    const { userId } = body ?? {};
    if (!userId) {
      return NextResponse.json({ error: "Falta userId" }, { status: 400 });
    }

    // ── 3. Verificar que el usuario target existe ─────────────────────────────
    const { data: target } = await supabaseAdmin
      .from("usuarios")
      .select("id, nombre")
      .eq("id", userId)
      .single();

    if (!target) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    // ── 4. Generar contraseña temporal, hashear y guardar ─────────────────────
    const passwordTemporal = generarPasswordTemporal();
    const hash = await bcrypt.hash(passwordTemporal, 10);

    const { error: updateError } = await supabaseAdmin
      .from("usuarios")
      .update({ password: hash })
      .eq("id", userId);

    if (updateError) {
      console.error("[admin/reset-password] ❌ error update:", updateError.message);
      return NextResponse.json({ error: "Error al resetear la contraseña" }, { status: 500 });
    }

    console.log("[admin/reset-password] ✅ password reseteada — admin:", adminId, "| target:", userId);

    // Devolver la contraseña temporal en texto plano una sola vez para que el admin la comunique
    return NextResponse.json({ ok: true, passwordTemporal, nombre: target.nombre });

  } catch (error: any) {
    console.error("[admin/reset-password] ❌ error general:", error?.message ?? String(error));
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
