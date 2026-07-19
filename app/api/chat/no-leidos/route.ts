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

// ── INSTRUMENTACIÓN TEMPORAL FASE 2B-DIAG — solo diagnóstico, sacar antes de cerrar la tarea ──
const DIAG_FASE2B = true;
const diagApi = (evento: string, data: Record<string, unknown>) => {
  if (!DIAG_FASE2B) return;
  console.log(`[FASE2B-DIAG-API] ${evento}`, JSON.stringify({ ts: Date.now(), iso: new Date().toISOString(), ...data }));
};

export async function GET(req: Request) {
  const servidorAhora = new Date().toISOString(); // capturado antes de cualquier query
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

    const { data, error: selectError } = await supabaseAdmin
      .from("mensajes_viaje")
      .select("id, created_at")
      .eq("viaje_id", Number(viaje_id))
      .eq("tipo_chat", tipoValidado)
      .eq("leido", false)
      .neq("remitente_id", String(userId));

    if (selectError) {
      console.error("[chat/no-leidos] error contando:", selectError.message);
      return NextResponse.json({ error: "Error interno al contar mensajes" }, { status: 500 });
    }

    return NextResponse.json({
      count: data?.length ?? 0,
      ids: data?.map((d) => d.id) ?? [],
      mensajes: data?.map((d) => ({ id: d.id, created_at: d.created_at })) ?? [],
      server_now: servidorAhora,
    });
  }

  // ── 6b. Modo lote: varios viaje_id y/o varios tipo_chat en una sola llamada ───
  const { data: cargas, error: cargasError } = await supabaseAdmin
    .from("cargas")
    .select("id, cliente_id, chofer_id")
    .in("id", viajeIds.map(Number));

  if (cargasError) {
    console.error("[chat/no-leidos] error buscando cargas:", cargasError.message);
    return NextResponse.json({ error: "Error interno al buscar viajes" }, { status: 500 });
  }

  // Pares (viaje_id, tipo_chat) a los que el usuario tiene permiso — todo lo
  // demás se omite en la respuesta, aunque se haya pedido.
  const paresPermitidos = new Set<string>();
  const viajeIdsPermitidos = new Set<string>();
  for (const carga of cargas ?? []) {
    const vid       = String(carga.id);
    const esCliente = String(usuario.id) === String(carga.cliente_id);
    const esChofer  = String(usuario.id) === String(carga.chofer_id);
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

  diagApi("permisos-calculados", {
    viajeIdsSolicitados: viajeIds,
    tiposSolicitados: tiposValidados,
    paresPermitidos: [...paresPermitidos],
    viajeIdsPermitidos: [...viajeIdsPermitidos],
  });

  const porViaje: Record<string, Record<string, { count: number; ids: (string | number)[]; mensajes: { id: string | number; created_at: string }[] }>> = {};
  for (const vid of viajeIds) {
    porViaje[vid] = {};
    for (const tipo of tiposValidados) {
      if (paresPermitidos.has(`${vid}:${tipo}`)) porViaje[vid][tipo] = { count: 0, ids: [], mensajes: [] };
    }
  }

  if (viajeIdsPermitidos.size > 0) {
    const { data, error: selectError } = await supabaseAdmin
      .from("mensajes_viaje")
      .select("id, viaje_id, tipo_chat, created_at")
      .in("viaje_id", [...viajeIdsPermitidos].map(Number))
      .in("tipo_chat", tiposValidados)
      .eq("leido", false)
      .neq("remitente_id", String(userId));

    if (selectError) {
      console.error("[chat/no-leidos] error contando (lote):", selectError.message);
      return NextResponse.json({ error: "Error interno al contar mensajes" }, { status: 500 });
    }

    for (const m of data ?? []) {
      const vid  = String(m.viaje_id);
      const tipo = m.tipo_chat as string;
      if (!paresPermitidos.has(`${vid}:${tipo}`)) continue; // defensa en profundidad
      const bucket = porViaje[vid]?.[tipo];
      if (!bucket) continue;
      bucket.count++;
      bucket.ids.push(m.id);
      bucket.mensajes.push({ id: m.id, created_at: m.created_at });
    }

    diagApi("no-leidos-resultado", {
      filas: (data ?? []).map((m) => ({ id: m.id, viaje_id: m.viaje_id, tipo_chat: m.tipo_chat })),
      porViaje,
    });
  }

  // ── DIAG: TODOS los mensajes recientes (sin filtrar por leido), solo para
  // comparar contra lo que la query de arriba consideró "no leído". No se
  // devuelve al cliente — solo se imprime en el log del servidor.
  if (DIAG_FASE2B && viajeIdsPermitidos.size > 0) {
    const { data: todosDebug, error: debugError } = await supabaseAdmin
      .from("mensajes_viaje")
      .select("id, viaje_id, tipo_chat, leido, remitente_id, created_at")
      .in("viaje_id", [...viajeIdsPermitidos].map(Number))
      .in("tipo_chat", tiposValidados)
      .order("created_at", { ascending: false })
      .limit(30);

    if (debugError) {
      diagApi("todos-los-mensajes-recientes-error", { error: debugError.message });
    } else {
      diagApi("todos-los-mensajes-recientes", { mensajes: todosDebug ?? [] });
    }
  }

  return NextResponse.json({ porViaje, server_now: servidorAhora });
}
