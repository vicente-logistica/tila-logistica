import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolverUsuario } from "../../../../lib/auth/sesion";
import { procesarGetComisiones, procesarPutComisiones } from "../../../../lib/adminComisiones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (admin/configuracion/comisiones)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (admin/configuracion/comisiones)");

const supabaseAdmin = createClient(_url, _roleKey);

/**
 * Comisiones vigentes de TILA (Panel Admin → Comisiones).
 *  GET → valores actuales en puntos básicos.
 *  PUT { comision_cliente_bp, comision_chofer_bp } → guarda los nuevos valores.
 * Ambos exigen rol admin verificado en la base (ver app/lib/adminComisiones.ts). Los
 * cambios sólo afectan cargas publicadas DESPUÉS: las existentes conservan sus montos.
 */
export async function GET(req: Request) {
  const r = await procesarGetComisiones(supabaseAdmin, resolverUsuario(req).userId);
  return NextResponse.json(r.body, { status: r.status });
}

export async function PUT(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }); }
  const r = await procesarPutComisiones(supabaseAdmin, resolverUsuario(req).userId, body);
  return NextResponse.json(r.body, { status: r.status });
}
