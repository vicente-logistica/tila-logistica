// Levantador de la app TILA contra STAGING: UN build + 3 instancias (legacy / dual / strict) para los smoke tests.
//
// Uso (futuro; este archivo se preparó pero NO se ejecutó contra nada):
//   node --env-file=.env.staging scripts/staging/levantar-staging.mjs --plan     (solo describe; no lee .env.staging, sin build/procesos/red)
//   node --env-file=.env.staging scripts/staging/levantar-staging.mjs --check    (valida variables y guardas; sin Supabase, sin build, sin procesos, sin puertos)
//   node --env-file=.env.staging scripts/staging/levantar-staging.mjs            (valida → puertos → build → escaneo del build → 3 instancias → supervisión)
//   node --env-file=.env.staging scripts/staging/levantar-staging.mjs --sin-build (reutiliza .next, pero igualmente lo escanea antes de levantar)
//
// Reglas de diseño:
//   · Configuración SOLO por variables de entorno. Nada de claves, URLs ni refs por argv (cualquier argumento desconocido se rechaza).
//   · Las guardas corren ANTES de cualquier build o proceso hijo. Ante la duda, aborta (exit 2).
//   · Los hijos NO heredan process.env: su entorno se arma DESDE CERO (lista mínima de variables del sistema + variables de staging explícitas).
//     Además, todo nombre que aparezca en algún `.env*` del proyecto y que no sea de staging se pisa con un valor NO vacío (placeholder),
//     porque Next da prioridad a process.env sobre `.env.local` y solo carga del archivo lo que está `undefined` (ver @next/env).
//   · Hosts loopback distintos por modo (cookies = por host, no por puerto) y NUNCA 0.0.0.0.
//   · Un solo build sirve a los 3 modos: TILA_AUTH_MODE / TILA_SESSION_SECRET se leen en RUNTIME; los NEXT_PUBLIC_* quedan congelados en el build
//     y son idénticos para los 3 modos (mismo Supabase de staging).
//   · Build e instancias reciben NODE_OPTIONS=--use-system-ca como CONSTANTE del launcher (nunca el NODE_OPTIONS del shell): sin él, un Node que no confía en los
//     certificados del sistema falla con UNABLE_TO_VERIFY_LEAF_SIGNATURE al hablar con Supabase. TLS nunca se desactiva. NODE_EXTRA_CA_CERTS NO se hereda.
//     NO va como argumento de node: `next build` re-inyecta process.execArgv en el NODE_OPTIONS de su Worker (worker_threads) y Node lo rechaza con
//     ERR_WORKER_INVALID_EXEC_ARGV salvo que ese NODE_OPTIONS coincida con el del proceso padre.
//   · Readiness en dos pasos: (1) la instancia responde; (2) sonda de SOLO LECTURA (GET /api/cargas/disponibles) que obliga a la app a consultar Supabase.
//   · Ningún secreto se imprime: las variables sensibles se muestran solo como [CONFIGURADA] y toda salida de hijos pasa por redactar().
//
// Códigos de salida: 0 = OK / apagado limpio · 1 = falla en ejecución (puerto ocupado, build, escaneo, hijo caído) · 2 = configuración inválida / guarda · 3 = uso incorrecto
import { spawn as spawnReal, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTS_PRODUCCION, REF_PRODUCCION, asegurarAppNoProduccion, asegurarNoProduccion } from "./guardas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ_PROYECTO = resolve(AQUI, "..", "..");

// ── Instancias: un host loopback distinto por modo (cookies host-scoped) ─────────────────────────────────────────────────
// Se usan IPs 127.0.0.x y no `localhost`: `localhost` puede resolver a ::1 o 127.0.0.1 según el SO/Node y depende del archivo hosts.
export const MODOS = Object.freeze([
  Object.freeze({ modo: "legacy", host: "127.0.0.1", puerto: 3131 }),
  Object.freeze({ modo: "dual", host: "127.0.0.2", puerto: 3132 }),
  Object.freeze({ modo: "strict", host: "127.0.0.3", puerto: 3133 }),
]);
export const RUTA_LISTO = "/api/mercadopago/webhook"; // GET inerte: responde {ok:true} sin tocar Supabase
export const PLACEHOLDER = "STAGING-NO-CONFIGURADA"; // NO vacío a propósito: @next/env borra las claves cuyo valor inicial es ""

// Variables de staging que el launcher exige (nombres; los valores jamás se imprimen).
export const REQUERIDAS = Object.freeze([
  "TILA_ENTORNO",
  "TILA_STAGING_SUPABASE_REF",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TILA_SESSION_SECRET",
  "NEXT_PUBLIC_BASE_URL",
]);
// Opcionales que la app lee: si faltan, el hijo recibe PLACEHOLDER (nunca el valor que pudiera haber en un .env.local).
export const OPCIONALES = Object.freeze([
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
  "NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID",
  "GOOGLE_SERVER_API_KEY",
  "MERCADOPAGO_ACCESS_TOKEN",
  "MERCADOPAGO_WEBHOOK_SECRET",
]);
// De estas, las que son secretas (se redactan en toda salida).
const SECRETAS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TILA_SESSION_SECRET",
  "GOOGLE_SERVER_API_KEY",
  "MERCADOPAGO_ACCESS_TOKEN",
  "MERCADOPAGO_WEBHOOK_SECRET",
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
]);
// Coherencia opcional con las variables STAGING_* de .env.staging (las que usan v3-anon.mjs y el seed).
const PARES_STAGING = Object.freeze([
  ["STAGING_SUPABASE_URL", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]],
  ["STAGING_ANON_KEY", ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]],
  ["STAGING_SERVICE_ROLE_KEY", ["SUPABASE_SERVICE_ROLE_KEY"]],
]);

