import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const _url     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const _roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_url)     throw new Error("Falta SUPABASE_URL en variables de entorno (auth/login)");
if (!_roleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno (auth/login)");

const supabaseAdmin = createClient(_url, _roleKey);

// Campos sensibles que nunca se devuelven al cliente
const CAMPOS_SENSIBLES = [
  "password", "cuit_cuil", "antecedentes",
  "alias_cbu_cvu", "titular_cuenta", "banco_billetera",
  "metodo_cobro", "cnrt_ruta", "vtv_rto",
];

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }

    const { email, password } = body ?? {};

    if (!email || typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "El email es obligatorio" }, { status: 400 });
    }
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "La contraseña es obligatoria" }, { status: 400 });
    }

    const emailNorm = email.trim().toLowerCase();

    // ── 1. Buscar usuario por email ───────────────────────────────────────────
    const { data: usuario, error: dbError } = await supabaseAdmin
      .from("usuarios")
      .select("*")
      .eq("email", emailNorm)
      .maybeSingle();

    if (dbError) {
      console.error("[auth/login] ❌ error BD:", dbError.message);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }

    if (!usuario) {
      // Tiempo constante para no filtrar existencia de email
      await bcrypt.hash("dummy", 10);
      return NextResponse.json({ error: "Email o contraseña incorrectos" }, { status: 401 });
    }

    // ── 2. Comparar contraseña (hash o texto plano legacy) ────────────────────
    const storedPassword: string = usuario.password ?? "";
    let passwordCorrecta = false;
    const esHash = storedPassword.startsWith("$2");

    if (esHash) {
      passwordCorrecta = await bcrypt.compare(password, storedPassword);
    } else {
      // Legacy: texto plano — comparación directa
      passwordCorrecta = storedPassword === password;

      // Si coincide, rehashear automáticamente (migración gradual)
      if (passwordCorrecta) {
        const nuevoHash = await bcrypt.hash(password, 10);
        const { error: updateError } = await supabaseAdmin
          .from("usuarios")
          .update({ password: nuevoHash })
          .eq("id", usuario.id);

        if (updateError) {
          console.warn("[auth/login] ⚠️  rehash fallido para usuario:", usuario.id, updateError.message);
        } else {
          console.log("[auth/login] ✅ contraseña rehhasheada — usuario:", usuario.id);
        }
      }
    }

    if (!passwordCorrecta) {
      return NextResponse.json({ error: "Email o contraseña incorrectos" }, { status: 401 });
    }

    // ── 3. Validaciones de estado según rol ───────────────────────────────────
    if (usuario.rol === "chofer") {
      const aprobacion = usuario.estado_aprobacion || "pendiente";
      if (aprobacion === "pendiente") {
        return NextResponse.json(
          { error: "Tu cuenta de chofer está pendiente de aprobación por el administrador. Te avisaremos cuando esté habilitada." },
          { status: 403 }
        );
      }
      if (aprobacion === "rechazado") {
        return NextResponse.json(
          { error: "Tu cuenta de chofer fue rechazada. Contactá al administrador para más información." },
          { status: 403 }
        );
      }
      if (aprobacion === "suspendido") {
        return NextResponse.json(
          { error: "Tu cuenta de chofer está suspendida. Contactá al administrador para reactivarla." },
          { status: 403 }
        );
      }
    }

    // ── 4. Construir respuesta segura (sin campos sensibles) ──────────────────
    const usuarioSeguro = Object.fromEntries(
      Object.entries(usuario).filter(([k]) => !CAMPOS_SENSIBLES.includes(k))
    );

    console.log("[auth/login] ✅ login exitoso — user:", usuario.id, "| rol:", usuario.rol, "| hash:", esHash);

    return NextResponse.json({ ok: true, usuario: usuarioSeguro });

  } catch (error: any) {
    console.error("[auth/login] ❌ error general:", error?.message ?? String(error));
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
