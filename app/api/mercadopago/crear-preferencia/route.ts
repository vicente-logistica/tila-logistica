import { NextResponse } from "next/server";
import { MercadoPagoConfig, Preference } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cliente con service role para escribir sin restricciones de RLS.
// Si SUPABASE_SERVICE_ROLE_KEY no está configurada, cae a anon key.
const supabaseAdmin = createClient(
  "https://imbtepvdscdtpxkleihi.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_publishable_rpOk0QmsJhg-QsngXIE91w_bqHzl7hQ"
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { carga_id, monto, descripcion } = body;

    if (!carga_id || !monto || !descripcion) {
      return NextResponse.json(
        { error: "Faltan parámetros: carga_id, monto, descripcion" },
        { status: 400 }
      );
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken || accessToken === "REEMPLAZAR_CON_TU_TOKEN") {
      console.error("[MP] MERCADOPAGO_ACCESS_TOKEN no configurado");
      return NextResponse.json(
        { error: "MercadoPago no configurado en el servidor" },
        { status: 500 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? "https://tila-logistica.vercel.app";

    const client = new MercadoPagoConfig({ accessToken });
    const prefApi = new Preference(client);

    const result = await prefApi.create({
      body: {
        items: [
          {
            id: String(carga_id),
            title: descripcion,
            quantity: 1,
            unit_price: Number(monto),
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

    console.log("[MP] preferencia creada:", result.id, "carga:", carga_id);

    // Guardar preference_id y monto en la carga
    const { error: dbError } = await supabaseAdmin
      .from("cargas")
      .update({
        mp_preference_id: result.id,
        mp_monto: Number(monto),
      })
      .eq("id", Number(carga_id));

    if (dbError) {
      console.error("[MP] error guardando preference_id en carga:", dbError);
      // No fallar — la preferencia se creó, el webhook puede funcionar igual
    }

    return NextResponse.json({
      preference_id: result.id,
      init_point: result.init_point, // URL producción
      sandbox_init_point: result.sandbox_init_point, // URL sandbox
    });
  } catch (error: any) {
    console.error("[MP] crear-preferencia error:", error);
    return NextResponse.json(
      { error: "Error creando preferencia MP", detalle: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
