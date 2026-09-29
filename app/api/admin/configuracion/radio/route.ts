import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { identidadAdminComisiones, rechazoSinSesion } from "../../../../lib/adminComisiones";
import { procesarGetRadio, procesarPutRadio } from "../../../../lib/adminRadio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (admin/configuracion/radio)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (admin/configuracion/radio)");

const supabaseAdmin = createClient(_url, _roleKey);

/**
 * Radio de matching global (Panel Admin → Configuración).
 *  GET → { radio_matching_km, fuente }
 *  PUT { radio_matching_km } → entero ≥ 1.
 * Misma autenticación estricta que /api/admin/configuracion/comisiones: sesión firmada
 * (x-user-id se ignora), control de origen y rol admin verificado en la base.
 * Afecta nuevas ofertas y nuevas aceptaciones; nunca viajes ya aceptados.
 */
export async function GET(req: Request) {
  const auth = identidadAdminComisiones(req);
  if (!auth.userId) { const r = rechazoSinSesion(auth.motivo); return NextResponse.json(r.body, { status: r.status }); }
  const r = await procesarGetRadio(supabaseAdmin, auth.userId);
  return NextResponse.json(r.body, { status: r.status });
}

export async function PUT(req: Request) {
  const auth = identidadAdminComisiones(req);
  if (!auth.userId) { const r = rechazoSinSesion(auth.motivo); return NextResponse.json(r.body, { status: r.status }); }
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }); }
  const r = await procesarPutRadio(supabaseAdmin, auth.userId, body);
  return NextResponse.json(r.body, { status: r.status });
}
