import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const _anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

if (!_url)     throw new Error("Falta SUPABASE_URL (chofer/documentacion)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (chofer/documentacion)");

const supabaseAdmin = createClient(_url, _roleKey);

const TIPOS_PERMITIDOS = [
  "dni_frente",
  "dni_dorso",
  "licencia",
  "antecedentes_penales",
  "antecedentes_codigo",
  "cedula_verde",
  "seguro",
  "vtv_rto",
  "foto_frente",
  "foto_lateral_izquierda",
  "foto_lateral_derecha",
  "foto_trasera",
] as const;

const BUCKETS_PERMITIDOS = ["documentacion-choferes", "vehiculos"];

function urlPertenecaAlChofer(url: string, choferId: string): boolean {
  // La URL pública de Storage tiene el formato:
  // https://{project}.supabase.co/storage/v1/object/public/{bucket}/{choferId}/...
  // Verificamos que el dominio sea del proyecto Supabase configurado
  // y que el path contenga el choferId como primer segmento después del bucket.
  try {
    const parsed = new URL(url);
    const expectedHost = new URL(_anonUrl).host;
    if (parsed.host !== expectedHost) return false;

    // El path tiene la forma: /storage/v1/object/public/{bucket}/{choferId}/...
    const segments = parsed.pathname.split("/");
    // segments: ["", "storage", "v1", "object", "public", bucket, choferId, ...]
    const bucketIdx = segments.indexOf("public") + 1;
    const bucket = segments[bucketIdx];
    const ownerSegment = segments[bucketIdx + 1];

    if (!BUCKETS_PERMITIDOS.includes(bucket)) return false;
    if (ownerSegment !== choferId) return false;

    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  // ── 1. Verificar caller ────────────────────────────────────────────────────
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabaseAdmin
    .from("usuarios")
    .select("id, rol")
    .eq("id", userId)
    .maybeSingle();

  if (!usuario || usuario.rol !== "chofer") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // ── 2. Leer body ───────────────────────────────────────────────────────────
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { tipo, url } = body ?? {};

  if (!tipo || !TIPOS_PERMITIDOS.includes(tipo)) {
    return NextResponse.json(
      { error: `Tipo inválido. Permitidos: ${TIPOS_PERMITIDOS.join(", ")}` },
      { status: 400 }
    );
  }

  // ── 3. Validar url según tipo ──────────────────────────────────────────────
  if (tipo === "antecedentes_codigo") {
    // Es un código string, no una URL de Storage
    if (typeof url !== "string") {
      return NextResponse.json({ error: "Código de antecedentes inválido" }, { status: 400 });
    }
  } else {
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL requerida" }, { status: 400 });
    }
    if (!urlPertenecaAlChofer(url, userId)) {
      return NextResponse.json(
        { error: "La URL no pertenece al storage del chofer autenticado" },
        { status: 403 }
      );
    }
  }

  // ── 4. UPSERT — chofer_id siempre del header, nunca del body ──────────────
  const { error } = await supabaseAdmin
    .from("documentacion_chofer")
    .upsert(
      [{ chofer_id: userId, tipo, url: url ?? null }],
      { onConflict: "chofer_id,tipo" }
    );

  if (error) {
    console.error("[chofer/documentacion] ❌ error UPSERT:", error.message);
    return NextResponse.json({ error: "Error al guardar documentación" }, { status: 500 });
  }

  console.log("[chofer/documentacion] ✅ tipo:", tipo, "| chofer:", userId);
  return NextResponse.json({ ok: true });
}