// Variables del sistema que un hijo necesita para funcionar (comparación sin distinguir mayúsculas: Windows). NADA más se hereda:
// ni NODE_OPTIONS (el hijo recibe una constante propia, ver NODE_OPTIONS_HIJOS), ni proxies, ni credenciales de nube, ni SUPABASE_* del shell.
const SISTEMA = Object.freeze([
  "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "HOMEDRIVE", "HOMEPATH",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES",
  "ALLUSERSPROFILE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "USERNAME", "USERDOMAIN", "COMPUTERNAME",
  "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "SHELL", "USER", "LOGNAME",
]);

// ── Utilidades ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Reemplaza secretos conocidos y patrones de claves de Supabase por [REDACTADO]. */
export function redactar(texto, secretos = []) {
  let t = String(texto ?? "");
  for (const s of secretos) if (typeof s === "string" && s.length >= 8) t = t.split(s).join("[REDACTADO]");
  return t
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[REDACTADO]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTADO]");
}

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

/** Resuelve referencias exactas `${NOMBRE}` contra el propio entorno (Node --env-file NO las expande). Una sola pasada, solo nombres conocidos. */
export function expandirReferencias(env, nombres = [...REQUERIDAS, ...OPCIONALES]) {
  const salida = {};
  for (const n of nombres) {
    const v = env[n];
    if (typeof v !== "string") continue;
    salida[n] = v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (orig, ref) => (typeof env[ref] === "string" ? env[ref] : orig));
  }
  return salida;
}

const contieneProduccion = (v) =>
  typeof v === "string" && (v.toLowerCase().includes(REF_PRODUCCION) || HOSTS_PRODUCCION.some((h) => v.toLowerCase().includes(h)));

// ── Modos: hosts y puertos ────────────────────────────────────────────────────────────────────────────────────────────────
export function validarModos(modos = MODOS) {
  const errores = [];
  const vistosHost = new Set(); const vistosPuerto = new Set(); const vistosModo = new Set();
  for (const { modo, host, puerto } of modos) {
    if (!["legacy", "dual", "strict"].includes(modo)) errores.push(`modo desconocido: ${modo}`);
    if (vistosModo.has(modo)) errores.push(`modo repetido: ${modo}`); vistosModo.add(modo);
    if (host === "0.0.0.0" || host === "::" || host === "") errores.push(`${modo}: host ${JSON.stringify(host)} expone la app fuera de esta máquina`);
    else if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) errores.push(`${modo}: host ${host} no es una IP loopback 127.x.x.x`);
    if (!Number.isInteger(puerto) || puerto < 1024 || puerto > 65535) errores.push(`${modo}: puerto inválido`);
    if (vistosHost.has(host)) errores.push(`${modo}: host repetido (cookies compartidas entre modos)`); vistosHost.add(host);
    if (vistosPuerto.has(puerto)) errores.push(`${modo}: puerto repetido`); vistosPuerto.add(puerto);
  }
  if (modos.length !== 3) errores.push("deben ser exactamente 3 instancias (legacy, dual, strict)");
  return errores;
}

