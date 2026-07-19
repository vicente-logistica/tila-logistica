import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (chat/mensajes)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (chat/mensajes)");

const supabaseAdmin = createClient(_url, _roleKey);

const TIPOS_VALIDOS = ["viaje", "soporte_cliente", "soporte_chofer"] as const;
type TipoChat = typeof TIPOS_VALIDOS[number];

interface MensajeViaje {
  id: number;
  viaje_id: number;
  tipo_chat: TipoChat;
  remitente_id: string;
  remitente_rol: string;
  remitente_nombre: string;
  mensaje: string;
  leido: boolean;
  created_at: string;
}

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
  const viajeIdParam  = searchParams.get("viaje_id");
  const tipoChatParam = searchParams.get("tipo_chat");

  if (!viajeIdParam || !tipoChatParam) {
    return NextResponse.json(
      { error: "Faltan parámetros obligatorios: viaje_id, tipo_chat" },
      { status: 400 },
    );
  }

  const viajeIds  = [...new Set(viajeIdParam.split(",").map((v) => v.trim()).filter(Boolean))];
  const tiposChat = [...new Set(tipoChatParam.split(",").map((t) => t.trim()).filter(Boolean))];

  if (viajeIds.length === 0 || tiposChat.length === 0) {
    return NextResponse.json(
      { error: "Faltan parámetros obligatorios: viaje_id, tipo_chat" },
      { status: 400 },
    );
  }

  // ── 5. Validar tipo_chat ──────────────────────────────────────────────────────
  for (const t of tiposChat) {
    if (!(TIPOS_VALIDOS as readonly string[]).includes(t)) {
      return NextResponse.json(
        { error: `tipo_chat inválido. Valores permitidos: ${TIPOS_VALIDOS.join(", ")}` },
        { status: 400 },
      );
    }
  }
  const tiposValidados = tiposChat as TipoChat[];

  const esAdmin = usuario.rol === "admin";

  // ── 6a. Un solo viaje_id + un solo tipo_chat → respuesta clásica (compat) ─────
  if (viajeIds.length === 1 && tiposValidados.length === 1) {
    const viaje_id     = viajeIds[0];
    const tipoValidado = tiposValidados[0];

    const { data: carga, error: cargaError } = await supabaseAdmin
      .from("cargas")
      .select("id, cliente_id, chofer_id")
      .eq("id", viaje_id)
      .single();

    if (cargaError || !carga) {
      return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
    }

    const esCliente = usuario.id === carga.cliente_id;
    const esChofer  = usuario.id === carga.chofer_id;

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
        { error: "Prohibido: no tenés permiso para leer este canal" },
        { status: 403 },
      );
    }

    const { data, error: selectError } = await supabaseAdmin
      .from("mensajes_viaje")
      .select("*")
      .eq("viaje_id", Number(viaje_id))
      .eq("tipo_chat", tipoValidado)
      .order("created_at", { ascending: true });

    if (selectError) {
      console.error("[chat/mensajes] error leyendo mensajes:", selectError.message);
      return NextResponse.json({ error: "Error interno al leer mensajes" }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  }

  // ── 6b. Modo lote: varios viaje_id y/o varios tipo_chat en una sola llamada ───
  // Fuente de detección de mensajes nuevos (nunca filtra por leído) — badges y
  // contadores siguen viviendo exclusivamente en /api/chat/no-leidos.
  const servidorAhora = new Date().toISOString();

  const { data: cargas, error: cargasError } = await supabaseAdmin
    .from("cargas")
    .select("id, cliente_id, chofer_id")
    .in("id", viajeIds.map(Number));

  if (cargasError) {
    console.error("[chat/mensajes] error buscando cargas:", cargasError.message);
    return NextResponse.json({ error: "Error interno al buscar viajes" }, { status: 500 });
  }

  const paresPermitidos = new Set<string>();
  const viajeIdsPermitidos = new Set<string>();
  for (const carga of cargas ?? []) {
    const vid       = String(carga.id);
    const esCliente = usuario.id === carga.cliente_id;
    const esChofer  = usuario.id === carga.chofer_id;
    for (const tipo of tiposValidados) {
      let permitido = false;
      if (tipo === "viaje")           permitido = esCliente || esChofer || esAdmin;
      else if (tipo === "soporte_cliente") permitido = esCliente || esAdmin;
      else if (tipo === "soporte_chofer")  permitido = esChofer || esAdmin;
      if (permitido) {
        paresPermitidos.add(`${vid}:${tipo}`);
        viajeIdsPermitidos.add(vid);
      }
    }
  }

  const porViaje: Record<string, Record<string, MensajeViaje[]>> = {};
  for (const vid of viajeIds) {
    porViaje[vid] = {};
    for (const tipo of tiposValidados) {
      if (paresPermitidos.has(`${vid}:${tipo}`)) porViaje[vid][tipo] = [];
    }
  }

  if (viajeIdsPermitidos.size > 0) {
    const { data, error: selectError } = await supabaseAdmin
      .from("mensajes_viaje")
      .select("*")
      .in("viaje_id", [...viajeIdsPermitidos].map(Number))
      .in("tipo_chat", tiposValidados)
      .order("created_at", { ascending: true });

    if (selectError) {
      console.error("[chat/mensajes] error leyendo mensajes (lote):", selectError.message);
      return NextResponse.json({ error: "Error interno al leer mensajes" }, { status: 500 });
    }

    for (const m of data ?? []) {
      const vid  = String(m.viaje_id);
      const tipo = m.tipo_chat as string;
      if (!paresPermitidos.has(`${vid}:${tipo}`)) continue; // defensa en profundidad
      porViaje[vid]?.[tipo]?.push(m);
    }
  }

  return NextResponse.json({ porViaje, server_now: servidorAhora });
}
