import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { registrarConsentimiento } from "../../../lib/consentimiento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (registro-cliente)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (registro-cliente)");

const supabaseAdmin = createClient(_url, _roleKey);

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }

    const { nombre, email, password, telefono, acepta_terminos } = body ?? {};

    // ── 1. Validar campos obligatorios ────────────────────────────────────────
    if (!nombre || typeof nombre !== "string" || !nombre.trim()) {
      return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }
    if (!email || typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "El email es obligatorio" }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
    }
    if (acepta_terminos !== true) {
      return NextResponse.json({ error: "Debés aceptar los Términos y Condiciones" }, { status: 400 });
    }

    // ── 2. Normalizar email ───────────────────────────────────────────────────
    const emailNorm = email.trim().toLowerCase();

    // Validación básica de formato email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNorm)) {
      return NextResponse.json({ error: "El email no tiene un formato válido" }, { status: 400 });
    }

    // ── 3. Verificar que no exista otro usuario con ese email ─────────────────
    const { data: existente } = await supabaseAdmin
      .from("usuarios")
      .select("id")
      .eq("email", emailNorm)
      .maybeSingle();

    if (existente) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese email" }, { status: 409 });
    }

    // ── 4. Hashear contraseña ─────────────────────────────────────────────────
    const hash = await bcrypt.hash(password, 10);

    // ── 5. INSERT server-side — rol y campos sensibles forzados aquí ──────────
    const { data: nuevo, error: insertError } = await supabaseAdmin
      .from("usuarios")
      .insert([{
        nombre:                    nombre.trim(),
        email:                     emailNorm,
        password:                  hash,
        telefono:                  telefono?.trim() ?? null,
        rol:                       "cliente",   // siempre forzado server-side
        estado_doc:                "pendiente_actualizacion",
        acepta_terminos:           true,
        fecha_aceptacion_terminos: new Date().toISOString(),
      }])
      .select("id, nombre, email, rol, telefono")
      .single();

    if (insertError || !nuevo) {
      console.error("[registro-cliente] ❌ error INSERT:", insertError?.message);
      return NextResponse.json({ error: "Error al crear la cuenta" }, { status: 500 });
    }

    console.log("[registro-cliente] ✅ nuevo cliente creado — id:", nuevo.id, "| email:", emailNorm);

    // ── 6. Registrar consentimientos legales auditables ───────────────────────
    const errorConsent = await registrarConsentimiento({
      supabaseAdmin,
      usuarioId: String(nuevo.id),
      documentos: ["terminos", "privacidad"],
      req,
    });

    if (errorConsent) {
      // El usuario ya fue creado — no hacemos rollback pero sí reportamos el problema.
      // El admin puede ver que acepta_terminos=true en usuarios pero sin fila en consentimientos_legales.
      console.error("[registro-cliente] ❌ usuario creado pero consentimiento falló:", errorConsent);
      return NextResponse.json(
        { error: "Cuenta creada pero no se pudo registrar el consentimiento legal. Contactá al soporte." },
        { status: 500 }
      );
    }

    // ── 7. Devolver solo datos seguros (sin password ni campos sensibles) ─────
    return NextResponse.json({ ok: true, usuario: nuevo }, { status: 201 });

  } catch (error: any) {
    console.error("[registro-cliente] ❌ error general:", error?.message ?? String(error));
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
