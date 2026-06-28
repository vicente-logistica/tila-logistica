import { NextResponse } from "next/server";
import { MercadoPagoConfig, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _webhookSupabaseUrl     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _webhookServiceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_webhookSupabaseUrl)    throw new Error("Falta SUPABASE_URL en variables de entorno (webhook)");
if (!_webhookServiceRoleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (webhook)");

const supabaseAdmin = createClient(_webhookSupabaseUrl, _webhookServiceRoleKey);


export async function POST(req: Request) {
  // Leer body como texto primero para poder verificar firma antes de parsear
  const rawBody = await req.text();
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("[MP-WEBHOOK] ❌ Body no es JSON válido");
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  console.log("[MP-WEBHOOK] recibido — type:", body?.type, "| data.id:", body?.data?.id);

  try {
    // MP envía type:"payment" con data.id para notificaciones de pago
    if (body.type !== "payment" || !body.data?.id) {
      // Ignorar otros eventos (merchant_order, etc.)
      return NextResponse.json({ ok: true });
    }

    // ── 1. Verificar firma x-signature ───────────────────────────────────────
    // data.id viene del query string (no del body) — es el valor que MP firma.
    const dataId = new URL(req.url).searchParams.get("data.id") ?? String(body.data.id);
    const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!webhookSecret) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[MP-WEBHOOK] ⚠️  MERCADOPAGO_WEBHOOK_SECRET no configurado — firma omitida en desarrollo");
      } else {
        console.error("[MP-WEBHOOK] ❌ MERCADOPAGO_WEBHOOK_SECRET no configurado en producción — request rechazado");
        return NextResponse.json({ ok: false }, { status: 401 });
      }
    } else {
      try {
        WebhookSignatureValidator.validate({
          xSignature: req.headers.get("x-signature") ?? undefined,
          xRequestId: req.headers.get("x-request-id") ?? undefined,
          dataId,
          secret: webhookSecret,
        });
      } catch (e) {
        if (e instanceof InvalidWebhookSignatureError) {
          console.error("[MP-WEBHOOK] ❌ Firma inválida:", e.reason, "| request-id:", e.requestId);
          return NextResponse.json({ ok: false }, { status: 401 });
        }
        throw e;
      }
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken || accessToken === "REEMPLAZAR_CON_TU_TOKEN") {
      console.error("[MP-WEBHOOK] ❌ MERCADOPAGO_ACCESS_TOKEN no configurado");
      return NextResponse.json({ error: "MP no configurado" }, { status: 500 });
    }

    const client = new MercadoPagoConfig({ accessToken });
    const paymentApi = new Payment(client);

    // ── 2. Consultar el pago real en MP (nunca confiar en el body del webhook) ─
    const paymentData = await paymentApi.get({ id: String(body.data.id) });

    console.log(
      "[MP-WEBHOOK] payment id:", paymentData.id,
      "| status:", paymentData.status,
      "| external_reference:", paymentData.external_reference
    );

    if (!paymentData.external_reference) {
      console.warn("[MP-WEBHOOK] ⚠️  sin external_reference — ignorando");
      return NextResponse.json({ ok: true });
    }

    const cargaId = Number(paymentData.external_reference);
    if (isNaN(cargaId) || cargaId <= 0) {
      console.warn("[MP-WEBHOOK] ⚠️  external_reference inválido:", paymentData.external_reference);
      return NextResponse.json({ ok: true });
    }

    // ── 3. Buscar carga y aplicar doble idempotencia ──────────────────────────
    const { data: cargaActual, error: cargaError } = await supabaseAdmin
      .from("cargas")
      .select("id, mp_payment_id, pago_estado")
      .eq("id", cargaId)
      .single();

    if (cargaError || !cargaActual) {
      console.error("[MP-WEBHOOK] ❌ carga no encontrada en BD:", cargaId);
      // Devolver 200 para que MP no reintente indefinidamente
      return NextResponse.json({ ok: true });
    }

    // Idempotencia 1: mismo payment_id ya procesado
    if (cargaActual.mp_payment_id === String(paymentData.id)) {
      console.log("[MP-WEBHOOK] ✅ payment_id ya procesado — skip idempotente:", paymentData.id);
      return NextResponse.json({ ok: true });
    }

    // Idempotencia 2: carga ya en estado pagado (protección contra webhooks duplicados)
    if (cargaActual.pago_estado === "pagado") {
      console.log("[MP-WEBHOOK] ✅ carga ya marcada como pagada — skip:", cargaId);
      return NextResponse.json({ ok: true });
    }

    // ── 4. Procesar según status del pago ─────────────────────────────────────
    if (paymentData.status === "approved") {
      const { error } = await supabaseAdmin
        .from("cargas")
        .update({
          estado:          "pendiente",
          pagado_cliente:  true,
          mp_status:       "approved",
          mp_payment_id:   String(paymentData.id),
          pago_estado:     "pagado",
        })
        .eq("id", cargaId);

      if (error) {
        console.error("[MP-WEBHOOK] ❌ error actualizando carga:", error.message);
        // Devolver 500 para que MP reintente (la carga aún no está pagada)
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }

      console.log("[MP-WEBHOOK] ✅ carga aprobada y publicada para choferes — carga:", cargaId, "| payment:", paymentData.id);
    } else {
      const nuevoEstadoPago =
        paymentData.status === "pending" || paymentData.status === "in_process"
          ? "pendiente_proceso"
          : "rechazado";

      await supabaseAdmin
        .from("cargas")
        .update({
          mp_status:     paymentData.status ?? "unknown",
          mp_payment_id: String(paymentData.id),
          pago_estado:   nuevoEstadoPago,
        })
        .eq("id", cargaId);

      console.log("[MP-WEBHOOK] pago no aprobado:", paymentData.status, "| carga:", cargaId, "| nuevo pago_estado:", nuevoEstadoPago);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[MP-WEBHOOK] ❌ error general:", error?.message ?? String(error));
    // Devolver 200 para que MP no reintente si el error es interno nuestro
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

// MP hace GET al endpoint para verificar que está activo
export async function GET() {
  return NextResponse.json({ ok: true, service: "TILA MercadoPago webhook" });
}