// ── Validación de la configuración (PURA: no toca red, disco ni procesos) ────────────────────────────────────────────────
function revisarClave(nombre, valor, tipo, ref, errores) {
  if (typeof valor !== "string" || !valor) return;
  if (valor !== valor.trim() || /\s/.test(valor) || /["'`]/.test(valor)) { errores.push(`${nombre} contiene espacios o comillas (revisar el .env.staging).`); return; }
  if (valor.includes("${")) { errores.push(`${nombre} tiene una referencia \${…} sin resolver.`); return; }
  if (valor.length < 20) { errores.push(`${nombre} es demasiado corta para ser una clave real.`); return; }
  const info = inspeccionarClave(valor);
  if (info.formato === "desconocido") { errores.push(`${nombre}: formato de clave no reconocido.`); return; }
  if (tipo === "anon") {
    if (info.formato === "secret") errores.push(`${nombre} es una clave SECRETA (sb_secret_): la anon debe ser publishable o JWT anon.`);
    if (info.formato === "jwt" && info.rol !== "anon") errores.push(`${nombre} es un JWT con rol "${info.rol ?? "desconocido"}", se esperaba "anon".`);
  } else {
    if (info.formato === "publishable") errores.push(`${nombre} es una clave PÚBLICA (sb_publishable_): la service debe ser sb_secret_ o JWT service_role.`);
    if (info.formato === "jwt" && info.rol !== "service_role") errores.push(`${nombre} es un JWT con rol "${info.rol ?? "desconocido"}", se esperaba "service_role".`);
  }
  if (info.formato === "jwt") {
    if (!info.ref) errores.push(`${nombre}: el JWT no trae "ref"; no se puede verificar a qué proyecto pertenece.`);
    else if (info.ref === REF_PRODUCCION) errores.push(`${nombre} pertenece al proyecto de PRODUCCIÓN. Abortado.`);
    else if (ref && info.ref !== ref) errores.push(`${nombre}: el ref del JWT no coincide con TILA_STAGING_SUPABASE_REF.`);
  }
}

function revisarUrlSupabase(nombre, valor, ref, errores) {
  if (typeof valor !== "string" || !valor) return;
  if (valor.includes("${")) { errores.push(`${nombre} tiene una referencia \${…} sin resolver.`); return; }
  let u;
  try { u = new URL(valor); } catch { errores.push(`${nombre} no es una URL válida.`); return; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:") errores.push(`${nombre} debe usar https (staging es siempre Supabase Cloud).`);
  if (u.username || u.password) errores.push(`${nombre} no puede llevar usuario ni contraseña.`);
  if (u.port) errores.push(`${nombre} no puede llevar puerto.`);
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash) errores.push(`${nombre} debe ser solo https://<ref>.supabase.co (sin ruta, query ni hash).`);
  if (contieneProduccion(host)) { errores.push(`${nombre} apunta a PRODUCCIÓN. Abortado.`); return; }
  if (ref && host !== `${ref}.supabase.co`) { errores.push(`${nombre}: el ref de la URL no coincide EXACTAMENTE con TILA_STAGING_SUPABASE_REF.`); return; }
  if (ref) {
    try { asegurarNoProduccion(`https://${ref}.supabase.co`, { etiqueta: nombre, env: { TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: ref } }); }
    catch (e) { errores.push(String(e.message)); }
  }
}

/**
 * Valida TODO antes de tocar nada. Devuelve { errores, avisos, cfg }.
 * `cfg` solo existe si no hay errores y contiene únicamente variables de staging explícitas (con sus valores, en memoria).
 * Los mensajes de error/aviso NUNCA incluyen valores de variables.
 */
export function validarConfig(envFuente, { modos = MODOS } = {}) {
  const errores = [];
  const avisos = [];
  errores.push(...validarModos(modos));

  if (envFuente.NODE_TLS_REJECT_UNAUTHORIZED === "0") errores.push("NODE_TLS_REJECT_UNAUTHORIZED=0 está definida: la verificación TLS no puede estar desactivada.");
  if (envFuente.TILA_ENTORNO !== "staging") errores.push('TILA_ENTORNO debe ser exactamente "staging".');

  const falta = REQUERIDAS.filter((n) => typeof envFuente[n] !== "string" || envFuente[n].trim() === "");
  for (const n of falta) errores.push(`Falta la variable obligatoria ${n}.`);

  const v = expandirReferencias(envFuente);

  // ref
  const ref = v.TILA_STAGING_SUPABASE_REF ?? "";
  let refOk = false;
  if (ref) {
    if (!/^[a-z0-9]{16,32}$/.test(ref)) errores.push("TILA_STAGING_SUPABASE_REF debe ser UN solo ref (minúsculas y números; sin comas, espacios ni comentarios).");
    else if (ref === REF_PRODUCCION || ref.includes(REF_PRODUCCION)) errores.push("TILA_STAGING_SUPABASE_REF es el ref de PRODUCCIÓN. Abortado.");
    else refOk = true;
  }
  const refUsable = refOk ? ref : "";

  // URLs de Supabase (las dos, exactamente https://<ref>.supabase.co)
  revisarUrlSupabase("NEXT_PUBLIC_SUPABASE_URL", v.NEXT_PUBLIC_SUPABASE_URL, refUsable, errores);
  revisarUrlSupabase("SUPABASE_URL", v.SUPABASE_URL, refUsable, errores);
  if (v.NEXT_PUBLIC_SUPABASE_URL && v.SUPABASE_URL && v.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "") !== v.SUPABASE_URL.replace(/\/$/, "")) {
    errores.push("NEXT_PUBLIC_SUPABASE_URL y SUPABASE_URL deben ser la misma URL (cliente y servidor hablan con el mismo staging).");
  }

  // claves
  revisarClave("NEXT_PUBLIC_SUPABASE_ANON_KEY", v.NEXT_PUBLIC_SUPABASE_ANON_KEY, "anon", refUsable, errores);
  revisarClave("SUPABASE_SERVICE_ROLE_KEY", v.SUPABASE_SERVICE_ROLE_KEY, "service", refUsable, errores);
  if (v.NEXT_PUBLIC_SUPABASE_ANON_KEY && v.NEXT_PUBLIC_SUPABASE_ANON_KEY === v.SUPABASE_SERVICE_ROLE_KEY) errores.push("La clave anon y la service_role no pueden ser la misma.");

  // coherencia con STAGING_* (si están presentes, deben coincidir; nunca se usan como reemplazo silencioso)
  const vs = expandirReferencias(envFuente, PARES_STAGING.map(([s]) => s));
  for (const [origen, destinos] of PARES_STAGING) {
    if (typeof vs[origen] !== "string" || vs[origen] === "") continue;
    for (const d of destinos) {
      if (typeof v[d] === "string" && v[d].replace(/\/$/, "") !== vs[origen].replace(/\/$/, "")) errores.push(`${d} no coincide con ${origen} (configuración incoherente).`);
    }
  }

  // secreto de sesión
  const sec = v.TILA_SESSION_SECRET;
  if (typeof sec === "string" && sec) {
    if (sec.length < 32) errores.push("TILA_SESSION_SECRET debe tener al menos 32 caracteres.");
    if (/\s/.test(sec) || sec.includes("${")) errores.push("TILA_SESSION_SECRET no puede tener espacios ni referencias ${…}.");
    if (sec === v.NEXT_PUBLIC_SUPABASE_ANON_KEY || sec === v.SUPABASE_SERVICE_ROLE_KEY) errores.push("TILA_SESSION_SECRET no puede reutilizar una clave de Supabase.");
  }

  // URL pública de la app (Mercado Pago back_urls; se congela en el build porque el código la lee como process.env.NEXT_PUBLIC_BASE_URL)
  if (v.NEXT_PUBLIC_BASE_URL) {
    if (!/^https?:\/\//i.test(v.NEXT_PUBLIC_BASE_URL)) errores.push("NEXT_PUBLIC_BASE_URL debe ser una URL http(s) completa.");
    else {
      try { asegurarAppNoProduccion(v.NEXT_PUBLIC_BASE_URL, { etiqueta: "NEXT_PUBLIC_BASE_URL", env: { TILA_ENTORNO: "staging", TILA_STAGING_APP_HOSTS: envFuente.TILA_STAGING_APP_HOSTS } }); }
      catch (e) { errores.push(String(e.message)); }
    }
  }

  // opcionales: nada que huela a producción
  const opcionalesPresentes = {};
  const opcionalesAusentes = [];
  for (const n of OPCIONALES) {
    const val = v[n];
    if (typeof val !== "string" || val.trim() === "") { opcionalesAusentes.push(n); continue; }
    if (val.includes("${")) { errores.push(`${n} tiene una referencia \${…} sin resolver.`); continue; }
    if (n === "MERCADOPAGO_ACCESS_TOKEN" && /^APP_USR-/.test(val)) errores.push("MERCADOPAGO_ACCESS_TOKEN es de PRODUCCIÓN (APP_USR-…). En staging solo credenciales de prueba (TEST-…).");
    opcionalesPresentes[n] = val;
  }
  // ninguna variable explícita puede contener el ref ni un host de producción
  for (const n of [...REQUERIDAS, ...OPCIONALES]) {
    if (contieneProduccion(v[n]) && n !== "NEXT_PUBLIC_SUPABASE_URL" && n !== "SUPABASE_URL" && n !== "NEXT_PUBLIC_BASE_URL") errores.push(`${n} contiene una referencia a PRODUCCIÓN (ref u host). Abortado.`);
  }
  if (typeof envFuente.TILA_AUTH_MODE === "string" && envFuente.TILA_AUTH_MODE !== "") avisos.push("TILA_AUTH_MODE está definida en el entorno: se IGNORA (el launcher la fija por instancia).");
  if (opcionalesAusentes.length) avisos.push(`Sin configurar (los hijos reciben un placeholder inofensivo): ${opcionalesAusentes.join(", ")}.`);

  if (errores.length) return { errores, avisos, cfg: null };
  const vars = {};
  for (const n of REQUERIDAS) if (n !== "TILA_ENTORNO" && n !== "TILA_STAGING_SUPABASE_REF") vars[n] = v[n];
  return {
    errores,
    avisos,
    cfg: { ref, supabaseHost: `${ref}.supabase.co`, vars, opcionalesPresentes, opcionalesAusentes, secretos: [...SECRETAS.map((n) => vars[n] ?? opcionalesPresentes[n]).filter(Boolean)] },
  };
}

// ── Entorno de los hijos: DESDE CERO ─────────────────────────────────────────────────────────────────────────────────────
/** Nombres (solo nombres, nunca valores) que definen los `.env*` del proyecto. */
export function nombresEnArchivosEnv(fs, dirs) {
  const nombres = new Set();
  for (const dir of dirs) {
    let archivos = [];
    try { archivos = fs.readdirSync(dir); } catch { continue; }
    for (const a of archivos) {
      const nombre = typeof a === "string" ? a : a.name;
      if (!/^\.env(\..+)?$/.test(nombre)) continue;
      let txt = "";
      try { txt = String(fs.readFileSync(join(dir, nombre), "utf8")); } catch { continue; }
      for (const linea of txt.split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/.exec(linea);
        if (m) nombres.add(m[1]);
      }
    }
  }
  return nombres;
}

/**
 * Construye el entorno de un hijo (build o instancia). NO parte de process.env completo:
 *  1) variables del sistema (lista mínima); 2) variables de staging explícitas; 3) placeholders NO vacíos para todo nombre
 *  conocido por la app u observado en los `.env*` que no sea de staging → Next no puede rellenarlos desde `.env.local`.
 */
export function construirEntorno(base, cfg, modo, nombresArchivos = new Set()) {
  const e = {};
  const sistema = new Set(SISTEMA);
  for (const [k, val] of Object.entries(base)) if (sistema.has(k.toUpperCase()) && typeof val === "string") e[k] = val;

  Object.assign(e, cfg.vars);
  Object.assign(e, cfg.opcionalesPresentes);
  e.TILA_ENTORNO = "staging";
  e.TILA_STAGING_SUPABASE_REF = cfg.ref;
  e.TILA_AUTH_MODE = modo;
  e.NODE_ENV = "production";
  e.NEXT_TELEMETRY_DISABLED = "1";
  e.NODE_OPTIONS = NODE_OPTIONS_HIJOS; // constante del launcher; jamás el NODE_OPTIONS del shell (podría traer --require / --inspect)

  const yaPuestos = new Set(Object.keys(e).map((k) => k.toUpperCase()));
  for (const n of [...OPCIONALES, ...nombresArchivos]) {
    if (!yaPuestos.has(n.toUpperCase())) { e[n] = PLACEHOLDER; yaPuestos.add(n.toUpperCase()); }
  }
  return e;
}

// ── Escaneo del build: el bundle no puede contener el ref/host de producción de Supabase ────────────────────────────────
const HOST_APP_PRODUCCION = HOSTS_PRODUCCION.find((h) => !h.endsWith(".supabase.co")); // la app (Vercel) de producción; viene de guardas.mjs
const EXT_TEXTO = /\.(js|mjs|cjs|json|html|txt|rsc|css|map)$/i;
export function escanearBuild(fs, dirNext) {
  const res = { archivos: 0, prohibidos: [], avisosHostApp: 0, contieneStaging: null };
  const recorrer = (dir) => {
    let entradas = [];
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entradas) {
      const ruta = join(dir, ent.name);
      if (ent.isDirectory()) { recorrer(ruta); continue; }
      if (!EXT_TEXTO.test(ent.name)) continue;
      let buf;
      try { buf = fs.readFileSync(ruta); } catch { continue; }
      res.archivos++;
      const txt = Buffer.isBuffer(buf) ? buf.toString("latin1") : String(buf);
      const bajo = txt.toLowerCase();
      if (bajo.includes(REF_PRODUCCION)) res.prohibidos.push(ruta);
      // El host de la APP de producción está escrito a mano en el código (AppUrlOpenHandler, crear-preferencia): es informativo, no falla.
      if (bajo.includes(HOST_APP_PRODUCCION)) res.avisosHostApp++;
    }
  };
  for (const sub of ["static", "server"]) recorrer(join(dirNext, sub));
  return res;
}

// ── Plan (texto estático: no depende del entorno ni del disco) ───────────────────────────────────────────────────────────
export function textoPlan() {
  const L = [];
  L.push("TILA · levantar-staging — PLAN (modo --plan: no lee .env.staging, no valida valores, no compila, no lanza procesos, no abre puertos, sin red)");
  L.push("");
  L.push("Uso futuro:  node --env-file=.env.staging scripts/staging/levantar-staging.mjs [--plan | --check | --sin-build]");
  L.push("");
  L.push("Instancias (un build compartido, tres procesos `next start`; hosts loopback DISTINTOS → cookies separadas por modo):");
  for (const { modo, host, puerto } of MODOS) L.push(`  ${modo.padEnd(6)}  http://${host}:${puerto}   (TILA_AUTH_MODE=${modo}; se enlaza SOLO a ${host}, nunca a 0.0.0.0)`);
  L.push("");
  L.push("Pasos de la ejecución real (cada uno solo corre si los anteriores pasaron):");
  L.push("  1. Validar variables y guardas (aborta con exit 2 antes de cualquier build/proceso).");
  L.push("  2. Armar el entorno de los hijos DESDE CERO (variables del sistema + variables de staging + placeholders anti-.env.local).");
  L.push("  3. Comprobar que los 3 puertos están libres en sus hosts.");
  L.push("  4. `next build` UNA vez con el entorno de staging (los NEXT_PUBLIC_* quedan congelados en el build).");
  L.push("  5. Escanear .next/static y .next/server: si aparece el ref/host de Supabase de producción → abortar sin levantar nada.");
  L.push("  6. Lanzar las 3 instancias (sin shell, sin heredar process.env; NODE_OPTIONS=--use-system-ca constante en el env del hijo, TLS nunca se desactiva) y esperar GET " + RUTA_LISTO + " en cada una.");
  L.push("  6b. Sonda de SOLO LECTURA: GET " + RUTA_SONDA + " (x-user-id del chofer1 del seed) en cada instancia; 200/403 = la app llegó a Supabase. 401/otro → se apaga todo (exit 1).");
  L.push("  7. Supervisar: si un hijo muere, se apagan los demás (exit 1); Ctrl+C / SIGTERM apagan todo limpiamente (exit 0).");
  L.push("");
  L.push("Variables OBLIGATORIAS (solo nombres): " + REQUERIDAS.join(", "));
  L.push("Variables OPCIONALES (si faltan, el hijo recibe un placeholder): " + OPCIONALES.join(", "));
  L.push("Opcional para URL de app fuera de loopback: TILA_STAGING_APP_HOSTS. Coherencia opcional: STAGING_SUPABASE_URL, STAGING_ANON_KEY, STAGING_SERVICE_ROLE_KEY.");
  L.push("");
  L.push("Guardas: TILA_ENTORNO==='staging'; ref único y distinto del de producción; NEXT_PUBLIC_SUPABASE_URL y SUPABASE_URL === https://<ref>.supabase.co;");
  L.push("  claves con rol correcto (anon ≠ service_role) y, si son JWT, con el mismo ref; ninguna variable contiene ref/host de producción;");
  L.push("  MERCADOPAGO_ACCESS_TOKEN no puede ser APP_USR-…; NEXT_PUBLIC_BASE_URL nunca es la app de producción. Sin fallbacks silenciosos.");
  L.push("Los secretos nunca se imprimen ([CONFIGURADA]); las claves NO se aceptan por argumentos de línea de comandos.");
  return L.join("\n");
}

// ── Argumentos ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function parsearArgs(argv) {
  const r = { plan: false, check: false, sinBuild: false, ayuda: false, errores: [] };
  for (const a of argv) {
    if (a === "--plan" || a === "--listar") r.plan = true;
    else if (a === "--check") r.check = true;
    else if (a === "--sin-build") r.sinBuild = true;
    else if (a === "--ayuda" || a === "--help" || a === "-h") r.ayuda = true;
    else r.errores.push(`argumento no permitido: ${a.split("=")[0]} (la configuración va por variables de entorno; no se aceptan claves, URLs ni refs por argv)`);
  }
  if (r.plan && r.check) r.errores.push("--plan y --check son excluyentes");
  if ((r.plan || r.check) && r.sinBuild) r.errores.push("--sin-build solo aplica a la ejecución real");
  return r;
}

