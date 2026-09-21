// V3 — pruebas de COMPORTAMIENTO con la anon/publishable key contra un Supabase de STAGING (PLAN-V3-STAGING.md, FASE 4).
//   A1–A15 : SOLO LECTURA.          B1–B16 : escrituras FICTICIAS con marcador (V3-MARCADOR).
// Objetivo: comprobar que staging se comporta como producción, INCLUIDAS las policies abiertas que reproducimos a propósito.
// Este script NO corrige nada: solo observa y compara contra lo esperado.
//
// ESTADO: escrito y probado SOLO de forma local (con un Supabase falso en memoria). NO se ejecutó contra ninguna base.
//
// Uso (las claves SOLO por variables de entorno; NUNCA por argumentos):
//   node --env-file=.env.staging scripts/staging/smoke/v3-anon.mjs --listar          (no se conecta a nada)
//   node --env-file=.env.staging scripts/staging/smoke/v3-anon.mjs [--solo=A|B|A1,B4] [--limpiar]
// Variables: TILA_ENTORNO=staging · TILA_STAGING_SUPABASE_REF · STAGING_SUPABASE_URL · STAGING_ANON_KEY · STAGING_SERVICE_ROLE_KEY
//
// Reglas de seguridad de este archivo:
//   · Solo variables de entorno. Cualquier argumento con pinta de clave/URL/ref se rechaza.
//   · Antes de conectar: TILA_ENTORNO=staging; URL exactamente https://<ref>.supabase.co; ref == TILA_STAGING_SUPABASE_REF; nunca el ref/host de producción.
//   · Nunca se imprime una clave, un header Authorization, un token ni una contraseña (todo lo impreso pasa por redactar()).
//   · Las escrituras que miden permisos las hace la ANON. La service_role SOLO relee/verifica y limpia objetos con marcador de ESTA corrida.
//   · Sin TRUNCATE. Sin borrados sin marcador. La limpieza es exacta (por id registrado + marcador) y solo con --limpiar.
import crypto from "node:crypto";
import { resolve } from "node:path";
import { HOSTS_PRODUCCION, REF_PRODUCCION, asegurarNoProduccion } from "../guardas.mjs";

export const MARCADOR = "V3-MARCADOR";
export const DOMINIO_EMAIL = "@tila-staging.invalid";
export const PREFIJO_STORAGE = "v3-marcador/";
const BUCKETS = ["documentacion-choferes", "vehiculos"];
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

// ── Redacción: nada sensible sale por pantalla ───────────────────────────────────────────────────────────────────────
const PATRONES_SECRETOS = [
  /eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,}){1,2}/g,
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]+/gi,
  /bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /apikey["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}/gi,
];
export function redactar(texto, secretos = []) {
  let s = String(texto ?? "");
  for (const k of secretos) if (typeof k === "string" && k.length >= 8) s = s.split(k).join("[REDACTADO]");
  for (const re of PATRONES_SECRETOS) s = s.replace(re, "[REDACTADO]");
  return s;
}
let SECRETOS_ACTIVOS = [];
/** Registra los valores secretos que jamás deben imprimirse (además de los patrones genéricos). */
export function definirSecretos(lista) { SECRETOS_ACTIVOS = Array.isArray(lista) ? lista.filter((x) => typeof x === "string") : []; }
/** Única vía de salida del script (lo demás no debe usar console). */
export function salida(...partes) { console.log(redactar(partes.join(" "), SECRETOS_ACTIVOS)); }

// ── Claves: se inspecciona el FORMATO localmente (sin red) y nunca se muestra el valor ──────────────────────────────────
export function inspeccionarClave(clave) {
  if (typeof clave !== "string" || !clave) return { formato: "ausente" };
  if (/^sb_publishable_/.test(clave)) return { formato: "publishable" };
  if (/^sb_secret_/.test(clave)) return { formato: "secret" };
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(clave);
  if (m) {
    try {
      const p = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8"));
      return { formato: "jwt", rol: typeof p.role === "string" ? p.role : undefined, ref: typeof p.ref === "string" ? p.ref : undefined };
    } catch { return { formato: "jwt" }; }
  }
  return { formato: "desconocido" };
}

// ── Configuración: TODO se valida ANTES de crear cualquier cliente o conexión ────────────────────────────────────────────
export function validarConfig(env) {
  const errores = [];
  if (env.TILA_ENTORNO !== "staging") errores.push('TILA_ENTORNO debe ser exactamente "staging" (V3 no corre en "local" ni sin definir).');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") errores.push("NODE_TLS_REJECT_UNAUTHORIZED=0 está definida: la verificación TLS no puede estar desactivada.");

  const ref = env.TILA_STAGING_SUPABASE_REF ?? "";
  let refOk = false;
  if (!/^[a-z0-9]{6,40}$/.test(ref)) errores.push("TILA_STAGING_SUPABASE_REF debe ser UN solo ref (minúsculas y números; sin comas, espacios ni comentarios).");
  else if (ref === REF_PRODUCCION) errores.push("TILA_STAGING_SUPABASE_REF es el ref de PRODUCCIÓN. Abortado.");
  else refOk = true;

  const urlTxt = env.STAGING_SUPABASE_URL ?? "";
  if (!urlTxt) errores.push("Falta STAGING_SUPABASE_URL.");
  else {
    let u = null;
    try { u = new URL(urlTxt); } catch { errores.push("STAGING_SUPABASE_URL no es una URL válida."); }
    if (u) {
      const host = u.hostname.toLowerCase();
      if (u.protocol !== "https:") errores.push("STAGING_SUPABASE_URL debe usar https.");
      if (u.username || u.password) errores.push("STAGING_SUPABASE_URL no puede llevar usuario ni contraseña.");
      if (u.port) errores.push("STAGING_SUPABASE_URL no puede llevar puerto.");
      if ((u.pathname && u.pathname !== "/") || u.search || u.hash) errores.push("STAGING_SUPABASE_URL debe ser solo https://<ref>.supabase.co (sin ruta, query ni hash).");
      if (HOSTS_PRODUCCION.some((h) => host === h || host.endsWith("." + h)) || host.includes(REF_PRODUCCION)) errores.push("STAGING_SUPABASE_URL apunta a PRODUCCIÓN. Abortado.");
      if (refOk && host !== `${ref}.supabase.co`) errores.push("El ref de STAGING_SUPABASE_URL no coincide EXACTAMENTE con TILA_STAGING_SUPABASE_REF.");
      if (refOk && !errores.length) {
        try { asegurarNoProduccion(`https://${ref}.supabase.co`, { etiqueta: "STAGING_SUPABASE_URL", env: { TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: ref } }); }
        catch (e) { errores.push(String(e.message)); }
      }
    }
  }

  const anon = env.STAGING_ANON_KEY, svc = env.STAGING_SERVICE_ROLE_KEY;
  const ia = inspeccionarClave(anon), is = inspeccionarClave(svc);
  if (!anon) errores.push("Falta STAGING_ANON_KEY."); else {
    if (ia.formato === "secret") errores.push("STAGING_ANON_KEY tiene formato de clave SECRETA (sb_secret_…): debe ser la publishable/anon.");
    if (ia.formato === "jwt" && ia.rol && ia.rol !== "anon") errores.push("STAGING_ANON_KEY es un JWT con rol distinto de anon.");
    if (ia.ref && refOk && ia.ref !== ref) errores.push("STAGING_ANON_KEY pertenece a otro proyecto (claim ref distinto de TILA_STAGING_SUPABASE_REF).");
    if (ia.formato === "desconocido") errores.push("STAGING_ANON_KEY no tiene un formato reconocible.");
  }
  if (!svc) errores.push("Falta STAGING_SERVICE_ROLE_KEY."); else {
    if (is.formato === "publishable") errores.push("STAGING_SERVICE_ROLE_KEY tiene formato de clave PÚBLICA (sb_publishable_…): debe ser la secret/service_role.");
    if (is.formato === "jwt" && is.rol && is.rol !== "service_role") errores.push("STAGING_SERVICE_ROLE_KEY es un JWT con rol distinto de service_role.");
    if (is.ref && refOk && is.ref !== ref) errores.push("STAGING_SERVICE_ROLE_KEY pertenece a otro proyecto (claim ref distinto de TILA_STAGING_SUPABASE_REF).");
    if (is.formato === "desconocido") errores.push("STAGING_SERVICE_ROLE_KEY no tiene un formato reconocible.");
  }
  if (anon && svc && anon === svc) errores.push("STAGING_ANON_KEY y STAGING_SERVICE_ROLE_KEY son iguales.");
  for (const [n, v] of Object.entries({ STAGING_ANON_KEY: anon, STAGING_SERVICE_ROLE_KEY: svc })) {
    if (typeof v === "string" && (v.includes(REF_PRODUCCION) || HOSTS_PRODUCCION.some((h) => v.includes(h)))) errores.push(`${n} contiene el ref/host de producción.`);
  }
  const ok = errores.length === 0;
  return { ok, errores, cfg: ok ? { ref, url: `https://${ref}.supabase.co`, anon, service: svc } : undefined };
}

