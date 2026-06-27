import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (admin/usuarios/[id])");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (admin/usuarios/[id])");

const supabaseAdmin = createClient(_url, _roleKey);

const CAMPOS_EDITABLES = [
  "nombre", "email", "telefono", "dni",
  "categoria_legal", "tipo_vehiculo", "tipo_carroceria", "vehiculo",
] as const;

type CampoEditable = typeof CAMPOS_EDITABLES[number];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetId } = await params;

  // ── 1. Verificar caller ────────────────────────────────────────────────────
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: caller } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", callerId)
    .maybeSingle();

  if (!caller || caller.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // ── 2. Verificar que el usuario target exista ──────────────────────────────
  const { data: target } = await supabaseAdmin
    .from("usuarios")
    .select("id")
    .eq("id", targetId)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  // ── 3. Construir updateData SOLO desde whitelist — nunca del body directo ──
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const updateData: Partial<Record<CampoEditable, any>> = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (campo in body && body[campo] !== undefined) {
      updateData[campo] = body[campo];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  // ── 4. Aplicar actualización ───────────────────────────────────────────────
  const { error } = await supabaseAdmin
    .from("usuarios")
    .update(updateData)
    .eq("id", targetId);

  if (error) {
    console.error("[admin/usuarios/[id]] ❌ error UPDATE:", error.message);
    return NextResponse.json({ error: "Error al actualizar usuario" }, { status: 500 });
  }

  console.log("[admin/usuarios/[id]] ✅ actualizado — target:", targetId, "| campos:", Object.keys(updateData).join(", "));
  return NextResponse.json({ ok: true });
}