const cadenaModos = () => "--modos=" + MODOS.map(({ modo, host, puerto }) => `${modo}=http://${host}:${puerto}`).join(",");

// ── Supervisión de procesos ──────────────────────────────────────────────────────────────────────────────────────────────
// Flags de Node de los hijos Next (build e instancias), pasados por NODE_OPTIONS con un valor CONSTANTE (jamás el del shell).
// Sin --use-system-ca, un Node sin los certificados del sistema (p. ej. con un antivirus que intercepta HTTPS) no puede validar
// TLS contra Supabase: fetch falla con UNABLE_TO_VERIFY_LEAF_SIGNATURE y la app responde 500. La verificación TLS NUNCA se desactiva.
// Por qué NODE_OPTIONS y no argv: `next build` corre el build de Turbopack en un worker_threads.Worker y le construye el env con
// NODE_OPTIONS = process.execArgv + NODE_OPTIONS del padre. Si el flag (de proceso, no de isolate) viene solo por argv, el NODE_OPTIONS del worker
// difiere del del padre y Node lanza ERR_WORKER_INVALID_EXEC_ARGV. Con NODE_OPTIONS idéntico en padre y worker, se acepta. (Node 24 / Next 16.2.6)
export const FLAGS_NODE_HIJOS = Object.freeze(["--use-system-ca"]);
export const NODE_OPTIONS_HIJOS = FLAGS_NODE_HIJOS.join(" ");
export function argsNext(nextBin, sub, extra = []) { return [nextBin, sub, ...extra]; }