// ── Argumentos: NUNCA claves ─────────────────────────────────────────────────────────────────────────────────────────────
export function parsearArgs(argv) {
  const r = { listar: false, ayuda: false, limpiar: false, solo: null, errores: [] };
  for (const a of argv) {
    if (/^--(anon|key|clave|service|service-role|secret|token|password|apikey|url|ref|env)\b/i.test(a) || /eyJ|sb_(secret|publishable)_/.test(a)) {
      r.errores.push("Las claves y datos de conexión NO se aceptan por argumentos: solo por variables de entorno.");
      continue;
    }
    if (a === "--listar" || a === "--plan") r.listar = true;
    else if (a === "--ayuda" || a === "--help" || a === "-h") r.ayuda = true;
    else if (a === "--limpiar") r.limpiar = true;
    else if (a.startsWith("--solo=")) r.solo = a.slice(7).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else r.errores.push("Argumento no reconocido (el valor no se muestra). Usá --ayuda.");
  }
  return r;
}

// ── Helpers de resultado ─────────────────────────────────────────────────────────────────────────────────────────────────
const pass = (esperado, observado) => ({ estado: "PASS", esperado, observado });
const fail = (esperado, observado) => ({ estado: "FAIL", esperado, observado });
const skip = (razon) => ({ estado: "SKIP", esperado: "-", observado: razon });
const errTxt = (r) => {
  if (!r) return "sin respuesta";
  if (!r.error) return `sin error (HTTP ${r.status ?? "?"})`;
  return `HTTP ${r.status ?? "?"} · código ${r.error.code ?? "?"} · ${String(r.error.message ?? "").slice(0, 100)}`;
};
const bloqueadoRLS = (r) => !!r?.error && (r.error.code === "42501" || /row-level security/i.test(String(r.error.message ?? "")));
const nFilas = (r) => (Array.isArray(r?.data) ? r.data.length : null);
const mismo = (a, b) => (a === b) || (a != null && b != null && String(a) === String(b)) || (a == null && b == null) || (a != null && b != null && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && Number(a) === Number(b));
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** Comprueba que la semilla requerida esté presente; si no, devuelve el motivo del SKIP. */
function faltaSemilla(c, claves) {
  const falta = claves.filter((k) => !c.semilla?.ok?.[k]);
  return falta.length ? `semilla incompleta o ausente (${falta.join(", ")}): aplicar el seed ficticio ANTES de V3 (PLAN-V3-STAGING.md §4).` : null;
}

/**
 * Intenta PATCH y DELETE con la ANON sobre una fila (de la semilla) donde NO deben estar permitidos.
 * Antes toma una foto de la fila con la service_role (solo memoria) y después RELEE para comprobar que no cambió ni se borró.
 * Si algo cambió/borró (FAIL), lo registra para poder restaurarlo con --limpiar (o a mano con el seed).
 */
async function intentarEscrituraProhibida(c, { tabla, buscar, col, marca, idCol = "id" }) {
  const b = await buscar(c.svc);
  if (b.error) return { estado: "SKIP", detalle: `${tabla}: no se pudo leer una fila para probar (${errTxt(b)})` };
  const fila = b.data?.[0];
  if (!fila) return { estado: "SKIP", detalle: `${tabla}: sin filas para probar (no evaluable)` };
  const idVal = fila[idCol], orig = fila[col];
  const valorMarca = mismo(orig, marca) ? `${marca}-2` : marca;
  const snapshot = { ...fila };
  // PATCH con la anon
  const up = await c.anon.from(tabla).update({ [col]: valorMarca }).eq(idCol, idVal).select(idCol);
  const post = await c.svc.from(tabla).select(`${idCol},${col}`).eq(idCol, idVal);
  const cambio = !!post.data?.[0] && !mismo(post.data[0][col], orig);
  if (cambio) c.reg.restauraciones.push({ tipo: "columna", tabla, idCol, idVal, col, orig, marcadoConValor: valorMarca });
  // DELETE con la anon
  const del = await c.anon.from(tabla).delete().eq(idCol, idVal).select(idCol);
  const post2 = await c.svc.from(tabla).select(idCol).eq(idCol, idVal);
  const borrada = !post2.error && (post2.data?.length ?? 0) === 0;
  if (borrada) c.reg.restauraciones.push({ tipo: "reinsertar", tabla, snapshot });
  const obs = `PATCH: ${nFilas(up) ?? "err"} fila(s) visible(s), ${cambio ? "CAMBIÓ" : "sin cambios"} · DELETE: ${nFilas(del) ?? "err"} fila(s), ${borrada ? "SE BORRÓ" : "la fila sigue"}`;
  return { estado: cambio || borrada ? "FAIL" : "PASS", detalle: `${tabla}: ${obs}` };
}
const veredictoTabla = (partes, exito) => {
  const evaluables = partes.filter((p) => p.estado !== "SKIP");
  const hayFail = partes.some((p) => p.estado === "FAIL");
  const detalle = partes.map((p) => p.detalle).join(" | ");
  if (!evaluables.length) return skip(detalle);
  return hayFail ? fail(exito, detalle) : pass(exito, detalle);
};

