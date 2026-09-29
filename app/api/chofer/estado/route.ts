import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolverUsuario } from "../../../lib/auth/sesion";
import { procesarPatchEstadoChofer } from "../../../lib/estadoChofer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (chofer/estado)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (chofer/estado)");

const supabaseAdmin = createClient(_url, _roleKey);

/**
 * PATCH { online?, navegador_preferido?, bateria_nivel?, bateria_cargando?, senal? }
 * Estado propio del chofer — reemplaza los UPDATE directos a `usuarios` que panel-chofer y
 * viaje-activo hacían con la clave anon. Lista blanca de columnas y siempre sobre la fila
 * del propio usuario (ver app/lib/estadoChofer.ts).
 */
export async function PATCH(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }); }
  const r = await procesarPatchEstadoChofer(supabaseAdmin, resolverUsuario(req).userId, body);
  return NextResponse.json(r.body, { status: r.status });
}
