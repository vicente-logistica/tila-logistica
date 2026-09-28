import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolverUsuario } from "../../../lib/auth/sesion";
import { leerConfiguracionComisiones } from "../../../lib/configuracionComisiones";
import { cotizarCarga, camposEconomicosCarga, TIPOS_VEHICULO_VALIDOS } from "../../../lib/cotizacion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (tarifas/cotizar)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (tarifas/cotizar)");

const supabaseAdmin = createClient(_url, _roleKey);

/**
 * Vista previa del precio para app/publicar — SOLO LECTURA, no escribe nada. Usa la MISMA
 * configuración de comisiones (leerConfiguracionComisiones) y la MISMA función
 * (cotizarCarga) que /api/cargas/publicar, así el cliente ve exactamente lo que después
 * se guarda. Devuelve los mismos campos económicos que se congelan en `cargas`.
 */
export async function POST(req: Request) {
  const userId = resolverUsuario(req).userId;
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios").select("id, rol").eq("id", userId).single();
  if (userError || !usuario) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (usuario.rol !== "cliente") return NextResponse.json({ error: "Prohibido" }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }); }
  const { km_estimados, tipo_vehiculo, tipo_carga, paradas_intermedias } = body ?? {};

  // Mismas validaciones que /api/cargas/publicar para estos campos.
  if (!tipo_vehiculo || typeof tipo_vehiculo !== "string" || !TIPOS_VEHICULO_VALIDOS.includes(tipo_vehiculo)) {
    return NextResponse.json({ error: "tipo_vehiculo inválido" }, { status: 400 });
  }
  if (!tipo_carga || typeof tipo_carga !== "string") {
    return NextResponse.json({ error: "Campo obligatorio: tipo_carga" }, { status: 400 });
  }
  const kmNum = Number(km_estimados);
  if (!kmNum || kmNum <= 0) {
    return NextResponse.json({ error: "km_estimados debe ser un número positivo" }, { status: 400 });
  }

  const comisiones = await leerConfiguracionComisiones(supabaseAdmin);
  const tarifa = cotizarCarga(
    { kmEstimados: kmNum, tipoVehiculo: tipo_vehiculo, tipoCarga: tipo_carga, paradasIntermedias: paradas_intermedias },
    comisiones,
  );
  return NextResponse.json({ ok: true, cotizacion: camposEconomicosCarga(tarifa) });
}
