// Guardas de seguridad COMPARTIDAS por todos los scripts de staging.
// Objetivo: que sea imposible, por diseño, que un script de staging escriba en producción.
//
// Reglas (todas deben cumplirse):
//   1. TILA_ENTORNO debe ser "staging" o "local".
//   2. El host destino NO puede ser ninguno de los hosts de producción conocidos.
//   3. Si el destino NO es local (127.x / localhost), debe ser un *.supabase.co cuyo "ref" esté declarado
//      explícitamente en TILA_STAGING_SUPABASE_REF (lista separada por comas) → nunca "cualquier proyecto".
//   4. Escrituras (seed, reset, smoke con escritura) exigen además el flag --aplicar / confirmación explícita.
//
// Los hosts de producción son públicos (van en el bundle JS del sitio); no son secretos.
export const HOSTS_PRODUCCION = ["imbtepvdscdtpxkleihi.supabase.co", "tila-logistica.vercel.app"];
export const REF_PRODUCCION = "imbtepvdscdtpxkleihi";

const esLocal = (h) => h === "localhost" || h.startsWith("127.") || h === "::1" || h === "[::1]";

/** Lanza si el destino puede ser producción o no está explícitamente autorizado como staging/local. */
export function asegurarNoProduccion(urlStr, { etiqueta = "destino", env = process.env } = {}) {
  let u;
  try { u = new URL(urlStr); } catch { throw new Error(`[guarda] ${etiqueta}: URL inválida`); }
  const host = u.hostname.toLowerCase();

  const entorno = env.TILA_ENTORNO;
  if (entorno !== "staging" && entorno !== "local") {
    throw new Error(`[guarda] TILA_ENTORNO debe ser "staging" o "local" (valor actual: ${JSON.stringify(entorno ?? null)}). Abortado.`);
  }
  if (HOSTS_PRODUCCION.some((h) => host === h || host.endsWith("." + h)) || host.includes(REF_PRODUCCION)) {
    throw new Error(`[guarda] ${etiqueta} apunta a PRODUCCIÓN (${host}). Abortado.`);
  }
  if (!esLocal(host)) {
    const m = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
    const permitidos = (env.TILA_STAGING_SUPABASE_REF ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!m) throw new Error(`[guarda] ${etiqueta}: host no reconocido como Supabase ni local (${host}). Abortado.`);
    if (!permitidos.includes(m[1])) {
      throw new Error(`[guarda] ${etiqueta}: el proyecto "${m[1]}" no está en TILA_STAGING_SUPABASE_REF. Abortado.`);
    }
  }
  return { host, local: esLocal(host) };
}

/**
 * Guarda para la URL de la APLICACIÓN (Next/Vercel) sobre la que corren los smoke tests.
 * Permitidos: local, o hosts declarados en TILA_STAGING_APP_HOSTS (lista separada por comas, p. ej. "tila-staging.vercel.app").
 */
export function asegurarAppNoProduccion(urlStr, { etiqueta = "app", env = process.env } = {}) {
  let u;
  try { u = new URL(urlStr); } catch { throw new Error(`[guarda] ${etiqueta}: URL inválida`); }
  const host = u.hostname.toLowerCase();
  if (env.TILA_ENTORNO !== "staging" && env.TILA_ENTORNO !== "local") throw new Error(`[guarda] TILA_ENTORNO debe ser "staging" o "local". Abortado.`);
  if (HOSTS_PRODUCCION.some((h) => host === h || host.endsWith("." + h)) || host.includes(REF_PRODUCCION)) {
    throw new Error(`[guarda] ${etiqueta} apunta a PRODUCCIÓN (${host}). Abortado.`);
  }
  if (!esLocal(host)) {
    const permitidos = (env.TILA_STAGING_APP_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!permitidos.includes(host)) throw new Error(`[guarda] ${etiqueta}: el host "${host}" no está en TILA_STAGING_APP_HOSTS. Abortado.`);
  }
  return { host, local: esLocal(host) };
}

/** Enmascara un secreto para mostrarlo en logs (nunca imprimir claves completas). */
export function enmascarar(s) {
  if (!s) return "(vacío)";
  return s.length <= 8 ? "****" : `${s.slice(0, 3)}…${s.slice(-2)} (len ${s.length})`;
}
