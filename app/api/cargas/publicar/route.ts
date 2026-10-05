import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { obtenerRutaPublicacion } from "../../../lib/geo/rutaPublicacion";
import { procesarPublicacion, BODY_JSON_INVALIDO } from "../../../lib/publicarCargaServidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/publicar)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/publicar)");

const supabaseAdmin = createClient(_url, _roleKey);

/**
 * POST /api/cargas/publicar — crea la carga (y sus paradas) con km, tarifa y geografía
 * calculados en el servidor. Toda la lógica vive en app/lib/publicarCargaServidor.ts.
 */
export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_SERVER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta GOOGLE_SERVER_API_KEY en variables de entorno" }, { status: 500 });
  }

  // JSON inválido se informa DESPUÉS de verificar el usuario (mismo orden que antes).
  let body: unknown = BODY_JSON_INVALIDO;
  try {
    body = await req.json();
  } catch { /* queda BODY_JSON_INVALIDO */ }

  const r = await procesarPublicacion(
    { db: supabaseAdmin, obtenerRuta: (direcciones) => obtenerRutaPublicacion(direcciones, apiKey) },
    req.headers.get("x-user-id"),
    body,
  );
  return NextResponse.json(r.body, { status: r.status });
}
