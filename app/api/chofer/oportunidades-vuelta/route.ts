import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolverUsuario } from "../../../lib/auth/sesion";
import { geocodificarParaPrefiltro } from "../../../lib/geo/calculoDistanciaCarga";
import { obtenerCorredorRuta } from "../../../lib/geo/corredorRuta";
import { procesarOportunidadesVuelta } from "../../../lib/vueltaACasaServidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL (chofer/oportunidades-vuelta)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (chofer/oportunidades-vuelta)");

const supabaseAdmin = createClient(_url, _roleKey);

/**
 * GET /api/chofer/oportunidades-vuelta?carga_id=…&lat=…&lng=… — "Vuelta a Casa".
 * SÓLO LECTURA: recomienda cargas pendientes C → D sobre el corredor de regreso B → A (ruta
 * real) que acercan al chofer a casa. No acepta, no reserva, no asigna, no cambia estados.
 * Se activa sólo cuando faltan ≤ vuelta_casa_inicio_km hasta B y si está habilitada.
 */
export async function GET(req: Request) {
  const apiKey = process.env.GOOGLE_SERVER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Servicio de mapas no configurado" }, { status: 503 });
  try {
    const q = new URL(req.url).searchParams;
    const num = (v: string | null) => (v === null || v.trim() === "" ? undefined : Number(v));
    const r = await procesarOportunidadesVuelta(
      {
        db: supabaseAdmin,
        geocodificar: (dir) => geocodificarParaPrefiltro(dir, apiKey),
        obtenerCorredor: (dirB, dirA) => obtenerCorredorRuta(dirB, dirA, apiKey),
      },
      resolverUsuario(req).userId,
      { cargaId: q.get("carga_id"), lat: num(q.get("lat")), lng: num(q.get("lng")) },
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("[oportunidades-vuelta] error:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "No se pudieron calcular oportunidades" }, { status: 500 });
  }
}
