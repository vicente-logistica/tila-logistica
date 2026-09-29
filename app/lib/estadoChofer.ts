/**
 * Escrituras que el chofer hace sobre su PROPIA fila de `usuarios`: estado online, navegador
 * preferido y señal/batería. Antes se hacían desde el navegador con la clave anon (política
 * `anon_update_usuarios_permisivo`, que dejaba modificar cualquier columna — incluido `rol`
 * — de cualquier usuario). Ahora pasan por /api/chofer/estado con service role y esta lista
 * blanca: nunca otra columna, nunca otro usuario.
 */

export const NAVEGADORES_VALIDOS = ["google_maps", "waze", "preguntar_siempre", "mapa_tila"] as const;

/** Columnas que el chofer puede escribir sobre sí mismo (nada más). */
export const COLUMNAS_ESTADO_CHOFER = ["online", "navegador_preferido", "bateria_nivel", "bateria_cargando", "ultima_senal_at"] as const;

export type CambiosEstadoChofer = Partial<{
  online: boolean;
  navegador_preferido: string;
  bateria_nivel: number | null;
  bateria_cargando: boolean | null;
  ultima_senal_at: string;
}>;

/**
 * Valida el body. Sólo se aceptan las claves de la lista blanca, con tipo correcto; una
 * clave desconocida (p. ej. `rol`) rechaza el pedido entero. `ultima_senal_at` la fija el
 * servidor (hora del servidor) cuando el cliente manda `senal: true` — nunca una fecha del
 * cliente.
 */
export function validarCambiosEstadoChofer(body: unknown, ahora: Date = new Date()):
  { ok: true; cambios: CambiosEstadoChofer } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Body inválido" };
  const b = body as Record<string, unknown>;
  const permitidas = new Set(["online", "navegador_preferido", "bateria_nivel", "bateria_cargando", "senal"]);
  const desconocidas = Object.keys(b).filter(k => !permitidas.has(k));
  if (desconocidas.length > 0) return { ok: false, error: `Campos no permitidos: ${desconocidas.join(", ")}` };

  const cambios: CambiosEstadoChofer = {};
  if ("online" in b) {
    if (typeof b.online !== "boolean") return { ok: false, error: "online debe ser booleano" };
    cambios.online = b.online;
  }
  if ("navegador_preferido" in b) {
    if (typeof b.navegador_preferido !== "string" || !(NAVEGADORES_VALIDOS as readonly string[]).includes(b.navegador_preferido)) {
      return { ok: false, error: `navegador_preferido inválido (${NAVEGADORES_VALIDOS.join(", ")})` };
    }
    cambios.navegador_preferido = b.navegador_preferido;
  }
  if ("bateria_nivel" in b) {
    const n = b.bateria_nivel;
    if (n !== null && !(typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100)) {
      return { ok: false, error: "bateria_nivel debe ser un número entre 0 y 100 o null" };
    }
    cambios.bateria_nivel = n as number | null;
  }
  if ("bateria_cargando" in b) {
    if (b.bateria_cargando !== null && typeof b.bateria_cargando !== "boolean") {
      return { ok: false, error: "bateria_cargando debe ser booleano o null" };
    }
    cambios.bateria_cargando = b.bateria_cargando as boolean | null;
  }
  if ("senal" in b) {
    if (b.senal !== true) return { ok: false, error: "senal sólo admite true" };
    cambios.ultima_senal_at = ahora.toISOString();
  }
  if (Object.keys(cambios).length === 0) return { ok: false, error: "Nada para actualizar" };
  return { ok: true, cambios };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteDb = { from: (tabla: string) => any };

/**
 * PATCH de estado propio. `userId` sale de resolverUsuario (la misma identidad que usan
 * hoy todas las rutas del chofer, p. ej. /api/cargas/gps). El UPDATE es siempre
 * `.eq("id", userId)` — imposible escribir la fila de otro usuario — y sólo con las
 * columnas de la lista blanca.
 */
export async function procesarPatchEstadoChofer(db: ClienteDb, userId: string | null, body: unknown, ahora: Date = new Date()):
  Promise<{ status: number; body: Record<string, unknown> }> {
  if (!userId) return { status: 401, body: { error: "No autorizado" } };
  const { data: usuario, error: errUsuario } = await db
    .from("usuarios").select("id, rol, eliminado").eq("id", userId).maybeSingle();
  if (errUsuario || !usuario) return { status: 401, body: { error: "No autorizado" } };
  if (usuario.rol !== "chofer" || usuario.eliminado) return { status: 403, body: { error: "Prohibido" } };

  const v = validarCambiosEstadoChofer(body, ahora);
  if (!v.ok) return { status: 400, body: { error: v.error } };

  const { error } = await db.from("usuarios").update(v.cambios).eq("id", userId);
  if (error) return { status: 500, body: { error: "No se pudo actualizar el estado" } };
  return { status: 200, body: { ok: true } };
}
