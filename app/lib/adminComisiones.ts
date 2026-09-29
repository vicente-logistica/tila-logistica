import {
  leerConfiguracionComisiones, guardarConfiguracionComisiones,
} from "./configuracionComisiones.ts";
import { resolverUsuario, type ResultadoAuth } from "./auth/sesion.ts";

/**
 * Identidad para /api/admin/configuracion/comisiones: SIEMPRE el camino `strict` de
 * resolverUsuario, sin importar TILA_AUTH_MODE global — sólo una sesión firmada (cookie
 * HttpOnly que emite /api/auth/login, o Bearer) con control de origen. El header
 * `x-user-id` se ignora: inventar el id de un admin no alcanza. Si TILA_SESSION_SECRET no
 * está configurado, rechaza (config_incompleta) — nunca cae al header.
 */
export function identidadAdminComisiones(req: Request, env: Record<string, string | undefined> = process.env): ResultadoAuth {
  return resolverUsuario(req, { env: { ...env, TILA_AUTH_MODE: "strict" } });
}

/** Mensaje claro para el panel cuando no hay sesión firmada válida. */
export function rechazoSinSesion(motivo: string | null): { status: number; body: Record<string, unknown> } {
  return {
    status: 401,
    body: {
      error: motivo === "config_incompleta"
        ? "Sesión segura no configurada en el servidor (falta TILA_SESSION_SECRET)."
        : "Se requiere una sesión segura: cerrá sesión y volvé a iniciarla.",
      motivo,
    },
  };
}

/**
 * Lógica de /api/admin/configuracion/comisiones separada del handler (Next + Supabase
 * real) para poder testearla con node --test.
 *
 * Autorización SIEMPRE en el servidor: el usuario identificado por resolverUsuario (la
 * arquitectura de auth disponible hoy) tiene que existir en `usuarios`, no estar eliminado
 * y tener rol "admin" en la BASE — nunca se confía en el rol guardado en el navegador.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteDb = { from: (tabla: string) => any };

export interface RespuestaApi { status: number; body: Record<string, unknown> }

export async function autorizarAdmin(db: ClienteDb, userId: string | null): Promise<RespuestaApi | null> {
  if (!userId) return { status: 401, body: { error: "No autorizado" } };
  const { data: usuario, error } = await db
    .from("usuarios").select("id, rol, eliminado").eq("id", userId).maybeSingle();
  if (error || !usuario) return { status: 401, body: { error: "No autorizado" } };
  if (usuario.rol !== "admin" || usuario.eliminado) return { status: 403, body: { error: "Prohibido: solo administradores" } };
  return null; // autorizado
}

const respuestaConfig = (c: { comisionClienteBp: number; comisionChoferBp: number; fuente?: string; motivo?: string }) => ({
  comision_cliente_bp: c.comisionClienteBp,
  comision_chofer_bp:  c.comisionChoferBp,
  fuente:              c.fuente ?? "db",
  ...(c.motivo ? { motivo: c.motivo } : {}),
});

export async function procesarGetComisiones(db: ClienteDb, userId: string | null): Promise<RespuestaApi> {
  const rechazo = await autorizarAdmin(db, userId);
  if (rechazo) return rechazo;
  const config = await leerConfiguracionComisiones(db);
  return { status: 200, body: { ok: true, ...respuestaConfig(config) } };
}

export async function procesarPutComisiones(db: ClienteDb, userId: string | null, body: unknown): Promise<RespuestaApi> {
  const rechazo = await autorizarAdmin(db, userId);
  if (rechazo) return rechazo;
  const b = (body ?? {}) as Record<string, unknown>;
  const r = await guardarConfiguracionComisiones(
    db,
    { comisionClienteBp: b.comision_cliente_bp, comisionChoferBp: b.comision_chofer_bp },
    userId as string,
  );
  if (!r.ok) return { status: r.error.startsWith("Comisiones inválidas") ? 400 : 500, body: { error: r.error } };
  return { status: 200, body: { ok: true, ...respuestaConfig(r.config) } };
}