// ═══════════════════════════════ CATÁLOGO DE PRUEBAS (A1–A15, B1–B16) ═══════════════════════════════
export const PRUEBAS = [
  // ── A) SOLO LECTURA ─────────────────────────────────────────────────────────────────────────────────────────────────────
  { id: "A1", grupo: "A", titulo: "usuarios: lectura abierta a anon", metodo: "GET", endpoint: "/rest/v1/usuarios?select=id,email,rol", escribe: false, obligatoria: true, requiere: ["usuarios"],
    esperado: "200 con los 6 usuarios del seed visibles (OBS)", diferencia: "[] , 401 o 403",
    async ejecutar(c) {
      const ids = Object.values(c.D.ID);
      const r = await c.anon.from("usuarios").select("id,email,rol").in("id", ids);
      if (r.error) return fail(`${ids.length} usuarios del seed visibles`, errTxt(r));
      return r.data.length === ids.length ? pass(`${ids.length} usuarios del seed visibles`, `${r.data.length}/${ids.length} visibles`) : fail(`${ids.length} usuarios del seed visibles`, `${r.data.length}/${ids.length} visibles`);
    } },
  { id: "A2", grupo: "A", titulo: "usuarios: la columna password es legible", metodo: "GET", endpoint: "/rest/v1/usuarios?select=id,password", escribe: false, obligatoria: true, requiere: ["usuarios"],
    esperado: "columna legible para anon (sin permisos por columna); en staging es un hash bcrypt (OBS/DER)", diferencia: "error de permiso o campo nulo",
    async ejecutar(c) {
      const ids = Object.values(c.D.ID);
      const r = await c.anon.from("usuarios").select("id,password").in("id", ids);
      if (r.error) return fail("password legible", errTxt(r));
      const leg = r.data.filter((x) => typeof x.password === "string" && x.password.length > 0).length;
      const bc = r.data.filter((x) => typeof x.password === "string" && x.password.startsWith("$2")).length;
      const obs = `${leg}/${ids.length} contraseñas legibles (formato bcrypt: ${bc}); los valores NO se imprimen`;
      return leg === ids.length ? pass("password legible en los 6 usuarios del seed", obs) : fail("password legible en los 6 usuarios del seed", obs);
    } },
  { id: "A3", grupo: "A", titulo: "usuarios: datos sensibles legibles (solo existencia)", metodo: "GET", endpoint: "/rest/v1/usuarios?select=dni,cuit_cuil,alias_cbu_cvu,titular_cuenta,telefono", escribe: false, obligatoria: true, requiere: ["usuarios"],
    esperado: "columnas legibles (DER); dni y telefono en los 6, cuit/alias/titular en los 3 choferes", diferencia: "error de permiso o vacío",
    async ejecutar(c) {
      const ids = Object.values(c.D.ID);
      const r = await c.anon.from("usuarios").select("id,dni,cuit_cuil,alias_cbu_cvu,titular_cuenta,telefono").in("id", ids);
      if (r.error) return fail("columnas sensibles legibles", errTxt(r));
      const choferes = new Set(Object.keys(c.D.ID).filter((k) => c.D.ROL[k] === "chofer").map((k) => c.D.ID[k]));
      const cuenta = (col, soloChoferes) => r.data.filter((x) => (!soloChoferes || choferes.has(x.id)) && x[col] != null && String(x[col]).length > 0).length;
      const n = { dni: cuenta("dni"), telefono: cuenta("telefono"), cuit_cuil: cuenta("cuit_cuil", true), alias_cbu_cvu: cuenta("alias_cbu_cvu", true), titular_cuenta: cuenta("titular_cuenta", true) };
      const ok = n.dni === ids.length && n.telefono === ids.length && n.cuit_cuil === choferes.size && n.alias_cbu_cvu === choferes.size && n.titular_cuenta === choferes.size;
      const obs = `presentes: dni ${n.dni}/${ids.length}, telefono ${n.telefono}/${ids.length}, cuit_cuil ${n.cuit_cuil}/${choferes.size}, alias ${n.alias_cbu_cvu}/${choferes.size}, titular ${n.titular_cuenta}/${choferes.size} (valores NO impresos)`;
      return ok ? pass("datos sensibles visibles para anon", obs) : fail("datos sensibles visibles para anon", obs);
    } },
  { id: "A4", grupo: "A", titulo: "vehiculos: lectura abierta a anon", metodo: "GET", endpoint: "/rest/v1/vehiculos", escribe: false, obligatoria: true, requiere: ["vehiculos"],
    esperado: "3 vehículos del seed visibles (OBS)", diferencia: "[]",
    async ejecutar(c) {
      const ids = c.D.vehiculos("x").map((v) => v.id);
      const r = await c.anon.from("vehiculos").select("id").in("id", ids);
      if (r.error) return fail(`${ids.length} vehículos visibles`, errTxt(r));
      return r.data.length === ids.length ? pass(`${ids.length} vehículos visibles`, `${r.data.length}/${ids.length}`) : fail(`${ids.length} vehículos visibles`, `${r.data.length}/${ids.length}`);
    } },
  { id: "A5", grupo: "A", titulo: "documentacion_chofer: lectura abierta a anon", metodo: "GET", endpoint: "/rest/v1/documentacion_chofer", escribe: false, obligatoria: true, requiere: ["docs"],
    esperado: "26 filas del seed visibles (OBS)", diferencia: "[]",
    async ejecutar(c) {
      const total = c.D.documentacion("x").filas.length;
      const r = await c.anon.from("documentacion_chofer").select("id").in("chofer_id", Object.values(c.D.ID));
      if (r.error) return fail(`≥ ${total} filas visibles`, errTxt(r));
      return r.data.length >= total ? pass(`≥ ${total} filas visibles`, `${r.data.length} filas visibles`) : fail(`≥ ${total} filas visibles`, `${r.data.length} filas visibles`);
    } },
  { id: "A6", grupo: "A", titulo: "paradas_viaje: lectura abierta a anon", metodo: "GET", endpoint: "/rest/v1/paradas_viaje", escribe: false, obligatoria: true, requiere: ["paradas"],
    esperado: "5 paradas del seed visibles (OBS)", diferencia: "[]",
    async ejecutar(c) {
      const ids = c.D.paradas().map((p) => p.id);
      const r = await c.anon.from("paradas_viaje").select("id").in("id", ids);
      if (r.error) return fail(`${ids.length} paradas visibles`, errTxt(r));
      return r.data.length === ids.length ? pass(`${ids.length} paradas visibles`, `${r.data.length}/${ids.length}`) : fail(`${ids.length} paradas visibles`, `${r.data.length}/${ids.length}`);
    } },
  { id: "A7", grupo: "A", titulo: "viaje_evidencias: lectura abierta a anon", metodo: "GET", endpoint: "/rest/v1/viaje_evidencias", escribe: false, obligatoria: true, requiere: ["evidencias"],
    esperado: "3 evidencias del seed visibles (OBS)", diferencia: "[]",
    async ejecutar(c) {
      const ids = c.D.evidencias("x").map((e) => e.id);
      const r = await c.anon.from("viaje_evidencias").select("id").in("id", ids);
      if (r.error) return fail(`${ids.length} evidencias visibles`, errTxt(r));
      return r.data.length === ids.length ? pass(`${ids.length} evidencias visibles`, `${r.data.length}/${ids.length}`) : fail(`${ids.length} evidencias visibles`, `${r.data.length}/${ids.length}`);
    } },
  ...[["A8", "cargas", "cargas", "cargas"], ["A9", "mensajes_viaje", "mensajes", "mensajes_viaje"], ["A10", "billetera_chofer", "billetera", "billetera_chofer"], ["A11", "consentimientos_legales", "consentimientos", "consentimientos_legales"]].map(([id, tabla, clave]) => ({
    id, grupo: "A", titulo: `${tabla}: RLS sin policies → anon no ve nada`, metodo: "GET", endpoint: `/rest/v1/${tabla}`, escribe: false, obligatoria: true, requiere: [clave],
    esperado: "200 con [] (RLS activo sin policies; OBS del 18/09)", diferencia: "cualquier fila visible",
    async ejecutar(c) {
      const r = await c.anon.from(tabla).select("id").limit(5);
      if (r.error) return fail("200 con []", errTxt(r));
      return r.data.length === 0 ? pass("200 con []", `0 filas (HTTP ${r.status ?? 200}); la service_role confirma que la tabla SÍ tiene filas`) : fail("200 con []", `${r.data.length} fila(s) visible(s)`);
    } })),
  { id: "A12", grupo: "A", titulo: "tarifas_config: RLS sin policies → anon no ve nada", metodo: "GET", endpoint: "/rest/v1/tarifas_config", escribe: false, obligatoria: false, requiere: ["tarifas"],
    esperado: "200 con [] (DER). No obligatoria: el seed no carga esta tabla, y vacía no distingue RLS cerrada de tabla vacía", diferencia: "cualquier fila visible",
    async ejecutar(c) {
      const r = await c.anon.from("tarifas_config").select("id").limit(5);
      if (r.error) return fail("200 con []", errTxt(r));
      return r.data.length === 0 ? pass("200 con []", "0 filas; la service_role confirma que la tabla tiene filas") : fail("200 con []", `${r.data.length} fila(s) visible(s)`);
    } },
  { id: "A13", grupo: "A", titulo: "Storage: anon puede LISTAR objetos de ambos buckets", metodo: "POST", endpoint: "/storage/v1/object/list/<bucket> (solo lectura)", escribe: false, obligatoria: true, requiere: ["storage"],
    esperado: "lista los archivos del seed (DER: policy SELECT abierta)", diferencia: "lista vacía o 403",
    async ejecutar(c) {
      const { archivos } = c.D.documentacion("x");
      const pref = c.D.ID.chofer1;
      const det = []; let ok = true;
      for (const b of BUCKETS) {
        const esp = archivos.filter((a) => a.bucket === b && a.ruta.startsWith(pref + "/")).map((a) => a.ruta.slice(pref.length + 1));
        const r = await c.anon.storage.from(b).list(pref);
        if (r.error) { ok = false; det.push(`${b}: ${errTxt(r)}`); continue; }
        const nombres = new Set((r.data ?? []).map((o) => o.name));
        const vistos = esp.filter((n) => nombres.has(n)).length;
        if (vistos !== esp.length) ok = false;
        det.push(`${b}: ${vistos}/${esp.length} archivos del seed listados`);
      }
      return ok ? pass("ambos buckets listables por anon", det.join(" | ")) : fail("ambos buckets listables por anon", det.join(" | "));
    } },
  { id: "A14", grupo: "A", titulo: "Storage: lectura por URL pública", metodo: "GET", endpoint: "/storage/v1/object/public/<bucket>/<ruta del seed>", escribe: false, obligatoria: true, requiere: ["storage"],
    esperado: "200 e imagen (DER: buckets públicos)", diferencia: "400 o 404",
    async ejecutar(c) {
      const { archivos } = c.D.documentacion("x");
      const det = []; let ok = true;
      for (const b of BUCKETS) {
        const a = archivos.find((x) => x.bucket === b);
        const { data } = c.anon.storage.from(b).getPublicUrl(a.ruta);
        const res = await c.fetchFn(data.publicUrl);
        const tipo = String(res.headers?.get?.("content-type") ?? "");
        await res.arrayBuffer?.();
        const bien = res.status === 200 && tipo.startsWith("image/");
        if (!bien) ok = false;
        det.push(`${b}: HTTP ${res.status}${tipo ? ` (${tipo.split(";")[0]})` : ""}`);
      }
      return ok ? pass("200 e imagen en ambos buckets", det.join(" | ")) : fail("200 e imagen en ambos buckets", det.join(" | "));
    } },
  { id: "A15", grupo: "A", titulo: "control de diferencia esperada: tabla backup_* excluida", metodo: "GET", endpoint: "/rest/v1/backup_usuarios_20260614", escribe: false, obligatoria: true, requiere: [],
    esperado: "diferencia ESPERADA: en producción daría [] (RLS); en staging la tabla no existe (4xx). Solo sería un problema si devolviera filas", diferencia: "solo si devolviera filas",
    async ejecutar(c) {
      const r = await c.anon.from("backup_usuarios_20260614").select("id").limit(1);
      if (r.error) return pass("tabla ausente (4xx) o sin filas", `tabla ausente en staging: ${errTxt(r)} (diferencia esperada, documentada)`);
      return r.data.length === 0 ? pass("tabla ausente (4xx) o sin filas", "200 con [] (la tabla existe pero no expone filas)") : fail("tabla ausente (4xx) o sin filas", `${r.data.length} fila(s) visible(s): NO debería haber datos de backup en staging`);
    } },

  // ── B) ESCRITURAS FICTICIAS CON MARCADOR (anon; la service_role solo verifica) ─────────────────────────────────────────
  { id: "B1", grupo: "B", titulo: "usuarios: INSERT rol=cliente permitido", metodo: "POST", endpoint: "/rest/v1/usuarios", escribe: true, obligatoria: true, requiere: [],
    esperado: "201 (anon_insert_usuarios_no_admin)", diferencia: "rechazado",
    async ejecutar(c) {
      const id = crypto.randomUUID(), email = `v3-${c.runId}-cliente${DOMINIO_EMAIL}`;
      c.reg.usuarios.push(id);
      const r = await c.anon.from("usuarios").insert({ id, email, nombre: MARCADOR, rol: "cliente" });
      if (r.error) return fail("201 y fila creada", errTxt(r));
      const v = await c.svc.from("usuarios").select("id,email").eq("id", id);
      if (v.data?.length === 1 && v.data[0].email === email) { c.est.idCliente = id; return pass("201 y fila creada", `HTTP ${r.status ?? 201}; la service_role confirma la fila (marcada)`); }
      return fail("201 y fila creada", `HTTP ${r.status ?? "?"} pero la relectura no encuentra la fila`);
    } },
  { id: "B2", grupo: "B", titulo: "usuarios: INSERT rol=admin RECHAZADO", metodo: "POST", endpoint: "/rest/v1/usuarios", escribe: true, obligatoria: true, requiere: [],
    esperado: "403 / 42501 (WITH CHECK rol ∈ {cliente, chofer})", diferencia: "se crea",
    async ejecutar(c) {
      const id = crypto.randomUUID(), email = `v3-${c.runId}-admin${DOMINIO_EMAIL}`;
      c.reg.usuarios.push(id);
      const r = await c.anon.from("usuarios").insert({ id, email, nombre: MARCADOR, rol: "admin" });
      const v = await c.svc.from("usuarios").select("id").eq("email", email);
      const creada = (v.data?.length ?? 0) > 0;
      if (creada) return fail("rechazado por RLS y fila inexistente", `SE CREÓ un usuario admin (${errTxt(r)})`);
      return bloqueadoRLS(r) ? pass("rechazado por RLS y fila inexistente", `${errTxt(r)}; la relectura confirma que no existe`) : fail("rechazado por RLS y fila inexistente", `no se creó, pero el motivo no es RLS: ${errTxt(r)}`);
    } },
  { id: "B3", grupo: "B", titulo: "usuarios: INSERT rol=chofer permitido", metodo: "POST", endpoint: "/rest/v1/usuarios", escribe: true, obligatoria: true, requiere: [],
    esperado: "201", diferencia: "rechazado",
    async ejecutar(c) {
      const id = crypto.randomUUID(), email = `v3-${c.runId}-chofer${DOMINIO_EMAIL}`;
      c.reg.usuarios.push(id);
      const r = await c.anon.from("usuarios").insert({ id, email, nombre: MARCADOR, rol: "chofer" });
      if (r.error) return fail("201 y fila creada", errTxt(r));
      const v = await c.svc.from("usuarios").select("id,email").eq("id", id);
      if (v.data?.length === 1 && v.data[0].email === email) { c.est.idChofer = id; return pass("201 y fila creada", `HTTP ${r.status ?? 201}; la service_role confirma la fila (marcada)`); }
      return fail("201 y fila creada", `HTTP ${r.status ?? "?"} pero la relectura no encuentra la fila`);
    } },
  { id: "B4", grupo: "B", titulo: "usuarios: PATCH abierto (rol, estado, password) sobre la fila de B1", metodo: "PATCH", endpoint: "/rest/v1/usuarios?id=eq.<B1>", escribe: true, obligatoria: true, requiere: [], dependeDe: ["B1"],
    esperado: "200/204 y la fila CAMBIA (anon_update_usuarios_permisivo): la escalada de privilegios que reproducimos a propósito", diferencia: "rechazado o sin cambio",
    async ejecutar(c) {
      if (!c.est.idCliente) return skip("depende de B1 (la fila de prueba no existe)");
      const pw = crypto.randomBytes(24).toString("hex");
      const r = await c.anon.from("usuarios").update({ rol: "admin", estado_aprobacion: "rechazado", password: pw }).eq("id", c.est.idCliente).select("id");
      const v = await c.svc.from("usuarios").select("rol,estado_aprobacion,password").eq("id", c.est.idCliente);
      const f = v.data?.[0];
      const cambio = !!f && f.rol === "admin" && f.estado_aprobacion === "rechazado" && f.password === pw;
      const obs = `${nFilas(r) ?? "err"} fila(s) actualizada(s); rol/estado/password ${cambio ? "CAMBIARON" : "NO cambiaron"} (valores NO impresos)`;
      return cambio ? pass("la fila cambia (policy permisiva)", obs) : fail("la fila cambia (policy permisiva)", `${obs}; ${r.error ? errTxt(r) : ""}`);
    } },
  { id: "B5", grupo: "B", titulo: "usuarios: DELETE sin efecto (no hay policy DELETE)", metodo: "DELETE", endpoint: "/rest/v1/usuarios?id=eq.<B1>", escribe: true, obligatoria: true, requiere: [], dependeDe: ["B1"],
    esperado: "0 filas afectadas; la fila sigue", diferencia: "se borra",
    async ejecutar(c) {
      if (!c.est.idCliente) return skip("depende de B1 (la fila de prueba no existe)");
      const r = await c.anon.from("usuarios").delete().eq("id", c.est.idCliente).select("id");
      const v = await c.svc.from("usuarios").select("id").eq("id", c.est.idCliente);
      const sigue = (v.data?.length ?? 0) === 1;
      const obs = `${r.error ? errTxt(r) : `${nFilas(r)} fila(s) borrada(s)`}; ${sigue ? "la fila sigue" : "LA FILA SE BORRÓ"}`;
      return sigue ? pass("0 filas y la fila sigue", obs) : fail("0 filas y la fila sigue", obs);
    } },
  { id: "B6", grupo: "B", titulo: "vehiculos y documentacion_chofer: INSERT RECHAZADO", metodo: "POST", endpoint: "/rest/v1/vehiculos · /rest/v1/documentacion_chofer", escribe: true, obligatoria: true, requiere: [],
    esperado: "403 / 42501 en ambas (sin policy INSERT)", diferencia: "se crea",
    async ejecutar(c) {
      const chofer = c.est.idChofer ?? crypto.randomUUID();
      const casos = [
        { t: "vehiculos", fila: { chofer_id: chofer, marca: MARCADOR, modelo: MARCADOR, patente: "V3-MARC", tipo_vehiculo: "otro" }, marca: ["patente", "V3-MARC"] },
        { t: "documentacion_chofer", fila: { chofer_id: chofer, tipo: MARCADOR, url: MARCADOR }, marca: ["tipo", MARCADOR] },
      ];
      const det = []; let ok = true;
      for (const k of casos) {
        const r = await c.anon.from(k.t).insert(k.fila);
        const v = await c.svc.from(k.t).select("id").eq(k.marca[0], k.marca[1]);
        for (const x of v.data ?? []) c.reg.inesperados.push({ tabla: k.t, idCol: "id", id: x.id, colMarca: k.marca[0], valorMarca: k.marca[1] });
        const creada = (v.data?.length ?? 0) > 0;
        const rls = bloqueadoRLS(r);
        if (creada || !rls) ok = false;
        det.push(`${k.t}: ${creada ? "SE CREÓ" : rls ? "bloqueado por RLS" : `no bloqueado por RLS (${errTxt(r)})`}`);
      }
      return ok ? pass("ambas rechazadas por RLS", det.join(" | ")) : fail("ambas rechazadas por RLS", det.join(" | "));
    } },
  { id: "B7", grupo: "B", titulo: "vehiculos y documentacion_chofer: PATCH/DELETE sin efecto (sobre filas del seed)", metodo: "PATCH · DELETE", endpoint: "/rest/v1/vehiculos · /rest/v1/documentacion_chofer", escribe: true, obligatoria: true, requiere: ["vehiculos", "docs"],
    esperado: "0 filas afectadas y SIN cambios (relectura con service_role); se toma una foto de la fila antes", diferencia: "cambia o se borra",
    async ejecutar(c) {
      const partes = [
        await intentarEscrituraProhibida(c, { tabla: "vehiculos", col: "color", marca: MARCADOR, buscar: (s) => s.from("vehiculos").select("*").eq("id", c.D.VEHICULO_ID.chofer3).limit(1) }),
        await intentarEscrituraProhibida(c, { tabla: "documentacion_chofer", col: "url", marca: MARCADOR, buscar: (s) => s.from("documentacion_chofer").select("*").eq("chofer_id", c.D.ID.chofer3).eq("tipo", "dni_frente").limit(1) }),
      ];
      return veredictoTabla(partes, "sin cambios ni borrados");
    } },
  { id: "B8", grupo: "B", titulo: "paradas_viaje: INSERT abierto", metodo: "POST", endpoint: "/rest/v1/paradas_viaje", escribe: true, obligatoria: true, requiere: ["cargas"],
    esperado: "201 (permitir insertar paradas anon y authenticated)", diferencia: "rechazado",
    async ejecutar(c) {
      const r = await c.anon.from("paradas_viaje").insert({ carga_id: 101, orden: 99, tipo: "parada", direccion: MARCADOR, estado: "pendiente" }).select("id");
      if (r.error) return fail("201 y fila creada", errTxt(r));
      const id = r.data?.[0]?.id;
      if (id != null) c.reg.paradas.push(id);
      const v = id != null ? await c.svc.from("paradas_viaje").select("id,direccion").eq("id", id) : { data: [] };
      if (v.data?.length === 1 && v.data[0].direccion === MARCADOR) { c.est.idParada = id; return pass("201 y fila creada", `HTTP ${r.status ?? 201}; la service_role confirma la fila (marcada)`); }
      return fail("201 y fila creada", "respuesta sin error pero la relectura no encuentra la fila");
    } },
  { id: "B9", grupo: "B", titulo: "paradas_viaje: PATCH permitido, DELETE sin efecto", metodo: "PATCH · DELETE", endpoint: "/rest/v1/paradas_viaje?id=eq.<B8>", escribe: true, obligatoria: true, requiere: [], dependeDe: ["B8"],
    esperado: "PATCH cambia la fila; DELETE 0 filas y la fila sigue", diferencia: "al revés",
    async ejecutar(c) {
      if (!c.est.idParada) return skip("depende de B8 (la fila de prueba no existe)");
      const up = await c.anon.from("paradas_viaje").update({ estado: "en_curso" }).eq("id", c.est.idParada).select("id");
      const v1 = await c.svc.from("paradas_viaje").select("estado").eq("id", c.est.idParada);
      const cambio = v1.data?.[0]?.estado === "en_curso";
      const del = await c.anon.from("paradas_viaje").delete().eq("id", c.est.idParada).select("id");
      const v2 = await c.svc.from("paradas_viaje").select("id").eq("id", c.est.idParada);
      const sigue = (v2.data?.length ?? 0) === 1;
      const obs = `PATCH: ${nFilas(up) ?? "err"} fila(s), ${cambio ? "cambió" : "NO cambió"} · DELETE: ${del.error ? errTxt(del) : `${nFilas(del)} fila(s)`}, ${sigue ? "la fila sigue" : "SE BORRÓ"}`;
      return cambio && sigue ? pass("PATCH cambia, DELETE sin efecto", obs) : fail("PATCH cambia, DELETE sin efecto", obs);
    } },
  { id: "B10", grupo: "B", titulo: "viaje_evidencias: INSERT abierto (rol public)", metodo: "POST", endpoint: "/rest/v1/viaje_evidencias", escribe: true, obligatoria: true, requiere: ["cargas"],
    esperado: "201 (viaje_evidencias_insert)", diferencia: "rechazado",
    async ejecutar(c) {
      const r = await c.anon.from("viaje_evidencias").insert({ carga_id: 101, evento: MARCADOR, observacion: MARCADOR, rol_usuario: "v3" }).select("id");
      if (r.error) return fail("201 y fila creada", errTxt(r));
      const id = r.data?.[0]?.id;
      if (id != null) c.reg.evidencias.push(id);
      const v = id != null ? await c.svc.from("viaje_evidencias").select("id,observacion").eq("id", id) : { data: [] };
      if (v.data?.length === 1 && v.data[0].observacion === MARCADOR) { c.est.idEvidencia = id; return pass("201 y fila creada", `HTTP ${r.status ?? 201}; la service_role confirma la fila (marcada)`); }
      return fail("201 y fila creada", "respuesta sin error pero la relectura no encuentra la fila");
    } },
  { id: "B11", grupo: "B", titulo: "viaje_evidencias: PATCH y DELETE sin efecto", metodo: "PATCH · DELETE", endpoint: "/rest/v1/viaje_evidencias?id=eq.<B10>", escribe: true, obligatoria: true, requiere: [], dependeDe: ["B10"],
    esperado: "0 filas afectadas y sin cambios", diferencia: "cambia o se borra",
    async ejecutar(c) {
      if (!c.est.idEvidencia) return skip("depende de B10 (la fila de prueba no existe)");
      const up = await c.anon.from("viaje_evidencias").update({ observacion: `${MARCADOR}-2` }).eq("id", c.est.idEvidencia).select("id");
      const v1 = await c.svc.from("viaje_evidencias").select("observacion").eq("id", c.est.idEvidencia);
      const cambio = v1.data?.[0]?.observacion !== MARCADOR;
      const del = await c.anon.from("viaje_evidencias").delete().eq("id", c.est.idEvidencia).select("id");
      const v2 = await c.svc.from("viaje_evidencias").select("id").eq("id", c.est.idEvidencia);
      const sigue = (v2.data?.length ?? 0) === 1;
      const obs = `PATCH: ${nFilas(up) ?? "err"} fila(s), ${cambio ? "CAMBIÓ" : "sin cambios"} · DELETE: ${nFilas(del) ?? "err"} fila(s), ${sigue ? "la fila sigue" : "SE BORRÓ"}`;
      return !cambio && sigue ? pass("sin cambios ni borrados", obs) : fail("sin cambios ni borrados", obs);
    } },
  { id: "B12", grupo: "B", titulo: "cargas, mensajes_viaje, billetera_chofer, consentimientos_legales, tarifas_config: INSERT RECHAZADO", metodo: "POST", endpoint: "/rest/v1/<5 tablas sin policies>", escribe: true, obligatoria: true, requiere: [],
    esperado: "403 / 42501 en las 5 (RLS sin policies) y ninguna fila creada", diferencia: "se crea",
    async ejecutar(c) {
      const uid = c.est.idChofer ?? crypto.randomUUID();
      const NUM = 987654.321;
      const casos = [
        { t: "cargas", fila: { detalles: MARCADOR, estado: MARCADOR, origen: MARCADOR }, col: "detalles", val: MARCADOR },
        { t: "mensajes_viaje", fila: { viaje_id: 101, remitente_id: uid, remitente_rol: "v3", remitente_nombre: MARCADOR, mensaje: MARCADOR }, col: "mensaje", val: MARCADOR },
        { t: "billetera_chofer", fila: { chofer_id: MARCADOR, viaje_id: MARCADOR, monto: 0 }, col: "viaje_id", val: MARCADOR },
        { t: "consentimientos_legales", fila: { usuario_id: uid, tipo_documento: MARCADOR, version_documento: "v3" }, col: "tipo_documento", val: MARCADOR },
        { t: "tarifas_config", fila: { extra_fragil: NUM }, col: "extra_fragil", val: NUM },
      ];
      const det = []; let ok = true;
      for (const k of casos) {
        const r = await c.anon.from(k.t).insert(k.fila);
        const v = await c.svc.from(k.t).select("id").eq(k.col, k.val);
        for (const x of v.data ?? []) c.reg.inesperados.push({ tabla: k.t, idCol: "id", id: x.id, colMarca: k.col, valorMarca: k.val });
        const creada = (v.data?.length ?? 0) > 0;
        const rls = bloqueadoRLS(r);
        const fk = r.error?.code === "23503";
        if (creada || !rls) ok = false;
        det.push(`${k.t}: ${creada ? "SE CREÓ" : rls ? "bloqueado" : fk ? "RLS PERMITIÓ el INSERT (falló luego por FK)" : `no bloqueado por RLS (${errTxt(r)})`}`);
      }
      return ok ? pass("las 5 rechazadas por RLS", det.join(" | ")) : fail("las 5 rechazadas por RLS", det.join(" | "));
    } },
  { id: "B13", grupo: "B", titulo: "esas 5 tablas: PATCH/DELETE sin efecto (sobre filas del seed)", metodo: "PATCH · DELETE", endpoint: "/rest/v1/<5 tablas sin policies>", escribe: true, obligatoria: true, requiere: ["cargas", "mensajes", "billetera", "consentimientos"],
    esperado: "0 filas afectadas y SIN cambios (relectura con service_role; se toma foto antes). tarifas_config sin filas → no evaluable", diferencia: "alguna cambia o se borra",
    async ejecutar(c) {
      const T = (tabla, col, buscar, marca = MARCADOR) => intentarEscrituraProhibida(c, { tabla, col, marca, buscar });
      const partes = [
        await T("cargas", "detalles", (s) => s.from("cargas").select("*").eq("id", 105).limit(1)),
        await T("mensajes_viaje", "mensaje", (s) => s.from("mensajes_viaje").select("*").eq("viaje_id", 104).limit(1)),
        await T("billetera_chofer", "viaje_id", (s) => s.from("billetera_chofer").select("*").eq("chofer_id", c.D.ID.chofer2).limit(1)),
        await T("consentimientos_legales", "user_agent", (s) => s.from("consentimientos_legales").select("*").eq("usuario_id", c.D.ID.cliente2).limit(1)),
        await T("tarifas_config", "extra_fragil", (s) => s.from("tarifas_config").select("*").limit(1), 987654.321),
      ];
      return veredictoTabla(partes, "sin cambios ni borrados");
    } },
  { id: "B14", grupo: "B", titulo: "Storage: anon puede SUBIR (incluso un archivo que no es imagen)", metodo: "POST", endpoint: "/storage/v1/object/<bucket>/v3-marcador/…", escribe: true, obligatoria: true, requiere: [],
    esperado: "permitido en ambos buckets (INSERT abierto; sin límite de MIME)", diferencia: "rechazado",
    async ejecutar(c) {
      const carpeta = `${PREFIJO_STORAGE}${c.runId}`;
      const objetos = [{ bucket: "vehiculos", ruta: `${carpeta}/prueba.png`, cuerpo: PNG_1X1, tipo: "image/png" }, { bucket: "documentacion-choferes", ruta: `${carpeta}/nota.txt`, cuerpo: Buffer.from(`${MARCADOR} texto (no es imagen)`), tipo: "text/plain" }];
      const det = []; let ok = true;
      for (const o of objetos) {
        c.reg.storage.push({ bucket: o.bucket, ruta: o.ruta });
        const r = await c.anon.storage.from(o.bucket).upload(o.ruta, o.cuerpo, { contentType: o.tipo, upsert: false });
        const l = await c.svc.storage.from(o.bucket).list(carpeta);
        const existe = (l.data ?? []).some((x) => x.name === o.ruta.split("/").pop());
        if (r.error || !existe) ok = false;
        det.push(`${o.bucket} (${o.tipo}): ${r.error ? errTxt(r) : "subido"}${existe ? "; existe (relectura)" : "; NO existe en la relectura"}`);
        if (existe) c.est.storage.push(o);
      }
      return ok ? pass("subida permitida en ambos buckets", det.join(" | ")) : fail("subida permitida en ambos buckets", det.join(" | "));
    } },
  { id: "B15", grupo: "B", titulo: "Storage: anon puede REEMPLAZAR (upsert) un objeto existente", metodo: "PUT/POST (upsert)", endpoint: "/storage/v1/object/vehiculos/v3-marcador/…", escribe: true, obligatoria: true, requiere: [], dependeDe: ["B14"],
    esperado: "permitido (policy UPDATE abierta)", diferencia: "rechazado",
    async ejecutar(c) {
      const o = c.est.storage.find((x) => x.bucket === "vehiculos");
      if (!o) return skip("depende de B14 (el objeto de prueba no existe)");
      const nuevo = Buffer.concat([PNG_1X1, Buffer.from(MARCADOR)]);
      const r = await c.anon.storage.from(o.bucket).upload(o.ruta, nuevo, { contentType: "image/png", upsert: true });
      if (r.error) return fail("reemplazo permitido", errTxt(r));
      const d = await c.svc.storage.from(o.bucket).download(o.ruta);
      if (d.error || !d.data) return fail("reemplazo permitido", "subió sin error pero no se pudo releer el objeto");
      const igual = sha(Buffer.from(await d.data.arrayBuffer())) === sha(nuevo);
      return igual ? pass("reemplazo permitido y verificado por contenido", "el contenido fue reemplazado (huella SHA-256 coincide; contenido no impreso)") : fail("reemplazo permitido y verificado por contenido", "sin error pero el contenido NO cambió");
    } },
  { id: "B16", grupo: "B", titulo: "Storage: anon NO puede borrar (sin policy DELETE)", metodo: "DELETE", endpoint: "/storage/v1/object/<bucket>/v3-marcador/…", escribe: true, obligatoria: true, requiere: [], dependeDe: ["B14"],
    esperado: "rechazado o sin efecto: el objeto sigue", diferencia: "se borra",
    async ejecutar(c) {
      if (!c.est.storage.length) return skip("depende de B14 (el objeto de prueba no existe)");
      const det = []; let ok = true;
      for (const o of c.est.storage) {
        const r = await c.anon.storage.from(o.bucket).remove([o.ruta]);
        const carpeta = o.ruta.slice(0, o.ruta.lastIndexOf("/"));
        const l = await c.svc.storage.from(o.bucket).list(carpeta);
        const sigue = (l.data ?? []).some((x) => x.name === o.ruta.split("/").pop());
        if (!sigue) ok = false;
        det.push(`${o.bucket}: ${r.error ? errTxt(r) : `${Array.isArray(r.data) ? r.data.length : "?"} objeto(s) borrado(s)`}; ${sigue ? "el objeto sigue" : "EL OBJETO SE BORRÓ"}`);
      }
      return ok ? pass("el objeto sigue en ambos buckets", det.join(" | ")) : fail("el objeto sigue en ambos buckets", det.join(" | "));
    } },
];

