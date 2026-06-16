import { NextResponse } from "next/server";
import { MercadoPagoConfig, Preference } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cliente con service role para escribir sin restricciones de RLS.
const _prefSupabaseUrl    = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _prefServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_prefSupabaseUrl)    throw new Error("Falta SUPABASE_URL en variables de entorno (crear-preferencia)");
if (!_prefServiceRoleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (crear-preferencia)");

const supabaseAdmin = createClient(_prefSupabaseUrl, _prefServiceRoleKey);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { carga_id, monto, descripcion } = body;

    console.log("[MP] crear-preferencia — body recibido:", { carga_id, monto, descripcion });

    // ── 1. Validar parámetros ────────────────────────────────────────────────
    if (!carga_id || !monto || !descripcion) {
      console.error("[MP] ❌ Faltan parámetros:", { carga_id, monto, descripcion });
      return NextResponse.json(
        { error: "Faltan parámetros: carga_id, monto, descripcion" },
        { status: 400 }
      );
    }

    // ── 2. Verificar token MP ────────────────────────────────────────────────
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken || accessToken === "REEMPLAZAR_CON_TU_TOKEN") {
      console.error("[MP] ❌ MERCADOPAGO_ACCESS_TOKEN no configurado o es placeholder");
      return NextResponse.json(
        { error: "MercadoPago no configurado en el servidor" },
        { status: 500 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? "https://tila-logistica.vercel.app";
    console.log("[MP] baseUrl:", baseUrl);

    // ── 4. Crear preferencia en MercadoPago ──────────────────────────────────
    const client = new MercadoPagoConfig({ accessToken });
    const prefApi = new Preference(client);

    let result: any;
    try {
      result = await prefApi.create({
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
      console.log("[MP] ✅ Preferencia creada — id:", result.id, "| init_point:", result.init_point?.slice(0, 60));
    } catch (mpError: any) {
      console.error("[MP] ❌ Error al llamar a MP prefApi.create:", mpError?.message ?? mpError);
      console.error("[MP] MP error detalle completo:", JSON.stringify(mpError, null, 2));
      throw mpError; // propagar para el catch exterior
    }

    // ── 5. Guardar preference_id en Supabase ─────────────────────────────────
    const { error: dbError } = await supabaseAdmin
      .from("cargas")
      .update({
        mp_preference_id: result.id,
        mp_monto: Number(monto),
      })
      .eq("id", Number(carga_id));

    if (dbError) {
      console.error("[MP] ⚠️  Error guardando preference_id en carga (no fatal):", dbError.message, "| code:", dbError.code);
    } else {
      console.log("[MP] ✅ preference_id guardado en carga:", carga_id);
    }

    return NextResponse.json({
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
    });
  } catch (error: any) {
    console.error("[MP] ❌ crear-preferencia — error general:", error?.message ?? String(error));
    console.error("[MP] stack:", error?.stack);
    return NextResponse.json(
      { error: "Error creando preferencia MP", detalle: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
