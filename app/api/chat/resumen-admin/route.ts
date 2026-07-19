import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (chat/resumen-admin)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (chat/resumen-admin)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function GET(req: Request) {
  // ── 1. Leer x-user-id ────────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });
  }

  // ── 2-3. Verificar usuario en BD ─────────────────────────────────────────────
  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", userId)
    .single();

  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  // ── 4. Verificar rol admin ────────────────────────────────────────────────────
  if (usuario.rol !== "admin") {
    return NextResponse.json({ error: "Prohibido: se requiere rol admin" }, { status: 403 });
  }

  // ── 5. SELECT global mensajes no leídos ──────────────────────────────────────
  const { data, error: selectError } = await supabaseAdmin
    .from("mensajes_viaje")
    .select("id, viaje_id, leido, remitente_id, tipo_chat")
    .eq("leido", false);

  if (selectError) {
    console.error("[chat/resumen-admin] error leyendo mensajes:", selectError.message);
    return NextResponse.json({ error: "Error interno al leer resumen" }, { status: 500 });
  }

  // ── 6. Construir resumen en el mismo formato que espera admin/page.tsx ────────
  // { [viaje_id]: { viaje: n, soporte_cliente: n, soporte_chofer: n } }
  const resumen: Record<string, Record<string, number>> = {};
  (data ?? []).forEach((m: any) => {
    const vkey = String(m.viaje_id);
    if (!resumen[vkey]) resumen[vkey] = { viaje: 0, soporte_cliente: 0, soporte_chofer: 0 };
    const tipo = m.tipo_chat as string;
    if (tipo in resumen[vkey]) resumen[vkey][tipo]++;
  });

  // ── 7. IDs de mensajes no leídos, para que el cliente pueda deduplicar por ID ──
  const mensajes = (data ?? []).map((m: any) => ({
    id: m.id,
    viaje_id: m.viaje_id,
    remitente_id: m.remitente_id,
    tipo_chat: m.tipo_chat,
  }));

  return NextResponse.json({ resumen, mensajes });
}