// ── Selección de pruebas (--solo) con dependencias ──────────────────────────────────────────────────────────────────────
export function seleccionar(solo, catalogo = PRUEBAS) {
  if (!solo || !solo.length) return { ids: catalogo.map((p) => p.id), errores: [], agregadasPorDependencia: [] };
  const conocidos = new Set(catalogo.map((p) => p.id));
  const errores = []; const pedidos = new Set();
  for (const t of solo) {
    if (t === "A" || t === "B") catalogo.filter((p) => p.grupo === t).forEach((p) => pedidos.add(p.id));
    else if (conocidos.has(t)) pedidos.add(t);
    else errores.push(`--solo: prueba desconocida "${String(t).slice(0, 12)}" (usá A, B o ids como A1,B4).`);
  }
  const agregadas = [];
  const agregar = (id) => { const p = catalogo.find((x) => x.id === id); for (const d of p.dependeDe ?? []) if (!pedidos.has(d)) { pedidos.add(d); agregadas.push(d); agregar(d); } };
  for (const id of [...pedidos]) agregar(id);
  return { ids: catalogo.map((p) => p.id).filter((id) => pedidos.has(id)), errores, agregadasPorDependencia: agregadas };
}

// ── Listado local (NO se conecta a nada ni lee variables) ───────────────────────────────────────────────────────────────
export function formatearListado(catalogo = PRUEBAS) {
  const l = ["V3 — pruebas con la anon key contra STAGING (modo --listar: NO se conecta a Supabase, NO lee claves, NO escribe nada)", ""];
  for (const g of ["A", "B"]) {
    l.push(g === "A" ? "A) 100 % SOLO LECTURA" : "B) ESCRITURAS FICTICIAS con marcador (anon escribe; service_role solo verifica)", "");
    for (const p of catalogo.filter((x) => x.grupo === g)) {
      l.push(`${p.id.padEnd(4)} ${p.titulo}`);
      l.push(`     ${p.metodo} ${p.endpoint}  ·  ${p.escribe ? "ESCRIBE datos ficticios" : "solo lectura"}  ·  ${p.obligatoria ? "obligatoria" : "NO obligatoria"}${p.dependeDe?.length ? `  ·  depende de ${p.dependeDe.join(",")}` : ""}`);
      l.push(`     esperado: ${p.esperado}`);
      l.push(`     sería una diferencia: ${p.diferencia}`, "");
    }
  }
  l.push(`Total: ${catalogo.filter((p) => p.grupo === "A").length} pruebas A y ${catalogo.filter((p) => p.grupo === "B").length} pruebas B.`);
  return l.join("\n");
}

