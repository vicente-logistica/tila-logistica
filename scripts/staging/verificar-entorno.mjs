// Verificación SEPARADA del entorno de STAGING: confirma que TODO apunta exclusivamente a TILA-STAGING y que no hay contaminación desde producción.
// ESTADO: PREPARADO Y VALIDADO SOLO EN LOCAL (tests con fakes). NUNCA se ejecutó contra Supabase.
//
//   node scripts/staging/verificar-entorno.mjs --plan                          (sin env, sin red, sin disco: explica qué comprueba)
//   node --env-file=.env.staging scripts/staging/verificar-entorno.mjs --local     (NIVEL A: configuración local; CERO red)
//   node --env-file=.env.staging scripts/staging/verificar-entorno.mjs --remoto    (NIVEL B: primero --local completo; luego SOLO LECTURA contra el proyecto)
//   (sin modo = --local: el comportamiento más seguro es no conectarse nunca por defecto)
//
// RESULTADO por chequeo: PASS · FAIL · INCONCLUSO (más N/A: "no aplica en este nivel", no cuenta). Un PASS puede llevar AVISO (informativo).
// CÓDIGOS DE SALIDA (precedencia 2 → 1 → 3 → 0):
//   0 = todo lo solicitado PASS
//   1 = hay FAIL (incoherencia, clave rechazada, secreto corto, .env.staging no ignorado, …)
//   2 = argumentos inválidos o FALLA UNA GUARDA ANTI-PRODUCCIÓN (destino no establecible/seguro o contaminación con ref/host/clave de producción).
//       Ajuste explicado: un FAIL de guarda sale con 2 (no 1) porque el destino no es seguro y --remoto NO corre.
//   3 = INCONCLUSO (no se pudo demostrar: git no disponible, respuesta remota ambigua, clave sb_* sin prueba remota, …)
//
// SECRETOS: nunca se imprime una clave, secreto de sesión, Authorization, apikey, token ni contraseña; las claves se muestran como [CONFIGURADA].
// Los archivos `.env*` se inspeccionan SOLO por NOMBRES y por búsqueda de ref/host de producción (en memoria; el contenido no se imprime ni se guarda).
// Las claves/URLs/ref NO se aceptan por argumentos: solo por variables de entorno.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTS_PRODUCCION, REF_PRODUCCION, asegurarAppNoProduccion, asegurarNoProduccion } from "./guardas.mjs";
import { inspeccionarClave, redactar } from "./smoke/v3-anon.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ_PROYECTO = resolve(AQUI, "..", "..");

// ── Tiempos centralizados ───────────────────────────────────────────────────────────────────────────────────────────────
export const TIMEOUTS = Object.freeze({
  llamadaMs: 10000,       // cada llamada remota (GET); si no responde → INCONCLUSO
  totalMs: 30000,         // presupuesto de todo el nivel remoto
  gitMs: 10000,           // cada comando git de solo lectura
  cuerpoMax: 400,         // se lee como máximo esto del cuerpo de una respuesta (solo para clasificar; nunca se imprime)
  salidaForzadaMs: 2000,  // si algo mantiene vivo el proceso al terminar, se fuerza la salida con el mismo código
});
export const SECRETO_SESION_MIN = 32; // mismo mínimo que app/lib/auth/sesion.ts (SECRETO_MIN)
export const ARCHIVO_STAGING = ".env.staging";

// Variables críticas (nombres). El resto del entorno también se escanea en busca de valores de producción.
export const CRITICAS = Object.freeze([
  "TILA_ENTORNO", "TILA_STAGING_SUPABASE_REF", "STAGING_SUPABASE_URL", "STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TILA_SESSION_SECRET", "NEXT_PUBLIC_BASE_URL",
]);
const SECRETAS = Object.freeze(["STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TILA_SESSION_SECRET",
  "MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET", "GOOGLE_SERVER_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"]);

const PASS = "PASS", FAIL = "FAIL", INCONCLUSO = "INCONCLUSO", NA = "N/A";
export const ESTADOS = Object.freeze({ PASS, FAIL, INCONCLUSO, NA });

