import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { registrarConsentimiento } from "../../../lib/consentimiento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (registro-chofer-usuario)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (registro-chofer-usuario)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }

    const {
      nombre, email, password, telefono,
      dni, cuit_cuil, licencia, cnrt_ruta,
      patente, tipo_vehiculo, tipo_carroceria,
      categoria_legal, zona_operativa, capacidad_carga,
      seguro_carga, metodo_cobro, alias_cbu_cvu,
      titular_cuenta, banco_billetera,
      acepta_terminos,
      acepta_contrato,
      // fecha_aceptacion_terminos ignorada intencionalmente — se fuerza server-side
    } = body ?? {};

    // ── 1. Validar campos mínimos ─────────────────────────────────────────────
    if (!nombre?.trim())   return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    if (!email?.trim())    return NextResponse.json({ error: "El email es obligatorio" }, { status: 400 });
    if (!telefono?.trim()) return NextResponse.json({ error: "El teléfono es obligatorio" }, { status: 400 });
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
    }
    if (acepta_terminos !== true) {
      return NextResponse.json({ error: "Debés aceptar los Términos y Condiciones y la Política de Privacidad" }, { status: 400 });
    }
    if (acepta_contrato !== true) {
      return NextResponse.json({ error: "Debés aceptar el Contrato de Transportista Independiente" }, { status: 400 });
    }

    const emailNorm = email.trim().toLowerCase();

    // ── 2. Verificar email duplicado ──────────────────────────────────────────
    const { data: existente } = await supabaseAdmin
      .from("usuarios")
      .select("id")
      .eq("email", emailNorm)
      .maybeSingle();

    if (existente) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese email" }, { status: 409 });
    }

    // ── 3. Hashear contraseña ─────────────────────────────────────────────────
    const hash = await bcrypt.hash(password, 10);

    // Fecha forzada server-side — ignoramos cualquier valor que venga del frontend
    const fechaAceptacion = new Date().toISOString();

    // ── 4. INSERT server-side — rol siempre "chofer", password hasheada ───────
    const { data: nuevoUsuario, error: insertError } = await supabaseAdmin
      .from("usuarios")
      .insert([{
        nombre:                    nombre.trim(),
        email:                     emailNorm,
        password:                  hash,
        telefono:                  telefono?.trim() ?? null,
        rol:                       "chofer",
        acepta_terminos:           true,
        fecha_aceptacion_terminos: fechaAceptacion,
        dni:                       dni ?? null,
        cuit_cuil:                 cuit_cuil ?? null,
        licencia:                  licencia ?? null,
        cnrt_ruta:                 cnrt_ruta ?? null,
        patente:                   patente?.trim().toUpperCase() ?? null,
        vehiculo:                  tipo_vehiculo ?? null,
        tipo_vehiculo:             tipo_vehiculo ?? null,
        tipo_carroceria:           tipo_carroceria ?? null,
        categoria_legal:           categoria_legal ?? null,
        zona_operativa:            zona_operativa ?? null,
        capacidad_carga:           capacidad_carga ?? null,
        seguro_carga:              seguro_carga ?? null,
        metodo_cobro:              metodo_cobro ?? null,
        alias_cbu_cvu:             alias_cbu_cvu ?? null,
        titular_cuenta:            titular_cuenta ?? null,
        banco_billetera:           banco_billetera ?? null,
        estado_validacion:         "pendiente",
        estado_aprobacion:         "pendiente",
        estado_doc:                "pendiente_actualizacion",
      }])
      .select("id, nombre, email, rol")
      .single();

    if (insertError || !nuevoUsuario) {
      console.error("[registro-chofer-usuario] ❌ error INSERT:", insertError?.message);
      return NextResponse.json({ error: "Error al crear la cuenta de chofer" }, { status: 500 });
    }

    console.log("[registro-chofer-usuario] ✅ nuevo chofer creado — id:", nuevoUsuario.id, "| email:", emailNorm);

    // ── 5. Registrar consentimientos legales auditables (tres documentos) ─────
    const errorConsent = await registrarConsentimiento({
      supabaseAdmin,
      usuarioId: String(nuevoUsuario.id),
      documentos: ["terminos", "privacidad", "contrato_transportista"],
      req,
    });

    if (errorConsent) {
      console.error("[registro-chofer-usuario] ❌ chofer creado pero consentimiento falló:", errorConsent);
      return NextResponse.json(
        { error: "Cuenta creada pero no se pudo registrar el consentimiento legal. Contactá al soporte." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, usuario: nuevoUsuario }, { status: 201 });

  } catch (error: any) {
    console.error("[registro-chofer-usuario] ❌ error general:", error?.message ?? String(error));
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
