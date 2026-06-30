import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (admin/usuarios/[id]/estado)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (admin/usuarios/[id]/estado)");

const supabaseAdmin = createClient(_url, _roleKey);

type Accion = "eliminar" | "restaurar" | "aprobar" | "rechazar" | "suspender" | "reactivar";

const ACCIONES_PERMITIDAS: Accion[] = [
  "eliminar", "restaurar", "aprobar", "rechazar", "suspender", "reactivar",
];

const ACCION_A_UPDATE: Record<Accion, Record<string, unknown>> = {
  eliminar:  { eliminado: true },
  restaurar: { eliminado: false },
  aprobar:   { estado_aprobacion: "aprobado" },
  rechazar:  { estado_aprobacion: "rechazado" },
  suspender: { estado_aprobacion: "suspendido" },
  reactivar: { estado_aprobacion: "aprobado" },
};

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

  // ── 2. Leer y validar acción ───────────────────────────────────────────────
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { accion } = body ?? {};
  if (!accion || !ACCIONES_PERMITIDAS.includes(accion as Accion)) {
    return NextResponse.json(
      { error: `Acción inválida. Permitidas: ${ACCIONES_PERMITIDAS.join(", ")}` },
      { status: 400 }
    );
  }

  // ── 3. Verificar que el usuario target exista ──────────────────────────────
  const { data: target } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol, eliminado")
    .eq("id", targetId)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  // ── 4. Guardia: no eliminar el último admin ────────────────────────────────
  if (accion === "eliminar" && target.rol === "admin") {
    const { count } = await supabaseAdmin
      .from("usuarios")
      .select("id", { count: "exact", head: true })
      .eq("rol", "admin")
      .eq("eliminado", false);

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "No podés eliminar al único administrador activo" },
        { status: 409 }
      );
    }
  }

  // ── 5. Aplicar actualización ───────────────────────────────────────────────
  const updateData = ACCION_A_UPDATE[accion as Accion];

  const { error } = await supabaseAdmin
    .from("usuarios")
    .update(updateData)
    .eq("id", targetId);

  if (error) {
    console.error("[admin/usuarios/[id]/estado] ❌ error UPDATE:", error.message);
    return NextResponse.json({ error: "Error al actualizar estado" }, { status: 500 });
  }

  console.log("[admin/usuarios/[id]/estado] ✅ accion:", accion, "| target:", targetId);
  return NextResponse.json({ ok: true });
}
