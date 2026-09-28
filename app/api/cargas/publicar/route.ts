import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { leerConfiguracionComisiones } from "../../../lib/configuracionComisiones";
import {
  cotizarCarga, camposEconomicosCarga, TIPOS_VEHICULO_VALIDOS,
} from "../../../lib/cotizacion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/publicar)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/publicar)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function POST(req: Request) {
  // ── 1. Leer x-user-id ────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });
  }

  // ── 2. Verificar usuario en BD ────────────────────────────────────────────
  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol, eliminado, estado_aprobacion")
    .eq("id", userId)
    .single();

  if (userError || !usuario) {
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  }

  // ── 3. Validar estado del usuario ─────────────────────────────────────────
  if (usuario.eliminado) {
    return NextResponse.json({ error: "Esta cuenta ha sido eliminada." }, { status: 403 });
  }

  if (usuario.rol !== "cliente") {
    return NextResponse.json({ error: "Prohibido: solo clientes pueden publicar viajes" }, { status: 403 });
  }

  if (usuario.estado_aprobacion === "suspendido") {
    return NextResponse.json({ error: "Tu cuenta está suspendida. Contactá al administrador para reactivarla." }, { status: 403 });
  }

  // ── 4. Leer body ──────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const {
    origen,
    destino,
    tipo_vehiculo,
    tipo_carroceria,
    categoria_legal,
    peso,
    tipo_carga,
    detalles,
    km_estimados,
    paradas_intermedias,
  } = body ?? {};

  // ── 5. Validar campos obligatorios ────────────────────────────────────────
  if (!origen || typeof origen !== "string" || !origen.trim()) {
    return NextResponse.json({ error: "Campo obligatorio: origen" }, { status: 400 });
  }
  if (!destino || typeof destino !== "string" || !destino.trim()) {
    return NextResponse.json({ error: "Campo obligatorio: destino" }, { status: 400 });
  }
  if (!tipo_vehiculo || typeof tipo_vehiculo !== "string") {
    return NextResponse.json({ error: "Campo obligatorio: tipo_vehiculo" }, { status: 400 });
  }
  if (!TIPOS_VEHICULO_VALIDOS.includes(tipo_vehiculo)) {
    return NextResponse.json(
      { error: `tipo_vehiculo inválido. Valores permitidos: ${TIPOS_VEHICULO_VALIDOS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!tipo_carga || typeof tipo_carga !== "string") {
    return NextResponse.json({ error: "Campo obligatorio: tipo_carga" }, { status: 400 });
  }

  const kmNum = Number(km_estimados);
  if (!kmNum || kmNum <= 0) {
    return NextResponse.json({ error: "km_estimados debe ser un número positivo" }, { status: 400 });
  }

  // ── 6. Calcular tarifa server-side con las comisiones VIGENTES ──────────────
  // Misma función y misma configuración que /api/tarifas/cotizar (vista previa). Los
  // montos quedan fijos en la carga: un cambio posterior de comisiones sólo afecta cargas
  // nuevas.
  const comisiones = await leerConfiguracionComisiones(supabaseAdmin);
  const tarifa = cotizarCarga(
    { kmEstimados: kmNum, tipoVehiculo: tipo_vehiculo, tipoCarga: tipo_carga, paradasIntermedias: paradas_intermedias },
    comisiones,
  );
  const economicos = camposEconomicosCarga(tarifa);

  // ── 7. Componer texto de vehículo ─────────────────────────────────────────
  const vehiculoTexto = [tipo_vehiculo, tipo_carroceria, categoria_legal]
    .filter(Boolean)
    .join(" - ");

  // ── 8. INSERT con supabaseAdmin — campos sensibles siempre server-side ────
  const { data: carga, error: insertError } = await supabaseAdmin
    .from("cargas")
    .insert([{
      // ── Identidad (server-side) ──────────────────────────────────────────
      cliente_id:          userId,
      estado:              "pendiente",
      pago_estado:         "pendiente_pago",
      pagado_cliente:      false,
      tracking:            false,
      chofer_id:           null,
      oculto_cliente:      false,
      oculto_chofer:       false,
      // ── Datos del viaje (del body, ya validados) ─────────────────────────
      origen:              origen.trim(),
      destino:             destino.trim(),
      vehiculo:            vehiculoTexto,
      categoria_legal:     categoria_legal ?? null,
      tipo_vehiculo,
      tipo_carroceria:     tipo_carroceria ?? null,
      peso:                peso ?? null,
      tipo_carga,
      detalles:            detalles ?? null,
      km_estimados:        kmNum,
      // ── Tarifas (calculadas server-side) ─────────────────────────────────
      precio_base:         economicos.precio_base,
      precio_cliente:      economicos.precio_cliente,
      pago_chofer:         economicos.pago_chofer,
      comision_plataforma: economicos.comision_plataforma,
    }])
    .select()
    .single();

  if (insertError || !carga) {
    console.error("[cargas/publicar] error INSERT:", insertError?.message);
    return NextResponse.json({ error: "Error al publicar la carga" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, carga });
}