// ── Semilla: ¿está aplicada? (lectura con service_role) ────────────────────────────────────────────────────────────────────
export async function detectarSemilla(svc, D) {
  const ids = Object.values(D.ID), ok = {}, faltantes = [];
  const cuenta = async (t, col, vals) => { const r = await svc.from(t).select("id").in(col, vals); return r.error ? { n: 0, e: errTxt(r) } : { n: r.data.length }; };
  const chequeos = [
    ["usuarios", "usuarios", "id", ids, ids.length], ["vehiculos", "vehiculos", "id", D.vehiculos("x").map((v) => v.id), 3],
    ["cargas", "cargas", "id", D.cargas().map((x) => x.id), D.cargas().length], ["paradas", "paradas_viaje", "id", D.paradas().map((x) => x.id), D.paradas().length],
    ["evidencias", "viaje_evidencias", "id", D.evidencias("x").map((x) => x.id), D.evidencias("x").length],
    ["docs", "documentacion_chofer", "chofer_id", ids, D.documentacion("x").filas.length], ["mensajes", "mensajes_viaje", "viaje_id", [103, 104], D.mensajes().length],
    ["billetera", "billetera_chofer", "chofer_id", ids, D.billetera().length], ["consentimientos", "consentimientos_legales", "usuario_id", ids, D.consentimientos().length],
  ];
  for (const [clave, tabla, col, vals, esperado] of chequeos) {
    const r = await cuenta(tabla, col, vals);
    ok[clave] = r.n >= esperado;
    if (!ok[clave]) faltantes.push(`${clave} ${r.n}/${esperado}${r.e ? ` (${r.e})` : ""}`);
  }
  const t = await svc.from("tarifas_config").select("id").limit(1);
  ok.tarifas = !t.error && (t.data?.length ?? 0) > 0;
  // Storage: los archivos del seed del chofer1 deben estar en ambos buckets
  const pref = D.ID.chofer1, { archivos } = D.documentacion("x");
  ok.storage = true;
  for (const b of BUCKETS) {
    const esp = archivos.filter((a) => a.bucket === b && a.ruta.startsWith(pref + "/")).map((a) => a.ruta.slice(pref.length + 1));
    const l = await svc.storage.from(b).list(pref);
    const nombres = new Set((l.data ?? []).map((o) => o.name));
    if (l.error || esp.some((n) => !nombres.has(n))) { ok.storage = false; faltantes.push(`storage ${b}`); }
  }
  return { ok, faltantes, completa: faltantes.length === 0 };
}

