/**
 * TILA — Sesión firmada (SOLO SERVIDOR).
 *
 * Módulo ADITIVO y compatible: mientras TILA_AUTH_MODE no esté definido (o sea "legacy"),
 * resolverUsuario() devuelve exactamente lo que hoy hace cada ruta:
 *     req.headers.get("x-user-id")
 * y no lee cookies ni tokens. Ver docs/seguridad/02-DISENO-Y-CAMBIOS.md.
 *
 * Modos (variable de entorno TILA_AUTH_MODE):
 *   legacy (defecto) → solo x-user-id. Comportamiento idéntico al actual.
 *   dual             → x-user-id sigue valiendo; si NO viene el header, se acepta la sesión firmada.
 *                      Registra qué requests todavía dependen solo del header (métrica de migración).
 *   strict           → solo sesión firmada (cookie o Bearer). x-user-id se ignora.
 *
 * Secreto: TILA_SESSION_SECRET (>= 32 caracteres). Sin secreto no se puede emitir ni verificar sesión.
 *
 * No importar desde componentes cliente: usa node:crypto (el build de cliente fallaría, a propósito).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const NOMBRE_COOKIE_SESION = "tila_sesion";
export const TTL_SESION_DEFECTO_SEG = 60 * 60 * 24 * 90; // 90 días
/** Sesión de alcance "registro" (alta de chofer → subir documentación): vence rápido. */
export const TTL_SESION_REGISTRO_SEG = 60 * 30; // 30 minutos

export type ModoAuth = "legacy" | "dual" | "strict";
export type AlcanceSesion = "completa" | "registro";
export type FuenteAuth = "cookie" | "bearer" | "legacy-header";
export type MotivoRechazo =
  | "sin_credenciales"
  | "sesion_invalida"
  | "sesion_expirada"
  | "alcance_insuficiente"
  | "origen_invalido"
  | "config_incompleta";

export type EntornoAuth = Record<string, string | undefined>;

export interface ResultadoAuth {
  userId: string | null;
  fuente: FuenteAuth | null;
  modo: ModoAuth;
  motivo: MotivoRechazo | null;
  /** dual: true/false si además había sesión válida y coincide/no con el header; null si no aplica. */
  coincideConSesion: boolean | null;
}

const SECRETO_MIN = 32;

export function modoAuth(env: EntornoAuth = process.env): ModoAuth {
  const v = (env.TILA_AUTH_MODE ?? "").trim().toLowerCase();
  return v === "dual" || v === "strict" ? v : "legacy";
}

function secretoValido(env: EntornoAuth): string | null {
  const s = env.TILA_SESSION_SECRET ?? "";
  return s.length >= SECRETO_MIN ? s : null;
}