// ── Sonda de Supabase (readiness, SOLO LECTURA) ─────────────────────────────────────────────────────────────────────────
// GET /api/cargas/disponibles hace únicamente SELECT (usuarios por id y cargas pendientes); no escribe y no depende del modo de auth (x-user-id).
// Usa el chofer1 del seed (mismo UUID que scripts/staging/seed/datos.mjs; un test verifica que coincidan). Interpretación:
//   200 (chofer) o 403 (usuario existe, otro rol) → la app llegó a Supabase y obtuvo respuesta.
//   401 → la app NO pudo leer al usuario: o el seed no está aplicado, o la app no alcanza Supabase (TLS/red/clave): la ruta no distingue ambos casos.
//   otro / red → fallo. No se imprime el cuerpo de la respuesta.
export const RUTA_SONDA = "/api/cargas/disponibles";
export const ID_USUARIO_SONDA = "57a91000-0000-4000-8000-000000000021";
export async function sondearSupabase(fetchFn, { host, puerto }) {
  let r;
  try { r = await fetchFn(`http://${host}:${puerto}${RUTA_SONDA}`, { method: "GET", headers: { "x-user-id": ID_USUARIO_SONDA } }); }
  catch (e) { return { ok: false, detalle: `sin respuesta de la app (${String(e?.name ?? "error")})` }; }
  const st = r?.status;
  if (st === 200 || st === 403) return { ok: true, detalle: `HTTP ${st}` };
  if (st === 401) return { ok: false, detalle: "HTTP 401: la app no pudo leer el usuario del seed en Supabase (seed sin aplicar, o TLS/red/clave de Supabase)" };
  return { ok: false, detalle: `HTTP ${st ?? "?"}` };
}