// ── Utilidades ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const txt = (env, n) => (typeof env[n] === "string" ? env[n] : "");
const presente = (env, n) => txt(env, n).trim() !== "";
const sinBarra = (u) => String(u).replace(/\/$/, "");
const contieneProd = (v) => typeof v === "string" && (v.toLowerCase().includes(REF_PRODUCCION) || HOSTS_PRODUCCION.some((h) => v.toLowerCase().includes(h)));
/** ¿el valor es (o parece) algo de producción? También decodifica JWT para leer su claim `ref`. */
export function valorDeProduccion(v) {
  if (typeof v !== "string" || !v) return false;
  if (contieneProd(v)) return true;
  const i = inspeccionarClave(v);
  return i.formato === "jwt" && i.ref === REF_PRODUCCION;
}
const ck = (id, titulo, estado, detalle = "", extra = {}) => ({ id, titulo, estado, detalle, ...extra });
const conTimeout = (p, ms, etiqueta) => { let t; const l = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${etiqueta}: sin respuesta en ${ms} ms`)), ms); }); return Promise.race([p, l]).finally(() => clearTimeout(t)); };

// ── Argumentos: NUNCA claves, URLs ni refs ─────────────────────────────────────────────────────────────────────────────────
export function parsearArgs(argv) {
  const r = { plan: false, local: false, remoto: false, ayuda: false, errores: [] };
  for (const a of argv) {
    if (/^--(anon|key|clave|service|service-role|secret|token|password|apikey|url|supabase|supabase-url|ref|env)\b/i.test(a) || /eyJ|sb_(secret|publishable)_/.test(a)) r.errores.push("Las claves, URLs y ref NO se aceptan por argumentos: solo por variables de entorno.");
    else if (a === "--plan" || a === "--listar") r.plan = true;
    else if (a === "--local") r.local = true;
    else if (a === "--remoto") r.remoto = true;
    else if (a === "--ayuda" || a === "--help" || a === "-h") r.ayuda = true;
    else r.errores.push("Argumento no reconocido (el valor no se muestra). Usá --ayuda.");
  }
  if (r.plan && (r.local || r.remoto)) r.errores.push("--plan no se combina con --local ni --remoto.");
  return r;
}

// ═══════════════ NIVEL A — LOCAL (cero red) ═══════════════
function evaluarUrlSupabase(url, ref) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, motivo: "no es una URL válida" }; }
  const host = u.hostname.toLowerCase();
  if (HOSTS_PRODUCCION.some((h) => host === h || host.endsWith("." + h)) || host.includes(REF_PRODUCCION)) return { ok: false, prod: true, motivo: "apunta a PRODUCCIÓN" };
  if (u.protocol !== "https:") return { ok: false, motivo: "el protocolo debe ser https" };
  if (u.username || u.password) return { ok: false, motivo: "no puede llevar usuario ni contraseña" };
  if (u.port) return { ok: false, motivo: "no puede llevar puerto" };
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash) return { ok: false, motivo: "no puede llevar ruta, query ni hash" };
  if (!ref) return { ok: false, motivo: "no se puede validar sin un TILA_STAGING_SUPABASE_REF válido" };
  if (host !== `${ref}.supabase.co`) return { ok: false, motivo: "el host no coincide EXACTAMENTE con TILA_STAGING_SUPABASE_REF" };
  if (ref) { try { asegurarNoProduccion(`https://${ref}.supabase.co`, { etiqueta: "url", env: { TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: ref } }); } catch (e) { return { ok: false, motivo: String(e.message) }; } }
  return { ok: true };
}