// ── Ejecución ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function nuevoRegistro() { return { usuarios: [], paradas: [], evidencias: [], storage: [], inesperados: [], restauraciones: [] }; }

export async function ejecutarPruebas(c, ids, log = salida, catalogo = PRUEBAS) {
  const resultados = [];
  for (const id of ids) {
    const p = catalogo.find((x) => x.id === id);
    let r;
    const falta = faltaSemilla(c, p.requiere ?? []);
    if (falta) r = skip(falta);
    else {
      try { r = await p.ejecutar(c); }
      catch (e) { r = fail("ejecución sin excepciones", `excepción: ${redactar(e?.message ?? e, SECRETOS_ACTIVOS).slice(0, 160)}`); }
    }
    const fila = { id, grupo: p.grupo, titulo: p.titulo, obligatoria: !!p.obligatoria, ...r };
    resultados.push(fila);
    log(`${fila.estado.padEnd(4)} ${id.padEnd(3)} ${p.titulo}`);
    log(`       esperado : ${fila.esperado}`);
    log(`       observado: ${fila.observado}`);
  }
  return resultados;
}

export function resumir(resultados) {
  const cuenta = { A: { PASS: 0, FAIL: 0, SKIP: 0 }, B: { PASS: 0, FAIL: 0, SKIP: 0 } };
  for (const r of resultados) cuenta[r.grupo][r.estado]++;
  const fails = resultados.filter((r) => r.estado === "FAIL");
  const skipsObl = resultados.filter((r) => r.estado === "SKIP" && r.obligatoria);
  const skipsOpc = resultados.filter((r) => r.estado === "SKIP" && !r.obligatoria);
  const codigo = fails.length ? 1 : skipsObl.length ? 3 : 0;
  return { cuenta, fails, skipsObl, skipsOpc, codigo };
}