/** Espera a que un hijo termine (build). Devuelve el código de salida. */
function esperarSalida(hijo) {
  return new Promise((res) => {
    hijo.once("exit", (code, signal) => res(code ?? (signal ? 1 : 0)));
    hijo.once("error", () => res(1));
  });
}

function conectarSalida(hijo, etiqueta, out, secretos) {
  for (const [flujo, cb] of [[hijo.stdout, out], [hijo.stderr, out]]) {
    if (!flujo || typeof flujo.on !== "function") continue;
    let resto = "";
    flujo.on("data", (d) => {
      resto += String(d);
      const lineas = resto.split(/\r?\n/); resto = lineas.pop();
      for (const l of lineas) if (l.trim()) cb(`[${etiqueta}] ${redactar(l, secretos)}`);
    });
    flujo.on("end", () => { if (resto.trim()) cb(`[${etiqueta}] ${redactar(resto, secretos)}`); resto = ""; });
  }
}

// ── Ejecución principal (todas las dependencias inyectadas) ─────────────────────────────────────────────────────────────
export async function main(argv, deps) {
  const { env, out = console.log, err = console.error } = deps;
  const args = parsearArgs(argv);
  if (args.errores.length) { for (const e of args.errores) err(`[uso] ${e}`); err("Uso: levantar-staging.mjs [--plan | --check | --sin-build]"); return 3; }
  if (args.ayuda) { out(textoPlan()); return 0; }
  if (args.plan) { out(textoPlan()); return 0; } // ← nada más: ni env, ni fs, ni red, ni procesos

  // 1) Validación (pura)
  const { errores, avisos, cfg } = validarConfig(env);
  const secretosVal = SECRETAS.map((n) => env[n]).filter((x) => typeof x === "string");
  const seguro = (t) => redactar(t, cfg?.secretos ?? secretosVal);
  if (errores.length) {
    err("[levantar-staging] CONFIGURACIÓN RECHAZADA (no se compiló ni se lanzó nada):");
    for (const e of errores) err("  ✖ " + seguro(e));
    return 2;
  }
  for (const a of avisos) out("  · " + seguro(a));

  const raiz = deps.raiz ?? RAIZ_PROYECTO;
  const nombresArchivos = nombresEnArchivosEnv(deps.fs, [raiz, join(raiz, "app")]);
  const entornos = Object.fromEntries(MODOS.map(({ modo }) => [modo, construirEntorno(env, cfg, modo, nombresArchivos)]));
  const bloqueados = [...nombresArchivos].filter((n) => entornos.legacy[n] === PLACEHOLDER);

  out(`[levantar-staging] configuración válida · Supabase de staging: ${cfg.supabaseHost}`);
  out(`  claves y secretos: [CONFIGURADA] · nombres de .env* neutralizados con placeholder: ${bloqueados.length}`);
  for (const { modo, host, puerto } of MODOS) out(`  ${modo.padEnd(6)} http://${host}:${puerto}`);

  if (args.check) {
    out("[--check] OK: no se compiló, no se lanzó ningún proceso, no se abrió ningún puerto, no se contactó Supabase.");
    return 0;
  }

  // 2) Puertos libres
  for (const { modo, host, puerto } of MODOS) {
    if (!(await deps.puertoLibre(host, puerto))) { err(`[levantar-staging] el puerto ${host}:${puerto} (${modo}) ya está en uso. No se compiló nada.`); return 1; }
  }
  const nextBin = deps.nextBin ?? join(raiz, "node_modules", "next", "dist", "bin", "next");
  if (!deps.fs.existsSync(nextBin)) { err("[levantar-staging] no se encontró el binario de Next en node_modules (¿npm install?)."); return 1; }

  const opciones = (modo, stdio) => ({ cwd: raiz, env: entornos[modo], shell: false, windowsHide: true, stdio });
  const hijos = []; // instancias: { modo, host, puerto, proc, vivo }
  let construyendo = null; // proceso de build en curso (también se apaga ante una señal)
  let apagando = false;
  let resolverFin;
  const fin = new Promise((r) => { resolverFin = r; });
  let codigoFinal = 0;

  const apagarTodos = (motivo, codigo) => {
    if (apagando) return;
    apagando = true; codigoFinal = codigo;
    out(`[levantar-staging] apagando instancias (${motivo})…`);
    if (construyendo) { try { deps.matarArbol(construyendo); } catch { /* ya terminó */ } }
    for (const h of hijos) if (h.vivo) { try { deps.matarArbol(h.proc); } catch { /* ya terminó */ } }
    resolverFin(codigo);
  };

  const senales = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];
  const manejadores = senales.map((s) => { const f = () => apagarTodos(`señal ${s}`, 0); deps.proceso.on(s, f); return [s, f]; });
  const quitarSenales = () => { for (const [s, f] of manejadores) { try { deps.proceso.off(s, f); } catch { /* ignorar */ } } };

  try {
    // 3) Build único
    if (!args.sinBuild) {
      out("[build] next build (una sola vez, con variables de STAGING)…");
      const b = deps.spawn(deps.execPath ?? process.execPath, argsNext(nextBin, "build"), opciones("legacy", ["ignore", "pipe", "pipe"]));
      construyendo = b;
      conectarSalida(b, "build", out, cfg.secretos);
      const codigoBuild = await esperarSalida(b);
      construyendo = null;
      if (apagando) return codigoFinal; // señal durante el build: apagado pedido por el usuario
      if (codigoBuild !== 0) { err("[build] FALLÓ. No se levantó ninguna instancia."); return 1; }
    } else out("[build] omitido (--sin-build): se reutiliza .next, que se escanea igualmente.");

    // 4) Escaneo del build
    const esc = escanearBuild(deps.fs, join(raiz, ".next"));
    if (esc.prohibidos.length) {
      err(`[escaneo] ✖ el build contiene el ref/host de Supabase de PRODUCCIÓN en ${esc.prohibidos.length} archivo(s). NO se levanta nada.`);
      for (const f of esc.prohibidos.slice(0, 10)) err("    " + f);
      err("  Recompilar sin --sin-build (probablemente .next quedó de un build con .env.local de producción).");
      return 1;
    }
    if (esc.archivos === 0) { err("[escaneo] ✖ .next no tiene archivos que escanear (¿falta el build?). No se levanta nada."); return 1; }
    out(`[escaneo] OK: ${esc.archivos} archivos sin referencia a Supabase de producción` + (esc.avisosHostApp ? ` (${esc.avisosHostApp} con el host de la APP de producción escrito a mano en el código: informativo)` : "") + ".");

    // 5) Instancias
    for (const { modo, host, puerto } of MODOS) {
      const proc = deps.spawn(deps.execPath ?? process.execPath, argsNext(nextBin, "start", ["-H", host, "-p", String(puerto)]), opciones(modo, ["ignore", "pipe", "pipe"]));
      const h = { modo, host, puerto, proc, vivo: true };
      hijos.push(h);
      conectarSalida(proc, modo, out, cfg.secretos);
      proc.once("exit", (code, signal) => {
        h.vivo = false;
        if (!apagando) { err(`[${modo}] el proceso terminó inesperadamente (código ${code ?? "?"}${signal ? `, señal ${signal}` : ""}).`); apagarTodos(`murió la instancia ${modo}`, 1); }
      });
      proc.once("error", (e) => { h.vivo = false; if (!apagando) { err(`[${modo}] no se pudo lanzar: ${seguro(e?.message ?? e)}`); apagarTodos(`falló el lanzamiento de ${modo}`, 1); } });
    }

    // 6) Readiness
    const esperar = async ({ modo, host, puerto }, h) => {
      for (let i = 0; i < (deps.intentos ?? 90); i++) {
        if (apagando || !h.vivo) return false;
        try { const r = await deps.fetch(`http://${host}:${puerto}${RUTA_LISTO}`); if (r.ok) return true; } catch { /* reintentar */ }
        await deps.sleep(deps.esperaMs ?? 1000);
      }
      return false;
    };
    const listos = await Promise.all(MODOS.map((m, i) => esperar(m, hijos[i]).then((ok) => ({ m, ok }))));
    if (!apagando) {
      const caidos = listos.filter((x) => !x.ok);
      if (caidos.length) { err(`[levantar-staging] no respondieron a tiempo: ${caidos.map((x) => x.m.modo).join(", ")}.`); apagarTodos("readiness fallida", 1); }
    }
    // 6b) Sonda READ-ONLY: obliga a cada instancia a consultar Supabase (que Next arranque no prueba que llegue a Supabase)
    if (!apagando) {
      const sondas = await Promise.all(MODOS.map((m) => sondearSupabase(deps.fetch, m).then((s) => ({ m, s }))));
      if (!apagando) {
        for (const { m, s } of sondas) out(`[sonda] ${m.modo}: ${s.ok ? "la app consultó Supabase (solo lectura)" : "FALLÓ"} · ${s.detalle}`);
        const malas = sondas.filter((x) => !x.s.ok);
        if (malas.length) { err(`[levantar-staging] la app no pudo consultar Supabase en: ${malas.map((x) => x.m.modo).join(", ")}.`); apagarTodos("sonda de Supabase fallida", 1); }
      }
    }
    if (!apagando) {
      out("");
      out("STAGING LISTO (Ctrl+C para detener todo):");
      for (const h of hijos) out(`  [${h.modo}] pid ${h.proc.pid} · http://${h.host}:${h.puerto} · TILA_AUTH_MODE=${h.modo} · Supabase ${cfg.supabaseHost}`);
      out("  Para los smoke tests: " + cadenaModos());
      out("  Abrí cada modo en su host (cookies separadas); no mezclar 127.0.0.1 con 127.0.0.2/3 en el mismo navegador de prueba.");
    }
    await fin;
    return codigoFinal;
  } finally {
    quitarSenales();
    if (!apagando) { apagando = true; for (const h of hijos) if (h.vivo) { try { deps.matarArbol(h.proc); } catch { /* ignorar */ } } }
    if (construyendo) { try { deps.matarArbol(construyendo); } catch { /* ignorar */ } }
  }
}

