// Limpieza GENERAL de datos de prueba de STAGING (TILA-STAGING) después de V3, Realtime y smoke tests.
// ESTADO: PREPARADO Y VALIDADO SOLO EN LOCAL (tests con Supabase FALSO). NUNCA se ejecutó contra ninguna base.
//
// DOS OPERACIONES DISTINTAS (no se mezclan):
//   A) --modo=pruebas (por defecto): borra SOLO restos de V3, Realtime y (opt-in) smoke `flujos.mjs`, y PRESERVA el seed ficticio.
//   B) --modo=reset-seed: NO borra nada desde acá. Delega en `seed/aplicar.mjs --reset`, que ya borra el seed por claves padre (con sus guardas)
//      y lo re-aplica. Duplicar esa lógica sería una segunda superficie de borrado del seed; además aplicar.mjs es un script de nivel superior
//      (no exporta funciones) y no se puede reutilizar sin modificarlo. Orden recomendado: 1) limpiar pruebas  2) reset del seed.
//
// POR DEFECTO ES DRY-RUN (no borra, no escribe, y no se conecta salvo con --contar, que solo LEE).
//   node scripts/staging/limpiar-pruebas.mjs --plan                                (sin .env.staging: explica qué limpia y qué preserva)
//   node --env-file=.env.staging scripts/staging/limpiar-pruebas.mjs              (dry-run sin conexión: clases + validación de la configuración)
//   node --env-file=.env.staging scripts/staging/limpiar-pruebas.mjs --contar     (dry-run con conexión SOLO LECTURA: conteos previstos)
//   node --env-file=.env.staging scripts/staging/limpiar-pruebas.mjs --aplicar --confirmar=<ref>.supabase.co [--incluir-flujos]
//
// PARA BORRAR se exigen TODAS: TILA_ENTORNO=staging · TILA_STAGING_SUPABASE_REF correcto · STAGING_SUPABASE_URL exactamente https://<ref>.supabase.co
//   · STAGING_SERVICE_ROLE_KEY (solo por entorno) · --aplicar · --confirmar=<host exacto>. Si falta una: exit 2 ANTES de conectarse.
//
// LÍNEA DE DEFENSA PRINCIPAL: el cliente de Supabase se envuelve (envolverCliente). Cada DELETE/UPDATE/remove pasa por una lista CERRADA de plantillas
// que exigen los marcadores exactos de cada script; todo lo demás se BLOQUEA por diseño: sin filtros, filtros solo de fecha/patrón, tablas backup_*,
// tablas fuera de la lista, insert/upsert/rpc, y Storage fuera de `v3-marcador/<runId>/(prueba.png|nota.txt)`. No existe TRUNCATE.
//
// CÓDIGOS DE SALIDA: 0 = limpieza y verificación correctas (o dry-run/plan/reset delegado) · 1 = quedaron restos o hubo error al borrar/conectar ·
//   2 = configuración/argumentos/guarda inválidos (no se conectó) · 3 = parcial o no determinable (cosas no reconocidas, flujos sin --incluir-flujos,
//   seed alterado, lecturas fallidas, interrupción). Precedencia: 2 → 1 → 3 → 0.
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { HOSTS_PRODUCCION, REF_PRODUCCION, asegurarNoProduccion } from "./guardas.mjs";
import { MARCADOR as V3, DOMINIO_EMAIL, PREFIJO_STORAGE, inspeccionarClave, redactar } from "./smoke/v3-anon.mjs";
import { PREFIJO_MARCADOR as PREFIJO_RT, limpiarPorMarcador } from "./smoke/realtime.mjs";
import * as D from "./seed/datos.mjs";

// ── Tiempos centralizados ───────────────────────────────────────────────────────────────────────────────────────────────
export const TIMEOUTS = Object.freeze({
  llamadaMs: 20000,       // cada llamada a la base o a Storage; si no responde → error (no determinable)
  totalMs: 300000,        // presupuesto total de la corrida
  paginaStorage: 100,     // tamaño de página al listar Storage
  maxPaginasStorage: 20,  // tope de páginas (si se alcanza, lo listado es "no determinable")
  salidaForzadaMs: 2000,  // tras terminar, si algo mantiene vivo el proceso, se fuerza la salida con el mismo código
});

// ── Marcadores REALES (los que generan v3-anon.mjs, realtime.mjs y flujos.mjs) ───────────────────────────────────────────
const V3_DOS = `${V3}-2`;                                          // v3 B11/B13 usan `${MARCADOR}-2` cuando el valor original ya era el marcador
const RE_EMAIL_V3 = new RegExp(`^v3-[0-9a-f]{6}-(cliente|chofer|admin)${DOMINIO_EMAIL.replace(/[.]/g, "\\.")}$`); // v3-<runId 6 hex>-(cliente|chofer|admin)@…
const RE_RT = new RegExp(`^${PREFIJO_RT}[0-9a-f]{8}$`);                                                            // REALTIME-MARCADOR-<runId 8 hex>
const RE_STORAGE_V3 = new RegExp(`^${PREFIJO_STORAGE.replace("/", "\\/")}[0-9a-f]{6}\\/(prueba\\.png|nota\\.txt)$`);  // v3-marcador/<6 hex>/(prueba.png|nota.txt)
const NUM_TARIFAS = 987654.321;                                    // v3 B12/B13: único marcador posible en tarifas_config (solo numéricos)
const COLS_TARIFAS_OTRAS = ["precio_litro_combustible", "litros_km_flete_chico", "litros_km_camion_mediano", "litros_km_camion_grande", "extra_carga_cara"];
const BUCKETS = Object.freeze(["documentacion-choferes", "vehiculos"]);
const SMOKE_MODOS = Object.freeze(["legacy", "dual", "strict"]);
const SMOKE_DETALLES = Object.freeze(SMOKE_MODOS.map((m) => `smoke ${m}`)); // flujos.mjs: detalles: `smoke ${modo}`
const SMOKE_ORIGEN = "Rosario, Santa Fe", SMOKE_DESTINO = "Córdoba, Córdoba";   // exactamente lo que flujos.mjs publica
// Mensajes de flujos.mjs sobre viajes del SEED (103/104): tupla exacta (viaje, canal, texto, remitente)
const SMOKE_MENSAJES_SEED = Object.freeze([
  ...SMOKE_MODOS.map((m) => Object.freeze([103, "viaje", `smoke cliente ${m}`, D.ID.cliente1])),
  ...SMOKE_MODOS.map((m) => Object.freeze([103, "soporte_cliente", `smoke admin ${m}`, D.ID.admin])),
  Object.freeze([104, "viaje", "no debería", D.ID.cliente1]), // flujos espera 403; solo existiría si la app lo permitiera
]);
const SEED_CARGAS = Object.freeze(D.cargas().map((c) => c.id));
const SEED_CHOFERES = Object.freeze([D.ID.chofer1, D.ID.chofer2, D.ID.chofer3]);

// ═══════════════ Guarda: plantillas CERRADAS de borrado / restauración ═══════════════
const DEMOSTRADOS = new WeakSet(); // arreglos de ids que SOLO descubrirFlujos() puede crear, tras verificar cada carga con el predicado exacto
const demostrar = (ids) => { const a = Object.freeze([...ids]); DEMOSTRADOS.add(a); return a; };
const eqv = (f, col) => { const x = f.filter((k) => k[0] === "eq" && k[1] === col); return x.length === 1 ? x[0][2] : undefined; };
const tiene = (f, col, test) => { const v = eqv(f, col); return v !== undefined && test(v); };
const es = (x) => (v) => String(v) === String(x);
const enLista = (l) => (v) => l.some((x) => String(x) === String(v));
const esV3 = es(V3), esRT = (v) => typeof v === "string" && RE_RT.test(v);
const nulos = (f, cols) => cols.every((c) => f.some((k) => k[0] === "is" && k[1] === c && k[2] === null));

