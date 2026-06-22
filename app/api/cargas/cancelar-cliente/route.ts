import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (cargas/cancelar-cliente)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (cargas/cancelar-cliente)");

const supabaseAdmin = createClient(_url, _roleKey);

const ESTADOS_CANCELABLES = ["pendiente", "Chofer asignado"];

export async function POST(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "No autorizado: falta x-user-id" }, { status: 401 });

  const { data: usuario, error: userError } = await supabaseAdmin
    .from("usuarios").select("id, rol").eq("id", userId).single();
  if (userError || !usuario)
    return NextResponse.json({ error: "No autorizado: usuario no encontrado" }, { status: 401 });
  if (usuario.rol !== "cliente")
    return NextResponse.json({ error: "Prohibido: solo clientes pueden cancelar por esta ruta" }, { status: 403 });

  let carga_id: unknown;
  try { ({ carga_id } = await req.json()); } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }
  if (!carga_id) return NextResponse.json({ error: "Falta carga_id" }, { status: 400 });

  const { data: carga, error: cargaError } = await supabaseAdmin
    .from("cargas").select("id, estado, cliente_id, pago_estado").eq("id", carga_id).single();
  if (cargaError || !carga)
    return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });

  if (String(carga.cliente_id) !== String(userId))
    return NextResponse.json({ error: "Prohibido: este viaje no te pertenece" }, { status: 403 });

  if (!ESTADOS_CANCELABLES.includes(carga.estado))
    return NextResponse.json(
      { error: `No se puede cancelar en estado "${carga.estado}".` },
      { status: 422 },
    );

  const upd: Record<string, unknown> = {
    estado:   "Cancelado por cliente",
    tracking: false,
  };
  if (carga.pago_estado === "pagado") {
    upd.pago_estado = "requiere_revision";
  }

  const { error: updateError } = await supabaseAdmin
    .from("cargas").update(upd).eq("id", carga_id);

  if (updateError) {
    console.error("[cancelar-cliente] error UPDATE:", updateError.message);
    return NextResponse.json({ error: "Error al cancelar el viaje" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