// ── Dependencias reales (solo se construyen al ejecutar el script; los tests usan falsos) ────────────────────────────────
export function depsReales() {
  return {
    env: process.env,
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    fs: { existsSync, readdirSync, readFileSync },
    raiz: RAIZ_PROYECTO,
    execPath: process.execPath,
    spawn: spawnReal,
    proceso: process,
    fetch: (u, init = {}) => fetch(u, { ...init, signal: AbortSignal.timeout(init.method ? 15000 : 3000) }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    puertoLibre: (host, puerto) => new Promise((res) => {
      const s = net.createServer();
      s.once("error", () => res(false));
      s.listen({ host, port: puerto, exclusive: true }, () => s.close(() => res(true)));
    }),
    matarArbol: (proc) => {
      if (!proc?.pid) return;
      if (process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore", windowsHide: true });
      else { try { proc.kill("SIGTERM"); } catch { /* ya terminó */ } }
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("levantar-staging.mjs")) {
  const argv = process.argv.slice(2);
  // --plan/--ayuda no construyen dependencias reales: no hay nada que tocar
  main(argv, depsReales()).then((c) => { process.exitCode = c; }, (e) => { console.error("[levantar-staging] error inesperado:", redactar(e?.message ?? e)); process.exitCode = 1; });
}