/** Cada plantilla es una condición NECESARIA: los filtros extra solo pueden acotar más, nunca ampliar. */
const marca = (id, tabla, eq, { sinId = false, is = [], flujos = false } = {}) => ({
  id, tabla, op: "delete", flujos,
  coincide: (f) => Object.entries(eq).every(([c, t]) => tiene(f, c, t)) && (sinId || f.some((k) => k[0] === "eq" && k[1] === "id" && k[2] != null)) && nulos(f, is),
});
const inDemostrado = (f, col) => f.some((k) => k[0] === "in" && k[1] === col && Array.isArray(k[2]) && k[2].length > 0 && k[2].length <= 500 && DEMOSTRADOS.has(k[2]));
export const PLANTILLAS = Object.freeze([
  // V3 — lo que v3-anon.mjs realmente crea
  marca("v3.usuarios", "usuarios", { nombre: esV3, email: (v) => RE_EMAIL_V3.test(v) }),
  marca("v3.paradas_viaje", "paradas_viaje", { direccion: esV3, carga_id: es(101), orden: es(99) }),
  marca("v3.viaje_evidencias", "viaje_evidencias", { evento: esV3, rol_usuario: es("v3") }),
  marca("v3.cargas(inesperada)", "cargas", { detalles: esV3, estado: esV3, origen: esV3 }),
  marca("v3.mensajes_viaje(inesperada)", "mensajes_viaje", { mensaje: esV3, remitente_rol: es("v3"), remitente_nombre: esV3 }),
  marca("v3.billetera_chofer(inesperada)", "billetera_chofer", { viaje_id: esV3, chofer_id: esV3 }),
  marca("v3.consentimientos_legales(inesperada)", "consentimientos_legales", { tipo_documento: esV3, version_documento: es("v3") }),
  marca("v3.vehiculos(inesperada)", "vehiculos", { patente: es("V3-MARC"), marca: esV3 }),
  marca("v3.documentacion_chofer(inesperada)", "documentacion_chofer", { tipo: esV3, url: esV3 }),
  marca("v3.tarifas_config(inesperada)", "tarifas_config", { extra_fragil: (v) => Number(v) === NUM_TARIFAS }, { is: COLS_TARIFAS_OTRAS }),
  // Realtime — lo que realtime.mjs realmente crea (marcador exacto por corrida)
  marca("rt.usuarios", "usuarios", { nombre: esRT }),
  marca("rt.cargas", "cargas", { detalles: esRT }),
  marca("rt.mensajes_viaje", "mensajes_viaje", { mensaje: esRT }, { sinId: true }),
  // Flujos (opt-in): composición exacta + relación demostrable con cargas smoke
  marca("flujos.cargas", "cargas", { detalles: enLista(SMOKE_DETALLES), cliente_id: es(D.ID.cliente1), origen: es(SMOKE_ORIGEN), destino: es(SMOKE_DESTINO) }, { flujos: true }),
  { id: "flujos.paradas_viaje", tabla: "paradas_viaje", op: "delete", flujos: true, coincide: (f) => inDemostrado(f, "carga_id") },
  { id: "flujos.viaje_evidencias", tabla: "viaje_evidencias", op: "delete", flujos: true, coincide: (f) => inDemostrado(f, "carga_id") },
  { id: "flujos.mensajes_viaje(rel)", tabla: "mensajes_viaje", op: "delete", flujos: true, coincide: (f) => inDemostrado(f, "viaje_id") },
  { id: "flujos.billetera_chofer", tabla: "billetera_chofer", op: "delete", flujos: true,
    coincide: (f) => inDemostrado(f, "viaje_id") && f.some((k) => k[0] === "in" && k[1] === "chofer_id" && Array.isArray(k[2]) && k[2].length > 0 && k[2].every((x) => SEED_CHOFERES.includes(x))) },
  { id: "flujos.mensajes_viaje(seed)", tabla: "mensajes_viaje", op: "delete", flujos: true,
    coincide: (f) => SMOKE_MENSAJES_SEED.some(([v, tc, m, r]) => tiene(f, "viaje_id", es(v)) && tiene(f, "tipo_chat", es(tc)) && tiene(f, "mensaje", es(m)) && tiene(f, "remitente_id", es(r))) },
]);
// Restauración de columnas de filas del SEED que una prueba V3 alteró con su marcador (valor original = el del seed, conocido)
export const COLUMNAS_RESTAURABLES = Object.freeze([["cargas", "detalles"], ["mensajes_viaje", "mensaje"], ["billetera_chofer", "viaje_id"], ["consentimientos_legales", "user_agent"], ["vehiculos", "color"], ["documentacion_chofer", "url"]]);

export function evaluarBorrado(tabla, filtros, { incluirFlujos = false } = {}) {
  if (typeof tabla !== "string" || /^backup_/i.test(tabla)) return { ok: false, motivo: `tabla no permitida (${String(tabla)}): nunca se tocan backup_* ni tablas fuera de la lista` };
  if (!Array.isArray(filtros) || filtros.length === 0) return { ok: false, motivo: "DELETE sin filtros" };
  if (filtros.some((f) => !["eq", "in", "is"].includes(f[0]))) return { ok: false, motivo: "operador no permitido en borrados (solo eq/in/is: nunca fechas ni patrones)" };
  const cand = PLANTILLAS.filter((p) => p.tabla === tabla && p.op === "delete");
  if (!cand.length) return { ok: false, motivo: `no hay plantilla de borrado para ${tabla}` };
  for (const p of cand) if (p.coincide(filtros)) return p.flujos && !incluirFlujos ? { ok: false, motivo: `${p.id} requiere --incluir-flujos` } : { ok: true, plantilla: p.id };
  return { ok: false, motivo: `los filtros no coinciden con ningún marcador exacto conocido de ${tabla}` };
}
export function evaluarRestauracion(tabla, filtros, valores) {
  const par = COLUMNAS_RESTAURABLES.find(([t]) => t === tabla);
  if (!par) return { ok: false, motivo: `UPDATE no permitido en ${tabla}` };
  const [, col] = par;
  if (!valores || typeof valores !== "object" || Object.keys(valores).length !== 1 || !(col in valores)) return { ok: false, motivo: `solo se puede restaurar la columna ${col}` };
  if (filtros.some((f) => !["eq", "in"].includes(f[0]))) return { ok: false, motivo: "operador no permitido" };
  if (!filtros.some((f) => f[0] === "eq" && f[1] === "id" && f[2] != null)) return { ok: false, motivo: "falta el id de la fila del seed" };
  if (!tiene(filtros, col, (v) => v === V3 || v === V3_DOS)) return { ok: false, motivo: `solo filas cuya ${col} lleva el marcador V3 actual` };
  return { ok: true };
}
export function evaluarStorage(bucket, rutas) {
  if (!BUCKETS.includes(bucket)) return { ok: false, motivo: `bucket no permitido (${String(bucket)})` };
  if (!Array.isArray(rutas) || rutas.length === 0 || rutas.length > 200) return { ok: false, motivo: "lista de rutas vacía o excesiva" };
  const mala = rutas.find((r) => typeof r !== "string" || !RE_STORAGE_V3.test(r));
  return mala === undefined ? { ok: true } : { ok: false, motivo: "ruta fuera de v3-marcador/<runId>/(prueba.png|nota.txt): nunca se vacían buckets ni se borra por extensión" };
}

