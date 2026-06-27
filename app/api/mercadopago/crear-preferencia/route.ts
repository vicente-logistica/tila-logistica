import { NextResponse } from "next/server";
import { MercadoPagoConfig, Preference } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _prefSupabaseUrl    = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _prefServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_prefSupabaseUrl)    throw new Error("Falta SUPABASE_URL en variables de entorno (crear-preferencia)");
if (!_prefServiceRoleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (crear-preferencia)");

const supabaseAdmin = createClient(_prefSupabaseUrl, _prefServiceRoleKey);

export async function POST(req: Request) {
  try {
    // ── 1. Autenticación: leer x-user-id del header ──────────────────────────
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      console.error("[MP] ❌ crear-preferencia — falta x-user-id en headers");
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // ── 2. Verificar usuario en BD (rol = cliente) ────────────────────────────
    const { data: usuario, error: userError } = await supabaseAdmin
      .from("usuarios")
      .select("id, rol")
      .eq("id", userId)
      .single();

    if (userError || !usuario) {
      console.error("[MP] ❌ crear-preferencia — usuario no encontrado:", userId);
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (usuario.rol !== "cliente") {
      console.error("[MP] ❌ crear-preferencia — rol incorrecto:", usuario.rol, "user:", userId);
      return NextResponse.json({ error: "Prohibido" }, { status: 403 });
    }

    // ── 3. Leer solo carga_id del body (monto y descripcion los ignoramos) ────
    const body = await req.json();
    const { carga_id } = body;

    if (!carga_id) {
      console.error("[MP] ❌ crear-preferencia — falta carga_id");
      return NextResponse.json({ error: "Falta carga_id" }, { status: 400 });
    }

    // ── 4. Buscar la carga en BD y validar propiedad + estado ─────────────────
    const { data: carga, error: cargaError } = await supabaseAdmin
      .from("cargas")
      .select("id, cliente_id, pago_estado, precio_cliente, tipo_vehiculo, origen, destino")
      .eq("id", Number(carga_id))
      .single();

    if (cargaError || !carga) {
      console.error("[MP] ❌ crear-preferencia — carga no encontrada:", carga_id);
      return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
    }

    // Validar que la carga pertenece al cliente que hace el request
    if (String(carga.cliente_id) !== String(userId)) {
      console.error("[MP] ❌ crear-preferencia — carga", carga_id, "no pertenece a usuario", userId);
      return NextResponse.json({ error: "Prohibido" }, { status: 403 });
    }

    // Validar que la carga aún no fue pagada
    if (carga.pago_estado === "pagado") {
      console.warn("[MP] ⚠️  crear-preferencia — carga ya pagada:", carga_id);
      return NextResponse.json({ error: "Esta carga ya fue pagada" }, { status: 409 });
    }
    if (carga.pago_estado !== "pendiente_pago") {
      console.warn("[MP] ⚠️  crear-preferencia — estado inesperado:", carga.pago_estado, "carga:", carga_id);
      return NextResponse.json(
        { error: `La carga no está disponible para pago (estado: ${carga.pago_estado})` },
        { status: 409 }
      );
    }

    // ── 5. Tomar monto y descripción desde BD (nunca del frontend) ────────────
    const montoServidor = Number(carga.precio_cliente);
    if (!montoServidor || montoServidor <= 0) {
      console.error("[MP] ❌ crear-preferencia — precio_cliente inválido en BD:", montoServidor, "carga:", carga_id);
      return NextResponse.json({ error: "Error interno: precio no disponible" }, { status: 500 });
    }
    const descripcionServidor = `TILA Logística — ${carga.tipo_vehiculo ?? "Viaje"} #${carga_id}`;

    console.log("[MP] crear-preferencia — user:", userId, "| carga:", carga_id, "| monto BD:", montoServidor);

    // ── 6. Verificar token MP ─────────────────────────────────────────────────
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken || accessToken === "REEMPLAZAR_CON_TU_TOKEN") {
      console.error("[MP] ❌ MERCADOPAGO_ACCESS_TOKEN no configurado");
      return NextResponse.json({ error: "MercadoPago no configurado en el servidor" }, { status: 500 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://tila-logistica.vercel.app";

    // ── 7. Crear preferencia en MercadoPago ──────────────────────────────────
    const client = new MercadoPagoConfig({ accessToken });
    const prefApi = new Preference(client);

    let result: any;
    try {
      result = await prefApi.create({
        body: {
          items: [
            {
              id: String(carga_id),
              title: descripcionServidor,
              quantity: 1,
              unit_price: montoServidor,
              currency_id: "ARS",
            },
          ],
          back_urls: {
            success: `${baseUrl}/panel-cliente?pago=ok`,
            failure: `${baseUrl}/panel-cliente?pago=error`,
            pending: `${baseUrl}/panel-cliente?pago=pendiente`,
          },
          auto_return: "approved",
          notification_url: `${baseUrl}/api/mercadopago/webhook`,
          external_reference: String(carga_id),
          statement_descriptor: "TILA Logistica",
        },
      });
      console.log("[MP] ✅ Preferencia creada — id:", result.id, "| carga:", carga_id, "| monto:", montoServidor);
    } catch (mpError: any) {
      console.error("[MP] ❌ Error en prefApi.create:", mpError?.message ?? mpError);
      throw mpError;
    }

    // ── 8. Guardar preference_id en Supabase (monto siempre desde BD) ─────────
    const { error: dbError } = await supabaseAdmin
      .from("cargas")
      .update({
        mp_preference_id: result.id,
        mp_monto: montoServidor,
      })
      .eq("id", Number(carga_id));

    if (dbError) {
      console.error("[MP] ⚠️  Error guardando preference_id (no fatal):", dbError.message);
    } else {
      console.log("[MP] ✅ preference_id guardado — carga:", carga_id);
    }

    return NextResponse.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (error: any) {
    console.error("[MP] ❌ crear-preferencia — error general:", error?.message ?? String(error));
    return NextResponse.json(
      { error: "Error creando preferencia MP" },
      { status: 500 }
    );
  }
}