function b64u(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

function hmac(secreto: string, parteFirmada: string): Buffer {
  return createHmac("sha256", secreto).update(parteFirmada).digest();
}

export interface OpcionesFirma {
  env?: EntornoAuth;
  ttlSeg?: number;
  /** epoch ms; solo para tests */
  ahora?: number;
  alcance?: AlcanceSesion;
}

/** Devuelve el token firmado, o null si no hay secreto configurado (no se emite sesión). */
export function firmarSesion(userId: string, op: OpcionesFirma = {}): string | null {
  const env = op.env ?? process.env;
  const secreto = secretoValido(env);
  if (!secreto || !userId) return null;
  const iat = Math.floor((op.ahora ?? Date.now()) / 1000);
  const payload = {
    v: 1,
    sub: userId,
    scp: op.alcance ?? "completa",
    iat,
    exp: iat + (op.ttlSeg ?? TTL_SESION_DEFECTO_SEG),
  };
  const cuerpo = b64u(JSON.stringify(payload));
  return `${cuerpo}.${b64u(hmac(secreto, cuerpo))}`;
}

export type ResultadoVerificacion =
  | { ok: true; userId: string; alcance: AlcanceSesion }
  | { ok: false; motivo: "sin_secreto" | "formato" | "firma" | "expirada" };

export function verificarSesion(
  token: string,
  op: { env?: EntornoAuth; ahora?: number } = {},
): ResultadoVerificacion {
  const env = op.env ?? process.env;
  const secreto = secretoValido(env);
  if (!secreto) return { ok: false, motivo: "sin_secreto" };

  const partes = typeof token === "string" ? token.split(".") : [];
  if (partes.length !== 2 || !partes[0] || !partes[1]) return { ok: false, motivo: "formato" };

  const esperada = hmac(secreto, partes[0]);
  let recibida: Buffer;
  try {
    recibida = Buffer.from(partes[1], "base64url");
  } catch {
    return { ok: false, motivo: "formato" };
  }
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
    return { ok: false, motivo: "firma" };
  }

  let p: { v?: number; sub?: unknown; scp?: unknown; exp?: unknown };
  try {
    p = JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8"));
  } catch {
    return { ok: false, motivo: "formato" };
  }
  if (p.v !== 1 || typeof p.sub !== "string" || !p.sub || typeof p.exp !== "number") {
    return { ok: false, motivo: "formato" };
  }
  const ahoraSeg = Math.floor((op.ahora ?? Date.now()) / 1000);
  if (p.exp <= ahoraSeg) return { ok: false, motivo: "expirada" };

  return { ok: true, userId: p.sub, alcance: p.scp === "registro" ? "registro" : "completa" };
}

/** Valor de la cabecera Set-Cookie que instala la sesión. HttpOnly + SameSite=Lax (+ Secure en https). */
export function cabeceraSetCookie(token: string, op: { ttlSeg?: number; secure?: boolean } = {}): string {
  const ttl = op.ttlSeg ?? TTL_SESION_DEFECTO_SEG;
  return `${NOMBRE_COOKIE_SESION}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${op.secure ? "; Secure" : ""}`;
}

/** Valor de la cabecera Set-Cookie que borra la sesión (logout). */
export function cabeceraBorrarCookie(op: { secure?: boolean } = {}): string {
  return `${NOMBRE_COOKIE_SESION}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${op.secure ? "; Secure" : ""}`;
}

/** true si la request llegó por https (directo o detrás del proxy de Vercel). */
export function requestEsHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Set-Cookie listo para una respuesta de login/alta, o null si no hay secreto configurado
 * (en ese caso la ruta responde exactamente igual que antes de existir la sesión firmada).
 * alcance "registro" → vence en TTL_SESION_REGISTRO_SEG y solo la aceptan las rutas que lo permiten.
 */
export function setCookieSesion(
  req: Request,
  userId: string,
  op: { alcance?: AlcanceSesion; env?: EntornoAuth; ahora?: number } = {},
): string | null {
  const alcance = op.alcance ?? "completa";
  const ttlSeg = alcance === "registro" ? TTL_SESION_REGISTRO_SEG : TTL_SESION_DEFECTO_SEG;
  const token = firmarSesion(userId, { env: op.env, alcance, ttlSeg, ahora: op.ahora });
  return token ? cabeceraSetCookie(token, { ttlSeg, secure: requestEsHttps(req) }) : null;
}

/** Set-Cookie que borra la sesión (logout). No depende de ningún dato de la request salvo http/https. */
export function setCookieBorrarSesion(req: Request): string {
  return cabeceraBorrarCookie({ secure: requestEsHttps(req) });
}

export function leerCookie(cabeceraCookie: string | null, nombre: string): string | null {
  if (!cabeceraCookie) return null;
  for (const trozo of cabeceraCookie.split(";")) {
    const i = trozo.indexOf("=");
    if (i < 0) continue;
    if (trozo.slice(0, i).trim() === nombre) return trozo.slice(i + 1).trim() || null;
  }
  return null;
}

function leerBearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/** Defensa CSRF para requests que mutan y se autentican por cookie: si hay Origin, debe coincidir con el host. */
function origenCoincide(req: Request): boolean {
  const metodo = req.method.toUpperCase();
  if (metodo === "GET" || metodo === "HEAD" || metodo === "OPTIONS") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true; // SameSite=Lax ya cubre los casos sin Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Métrica de migración (solo modo dual): cuántas requests todavía se autentican SOLO por header.
 * Sin ids ni datos personales. "DISTINTA" (sesión de otro usuario) se registra siempre; "ausente", al 5%.
 */
function registrarMetricaDual(req: Request, coincide: boolean | null): void {
  if (coincide === true) return;
  if (coincide === null && Math.random() >= 0.05) return;
  let ruta = "?";
  try { ruta = new URL(req.url).pathname; } catch { /* ignorar */ }
  console.info(`[auth-migracion] dual ruta=${ruta} fuente=legacy-header sesion=${coincide === null ? "ausente" : "DISTINTA"}`);
}

export interface OpcionesResolver {
  env?: EntornoAuth;
  ahora?: number;
  /** Rutas que aceptan sesiones de alcance "registro" (p. ej. subir documentación tras el alta). */
  permitirAlcanceRegistro?: boolean;
}

/**
 * Identifica al usuario de una request.
 * En modo legacy es EXACTAMENTE `req.headers.get("x-user-id")` (vacío → null).
 */
export function resolverUsuario(req: Request, op: OpcionesResolver = {}): ResultadoAuth {
  const env = op.env ?? process.env;
  const modo = modoAuth(env);
  const header = req.headers.get("x-user-id") || null;

  if (modo === "legacy") {
    return {
      userId: header,
      fuente: header ? "legacy-header" : null,
      modo,
      motivo: header ? null : "sin_credenciales",
      coincideConSesion: null,
    };
  }

  const rechazo = (motivo: MotivoRechazo): ResultadoAuth => ({
    userId: null, fuente: null, modo, motivo, coincideConSesion: null,
  });

  const bearer = leerBearer(req);
  const cookie = leerCookie(req.headers.get("cookie"), NOMBRE_COOKIE_SESION);
  const token = bearer ?? cookie;
  const fuenteToken: FuenteAuth = bearer ? "bearer" : "cookie";

  let sesion: ResultadoVerificacion | null = null;
  if (token) sesion = verificarSesion(token, { env, ahora: op.ahora });

  if (modo === "dual") {
    if (header) {
      // Compatibilidad total: el header sigue mandando. Solo se anota si coincide con la sesión.
      const coincide = sesion && sesion.ok ? sesion.userId === header : null;
      registrarMetricaDual(req, coincide);
      return { userId: header, fuente: "legacy-header", modo, motivo: null, coincideConSesion: coincide };
    }
    if (sesion && sesion.ok) {
      if (sesion.alcance !== "completa" && !op.permitirAlcanceRegistro) return rechazo("alcance_insuficiente");
      if (fuenteToken === "cookie" && !origenCoincide(req)) return rechazo("origen_invalido");
      return { userId: sesion.userId, fuente: fuenteToken, modo, motivo: null, coincideConSesion: null };
    }
    return rechazo(sesion ? "sesion_invalida" : "sin_credenciales");
  }

  // strict
  if (!secretoValido(env)) return rechazo("config_incompleta");
  if (!token || !sesion) return rechazo("sin_credenciales");
  if (!sesion.ok) return rechazo(sesion.motivo === "expirada" ? "sesion_expirada" : "sesion_invalida");
  if (sesion.alcance !== "completa" && !op.permitirAlcanceRegistro) return rechazo("alcance_insuficiente");
  if (fuenteToken === "cookie" && !origenCoincide(req)) return rechazo("origen_invalido");
  return { userId: sesion.userId, fuente: fuenteToken, modo, motivo: null, coincideConSesion: null };
}
