import { NextResponse } from "next/server";
import { setCookieBorrarSesion } from "../../../lib/auth/sesion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cierre de sesión en el servidor: borra la cookie firmada `tila_sesion`.
 *
 * - No autentica ni lee x-user-id: cerrar sesión no requiere estar autenticado.
 * - No consulta la base ni el contenido de la cookie (una cookie manipulada también se borra).
 * - Responde siempre lo mismo, exista o no la cookie: no revela si había sesión.
 * - Los atributos de la cookie de borrado coinciden con los de la cookie emitida (Path, HttpOnly,
 *   SameSite y Secure según http/https) y expira de inmediato (Max-Age=0 + Expires en el pasado).
 *
 * El cliente igualmente limpia su localStorage (ver app/utils/salirApp.ts).
 */
export async function POST(req: Request) {
  const respuesta = NextResponse.json({ ok: true });
  respuesta.headers.append("Set-Cookie", setCookieBorrarSesion(req));
  respuesta.headers.set("Cache-Control", "no-store");
  return respuesta;
}
