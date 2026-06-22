import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/republicar)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/republicar)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function POST(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });

  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios").select("id, rol").eq("id", userId).single();
  if (userError || !usuario)
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  if (usuario.rol !== "cliente")
    return NextResponse.json({ error: "Prohibido: solo clientes pueden republicar" }, { status: 403 });

  let carga_id: unknown;
  try { ({ carga_id } = await req.json()); } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }
  if (!carga_id) return NextResponse.json({ error: "Falta carga_id" }, { status: 400 });

  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas").select("id, estado, cliente_id").eq("id", carga_id).single();
  if (cargaError || !carga)
    return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });

  if (String(carga.cliente_id) !== String(userId))
    return NextResponse.json({ error: "Prohibido: este viaje no te pertenece" }, { status: 403 });

  if (carga.estado !== "Cancelado por chofer")
    return NextResponse.json(
      { error: `Solo se pueden republicar viajes en estado "Cancelado por chofer". Estado actual: "${carga.estado}"` },
      { status: 422 },
    );

  const { error: updateError } = await supabaseAdmin
    .from("cargas")
    .update({ estado: "pendiente" })
    .eq("id", carga_id);

  if (updateError) {
    console.error("[cargas/republicar] error UPDATE:", updateError.message);
    return NextResponse.json({ error: "Error al republicar el viaje" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