/** Forma y rol de una clave, sin mostrarla. tipo: "anon" | "service". */
function evaluarClave(valor, tipo) {
  if (valor !== valor.trim() || /\s/.test(valor) || /["'`]/.test(valor)) return { estado: FAIL, motivo: "contiene espacios o comillas" };
  if (valor.includes("${")) return { estado: FAIL, motivo: "tiene una referencia ${…} sin resolver" };
  if (valor.length < 20) return { estado: FAIL, motivo: "es demasiado corta para ser una clave real" };
  const i = inspeccionarClave(valor);
  if (i.formato === "desconocido" || i.formato === "ausente") return { estado: FAIL, motivo: "formato no reconocido (esperado sb_publishable_/sb_secret_ o JWT)" };
  if (tipo === "anon") {
    if (i.formato === "secret") return { estado: FAIL, motivo: "es una clave SECRETA (sb_secret_): la anon debe ser publishable o JWT anon", i };
    if (i.formato === "jwt" && !i.rol) return { estado: INCONCLUSO, motivo: "JWT sin rol legible: no se puede confirmar que sea anon", i };
    if (i.formato === "jwt" && i.rol !== "anon") return { estado: FAIL, motivo: `es un JWT con rol "${i.rol}", se esperaba "anon"`, i };
  } else {
    if (i.formato === "publishable") return { estado: FAIL, motivo: "es una clave PÚBLICA (sb_publishable_): la service debe ser sb_secret_ o JWT service_role", i };
    if (i.formato === "jwt" && !i.rol) return { estado: INCONCLUSO, motivo: "JWT sin rol legible: no se puede confirmar que sea service_role", i };
    if (i.formato === "jwt" && i.rol !== "service_role") return { estado: FAIL, motivo: `es un JWT con rol "${i.rol}", se esperaba "service_role"`, i };
  }
  return { estado: PASS, i };
}

/** Busca ref/host de producción en el texto de un `.env*`. Devuelve SOLO nombres (nunca valores). */
export function analizarArchivoEnv(texto) {
  const nombres = [], conProduccion = [];
  for (const linea of String(texto).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/.exec(linea);
    if (!m) continue;
    nombres.push(m[1]);
    const valor = m[2].trim().replace(/^["']|["']$/g, "");
    if (valorDeProduccion(valor)) conProduccion.push(m[1]);
  }
  return { nombres, conProduccion };
}

function gitLectura(deps, args) {
  try { return deps.git(args); } catch (e) { return { status: null, stdout: "", stderr: "", error: String(e?.message ?? e) }; }
}

export function verificarLocal(env, deps) {
  const R = [];
  const add = (c) => { R.push(c); return c; };
  const ref = txt(env, "TILA_STAGING_SUPABASE_REF");

  // L01 entorno
  add(env.TILA_ENTORNO === "staging" ? ck("L01", "TILA_ENTORNO = staging", PASS) : ck("L01", "TILA_ENTORNO = staging", FAIL, presente(env, "TILA_ENTORNO") ? 'valor distinto de "staging"' : "falta la variable", { guarda: true }));

  // L02 ref
  let refOk = false;
  if (!presente(env, "TILA_STAGING_SUPABASE_REF")) add(ck("L02", "TILA_STAGING_SUPABASE_REF presente y con formato válido", FAIL, "falta la variable", { guarda: true }));
  else if (ref === REF_PRODUCCION || ref.includes(REF_PRODUCCION)) add(ck("L02", "TILA_STAGING_SUPABASE_REF presente y con formato válido", FAIL, "es el ref de PRODUCCIÓN", { guarda: true }));
  else if (!/^[a-z0-9]{16,32}$/.test(ref)) add(ck("L02", "TILA_STAGING_SUPABASE_REF presente y con formato válido", FAIL, "formato inválido: un solo ref, minúsculas y números (16–32), sin comas, espacios ni comentarios", { guarda: true }));
  else { refOk = true; add(ck("L02", "TILA_STAGING_SUPABASE_REF presente y con formato válido", PASS)); }
  const refUsable = refOk ? ref : "";
  const hostEsperado = refOk ? `${ref}.supabase.co` : null;

  // L03..L05 URLs
  const urlStaging = txt(env, "STAGING_SUPABASE_URL");
  const urlCheck = (id, nombre, comparar) => {
    const titulo = `${nombre} = https://<ref>.supabase.co`;
    if (!presente(env, nombre)) return add(ck(id, titulo, FAIL, "falta la variable", { guarda: id === "L03" }));
    const v = evaluarUrlSupabase(txt(env, nombre), refUsable);
    if (!v.ok) return add(ck(id, titulo, FAIL, v.motivo, { guarda: id === "L03" || !!v.prod }));
    if (comparar && presente(env, "STAGING_SUPABASE_URL") && sinBarra(txt(env, nombre)) !== sinBarra(urlStaging)) return add(ck(id, titulo, FAIL, "no coincide con STAGING_SUPABASE_URL"));
    return add(ck(id, titulo, PASS, hostEsperado && id === "L03" ? hostEsperado : ""));
  };
  urlCheck("L03", "STAGING_SUPABASE_URL", false);
  urlCheck("L04", "NEXT_PUBLIC_SUPABASE_URL", true);
  urlCheck("L05", "SUPABASE_URL", true);

  // L06/L07 claves presentes, con forma y rol correctos
  const claveCheck = (id, nombre, tipo) => {
    const titulo = `${nombre} presente, con forma y rol de ${tipo === "anon" ? "anon/publishable" : "service_role/secret"}`;
    if (!presente(env, nombre)) return add(ck(id, titulo, FAIL, "falta la variable"));
    const e = evaluarClave(txt(env, nombre), tipo);
    return add(ck(id, titulo, e.estado, e.estado === PASS ? "[CONFIGURADA]" : e.motivo, e.estado === FAIL && valorDeProduccion(txt(env, nombre)) ? { guarda: true } : {}));
  };
  claveCheck("L06", "STAGING_ANON_KEY", "anon");
  claveCheck("L07", "STAGING_SERVICE_ROLE_KEY", "service");

  // L08/L09 coherencia de las variables que lee la app
  const coherente = (id, app, staging) => {
    const titulo = `${app} coherente con ${staging}`;
    if (!presente(env, app)) return add(ck(id, titulo, FAIL, "falta la variable"));
    if (!presente(env, staging)) return add(ck(id, titulo, FAIL, `falta ${staging} (no se puede comparar)`));
    return add(txt(env, app) === txt(env, staging) ? ck(id, titulo, PASS) : ck(id, titulo, FAIL, "los valores DIFIEREN (no se muestran)"));
  };
  coherente("L08", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "STAGING_ANON_KEY");
  coherente("L09", "SUPABASE_SERVICE_ROLE_KEY", "STAGING_SERVICE_ROLE_KEY");

  // L10 claves no cruzadas (anon ≠ service en cualquiera de las variables)
  {
    const anons = ["STAGING_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter((n) => presente(env, n)), servs = ["STAGING_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((n) => presente(env, n));
    const problemas = [];
    for (const a of anons) for (const s of servs) if (txt(env, a) === txt(env, s)) problemas.push(`${a} y ${s} tienen el MISMO valor`);
    for (const a of anons) { const i = inspeccionarClave(txt(env, a)); if (i.formato === "secret" || (i.formato === "jwt" && i.rol === "service_role")) problemas.push(`${a} contiene una clave de service_role`); }
    for (const s of servs) { const i = inspeccionarClave(txt(env, s)); if (i.formato === "publishable" || (i.formato === "jwt" && i.rol === "anon")) problemas.push(`${s} contiene una clave anon/publishable`); }
    add(problemas.length ? ck("L10", "anon y service_role no están cruzadas", FAIL, [...new Set(problemas)].join("; ")) : ck("L10", "anon y service_role no están cruzadas", PASS));
  }

  // L11 claim `ref` de las claves JWT (las sb_* no lo llevan: se prueban en --remoto)
  {
    const nombres = ["STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((n) => presente(env, n));
    const jwts = nombres.map((n) => [n, inspeccionarClave(txt(env, n))]).filter(([, i]) => i.formato === "jwt");
    if (!jwts.length) add(ck("L11", "claim ref de las claves JWT = ref de staging", NA, "las claves no son JWT (sb_*): no llevan ref; la coherencia clave↔proyecto se prueba en --remoto"));
    else {
      const prod = jwts.filter(([, i]) => i.ref === REF_PRODUCCION).map(([n]) => n), sinRef = jwts.filter(([, i]) => !i.ref).map(([n]) => n), otro = jwts.filter(([, i]) => i.ref && i.ref !== REF_PRODUCCION && refOk && i.ref !== ref).map(([n]) => n);
      if (prod.length) add(ck("L11", "claim ref de las claves JWT = ref de staging", FAIL, `${prod.join(", ")}: el JWT pertenece al proyecto de PRODUCCIÓN`, { guarda: true }));
      else if (otro.length) add(ck("L11", "claim ref de las claves JWT = ref de staging", FAIL, `${otro.join(", ")}: el ref del JWT no coincide con TILA_STAGING_SUPABASE_REF`, { guarda: true }));
      else if (sinRef.length) add(ck("L11", "claim ref de las claves JWT = ref de staging", INCONCLUSO, `${sinRef.join(", ")}: el JWT no trae ref`));
      else add(ck("L11", "claim ref de las claves JWT = ref de staging", refOk ? PASS : INCONCLUSO, refOk ? "" : "sin ref de staging válido para comparar"));
    }
  }

  // L12 secreto de sesión
  {
    const t = "TILA_SESSION_SECRET presente y de longitud segura";
    const s = txt(env, "TILA_SESSION_SECRET");
    if (!presente(env, "TILA_SESSION_SECRET")) add(ck("L12", t, FAIL, "falta la variable"));
    else if (s.length < SECRETO_SESION_MIN) add(ck("L12", t, FAIL, `tiene menos de ${SECRETO_SESION_MIN} caracteres`));
    else if (/\s/.test(s) || s.includes("${")) add(ck("L12", t, FAIL, "contiene espacios o una referencia ${…} sin resolver"));
    else if (new Set(s).size < 8) add(ck("L12", t, FAIL, "tiene muy poca variedad de caracteres"));
    else if (["STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].some((n) => txt(env, n) === s)) add(ck("L12", t, FAIL, "reutiliza una clave de Supabase"));
    else add(ck("L12", t, PASS, "[CONFIGURADA]"));
  }

  // L13 URL pública de la app
  {
    const t = "NEXT_PUBLIC_BASE_URL presente y no es la app de producción";
    if (!presente(env, "NEXT_PUBLIC_BASE_URL")) add(ck("L13", t, FAIL, "falta la variable"));
    else if (!/^https?:\/\//i.test(txt(env, "NEXT_PUBLIC_BASE_URL"))) add(ck("L13", t, FAIL, "debe ser una URL http(s) completa"));
    else {
      try { asegurarAppNoProduccion(txt(env, "NEXT_PUBLIC_BASE_URL"), { etiqueta: "NEXT_PUBLIC_BASE_URL", env: { TILA_ENTORNO: "staging", TILA_STAGING_APP_HOSTS: env.TILA_STAGING_APP_HOSTS } }); add(ck("L13", t, PASS)); }
      catch (e) { add(ck("L13", t, FAIL, /PRODUCCI/.test(e.message) ? "apunta a PRODUCCIÓN" : "host no permitido (loopback o TILA_STAGING_APP_HOSTS)", { guarda: /PRODUCCI/.test(e.message) })); }
    }
  }

  // L14 TLS
  add(env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ? ck("L14", "NODE_TLS_REJECT_UNAUTHORIZED no está deshabilitado", FAIL, "está en 0: la verificación TLS está desactivada") : ck("L14", "NODE_TLS_REJECT_UNAUTHORIZED no está deshabilitado", PASS));

  // L15 CONTAMINACIÓN: ningún valor del entorno EFECTIVO contiene ref/host/clave de producción (solo se informan NOMBRES)
  {
    const sucias = Object.entries(env).filter(([, v]) => typeof v === "string" && valorDeProduccion(v)).map(([n]) => n).sort();
    add(sucias.length ? ck("L15", "ninguna variable del entorno efectivo contiene valores de producción", FAIL, `contaminadas (solo nombres): ${sucias.join(", ")}. Si vienen de un .env.local o del shell, quitalas: Node --env-file NO pisa variables ya definidas.`, { guarda: true })
      : ck("L15", "ninguna variable del entorno efectivo contiene valores de producción", PASS, `${Object.keys(env).length} variables revisadas`));
  }

  // L16 credenciales de Mercado Pago (opcionales)
  {
    const t = "MERCADOPAGO_ACCESS_TOKEN no es una credencial de producción";
    if (!presente(env, "MERCADOPAGO_ACCESS_TOKEN")) add(ck("L16", t, PASS, "no configurada (aviso: los pagos de prueba no funcionarán)", { aviso: true }));
    else add(/^APP_USR-/.test(txt(env, "MERCADOPAGO_ACCESS_TOKEN")) ? ck("L16", t, FAIL, "es una credencial de PRODUCCIÓN (APP_USR-…); en staging solo TEST-…", { guarda: true }) : ck("L16", t, PASS, "[CONFIGURADA]"));
  }

  // G01/G02 Git (solo lectura)
  {
    const ig = gitLectura(deps, ["check-ignore", "-v", ARCHIVO_STAGING]);
    if (ig.error || ig.status === null || ig.status > 1) add(ck("G01", `${ARCHIVO_STAGING} está ignorado por Git`, INCONCLUSO, "no se pudo consultar git (¿no está instalado o esto no es un repositorio?)"));
    else if (ig.status === 1) add(ck("G01", `${ARCHIVO_STAGING} está ignorado por Git`, FAIL, "NO está ignorado: podría commitearse con claves"));
    else add(ck("G01", `${ARCHIVO_STAGING} está ignorado por Git`, PASS, `regla: ${String(ig.stdout).trim().split("\t")[0].slice(0, 80)}`));
    const tr = gitLectura(deps, ["ls-files", "--", ARCHIVO_STAGING]);
    if (tr.error || tr.status !== 0) add(ck("G02", `${ARCHIVO_STAGING} no está trackeado`, INCONCLUSO, "no se pudo consultar git"));
    else add(String(tr.stdout).trim() !== "" ? ck("G02", `${ARCHIVO_STAGING} no está trackeado`, FAIL, "ESTÁ trackeado (en el índice de Git): sacarlo con git rm --cached ANTES de cargar claves", { guarda: true }) : ck("G02", `${ARCHIVO_STAGING} no está trackeado`, PASS));
  }

  // F01/F02 archivos .env* (solo nombres y búsqueda de producción)
  {
    const raiz = deps.raiz ?? RAIZ_PROYECTO;
    const ruta = join(raiz, ARCHIVO_STAGING);
    let existe = false; try { existe = !!deps.fs.existsSync(ruta); } catch { existe = false; }
    if (!existe) add(ck("F01", `${ARCHIVO_STAGING} sin valores de producción`, PASS, "el archivo todavía no existe (estado esperado antes de crearlo; las variables vienen del entorno)", { aviso: true }));
    else {
      try {
        const a = analizarArchivoEnv(String(deps.fs.readFileSync(ruta, "utf8")));
        add(a.conProduccion.length ? ck("F01", `${ARCHIVO_STAGING} sin valores de producción`, FAIL, `variables con valores de PRODUCCIÓN (solo nombres): ${a.conProduccion.join(", ")}`, { guarda: true }) : ck("F01", `${ARCHIVO_STAGING} sin valores de producción`, PASS, `${a.nombres.length} variables (solo nombres revisados)`));
      } catch { add(ck("F01", `${ARCHIVO_STAGING} sin valores de producción`, INCONCLUSO, "no se pudo leer el archivo")); }
    }
    const otros = []; const problemas = [];
    for (const dir of [raiz, join(raiz, "app")]) {
      let lista = []; try { lista = deps.fs.readdirSync(dir); } catch { continue; }
      for (const f of lista.map((x) => (typeof x === "string" ? x : x.name)).filter((n) => /^\.env(\..+)?$/.test(n) && n !== ARCHIVO_STAGING)) {
        const etiqueta = dir === raiz ? f : `app/${f}`;
        try { const a = analizarArchivoEnv(String(deps.fs.readFileSync(join(dir, f), "utf8"))); otros.push(etiqueta); if (a.conProduccion.length) problemas.push(`${etiqueta} (${a.conProduccion.join(", ")})`); } catch { otros.push(`${etiqueta} (ilegible)`); }
      }
    }
    if (!otros.length) add(ck("F02", "otros archivos .env* del proyecto", PASS, "no hay otros .env*"));
    else if (problemas.length) add(ck("F02", "otros archivos .env* del proyecto", PASS, `AVISO: contienen valores de producción (solo nombres): ${problemas.join("; ")}. No afectan a esta verificación (solo mira el entorno efectivo), pero \`next start\` SIN levantar-staging.mjs los cargaría: usá siempre el launcher, que los neutraliza.`, { aviso: true }));
    else add(ck("F02", "otros archivos .env* del proyecto", PASS, `${otros.join(", ")}: sin valores de producción`));
  }
  return R;
}

// ═══════════════ NIVEL B — REMOTO (SOLO LECTURA; no se ejecuta en esta preparación) ═══════════════
/**
 * Cómo se prueba clave↔proyecto de forma NO destructiva y sin depender del esquema ni de RLS:
 *   GET https://<ref>.supabase.co/auth/v1/settings   con el header `apikey` (NO se manda Authorization: las sb_* no son JWT)
 *     · 200                                          → la clave es ACEPTADA por ESTE proyecto (una clave de otro proyecto no pasa el gateway)
 *     · 401 con mensaje "Invalid API key"            → RECHAZADA (otro proyecto, revocada o mal copiada) → FAIL
 *     · cualquier otra cosa (404, 403, 5xx, red, redirección, 401 con otro mensaje) → INCONCLUSO: no se asume nada
 *   GET https://<ref>.supabase.co/rest/v1/  con la service_role: el gateway entrega la especificación OpenAPI solo a un rol elevado → confirma privilegios
 *     (200 + JSON con "swagger"/"openapi" → PASS; otro resultado → INCONCLUSO, porque depende de la versión de Supabase)
 *   Si la respuesta trae el header `sb-project-ref`, debe ser el ref de staging (si no: FAIL de guarda, se llegó a OTRO proyecto).
 * Nunca INSERT/UPDATE/DELETE/RPC; nunca se sigue una redirección; el cuerpo solo se usa para clasificar y no se imprime.
 */
export function clasificarRespuestaClave({ status, cuerpo }) {
  if (status === 200) return { veredicto: "aceptada" };
  if (status === 401 && /invalid api key/i.test(String(cuerpo ?? ""))) return { veredicto: "rechazada" };
  if (status === 401) return { veredicto: "ambigua", motivo: "HTTP 401 con otro mensaje (¿falta el header? ¿endpoint restringido?)" };
  if (status >= 300 && status < 400) return { veredicto: "ambigua", motivo: `redirección HTTP ${status} (no se sigue)` };
  return { veredicto: "ambigua", motivo: `HTTP ${status}` };
}

async function llamar(deps, T, url, clave) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const p = deps.fetch(url, { method: "GET", headers: { apikey: clave, accept: "application/json" }, redirect: "manual", ...(ctrl ? { signal: ctrl.signal } : {}) });
  try {
    const r = await conTimeout(Promise.resolve(p), T.llamadaMs, "llamada");
    let cuerpo = ""; try { cuerpo = String(await conTimeout(Promise.resolve(r.text()), T.llamadaMs, "cuerpo")).slice(0, T.cuerpoMax); } catch { cuerpo = ""; }
    let refHeader = null; try { refHeader = r.headers?.get?.("sb-project-ref") ?? null; } catch { refHeader = null; }
    return { status: r.status, cuerpo, refHeader };
  } catch (e) { ctrl?.abort?.(); return { error: String(e?.message ?? e) }; }
}

export async function verificarRemoto(cfg, deps, T = TIMEOUTS) {
  const R = []; const add = (c) => { R.push(c); return c; };
  const origen = `https://${cfg.ref}.supabase.co`; // construido por la herramienta a partir del ref ya validado: nunca se usa una URL cruda del entorno
  const inicio = Date.now(); const refs = [];
  const fuera = () => Date.now() - inicio > T.totalMs;
  const clave = (id, titulo, valor) => async () => {
    if (fuera()) return add(ck(id, titulo, INCONCLUSO, "presupuesto de tiempo agotado"));
    const r = await llamar(deps, T, `${origen}/auth/v1/settings`, valor);
    if (r.error) return add(ck(id, titulo, INCONCLUSO, `sin respuesta utilizable (${r.error.slice(0, 80)})`));
    if (r.refHeader) refs.push(r.refHeader);
    const c = clasificarRespuestaClave(r);
    if (c.veredicto === "aceptada") return add(ck(id, titulo, PASS, `HTTP ${r.status}: el proyecto ${cfg.ref}.supabase.co aceptó la clave`));
    if (c.veredicto === "rechazada") return add(ck(id, titulo, FAIL, `HTTP ${r.status}: el proyecto RECHAZÓ la clave (otro proyecto, revocada o mal copiada)`));
    return add(ck(id, titulo, INCONCLUSO, `no se pudo demostrar: ${c.motivo}`));
  };
  await clave("R01", "STAGING_ANON_KEY aceptada por el proyecto de staging", cfg.anon)();
  await clave("R02", "STAGING_SERVICE_ROLE_KEY aceptada por el proyecto de staging", cfg.service)();
  {
    const t = "service_role con privilegios elevados (lectura del esquema OpenAPI)";
    if (fuera()) add(ck("R03", t, INCONCLUSO, "presupuesto de tiempo agotado"));
    else {
      const r = await llamar(deps, T, `${origen}/rest/v1/`, cfg.service);
      if (r.error) add(ck("R03", t, INCONCLUSO, `sin respuesta utilizable (${r.error.slice(0, 80)})`));
      else {
        if (r.refHeader) refs.push(r.refHeader);
        if (r.status === 200 && /"(swagger|openapi)"/.test(r.cuerpo)) add(ck("R03", t, PASS, "HTTP 200 con especificación OpenAPI"));
        else add(ck("R03", t, INCONCLUSO, `no se pudo demostrar: HTTP ${r.status} (el comportamiento depende de la versión de Supabase; no se asume)`));
      }
    }
  }
  {
    const t = "el proyecto que responde es el de staging (header sb-project-ref)";
    if (!refs.length) add(ck("R04", t, NA, "el gateway no informó sb-project-ref: sin evidencia adicional"));
    else if (refs.every((x) => x === cfg.ref)) add(ck("R04", t, PASS, "coincide con TILA_STAGING_SUPABASE_REF"));
    else add(ck("R04", t, FAIL, "el header sb-project-ref NO coincide con el ref de staging: se llegó a OTRO proyecto", { guarda: true }));
  }
  return R;
}

// ═══════════════ Resumen, plan y main ═══════════════
export function resumir(checks) {
  const c = { PASS: 0, FAIL: 0, INCONCLUSO: 0, "N/A": 0 };
  for (const k of checks) c[k.estado]++;
  const guarda = checks.some((k) => k.estado === FAIL && k.guarda);
  const codigo = guarda ? 2 : c.FAIL ? 1 : c.INCONCLUSO ? 3 : 0;
  return { conteo: c, codigo, veredicto: codigo === 0 ? "PASS" : codigo === 1 ? "FAIL" : codigo === 2 ? "FAIL (guarda anti-producción)" : "INCONCLUSO" };
}

export function textoPlan() {
  const L = [];
  L.push("TILA · verificar-entorno — PLAN (modo --plan: no lee el entorno, no lee archivos, no ejecuta git, no abre red, no imprime nada sensible)");
  L.push("");
  L.push("Modos: --plan · --local (cero red) · --remoto (primero TODO --local; recién si da PASS, llamadas de SOLO LECTURA). Sin modo = --local: nunca se conecta por defecto.");
  L.push("");
  L.push("NIVEL A — LOCAL (sin red):");
  L.push("  L01 TILA_ENTORNO = staging                                   L09 SUPABASE_SERVICE_ROLE_KEY coherente con STAGING_SERVICE_ROLE_KEY");
  L.push("  L02 TILA_STAGING_SUPABASE_REF presente, un solo ref válido     L10 anon y service_role no cruzadas (formato, rol y valores distintos)");
  L.push("  L03 STAGING_SUPABASE_URL = https://<ref>.supabase.co exacto     L11 claim ref de las claves JWT = ref de staging (las sb_* → N/A)");
  L.push("  L04 NEXT_PUBLIC_SUPABASE_URL = misma URL                       L12 TILA_SESSION_SECRET presente y ≥ 32 caracteres");
  L.push("  L05 SUPABASE_URL = misma URL                                   L13 NEXT_PUBLIC_BASE_URL presente y no es la app de producción");
  L.push("  L06 STAGING_ANON_KEY presente (forma y rol anon)                 L14 NODE_TLS_REJECT_UNAUTHORIZED no deshabilitado");
  L.push("  L07 STAGING_SERVICE_ROLE_KEY presente (forma y rol service)      L15 CONTAMINACIÓN: ningún valor del entorno efectivo contiene ref/host/clave de producción");
  L.push("  L08 NEXT_PUBLIC_SUPABASE_ANON_KEY coherente con STAGING_ANON_KEY  L16 MERCADOPAGO_ACCESS_TOKEN no es una credencial de producción (APP_USR-)");
  L.push("  G01 .env.staging ignorado por Git (git check-ignore -v)          G02 .env.staging no trackeado (git ls-files) — git como proceso hijo SOLO LECTURA, sin shell");
  L.push("  F01 .env.staging sin valores de producción (si aún no existe: estado esperado)   F02 otros .env* (raíz y app/): solo nombres y búsqueda de producción → AVISO");
  L.push("");
  L.push("NIVEL B — REMOTO (solo lectura; SOLO tras pasar el nivel A; nunca INSERT/UPDATE/DELETE/RPC):");
  L.push("  R01/R02  GET https://<ref>.supabase.co/auth/v1/settings con el header apikey (anon y service): 200 = aceptada por ESTE proyecto · 401 'Invalid API key' = FAIL · otro = INCONCLUSO");
  L.push("  R03      GET https://<ref>.supabase.co/rest/v1/ con la service_role: 200 + OpenAPI = privilegios elevados · otro = INCONCLUSO (depende de la versión)");
  L.push("  R04      header sb-project-ref (si viene) debe ser el ref de staging; si no coincide → FAIL de guarda");
  L.push("  Sin redirecciones, sin Authorization, sin cuerpo impreso. Antes de conectar: ref exacto, URL https://<ref>.supabase.co exacta, sin producción, sin puerto/ruta/credenciales.");
  L.push("");
  L.push("Contaminación de producción: se revisan TODOS los valores del entorno efectivo (incluidos JWT decodificados) y se informan solo NOMBRES; los .env* solo por nombres + búsqueda de ref/host.");
  L.push("Resultado por chequeo: PASS · FAIL · INCONCLUSO (N/A no cuenta). Códigos: 0 todo PASS · 1 FAIL · 2 argumentos o guarda anti-producción · 3 INCONCLUSO (precedencia 2 → 1 → 3 → 0).");
  L.push("Variables (solo nombres): " + CRITICAS.join(", ") + "; opcionales: TILA_STAGING_APP_HOSTS, MERCADOPAGO_ACCESS_TOKEN. Claves, URLs y ref NUNCA por argumentos.");
  return L.join("\n");
}

const ICONO = { PASS: "PASS      ", FAIL: "FAIL      ", INCONCLUSO: "INCONCLUSO", "N/A": "N/A       " };

export async function main(argv, deps) {
  const out = deps.out ?? console.log, err = deps.err ?? console.error;
  const a = parsearArgs(argv);
  if (a.errores.length) { for (const e of a.errores) err(`[uso] ${e}`); return 2; }
  if (a.ayuda || a.plan) { out(textoPlan()); return 0; } // ← nada más: ni entorno, ni archivos, ni git, ni red

  const env = deps.env ?? {};
  const secretos = SECRETAS.map((n) => env[n]).filter((x) => typeof x === "string" && x.length >= 8);
  const log = (...p) => out(redactar(p.join(" "), secretos));
  const T = { ...TIMEOUTS, ...(deps.timeouts ?? {}) };
  const remoto = a.remoto;
  log(`VERIFICAR-ENTORNO · nivel ${remoto ? "LOCAL + REMOTO (solo lectura)" : "LOCAL (cero red)"}${!a.local && !a.remoto ? " · (sin modo: por defecto --local; no se conecta)" : ""}`);

  const imprimir = (checks) => {
    for (const k of checks) log(`  ${ICONO[k.estado]} ${k.id}  ${k.titulo}${k.detalle ? `\n              ${k.detalle}` : ""}${k.estado === PASS && k.aviso ? "  (con aviso)" : ""}`);
  };
  const locales = verificarLocal(env, deps);
  log("NIVEL A — configuración local:");
  imprimir(locales);
  const resLocal = resumir(locales);
  let todos = locales;

  if (remoto) {
    if (resLocal.codigo !== 0) {
      log("");
      log(`NIVEL B — REMOTO NO EJECUTADO: el nivel local no dio PASS (${resLocal.veredicto}). No se abrió ninguna conexión.`);
    } else {
      const cfg = { ref: txt(env, "TILA_STAGING_SUPABASE_REF"), anon: txt(env, "STAGING_ANON_KEY"), service: txt(env, "STAGING_SERVICE_ROLE_KEY") };
      // guarda final ANTES de la primera llamada: la URL que se va a usar la construimos nosotros y debe pasar las guardas compartidas
      try { asegurarNoProduccion(`https://${cfg.ref}.supabase.co`, { etiqueta: "destino remoto", env: { TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: cfg.ref } }); }
      catch (e) { err(`[verificar-entorno] guarda anti-producción: ${redactar(e.message, secretos)}. No se abrió ninguna conexión.`); return 2; }
      if (typeof deps.fetch !== "function") { log("NIVEL B — sin capacidad de red inyectada: INCONCLUSO."); todos = [...locales, ck("R00", "capacidad de red disponible", INCONCLUSO, "no hay fetch")]; }
      else {
        log("");
        log(`NIVEL B — remoto, SOLO LECTURA contra ${cfg.ref}.supabase.co (claves [CONFIGURADA]):`);
        const rem = await verificarRemoto(cfg, deps, T);
        imprimir(rem);
        todos = [...locales, ...rem];
      }
    }
  }
  const res = resumir(todos);
  log("");
  log(`RESUMEN: PASS ${res.conteo.PASS} · FAIL ${res.conteo.FAIL} · INCONCLUSO ${res.conteo.INCONCLUSO} · N/A ${res.conteo["N/A"]}`);
  for (const k of todos.filter((x) => x.estado === FAIL)) log(`  ✖ ${k.id} ${k.titulo}`);
  for (const k of todos.filter((x) => x.estado === INCONCLUSO)) log(`  ? ${k.id} ${k.titulo}`);
  if (!remoto && res.codigo === 0) log("  Nivel local en PASS. El nivel remoto (clave↔proyecto) no se ejecutó: usá --remoto cuando lo apruebes.");
  log(`RESULTADO: ${res.veredicto} → exit ${res.codigo}`);
  return res.codigo;
}

export function depsReales() {
  // Todo perezoso: --plan no lee process.env ni el disco ni ejecuta git (main() vuelve antes de usar estas funciones).
  const envGit = () => {
    const e = {};
    for (const k of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "HOME", "USERPROFILE", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "ProgramData", "LANG"]) if (typeof process.env[k] === "string") e[k] = process.env[k];
    return Object.assign(e, { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" });
  };
  return {
    get env() { return process.env; }, out: (l) => console.log(l), err: (l) => console.error(l), fs: { existsSync, readFileSync, readdirSync }, raiz: RAIZ_PROYECTO,
    // git como proceso hijo SOLO LECTURA (check-ignore / ls-files), sin shell y con argumentos fijos: reimplementar las reglas de .gitignore (globales, anidadas, info/exclude) sería más frágil.
    git: (args) => { const r = spawnSync("git", args, { cwd: RAIZ_PROYECTO, env: envGit(), encoding: "utf8", timeout: TIMEOUTS.gitMs, windowsHide: true, shell: false }); return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ? String(r.error.message) : null }; },
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUTS.llamadaMs) }),
  };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("verificar-entorno.mjs")) {
  main(process.argv.slice(2), depsReales()).then((c) => { process.exitCode = c; setTimeout(() => process.exit(c), TIMEOUTS.salidaForzadaMs).unref(); },
    (e) => { console.error("[verificar-entorno] error inesperado:", redactar(e?.message ?? e)); process.exitCode = 1; });
}