// ── Limpieza EXACTA de lo que creó ESTA corrida (solo con --limpiar; sin TRUNCATE; nunca sin marcador) ─────────────────────
export async function limpiarMarcadores(svc, reg, log = salida) {
  const informe = [];
  const borrar = async (tabla, ids, colMarca, valorMarca, extra) => {
    const unicos = [...new Set(ids.filter((x) => x != null))];
    if (!unicos.length) return;
    let q = svc.from(tabla).delete().in("id", unicos);
    q = extra ? extra(q) : q.eq(colMarca, valorMarca);
    const r = await q.select("id");
    informe.push(`${tabla}: ${r.error ? `ERROR ${errTxt(r)}` : `${r.data?.length ?? 0} fila(s) borrada(s) de ${unicos.length} registrada(s)`}`);
  };
  // 1) restauraciones exactas de filas del seed que una prueba FALLIDA haya alterado/borrado
  for (const it of reg.restauraciones) {
    if (it.tipo === "columna") {
      const r = await svc.from(it.tabla).update({ [it.col]: it.orig }).eq(it.idCol, it.idVal).eq(it.col, it.marcadoConValor).select(it.idCol);
      informe.push(`restauración ${it.tabla}.${it.col}: ${r.error ? `ERROR ${errTxt(r)}` : `${r.data?.length ?? 0} fila(s) restaurada(s)`}`);
    } else if (it.tipo === "reinsertar") {
      const ex = await svc.from(it.tabla).select("id").eq("id", it.snapshot.id);
      if (!ex.error && (ex.data?.length ?? 0) === 0) { const r = await svc.from(it.tabla).insert(it.snapshot); informe.push(`restauración ${it.tabla}: ${r.error ? `ERROR ${errTxt(r)}` : "fila reinsertada desde la foto"}`); }
    }
  }
  // 2) filas creadas por V3 (id registrado Y marcador)
  await borrar("usuarios", reg.usuarios, null, null, (q) => q.like("email", `v3-%${DOMINIO_EMAIL}`));
  await borrar("paradas_viaje", reg.paradas, "direccion", MARCADOR);
  await borrar("viaje_evidencias", reg.evidencias, "observacion", MARCADOR);
  for (const x of reg.inesperados) await borrar(x.tabla, [x.id], x.colMarca, x.valorMarca);
  // 3) Storage: solo rutas registradas que empiecen con v3-marcador/
  const porBucket = {};
  for (const o of reg.storage) if (o.ruta.startsWith(PREFIJO_STORAGE) && BUCKETS.includes(o.bucket)) (porBucket[o.bucket] ??= new Set()).add(o.ruta);
  for (const [b, rutas] of Object.entries(porBucket)) {
    const r = await svc.storage.from(b).remove([...rutas]);
    informe.push(`storage ${b}: ${r.error ? `ERROR ${errTxt(r)}` : `${r.data?.length ?? 0} objeto(s) borrado(s) de ${rutas.size} registrado(s)`}`);
  }
  for (const l of informe) log(`   limpieza · ${l}`);
  return informe;
}

