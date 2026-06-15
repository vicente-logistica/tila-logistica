import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (chat/mensaje)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (chat/mensaje)");

const supabaseAdmin = createClient(_url, _roleKey);

const TIPOS_VALIDOS = ["viaje", "soporte_cliente", "soporte_chofer"] as const;
type TipoChat = typeof TIPOS_VALIDOS[number];

export async function POST(req: Request) {
  // ── 1. Leer x-user-id ────────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });
  }

  // ── 2-3. Verificar usuario en BD ─────────────────────────────────────────────
  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol, nombre")
    .eq("id", userId)
    .single();

  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  // ── 4. Leer body ──────────────────────────────────────────────────────────────
  let viaje_id: string | undefined;
  let tipo_chat: string | undefined;
  let mensaje: string | undefined;

  try {
    const body = await req.json();
    viaje_id  = body?.viaje_id  !== undefined ? String(body.viaje_id)  : undefined;
    tipo_chat = body?.tipo_chat !== undefined ? String(body.tipo_chat) : undefined;
    mensaje   = body?.mensaje   !== undefined ? String(body.mensaje)   : undefined;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!viaje_id || !tipo_chat || !mensaje?.trim()) {
    return NextResponse.json(
      { error: "Faltan campos obligatorios: viaje_id, tipo_chat, mensaje" },
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
  const esCliente = usuario.id  === carga.cliente_id;
  const esChofer  = usuario.id  === carga.chofer_id;

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
      { error: "Prohibido: no tenés permiso para escribir en este canal" },
      { status: 403 },
    );
  }

  // ── 8. Insertar — remitente_rol y remitente_nombre siempre desde la BD ────────
  const { error: insertError } = await supabaseAdmin
    .from("mensajes_viaje")
    .insert([{
      viaje_id:         Number(viaje_id),
      remitente_id:     usuario.id,
      remitente_rol:    usuario.rol,
      remitente_nombre: usuario.nombre,
      mensaje:          mensaje.trim(),
      leido:            false,
      tipo_chat:        tipoValidado,
    }]);

  if (insertError) {
    console.error("[chat/mensaje] error insertando:", insertError.message);
    return NextResponse.json({ error: "Error interno al enviar mensaje" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