const conTimeout = (p, ms, etiqueta) => { let t; const l = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${etiqueta}: sin respuesta en ${ms} ms`)), ms); }); return Promise.race([p, l]).finally(() => clearTimeout(t)); };
const CADENA_OK = ["select", "eq", "in", "is", "like", "limit", "order", "range", "single", "maybeSingle"];

class Consulta {
  constructor(g, tabla) { this.g = g; this.tabla = tabla; this.op = null; this.opArgs = []; this.cadena = []; }
  _base(op, a) { if (this.op) throw new Error(`[guarda] ${op}() encadenado sobre ${this.op}()`); this.op = op; this.opArgs = a; return this; }
  select(...a) { if (!this.op) return this._base("select", a); this.cadena.push(["select", a]); return this; }
  delete(...a) { return this._base("delete", a); }
  update(...a) { return this._base("update", a); }
  insert() { throw new Error("[guarda] esta herramienta nunca inserta"); }
  upsert() { throw new Error("[guarda] esta herramienta nunca hace upsert"); }
  then(res, rej) { return this._ejecutar().then(res, rej); }
  async _ejecutar() {
    const g = this.g;
    const filtros = this.cadena.filter(([m]) => ["eq", "in", "is", "like"].includes(m)).map(([m, a]) => [m, a[0], a[1]]);
    if (this.op === "delete") { const v = evaluarBorrado(this.tabla, filtros, g.opts); if (!v.ok) return g.bloquear(this.tabla, "delete", v.motivo); g.permitidos.push(v.plantilla); }
    else if (this.op === "update") { const v = evaluarRestauracion(this.tabla, filtros, this.opArgs[0]); if (!v.ok) return g.bloquear(this.tabla, "update", v.motivo); }
    else if (this.op !== "select") return g.bloquear(this.tabla, String(this.op), "operación no permitida");
    let q = g.real.from(this.tabla)[this.op](...this.opArgs);
    for (const [m, a] of this.cadena) q = q[m](...a);
    return conTimeout(Promise.resolve(q), g.T.llamadaMs, `${this.tabla}.${this.op}`);
  }
}
for (const m of CADENA_OK.filter((x) => x !== "select")) Consulta.prototype[m] = function (...a) { this.cadena.push([m, a]); return this; };

/** Cliente de solo las operaciones que esta herramienta necesita; todo borrado/restauración pasa por las plantillas. */
export function envolverCliente(real, { incluirFlujos = false, T = TIMEOUTS } = {}) {
  const g = { real, T, opts: { incluirFlujos }, bloqueos: [], permitidos: [] };
  g.bloquear = (tabla, op, motivo) => { g.bloqueos.push({ tabla, op, motivo }); throw new Error(`[guarda] ${op} sobre ${tabla} BLOQUEADO: ${motivo}`); };
  g.from = (tabla) => {
    if (typeof tabla !== "string" || /^backup_/i.test(tabla)) g.bloquear(String(tabla), "acceso", "nunca se tocan tablas backup_*");
    return new Consulta(g, tabla);
  };
  g.rpc = () => g.bloquear("-", "rpc", "sin RPC");
  g.storage = { from: (bucket) => ({
    list: (prefijo, o) => conTimeout(Promise.resolve(real.storage.from(bucket).list(prefijo, o)), T.llamadaMs, `storage.list ${bucket}`),
    remove: (rutas) => { const v = evaluarStorage(bucket, rutas); if (!v.ok) return g.bloquear(`storage:${bucket}`, "remove", v.motivo); g.permitidos.push("v3.storage"); return conTimeout(Promise.resolve(real.storage.from(bucket).remove(rutas)), T.llamadaMs, `storage.remove ${bucket}`); },
    upload: () => g.bloquear(`storage:${bucket}`, "upload", "esta herramienta nunca sube objetos"),
    update: () => g.bloquear(`storage:${bucket}`, "update", "sin escritura"), move: () => g.bloquear(`storage:${bucket}`, "move", "sin escritura"), copy: () => g.bloquear(`storage:${bucket}`, "copy", "sin escritura"),
    emptyBucket: () => g.bloquear(`storage:${bucket}`, "emptyBucket", "nunca se vacían buckets"),
  }), emptyBucket: () => g.bloquear("storage", "emptyBucket", "nunca se vacían buckets"), deleteBucket: () => g.bloquear("storage", "deleteBucket", "nunca se borran buckets") };
  return g;
}

// ═══════════════ Configuración y argumentos ═══════════════
export function validarConfig(env) {
  const errores = [];
  if (env.TILA_ENTORNO !== "staging") errores.push('TILA_ENTORNO debe ser exactamente "staging".');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") errores.push("NODE_TLS_REJECT_UNAUTHORIZED=0: la verificación TLS no puede estar desactivada.");
  const ref = env.TILA_STAGING_SUPABASE_REF ?? "";
  let refOk = false;
  if (!/^[a-z0-9]{6,40}$/.test(ref)) errores.push("TILA_STAGING_SUPABASE_REF debe ser UN solo ref (minúsculas y números; sin comas ni espacios).");
  else if (ref === REF_PRODUCCION || ref.includes(REF_PRODUCCION)) errores.push("TILA_STAGING_SUPABASE_REF es el ref de PRODUCCIÓN. Abortado.");
  else refOk = true;
  const urlTxt = env.STAGING_SUPABASE_URL ?? "";
  if (!urlTxt) errores.push("Falta STAGING_SUPABASE_URL.");
  else {
    let u = null;
    try { u = new URL(urlTxt); } catch { errores.push("STAGING_SUPABASE_URL no es una URL válida."); }
    if (u) {
      const host = u.hostname.toLowerCase();
      if (u.protocol !== "https:") errores.push("STAGING_SUPABASE_URL debe usar https.");
      if (u.username || u.password || u.port || (u.pathname && u.pathname !== "/") || u.search || u.hash) errores.push("STAGING_SUPABASE_URL debe ser solo https://<ref>.supabase.co.");
      if (HOSTS_PRODUCCION.some((h) => host === h || host.endsWith("." + h)) || host.includes(REF_PRODUCCION)) errores.push("STAGING_SUPABASE_URL apunta a PRODUCCIÓN. Abortado.");
      else if (refOk && host !== `${ref}.supabase.co`) errores.push("El host de STAGING_SUPABASE_URL no coincide EXACTAMENTE con TILA_STAGING_SUPABASE_REF.");
      else if (refOk && !errores.length) { try { asegurarNoProduccion(`https://${ref}.supabase.co`, { etiqueta: "STAGING_SUPABASE_URL", env: { TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: ref } }); } catch (e) { errores.push(String(e.message)); } }
    }
  }
  const svc = env.STAGING_SERVICE_ROLE_KEY;
  if (!svc) errores.push("Falta STAGING_SERVICE_ROLE_KEY.");
  else {
    const i = inspeccionarClave(svc);
    if (svc !== svc.trim() || /\s/.test(svc) || /["'`]/.test(svc)) errores.push("STAGING_SERVICE_ROLE_KEY tiene espacios o comillas.");
    if (i.formato === "publishable") errores.push("STAGING_SERVICE_ROLE_KEY tiene formato de clave PÚBLICA (sb_publishable_…).");
    if (i.formato === "jwt" && i.rol && i.rol !== "service_role") errores.push("STAGING_SERVICE_ROLE_KEY es un JWT con rol distinto de service_role.");
    if (i.ref && i.ref === REF_PRODUCCION) errores.push("STAGING_SERVICE_ROLE_KEY pertenece a PRODUCCIÓN. Abortado.");
    else if (i.ref && refOk && i.ref !== ref) errores.push("STAGING_SERVICE_ROLE_KEY pertenece a otro proyecto (ref distinto).");
    if (i.formato === "desconocido") errores.push("STAGING_SERVICE_ROLE_KEY no tiene un formato reconocible.");
    if (svc.includes(REF_PRODUCCION) || HOSTS_PRODUCCION.some((h) => svc.includes(h))) errores.push("STAGING_SERVICE_ROLE_KEY contiene el ref/host de producción.");
  }
  const ok = errores.length === 0;
  return { ok, errores, cfg: ok ? { ref, host: `${ref}.supabase.co`, url: `https://${ref}.supabase.co`, service: svc } : null };
}

export function parsearArgs(argv) {
  const r = { plan: false, ayuda: false, aplicar: false, contar: false, incluirFlujos: false, modo: "pruebas", confirmar: null, errores: [] };
  for (const a of argv) {
    if (/^--(anon|key|clave|service|service-role|secret|token|password|apikey|url|ref|env|supabase)\b/i.test(a) || /eyJ|sb_(secret|publishable)_/.test(a)) r.errores.push("Las claves, la URL y el ref NO se aceptan por argumentos: solo por variables de entorno.");
    else if (a === "--plan" || a === "--listar") r.plan = true;
    else if (a === "--ayuda" || a === "--help" || a === "-h") r.ayuda = true;
    else if (a === "--aplicar") r.aplicar = true;
    else if (a === "--contar") r.contar = true;
    else if (a === "--incluir-flujos") r.incluirFlujos = true;
    else if (a.startsWith("--confirmar=")) r.confirmar = a.slice(12);
    else if (a.startsWith("--modo=")) { const m = a.slice(7); if (m === "pruebas" || m === "reset-seed") r.modo = m; else r.errores.push("--modo debe ser pruebas o reset-seed."); }
    else r.errores.push("Argumento no reconocido (el valor no se muestra). Usá --ayuda.");
  }
  return r;
}

// ═══════════════ Descubrimiento (SOLO LECTURA) ═══════════════
const msg = (e, red) => red(String(e?.message ?? e)).slice(0, 140);
async function leer(g, tabla, cols, filtros = []) {
  let q = g.from(tabla).select(cols);
  for (const [m, c, v] of filtros) q = q[m](c, v);
  const r = await q;
  if (r.error) throw new Error(`${tabla}: ${r.error.code ?? ""} ${r.error.message ?? "error"}`.trim());
  return r.data ?? [];
}
async function listarStorage(g, bucket, prefijo) {
  const todo = []; let truncado = false;
  for (let p = 0; p < TIMEOUTS.maxPaginasStorage; p++) {
    const r = await g.storage.from(bucket).list(prefijo, { limit: TIMEOUTS.paginaStorage, offset: p * TIMEOUTS.paginaStorage });
    if (r.error) throw new Error(`storage ${bucket}/${prefijo}: ${r.error.message ?? "error"}`);
    const pag = r.data ?? []; todo.push(...pag);
    if (pag.length < TIMEOUTS.paginaStorage) return { entradas: todo, truncado };
  }
  return { entradas: todo, truncado: true };
}

const ESPECS_V3_INESPERADAS = Object.freeze([
  ["cargas", { detalles: V3, estado: V3, origen: V3 }], ["mensajes_viaje", { mensaje: V3, remitente_rol: "v3", remitente_nombre: V3 }], ["billetera_chofer", { viaje_id: V3, chofer_id: V3 }],
  ["consentimientos_legales", { tipo_documento: V3, version_documento: "v3" }], ["vehiculos", { patente: "V3-MARC", marca: V3 }], ["documentacion_chofer", { tipo: V3, url: V3 }],
]);

export async function descubrirV3(g, base, red = (x) => x) {
  const R = { usuarios: [], paradas: [], evidencias: [], inesperadas: [], tarifas: [], tarifasAlteradas: [], restaurar: [], noRestaurables: [], storage: [], storageDesconocidos: [], omitidos: [], errores: [] };
  const intentar = async (n, fn) => { try { await fn(); } catch (e) { R.errores.push(`V3 ${n}: ${msg(e, red)}`); } };
  await intentar("usuarios", async () => {
    const vistos = new Set();
    const clasificar = (f) => {
      if (vistos.has(String(f.id))) return; vistos.add(String(f.id));
      if (f.nombre === V3 && RE_EMAIL_V3.test(String(f.email))) R.usuarios.push({ id: f.id, email: f.email });
      else R.omitidos.push(`usuarios:${f.id} (marcador o email v3-* incompletos: no coincide con v3-anon.mjs)`);
    };
    for (const f of await leer(g, "usuarios", "id,email,nombre", [["like", "email", `v3-%${DOMINIO_EMAIL}`]])) clasificar(f);
    for (const f of await leer(g, "usuarios", "id,email,nombre", [["eq", "nombre", V3]])) clasificar(f);
  });
  await intentar("paradas_viaje", async () => {
    for (const f of await leer(g, "paradas_viaje", "id,carga_id,orden,direccion", [["eq", "direccion", V3]])) {
      if (String(f.carga_id) === "101" && String(f.orden) === "99") R.paradas.push(f.id); else R.omitidos.push(`paradas_viaje:${f.id} (marcador pero no es carga 101/orden 99)`);
    }
  });
  await intentar("viaje_evidencias", async () => {
    for (const f of await leer(g, "viaje_evidencias", "id,evento,rol_usuario", [["eq", "evento", V3]])) {
      if (f.rol_usuario === "v3") R.evidencias.push(f.id); else R.omitidos.push(`viaje_evidencias:${f.id} (marcador pero rol_usuario≠v3)`);
    }
  });
  for (const [tabla, eq] of ESPECS_V3_INESPERADAS) {
    await intentar(tabla, async () => { for (const f of await leer(g, tabla, "id", Object.entries(eq).map(([c, v]) => ["eq", c, v]))) R.inesperadas.push({ tabla, id: f.id, eq }); });
  }
  await intentar("tarifas_config", async () => {
    for (const f of await leer(g, "tarifas_config", ["id", "extra_fragil", ...COLS_TARIFAS_OTRAS].join(","), [["eq", "extra_fragil", NUM_TARIFAS]])) {
      (COLS_TARIFAS_OTRAS.every((c) => f[c] === null || f[c] === undefined) ? R.tarifas : R.tarifasAlteradas).push(f.id);
    }
  });
  // filas del SEED alteradas por una prueba V3 fallida: se restauran al valor del seed (conocido), solo si llevan el marcador V3 actual
  const dsc = [["cargas", "detalles", D.cargas()], ["mensajes_viaje", "mensaje", D.mensajes()], ["billetera_chofer", "viaje_id", D.billetera()], ["consentimientos_legales", "user_agent", D.consentimientos()], ["vehiculos", "color", D.vehiculos(base)], ["documentacion_chofer", "url", D.documentacion(base).filas]];
  for (const [tabla, col, seed] of dsc) {
    await intentar(`${tabla}.${col}`, async () => {
      for (const f of await leer(g, tabla, `id,${col}`, [["in", "id", seed.map((s) => s.id)], ["in", col, [V3, V3_DOS]]])) {
        const orig = seed.find((s) => String(s.id) === String(f.id))?.[col];
        if (orig === undefined) R.noRestaurables.push(`${tabla}#${f.id}.${col} (el seed no define el valor original)`);
        else R.restaurar.push({ tabla, id: f.id, col, actual: f[col], orig });
      }
    });
  }
  for (const bucket of BUCKETS) {
    await intentar(`storage ${bucket}`, async () => {
      const raiz = await listarStorage(g, bucket, PREFIJO_STORAGE.replace(/\/$/, ""));
      if (raiz.truncado) R.storageDesconocidos.push(`${bucket}/${PREFIJO_STORAGE} (listado truncado)`);
      for (const e of raiz.entradas) {
        if (!/^[0-9a-f]{6}$/.test(e.name)) { R.storageDesconocidos.push(`${bucket}/${PREFIJO_STORAGE}${e.name}`); continue; }
        const sub = await listarStorage(g, bucket, `${PREFIJO_STORAGE}${e.name}`);
        if (sub.truncado) R.storageDesconocidos.push(`${bucket}/${PREFIJO_STORAGE}${e.name}/ (listado truncado)`);
        for (const a of sub.entradas) { const ruta = `${PREFIJO_STORAGE}${e.name}/${a.name}`; (RE_STORAGE_V3.test(ruta) ? R.storage : R.storageDesconocidos).push(RE_STORAGE_V3.test(ruta) ? { bucket, ruta } : `${bucket}/${ruta}`); }
      }
    });
  }
  return R;
}

export async function descubrirRealtime(g, red = (x) => x) {
  const R = { corridas: new Map(), desconocidos: [], errores: [] };
  const alta = (runId, tabla, n = 1) => { const c = R.corridas.get(runId) ?? { cargas: 0, mensajes_viaje: 0, usuarios: 0 }; c[tabla] += n; R.corridas.set(runId, c); };
  for (const [tabla, col] of [["cargas", "detalles"], ["mensajes_viaje", "mensaje"], ["usuarios", "nombre"]]) {
    try {
      for (const f of await leer(g, tabla, `id,${col}`, [["like", col, `${PREFIJO_RT}%`]])) {
        if (RE_RT.test(String(f[col]))) alta(String(f[col]).slice(PREFIJO_RT.length), tabla); else R.desconocidos.push(`${tabla}:${f.id} (${String(f[col]).slice(0, 40)}: marcador no reconocido)`);
      }
    } catch (e) { R.errores.push(`Realtime ${tabla}: ${msg(e, red)}`); }
  }
  return R;
}

export async function descubrirFlujos(g, red = (x) => x) {
  const R = { cargas: [], detalles: {}, ajenas: [], ids: Object.freeze([]), mensajesRel: 0, evidencias: 0, billetera: 0, paradas: 0, mensajesSeed: [], errores: [] };
  try {
    const filas = await leer(g, "cargas", "id,detalles,cliente_id,origen,destino", [["in", "detalles", [...SMOKE_DETALLES]]]);
    for (const f of filas) {
      const exacta = SMOKE_DETALLES.includes(f.detalles) && f.cliente_id === D.ID.cliente1 && f.origen === SMOKE_ORIGEN && f.destino === SMOKE_DESTINO && !SEED_CARGAS.includes(Number(f.id));
      if (exacta) { R.cargas.push(f.id); R.detalles[f.id] = f.detalles; } else R.ajenas.push(`cargas:${f.id} (detalles smoke pero cliente/ruta/id no coinciden con flujos.mjs: NO se toca)`);
    }
    R.ids = demostrar(R.cargas);
    if (R.ids.length) {
      R.mensajesRel = (await leer(g, "mensajes_viaje", "id", [["in", "viaje_id", R.ids]])).length;
      R.evidencias = (await leer(g, "viaje_evidencias", "id", [["in", "carga_id", R.ids]])).length;
      R.paradas = (await leer(g, "paradas_viaje", "id", [["in", "carga_id", R.ids]])).length;
      R.billetera = (await leer(g, "billetera_chofer", "id", [["in", "viaje_id", demostrar(R.ids.map(String))], ["in", "chofer_id", [...SEED_CHOFERES]]])).length;
    }
    for (const [v, tc, m, r] of SMOKE_MENSAJES_SEED) {
      for (const f of await leer(g, "mensajes_viaje", "id", [["eq", "viaje_id", v], ["eq", "tipo_chat", tc], ["eq", "mensaje", m], ["eq", "remitente_id", r]])) R.mensajesSeed.push({ id: f.id, viaje: v, tc, m, r });
    }
  } catch (e) { R.errores.push(`Flujos: ${msg(e, red)}`); }
  return R;
}

// ═══════════════ Integridad del seed (SOLO LECTURA; solo columnas estables) ═══════════════
const ES_FECHA = /^\d{4}-\d{2}-\d{2}T/;
const iguales = (a, b) => (a == null && b == null) || (typeof a === "number" || typeof b === "number" ? a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9 : a === b);
export async function verificarSeed(g, base, red = (x) => x) {
  const tablas = [["usuarios", D.usuarios()], ["vehiculos", D.vehiculos(base)], ["documentacion_chofer", D.documentacion(base).filas], ["cargas", D.cargas()], ["paradas_viaje", D.paradas()],
    ["mensajes_viaje", D.mensajes()], ["billetera_chofer", D.billetera()], ["viaje_evidencias", D.evidencias(base)], ["consentimientos_legales", D.consentimientos()]];
  const R = { esperadas: 0, presentes: 0, alteradas: [], faltantes: [], errores: [], estado: "intacto" };
  for (const [tabla, seed] of tablas) {
    const cols = [...new Set(seed.flatMap((s) => Object.entries(s).filter(([c, v]) => c !== "password" && c !== "id" && (v === null || ["string", "number", "boolean"].includes(typeof v)) && !(typeof v === "string" && ES_FECHA.test(v))).map(([c]) => c)))];
    try {
      const filas = await leer(g, tabla, ["id", ...cols].join(","), [["in", "id", seed.map((s) => s.id)]]);
      R.esperadas += seed.length;
      for (const s of seed) {
        const f = filas.find((x) => String(x.id) === String(s.id));
        if (!f) { R.faltantes.push(`${tabla}#${s.id}`); continue; }
        R.presentes++;
        const dif = Object.entries(s).filter(([c, v]) => c !== "password" && c !== "id" && (v === null || ["string", "number", "boolean"].includes(typeof v)) && !(typeof v === "string" && ES_FECHA.test(v)) && c in f && !iguales(v, f[c])).map(([c]) => c);
        if (dif.length) R.alteradas.push(`${tabla}#${s.id}: ${dif.join(", ")}`);
      }
    } catch (e) { R.errores.push(`seed ${tabla}: ${msg(e, red)}`); }
  }
  // objetos de Storage del seed: solo se comprueba que EXISTEN (nunca se tocan)
  const porCarpeta = new Map();
  for (const a of D.documentacion(base).archivos) { const i = a.ruta.lastIndexOf("/"); const k = `${a.bucket}|${a.ruta.slice(0, i)}`; (porCarpeta.get(k) ?? porCarpeta.set(k, []).get(k)).push(a.ruta.slice(i + 1)); }
  porCarpeta.set("documentacion-choferes|evidencias/103", ["carga_1.png"]);
  for (const [k, nombres] of porCarpeta) {
    const [bucket, carpeta] = k.split("|");
    try { const l = await listarStorage(g, bucket, carpeta); for (const n of nombres) { R.esperadas++; if (l.entradas.some((e) => e.name === n)) R.presentes++; else R.faltantes.push(`storage ${bucket}/${carpeta}/${n}`); } }
    catch (e) { R.errores.push(`seed storage ${bucket}/${carpeta}: ${msg(e, red)}`); }
  }
  if (R.errores.length) R.estado = "no determinable";
  else if (R.presentes === 0) R.estado = "ausente";
  else if (R.faltantes.length || R.alteradas.length) R.estado = "alterado";
  return R;
}

// ═══════════════ Conteos, limpieza y verificación ═══════════════
export const contarV3 = (R) => ({ usuarios: R.usuarios.length, paradas_viaje: R.paradas.length, viaje_evidencias: R.evidencias.length, inesperadas: R.inesperadas.length, tarifas_config: R.tarifas.length, "seed con marcador V3 (a restaurar)": R.restaurar.length, "Storage v3-marcador/": R.storage.length });
export const contarRealtime = (R) => { const t = { cargas: 0, mensajes_viaje: 0, usuarios: 0 }; for (const c of R.corridas.values()) for (const k of Object.keys(t)) t[k] += c[k]; return { corridas: R.corridas.size, ...t }; };
export const contarFlujos = (R) => ({ cargas: R.cargas.length, mensajes_viaje: R.mensajesRel + R.mensajesSeed.length, viaje_evidencias: R.evidencias, billetera_chofer: R.billetera, paradas_viaje: R.paradas });
const suma = (o) => Object.values(o).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0) - (o.corridas ?? 0);