export function listarRestos(reg) {
  const l = [];
  if (reg.usuarios.length) l.push(`usuarios (ids): ${reg.usuarios.length} registrados (los que existan quedan con email v3-*${DOMINIO_EMAIL})`);
  if (reg.paradas.length) l.push(`paradas_viaje (ids): ${reg.paradas.join(", ")}`);
  if (reg.evidencias.length) l.push(`viaje_evidencias (ids): ${reg.evidencias.join(", ")}`);
  if (reg.storage.length) l.push(`Storage: ${[...new Set(reg.storage.map((o) => `${o.bucket}/${o.ruta}`))].join(", ")}`);
  if (reg.inesperados.length) l.push(`filas creadas INESPERADAMENTE en tablas que debían rechazar: ${reg.inesperados.map((x) => `${x.tabla}#${x.id}`).join(", ")}`);
  if (reg.restauraciones.length) l.push(`filas del SEED alteradas/borradas por una prueba fallida: ${reg.restauraciones.map((x) => `${x.tabla}${x.idVal != null ? "#" + x.idVal : ""}`).join(", ")} (restaurar con --limpiar o reaplicando el seed)`);
  return l;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function main(argv, env) {
  const a = parsearArgs(argv);
  if (a.errores.length) { for (const e of a.errores) salida("ERROR:", e); return 2; }
  if (a.ayuda) {
    salida("Uso: node --env-file=.env.staging scripts/staging/smoke/v3-anon.mjs [--listar] [--solo=A|B|A1,B4] [--limpiar]");
    salida("  --listar  muestra las pruebas SIN conectarse a nada ni leer claves     --solo=  subconjunto (las dependencias se agregan solas)");
    salida("  --limpiar borra SOLO los objetos con marcador que creó esta corrida (por id registrado + marcador) y restaura filas del seed alteradas por una prueba fallida");
    salida("Claves solo por variables de entorno: TILA_ENTORNO, TILA_STAGING_SUPABASE_REF, STAGING_SUPABASE_URL, STAGING_ANON_KEY, STAGING_SERVICE_ROLE_KEY.");
    return 0;
  }
  if (a.listar) { salida(formatearListado()); return 0; }

  const sel = seleccionar(a.solo);
  if (sel.errores.length) { for (const e of sel.errores) salida("ERROR:", e); return 2; }
  const v = validarConfig(env);
  if (!v.ok) { salida("CONFIGURACIÓN INVÁLIDA — no se abrió ninguna conexión:"); for (const e of v.errores) salida("  ✗", e); return 2; }
  const { cfg } = v;
  definirSecretos([cfg.anon, cfg.service]);
  const runId = crypto.randomBytes(3).toString("hex");
  salida(`entorno: staging · proyecto: ${new URL(cfg.url).hostname} · anon: [CONFIGURADA] · service_role: [CONFIGURADA] · corrida: ${runId}`);
  if (sel.agregadasPorDependencia.length) salida(`(se agregaron por dependencia: ${sel.agregadasPorDependencia.join(", ")})`);

  const { createClient } = await import("@supabase/supabase-js");
  const D = await import("../seed/datos.mjs");
  const conTimeout = (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(25000) });
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: conTimeout } };
  const anon = createClient(cfg.url, cfg.anon, opts), svc = createClient(cfg.url, cfg.service, opts);

  // P1: coherencia claves↔URL (dos lecturas mínimas)
  const p1a = await anon.from("usuarios").select("id").limit(1), p1s = await svc.from("usuarios").select("id").limit(1);
  if (p1a.error || p1s.error) { salida("P1 FAIL: las claves no responden en este proyecto (¿pertenecen a otro proyecto o la Data API no está disponible?)."); salida(`   anon: ${errTxt(p1a)} · service_role: ${errTxt(p1s)}`); return 2; }
  salida("P1 PASS: ambas claves responden en el proyecto de staging.");
  const semilla = await detectarSemilla(svc, D);
  salida(semilla.completa ? "P2 PASS: semilla ficticia presente." : `P2 AVISO: semilla incompleta → ${semilla.faltantes.join("; ")} (las pruebas que la necesitan darán SKIP).`);

  const c = { anon, svc, D, semilla, runId, fetchFn: fetch, reg: nuevoRegistro(), est: { storage: [] } };
  salida("");
  const resultados = await ejecutarPruebas(c, sel.ids);
  const s = resumir(resultados);
  salida("", "RESUMEN V3");
  for (const g of ["A", "B"]) salida(`  ${g}: PASS ${s.cuenta[g].PASS} · FAIL ${s.cuenta[g].FAIL} · SKIP ${s.cuenta[g].SKIP}`);
  for (const r of s.fails) salida(`  ✗ FAIL ${r.id}: ${r.observado}`);
  for (const r of s.skipsObl) salida(`  ⚠ SKIP (obligatoria) ${r.id}: ${r.observado}`);
  for (const r of s.skipsOpc) salida(`  · SKIP (no obligatoria) ${r.id}: ${r.observado}`);
  const restos = listarRestos(c.reg);
  if (a.limpiar) { salida("", "LIMPIEZA (solo objetos con marcador de esta corrida):"); await limpiarMarcadores(svc, c.reg); }
  else if (restos.length) { salida("", "OBJETOS V3 QUE QUEDAN EN STAGING (no se limpió: falta --limpiar o el elemento 4):"); for (const r of restos) salida("  -", r); }
  salida("", s.codigo === 0 ? "V3: TODAS las pruebas obligatorias PASARON." : s.codigo === 1 ? "V3: HAY FAIL. No se corrigió nada: informar (esperado en producción · observado en staging · causa · impacto)." : "V3: INCOMPLETO (hay SKIP en pruebas obligatorias; ver el motivo arriba).");
  return s.codigo;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("v3-anon.mjs")) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; }, (e) => { salida("ERROR inesperado:", e?.message ?? e); process.exitCode = 2; });
}
