import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (chat/no-leidos)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (chat/no-leidos)");

const supabaseAdmin = createClient(_url, _roleKey);

const TIPOS_VALIDOS = ["viaje", "soporte_cliente", "soporte_chofer"] as const;
type TipoChat = typeof TIPOS_VALIDOS[number];

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

  // ── 4. Leer query params ──────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const viaje_id  = searchParams.get("viaje_id");
  const tipo_chat = searchParams.get("tipo_chat");

  if (!viaje_id || !tipo_chat) {
    return NextResponse.json(
      { error: "Faltan parámetros obligatorios: viaje_id, tipo_chat" },
      { status: 400 },
    );
  }

  // ── 5. Validar tipo_chat ──────────────────────────────────────────────────────
  if (!(TIPOS_VALIDOS as readonly string[]).includes(tipo_chat)) {
    return NextResponse.json(
      { error: `tipo_chat inválido. Valores permitidos: ${TIPOS_VALIDOS.join(", ")}` },
      { status: 400 },
    );
  }

  const tipoValidado = tipo_chat as TipoChat;

  // ── 6. Buscar carga ───────────────────────────────────────────────────────────
  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas")
    .select("id, cliente_id, chofer_id")
    .eq("id", viaje_id)
    .single();

  if (cargaError || !carga) {
    return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
  }

  // ── 7. Validar permiso según tipo_chat ────────────────────────────────────────
  const esAdmin   = usuario.rol === "admin";
  const esCliente = String(usuario.id) === String(carga.cliente_id);
  const esChofer  = String(usuario.id) === String(carga.chofer_id);

  let permitido = false;

  if (tipoValidado === "viaje") {
    permitido = esCliente || esChofer || esAdmin;
  } else if (tipoValidado === "soporte_cliente") {
    permitido = esCliente || esAdmin;
  } else if (tipoValidado === "soporte_chofer") {
    permitido = esChofer || esAdmin;
  }

  if (!permitido) {
    return NextResponse.json(
      { error: "Prohibido: no tenés permiso para acceder a este canal" },
      { status: 403 },
    );
  }

  // ── 8. Contar mensajes no leídos ──────────────────────────────────────────────
  const { data, error: selectError } = await supabaseAdmin
    .from("mensajes_viaje")
    .select("id")
    .eq("viaje_id", Number(viaje_id))
    .eq("tipo_chat", tipoValidado)
    .eq("leido", false)
    .neq("remitente_id", String(userId));

  if (selectError) {
    console.error("[chat/no-leidos] error contando:", selectError.message);
    return NextResponse.json({ error: "Error interno al contar mensajes" }, { status: 500 });
  }

  return NextResponse.json({ count: data?.length ?? 0 });
}
