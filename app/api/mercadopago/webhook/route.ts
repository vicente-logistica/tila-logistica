import { NextResponse } from "next/server";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  "https://imbtepvdscdtpxkleihi.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_publishable_rpOk0QmsJhg-QsngXIE91w_bqHzl7hQ"
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("[MP-WEBHOOK] recibido:", JSON.stringify(body));

    // MP envía type:"payment" con data.id para notificaciones de pago
    if (body.type !== "payment" || !body.data?.id) {
      return NextResponse.json({ ok: true }); // ignorar otros eventos (merchant_order, etc.)
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken || accessToken === "REEMPLAZAR_CON_TU_TOKEN") {
      console.error("[MP-WEBHOOK] MERCADOPAGO_ACCESS_TOKEN no configurado");
      return NextResponse.json({ error: "MP no configurado" }, { status: 500 });
    }

    const client = new MercadoPagoConfig({ accessToken });
    const paymentApi = new Payment(client);

    // Consultar el pago real en MP (nunca confiar solo en el body del webhook)
    const paymentData = await paymentApi.get({ id: String(body.data.id) });

    console.log(
      "[MP-WEBHOOK] payment id:", paymentData.id,
      "status:", paymentData.status,
      "external_reference:", paymentData.external_reference
    );

    if (!paymentData.external_reference) {
      console.warn("[MP-WEBHOOK] sin external_reference — ignorando");
      return NextResponse.json({ ok: true });
    }

    const cargaId = Number(paymentData.external_reference);
    if (isNaN(cargaId) || cargaId <= 0) {
      console.warn("[MP-WEBHOOK] external_reference inválido:", paymentData.external_reference);
      return NextResponse.json({ ok: true });
    }

    // Idempotencia: no procesar el mismo payment_id dos veces
    const { data: cargaActual } = await supabaseAdmin
      .from("cargas")
      .select("id, mp_payment_id, pago_estado")
      .eq("id", cargaId)
      .single();

    if (cargaActual?.mp_payment_id === String(paymentData.id)) {
      console.log("[MP-WEBHOOK] payment_id ya procesado — skip idempotente");
      return NextResponse.json({ ok: true });
    }

    if (paymentData.status === "approved") {
      // ✅ Pago aprobado: hacer visible la carga para choferes
      const { error } = await supabaseAdmin
        .from("cargas")
        .update({
          estado: "pendiente",
          pagado_cliente: true,
          mp_status: "approved",
          mp_payment_id: String(paymentData.id),
          pago_estado: "pagado",
        })
        .eq("id", cargaId);

      if (error) {
        console.error("[MP-WEBHOOK] error actualizando carga:", error);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }

      console.log("[MP-WEBHOOK] ✅ carga aprobada y publicada:", cargaId);
    } else {
      // pending, rejected, in_process — actualizar estado MP sin publicar la carga
      const nuevoEstadoPago =
        paymentData.status === "pending" || paymentData.status === "in_process"
          ? "pendiente_proceso"
          : "rechazado";

      await supabaseAdmin
        .from("cargas")
        .update({
          mp_status: paymentData.status ?? "unknown",
          mp_payment_id: String(paymentData.id),
          pago_estado: nuevoEstadoPago,
        })
        .eq("id", cargaId);

      console.log("[MP-WEBHOOK] pago no aprobado:", paymentData.status, "carga:", cargaId);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[MP-WEBHOOK] error:", error);
    // Devolver 200 igual — si devolvemos 5xx MP reintenta indefinidamente
    return NextResponse.json(
      { ok: false, detalle: error?.message ?? String(error) },
      { status: 200 }
    );
  }
}

// MP hace GET al endpoint para verificar que está activo
export async function GET() {
  return NextResponse.json({ ok: true, service: "TILA MercadoPago webhook" });
}