async function borrar(g, tabla, filtros, log, etiqueta, errores, count = true) {
  try {
    let q = g.from(tabla).delete(count ? { count: "exact" } : undefined);
    for (const [m, c, v] of filtros) q = q[m](c, v);
    const r = await q;
    if (r.error) { errores.push(`${etiqueta}: ${r.error.code ?? ""} ${String(r.error.message ?? "").slice(0, 80)}`); return 0; }
    return r.count ?? 0;
  } catch (e) { errores.push(`${etiqueta}: ${String(e?.message ?? e).slice(0, 120)}`); return 0; }
}

export async function limpiarV3(g, R, log) {
  const errores = []; const n = { restauradas: 0, borrados: 0, storage: 0 };
  for (const it of R.restaurar) {
    try {
      const r = await g.from(it.tabla).update({ [it.col]: it.orig }).eq("id", it.id).eq(it.col, it.actual);
      if (r.error) errores.push(`restaurar ${it.tabla}#${it.id}: ${String(r.error.message ?? "").slice(0, 80)}`); else n.restauradas++;
    } catch (e) { errores.push(`restaurar ${it.tabla}#${it.id}: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  for (const u of R.usuarios) n.borrados += await borrar(g, "usuarios", [["eq", "id", u.id], ["eq", "nombre", V3], ["eq", "email", u.email]], log, `usuarios#${u.id}`, errores);
  for (const id of R.paradas) n.borrados += await borrar(g, "paradas_viaje", [["eq", "id", id], ["eq", "direccion", V3], ["eq", "carga_id", 101], ["eq", "orden", 99]], log, `paradas_viaje#${id}`, errores);
  for (const id of R.evidencias) n.borrados += await borrar(g, "viaje_evidencias", [["eq", "id", id], ["eq", "evento", V3], ["eq", "rol_usuario", "v3"]], log, `viaje_evidencias#${id}`, errores);
  for (const x of R.inesperadas) n.borrados += await borrar(g, x.tabla, [["eq", "id", x.id], ...Object.entries(x.eq).map(([c, v]) => ["eq", c, v])], log, `${x.tabla}#${x.id}`, errores);
  for (const id of R.tarifas) n.borrados += await borrar(g, "tarifas_config", [["eq", "id", id], ["eq", "extra_fragil", NUM_TARIFAS], ...COLS_TARIFAS_OTRAS.map((c) => ["is", c, null])], log, `tarifas_config#${id}`, errores);
  const porBucket = {};
  for (const o of R.storage) (porBucket[o.bucket] ??= []).push(o.ruta);
  for (const [b, rutas] of Object.entries(porBucket)) {
    try { const r = await g.storage.from(b).remove(rutas); if (r.error) errores.push(`storage ${b}: ${String(r.error.message ?? "").slice(0, 80)}`); else n.storage += r.data?.length ?? 0; }
    catch (e) { errores.push(`storage ${b}: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  log(`  V3: restauradas ${n.restauradas} · filas borradas ${n.borrados} · objetos Storage borrados ${n.storage} · errores ${errores.length}`);
  return { errores, ...n };
}

export async function limpiarRealtime(g, R, log, red) {
  const errores = []; let corridas = 0;
  for (const runId of R.corridas.keys()) {
    try { const rep = await limpiarPorMarcador(g, runId, { log: (...p) => log("  " + p.join(" ")), redact: red }); corridas++; if (!rep.ok) errores.push(`Realtime ${runId}: limpieza incompleta`); }
    catch (e) { errores.push(`Realtime ${runId}: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  return { errores, corridas };
}

export async function limpiarFlujos(g, R, log) {
  const errores = []; let borrados = 0;
  const ids = R.ids, idsTxt = demostrar(ids.map(String));
  if (ids.length) {
    borrados += await borrar(g, "mensajes_viaje", [["in", "viaje_id", ids]], log, "mensajes de cargas smoke", errores);
    borrados += await borrar(g, "viaje_evidencias", [["in", "carga_id", ids]], log, "evidencias de cargas smoke", errores);
    borrados += await borrar(g, "billetera_chofer", [["in", "viaje_id", idsTxt], ["in", "chofer_id", [...SEED_CHOFERES]]], log, "billetera de cargas smoke", errores);
    borrados += await borrar(g, "paradas_viaje", [["in", "carga_id", ids]], log, "paradas de cargas smoke", errores);
  }
  for (const m of R.mensajesSeed) borrados += await borrar(g, "mensajes_viaje", [["eq", "id", m.id], ["eq", "viaje_id", m.viaje], ["eq", "tipo_chat", m.tc], ["eq", "mensaje", m.m], ["eq", "remitente_id", m.r]], log, `mensaje smoke #${m.id}`, errores);
  for (const id of ids) {
    borrados += await borrar(g, "cargas", [["eq", "id", id], ["eq", "detalles", R.detalles[id]], ["eq", "cliente_id", D.ID.cliente1], ["eq", "origen", SMOKE_ORIGEN], ["eq", "destino", SMOKE_DESTINO]], log, `carga smoke #${id}`, errores);
  }
  log(`  Flujos: filas borradas ${borrados} · errores ${errores.length}`);
  return { errores, borrados };
}

// ═══════════════ Resumen y códigos de salida ═══════════════
export function resumirLimpieza({ errores = [], restos = 0, noDeterminables = [], seed = null, bloqueos = 0, interrumpido = false }) {
  const seedProblema = seed && (seed.estado === "alterado" || seed.estado === "no determinable");
  let codigo = 0, veredicto = "LIMPIO Y VERIFICADO";
  // una corrida interrumpida (señal / presupuesto total) deja restos POR CONSTRUCCIÓN: eso es "parcial" (3), no un fallo de borrado (1)
  if (errores.length || bloqueos > 0 || (restos > 0 && !interrumpido)) { codigo = 1; veredicto = "RESTOS O ERRORES"; }
  else if (noDeterminables.length || seedProblema || interrumpido) { codigo = 3; veredicto = "PARCIAL / NO DETERMINABLE"; }
  return { codigo, veredicto };
}

export function textoPlan() {
  const L = [];
  L.push("TILA · limpiar-pruebas — PLAN (modo --plan: no lee claves, no conecta, no borra nada)");
  L.push("");
  L.push("DOS operaciones distintas: A) limpieza de PRUEBAS (por defecto)  ·  B) reset del SEED (delegado a seed/aplicar.mjs --reset; esta herramienta NO borra el seed).");
  L.push("Por defecto es DRY-RUN. Borrar exige: TILA_ENTORNO=staging, TILA_STAGING_SUPABASE_REF, STAGING_SUPABASE_URL === https://<ref>.supabase.co, STAGING_SERVICE_ROLE_KEY (solo entorno), --aplicar y --confirmar=<host exacto>.");
  L.push("");
  L.push("A) QUÉ LIMPIA (marcadores REALES, exactos; cada borrado además exige el id de la fila):");
  L.push(`  V3 (v3-anon.mjs):`);
  L.push(`    usuarios              nombre='${V3}' Y email v3-<6hex>-(cliente|chofer|admin)${DOMINIO_EMAIL}`);
  L.push(`    paradas_viaje         direccion='${V3}' Y carga_id=101 Y orden=99`);
  L.push(`    viaje_evidencias      evento='${V3}' Y rol_usuario='v3'`);
  L.push(`    creadas si RLS lo permitiera: cargas, mensajes_viaje, billetera_chofer, consentimientos_legales, vehiculos, documentacion_chofer (marcador ${V3} en sus columnas de prueba)`);
  L.push(`    tarifas_config        extra_fragil=${NUM_TARIFAS} con el resto de columnas nulas (si trae otros valores: se informa, NO se borra)`);
  L.push(`    Storage               ${PREFIJO_STORAGE}<6hex>/(prueba.png|nota.txt) en los buckets ${BUCKETS.join(" y ")}`);
  L.push(`    filas del SEED alteradas por una prueba fallida (cargas.detalles, mensajes_viaje.mensaje, billetera_chofer.viaje_id, consentimientos_legales.user_agent, vehiculos.color,`);
  L.push(`      documentacion_chofer.url con valor '${V3}'/'${V3_DOS}') → se RESTAURAN al valor del seed (no se borran)`);
  L.push(`  Realtime (realtime.mjs): cargas.detalles / mensajes_viaje.mensaje / usuarios.nombre = ${PREFIJO_RT}<8hex> (usuario con email realtime-<8hex>${DOMINIO_EMAIL}); reutiliza limpiarPorMarcador()`);
  L.push(`  Flujos (flujos.mjs) — SOLO con --incluir-flujos:`);
  L.push(`    cargas                detalles ∈ {${SMOKE_DETALLES.map((s) => `'${s}'`).join(", ")}} Y cliente_id=cliente1 del seed Y origen/destino de flujos Y id fuera de las cargas del seed`);
  L.push(`    hijas de esas cargas  mensajes_viaje, viaje_evidencias, billetera_chofer (chofer del seed), paradas_viaje: solo por relación demostrada con las cargas anteriores`);
  L.push(`    mensajes en viajes del seed (103/104): tupla exacta viaje+canal+texto+remitente que flujos.mjs escribe ('smoke cliente <modo>', 'smoke admin <modo>', 'no debería')`);
  L.push("");
  L.push("A) QUÉ PRESERVA / NO PUEDE LIMPIAR DE FORMA SEGURA:");
  L.push("  · El seed ficticio completo (filas y objetos de Storage). Nunca se borra por 'no estar en el seed', ni por fecha, ni por extensión, ni un bucket entero. Sin TRUNCATE. Sin tablas backup_*.");
  L.push("  · Sin --incluir-flujos, los restos de flujos se CUENTAN pero no se tocan (exit 3). Sus marcadores son fijos ('smoke <modo>', sin runId): ver la limitación en el informe.");
  L.push("  · Cambios que las pruebas hacen SOBRE filas del seed sin marcador (mensajes leídos, GPS de la carga 103 por simular-gps, hash de contraseña al iniciar sesión): no son 'restos' y no se borran;");
  L.push("    se DETECTAN (integridad del seed por columnas estables; se ignoran fechas) → exit 3 y se corrigen re-aplicando el seed: seed/aplicar.mjs --aplicar --confirmar=<host> (upsert idempotente).");
  L.push("  · Objetos no reconocidos bajo v3-marcador/ y marcadores REALTIME con formato distinto: se informan y no se borran (exit 3).");
  L.push("");
  L.push("B) --modo=reset-seed: no borra nada desde acá; muestra el comando de seed/aplicar.mjs --reset (que borra el seed por claves padre y lo re-aplica). Correr ANTES la limpieza de pruebas.");
  L.push("");
  L.push("VERIFICACIÓN posterior (con --aplicar): relee y exige 0 restos V3, 0 restos Realtime, 0 restos smoke identificables, 0 objetos Storage de prueba, y compara el seed (presente y sin alteraciones).");
  L.push("Códigos de salida: 0 correcto · 1 restos o error · 2 configuración/guarda · 3 parcial/no determinable.");
  L.push(`Tiempos (TIMEOUTS): llamada ${TIMEOUTS.llamadaMs} ms · total ${TIMEOUTS.totalMs} ms.`);
  return L.join("\n");
}

const filaConteo = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(" · ");

// ═══════════════ main (dependencias inyectadas) ═══════════════
export async function main(argv, deps) {
  const out = deps.out ?? console.log, err = deps.err ?? console.error;
  const a = parsearArgs(argv);
  if (a.errores.length) { for (const e of a.errores) err(`[uso] ${e}`); return 2; }
  if (a.ayuda || a.plan) { out(textoPlan()); return 0; } // ← nada más: ni env, ni red, ni borrado

  const env = deps.env ?? {};
  const T = { ...TIMEOUTS, ...(deps.timeouts ?? {}) };
  const secretos = [env.STAGING_SERVICE_ROLE_KEY, env.STAGING_ANON_KEY].filter((x) => typeof x === "string");
  const red = (t) => redactar(t, secretos);
  const log = (...p) => out(red(p.join(" ")));
  const hayEntorno = ["TILA_ENTORNO", "TILA_STAGING_SUPABASE_REF", "STAGING_SUPABASE_URL", "STAGING_SERVICE_ROLE_KEY"].some((k) => typeof env[k] === "string" && env[k] !== "");
  const necesitaEntorno = a.aplicar || a.contar;
  let v = { ok: false, errores: ["sin configuración de staging en el entorno"], cfg: null };
  if (necesitaEntorno || hayEntorno) v = validarConfig(env);
  if ((necesitaEntorno || hayEntorno) && !v.ok) {
    err("[limpiar-pruebas] CONFIGURACIÓN RECHAZADA (no se conectó ni se borró nada):");
    for (const e of v.errores) err("  ✖ " + red(e));
    if (!necesitaEntorno) err("  (dry-run: corregí la configuración antes de usar --contar o --aplicar)");
    return 2;
  }

  // ── B) reset del seed: delegado ─────────────────────────────────────────────────────────────────────────────────────────
  if (a.modo === "reset-seed") {
    if (a.aplicar) { err("[limpiar-pruebas] --modo=reset-seed no borra desde esta herramienta (ver --plan). Usá seed/aplicar.mjs --reset. Nada se conectó ni se borró."); return 2; }
    const host = v.ok ? v.cfg.host : "<ref>.supabase.co";
    out("RESET DEL SEED — operación DISTINTA de la limpieza de pruebas; esta herramienta no la ejecuta.");
    out("  Por qué no se duplica: node scripts/staging/seed/aplicar.mjs ya implementa --reset (borra el seed por claves padre y lo re-aplica) con sus propias guardas y dry-run.");
    out("  1) Primero limpiar pruebas:   node --env-file=.env.staging scripts/staging/limpiar-pruebas.mjs --aplicar --confirmar=" + host + " [--incluir-flujos]");
    out("  2) Dry-run del reset:         node --env-file=.env.staging scripts/staging/seed/aplicar.mjs --reset");
    out("  3) Reset real (destructivo):  node --env-file=.env.staging scripts/staging/seed/aplicar.mjs --aplicar --confirmar=" + host + " --reset");
    out("  Nota: --reset no borra cargas smoke ni objetos de Storage de prueba; por eso la limpieza de pruebas va primero.");
    return 0;
  }

  const clasesTxt = ["V3 (usuarios, paradas_viaje, viaje_evidencias, inesperadas, tarifas_config, restauración del seed, Storage v3-marcador/)", "Realtime (cargas, mensajes_viaje, usuarios con REALTIME-MARCADOR-<runId>)", `Flujos smoke (${a.incluirFlujos ? "INCLUIDO" : "solo se cuenta; falta --incluir-flujos"})`];

  // ── DRY-RUN sin conexión ────────────────────────────────────────────────────────────────────────────────────────────────
  if (!a.aplicar && !a.contar) {
    out("DRY-RUN (no se conecta, no se borra nada). Clases que limpiaría:");
    for (const c of clasesTxt) out("  · " + c);
    out(v.ok ? `Configuración de staging VÁLIDA (${v.cfg.host}; clave [CONFIGURADA]). Sin conexión no hay conteos: agregá --contar (solo lectura) o --aplicar --confirmar=${v.cfg.host}.`
      : "Sin configuración de staging: solo se listan las clases. Detalle exacto de marcadores y preservación: --plan.");
    return 0;
  }

  // ── desde acá se conectará: todas las guardas ya pasaron; falta la confirmación para borrar ────────────────────────────
  const cfg = v.cfg;
  if (a.aplicar && a.confirmar !== cfg.host) {
    err(`[limpiar-pruebas] para borrar en ${cfg.host} hay que pasar --confirmar=${cfg.host} (exacto). No se conectó ni se borró nada.`);
    return 2;
  }
  const t0 = Date.now();
  let abortado = false;
  const alSenal = () => { abortado = true; };
  const senales = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];
  for (const s of senales) deps.proceso?.on?.(s, alSenal);
  const fuera = () => abortado || Date.now() - t0 > T.totalMs;
  let g;
  try {
    const real = deps.crearCliente(cfg.url, cfg.service, { auth: { persistSession: false, autoRefreshToken: false } });
    g = envolverCliente(real, { incluirFlujos: a.incluirFlujos && a.aplicar, T });
    log(`LIMPIAR-PRUEBAS · ${a.aplicar ? "APLICAR" : "DRY-RUN con lectura (--contar)"} · staging ${cfg.host} · clave [CONFIGURADA]${a.incluirFlujos ? " · con flujos" : ""}`);
    // preflight de lectura
    try { const r = await g.from("usuarios").select("id").limit(1); if (r.error) throw new Error(r.error.message ?? "error"); }
    catch (e) { err(`[limpiar-pruebas] la clave no responde en ${cfg.host} (${red(String(e?.message ?? e)).slice(0, 100)}). No se borró nada.`); return 1; }

    const leerTodo = async () => {
      const [v3, rt, fl] = [await descubrirV3(g, cfg.url, red), await descubrirRealtime(g, red), await descubrirFlujos(g, red)];
      return { v3, rt, fl };
    };
    const informar = (titulo, s) => {
      log(titulo);
      log(`  V3        : ${filaConteo(contarV3(s.v3))}`);
      log(`  Realtime  : ${filaConteo(contarRealtime(s.rt))}`);
      log(`  Flujos    : ${filaConteo(contarFlujos(s.fl))}${a.incluirFlujos ? "" : "  (no incluidos sin --incluir-flujos)"}`);
      for (const o of [...s.v3.omitidos, ...s.rt.desconocidos, ...s.fl.ajenas, ...s.v3.noRestaurables, ...s.v3.storageDesconocidos]) log(`  NO reconocido/omitido (no se toca): ${o}`);
      for (const t of s.v3.tarifasAlteradas) log(`  tarifas_config#${t}: extra_fragil con el marcador pero con otros valores: alteración de una fila existente; NO se borra ni restaura (valor original desconocido)`);
      for (const e of [...s.v3.errores, ...s.rt.errores, ...s.fl.errores]) log(`  lectura fallida: ${e}`);
    };
    const noDet = (s) => [...s.v3.omitidos, ...s.rt.desconocidos, ...s.fl.ajenas, ...s.v3.noRestaurables, ...s.v3.storageDesconocidos, ...s.v3.tarifasAlteradas.map((t) => `tarifas_config#${t}`), ...s.v3.errores, ...s.rt.errores, ...s.fl.errores];

    const antes = await leerTodo();
    informar(a.aplicar ? "ANTES de limpiar:" : "CONTEOS PREVISTOS (solo lectura):", antes);
    if (!a.aplicar) {
      const seed = await verificarSeed(g, cfg.url, red);
      log(`  seed: ${seed.estado} (${seed.presentes}/${seed.esperadas} elementos presentes${seed.alteradas.length ? `; alterados: ${seed.alteradas.length}` : ""})`);
      log("DRY-RUN: no se borró nada. Para limpiar: --aplicar --confirmar=" + cfg.host);
      return noDet(antes).length || seed.estado === "no determinable" ? 3 : 0;
    }

    // ── APLICAR ────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const errores = []; let interrumpido = false;
    const paso = async (nombre, fn) => { if (fuera()) { interrumpido = true; log(`  (interrumpido antes de ${nombre})`); return; } const r = await fn(); errores.push(...(r?.errores ?? [])); };
    await paso("Realtime", () => limpiarRealtime(g, antes.rt, log, red));
    if (a.incluirFlujos) await paso("Flujos", () => limpiarFlujos(g, antes.fl, log));
    await paso("V3", () => limpiarV3(g, antes.v3, log));

    // ── VERIFICACIÓN: releer todo ───────────────────────────────────────────────────────────────────────────────────────────
    const despues = await leerTodo();
    informar("DESPUÉS de limpiar (relectura):", despues);
    const seed = await verificarSeed(g, cfg.url, red);
    const restosV3 = suma(contarV3(despues.v3)), restosRT = suma(contarRealtime(despues.rt)), restosFl = suma(contarFlujos(despues.fl));
    const flujosSinIncluir = !a.incluirFlujos && restosFl > 0;
    log(`VERIFICACIÓN: restos V3 ${restosV3} · restos Realtime ${restosRT} · restos smoke ${restosFl}${flujosSinIncluir ? " (no incluidos: pasar --incluir-flujos)" : ""} · Storage de prueba ${despues.v3.storage.length}`);
    log(`  seed: ${seed.estado} (${seed.presentes}/${seed.esperadas} elementos presentes)`);
    for (const x of seed.alteradas.slice(0, 15)) log(`    alterado: ${x}`);
    for (const x of seed.faltantes.slice(0, 15)) log(`    faltante: ${x}`);
    for (const x of seed.errores) log(`    no determinable: ${x}`);
    if (seed.estado === "alterado" || seed.estado === "ausente") log("  Para restaurar el seed: node --env-file=.env.staging scripts/staging/seed/aplicar.mjs --aplicar --confirmar=" + cfg.host + "   (upsert idempotente; NO es un resto de limpieza)");
    for (const e of errores) log(`  error: ${e}`);
    if (g.bloqueos.length) for (const b of g.bloqueos) log(`  BLOQUEADO POR LA GUARDA (error de la herramienta): ${b.op} ${b.tabla}: ${b.motivo}`);
    const restos = restosV3 + restosRT + (a.incluirFlujos ? restosFl : 0);
    const nd = [...noDet(despues), ...(flujosSinIncluir ? ["flujos sin --incluir-flujos"] : [])];
    const res = resumirLimpieza({ errores, restos, noDeterminables: nd, seed, bloqueos: g.bloqueos.length, interrumpido });
    log(`RESULTADO: ${res.veredicto} → exit ${res.codigo}`);
    return res.codigo;
  } catch (e) {
    err(`[limpiar-pruebas] error inesperado: ${red(String(e?.message ?? e)).slice(0, 160)}`);
    return 1;
  } finally { for (const s of senales) deps.proceso?.off?.(s, alSenal); }
}

export function depsReales() { return { env: process.env, out: (l) => console.log(l), err: (l) => console.error(l), crearCliente: createClient, proceso: process }; }

if (process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("limpiar-pruebas.mjs")) {
  main(process.argv.slice(2), depsReales()).then((c) => { process.exitCode = c; setTimeout(() => process.exit(c), TIMEOUTS.salidaForzadaMs).unref(); },
    (e) => { console.error("[limpiar-pruebas] error inesperado:", redactar(e?.message ?? e)); process.exitCode = 1; });
}
