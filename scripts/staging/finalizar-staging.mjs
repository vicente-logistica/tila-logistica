// ORQUESTADOR FINAL DE STAGING: encadena, con TODAS las guardas anti-producción, todo lo que ya está preparado y validado localmente.
// ESTADO: PREPARADO Y VALIDADO SOLO EN LOCAL (tests con fakes). NUNCA se ejecutó contra Supabase ni contra ninguna app.
//
// Lo único manual: (1) cargar las claves de TILA-STAGING en `.env.staging`; (2) ejecutar a mano `docs/staging/sql/09-secuencias-seed.sql` cuando el orquestador lo pida.
//   node scripts/staging/finalizar-staging.mjs --plan                                                          (sin env, sin red: fases y plantilla de .env.staging)
//   node --env-file=.env.staging scripts/staging/finalizar-staging.mjs [--hasta=N]                            (fases 0→5; se DETIENE en la pausa del SQL 09; exit 4)
//   node --env-file=.env.staging scripts/staging/finalizar-staging.mjs --continuar [--resultado-09=<archivo>]  (revalida 0–2, comprueba secuencias y sigue 6→12)
//
// REGLAS: producción PROHIBIDA; ante CUALQUIER duda / diferencia / guarda fallida / host distinto de staging → ABORTA. Nunca corrige un fallo automáticamente.
//   · Ninguna clave por argv; ningún hijo hereda process.env (entorno armado desde cero con solo lo que necesita); toda salida pasa por redacción.
//   · Único flag de node heredado: --use-system-ca (argumento explícito, no NODE_OPTIONS). Un hijo que falla muestra la ruta de su log y sus últimas líneas redactadas.
//   · NO ejecuta el SQL 09, NO usa pg, NO usa RPC. Las secuencias se comprueban con la evidencia que pegás (resultado del SQL 09) cruzada con el MAX(id) leído por REST.
//   · Solo escribe: un estado local NO SENSIBLE (carpeta temporal del sistema), logs redactados (misma carpeta) y docs/staging/RESULTADO-FINAL-STAGING.md.
//
// CÓDIGOS DE SALIDA: 0 = terminó (o llegó a --hasta) sin FAIL · 1 = FAIL · 2 = argumentos/guarda anti-producción · 3 = INCONCLUSO bloqueante · 4 = PAUSA manual (SQL 09).
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { HOSTS_PRODUCCION, REF_PRODUCCION, asegurarNoProduccion } from "./guardas.mjs";
import * as V from "./verificar-entorno.mjs";
import * as LV from "./levantar-staging.mjs";
import * as LP from "./limpiar-pruebas.mjs";
import * as RT from "./smoke/realtime.mjs";
import * as SEC from "./seed/secuencias.mjs";
import * as D from "./seed/datos.mjs";
import { redactar } from "./smoke/v3-anon.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ_PROYECTO = resolve(AQUI, "..", "..");
export const RUTA_INFORME = "docs/staging/RESULTADO-FINAL-STAGING.md";
export const RUTA_SQL_09 = "docs/staging/sql/09-secuencias-seed.sql";
export const DOMINIO = "@tila-staging.invalid";

// ── Tiempos centralizados ───────────────────────────────────────────────────────────────────────────────────────────────
export const TIMEOUTS = Object.freeze({
  hijoCortoMs: 120000,      // aplicar.mjs en dry-run
  seedMs: 600000,           // aplicar.mjs --aplicar
  v3Ms: 900000,             // v3-anon.mjs
  flujosMs: 900000,         // flujos.mjs (un modo)
  gpsMs: 300000,            // simular-gps.mjs (un modo)
  levantarMs: 1500000,      // build + readiness de las 3 instancias
  readinessMs: 5000,        // GET de comprobación propia a cada instancia
  apagadoMs: 60000,         // espera del apagado de las instancias
  pegadoMs: 300000,         // espera máxima al pegar el resultado del SQL 09
  salidaForzadaMs: 2000,
});

// Lo que el seed debe dejar (validado contra datos.mjs en los tests)
export const ESPERADO = Object.freeze({
  usuarios: 6, vehiculos: 3, documentacion_chofer: 26, cargas: 7, paradas_viaje: 5, mensajes_viaje: 8, billetera_chofer: 2, viaje_evidencias: 3, consentimientos_legales: 15, storage: 25,
});
export const SECUENCIAS = Object.freeze(["paradas_viaje", "viaje_evidencias", "consentimientos_legales", "cargas", "vehiculos"]);
export const IDS_V3 = Object.freeze([...Array.from({ length: 15 }, (_, i) => `A${i + 1}`), ...Array.from({ length: 16 }, (_, i) => `B${i + 1}`)]);
export const MODOS = LV.MODOS; // legacy 127.0.0.1:3131 · dual 127.0.0.2:3132 · strict 127.0.0.3:3133

export const FASES = Object.freeze([
  [0, "Preflight (guardas anti-producción)"], [1, "Verificación local (verificar-entorno --local)"], [2, "Verificación remota SOLO LECTURA (verificar-entorno --remoto)"],
  [3, "Seed en DRY-RUN"], [4, "Aplicar seed + verificar"], [5, "PAUSA MANUAL: SQL 09 (secuencias)"], [6, "Comprobar secuencias"], [7, "V3 (A1–A15, B1–B16)"],
  [8, "Levantar la app de staging (3 instancias)"], [9, "Realtime"], [10, "Smoke tests por modo (legacy, dual, strict)"], [11, "Limpieza de pruebas"], [12, "Informe final"],
]);
const RES = Object.freeze({ PASS: "PASS", FAIL: "FAIL", INCONCLUSO: "INCONCLUSO", GUARDA: "GUARDA", PAUSA: "PAUSA" });
const CODIGO = Object.freeze({ PASS: 0, FAIL: 1, GUARDA: 2, INCONCLUSO: 3, PAUSA: 4 });
const SISTEMA = Object.freeze(["PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "ALLUSERSPROFILE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "USERNAME", "LANG", "TZ", "TERM"]);
const SECRETAS = Object.freeze(["STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TILA_SESSION_SECRET", "MERCADOPAGO_ACCESS_TOKEN",
  "MERCADOPAGO_WEBHOOK_SECRET", "GOOGLE_SERVER_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"]);
const contieneProd = (t) => typeof t === "string" && (t.toLowerCase().includes(REF_PRODUCCION) || HOSTS_PRODUCCION.some((h) => t.toLowerCase().includes(h)));

// ── Argumentos: NUNCA claves ────────────────────────────────────────────────────────────────────────────────────────────
export function parsearArgs(argv) {
  const r = { plan: false, ayuda: false, continuar: false, hasta: 12, resultado09: null, errores: [] };
  for (const a of argv) {
    if (/^--(anon|key|clave|service|service-role|secret|token|password|apikey|url|supabase|supabase-url|ref|env|host)\b/i.test(a) || /eyJ|sb_(secret|publishable)_/.test(a)) r.errores.push("Las claves, URLs y ref NO se aceptan por argumentos: solo por variables de entorno (.env.staging).");
    else if (a === "--plan" || a === "--listar") r.plan = true;
    else if (a === "--ayuda" || a === "--help" || a === "-h") r.ayuda = true;
    else if (a === "--continuar") r.continuar = true;
    else if (a.startsWith("--hasta=")) { const n = Number(a.slice(8)); if (!Number.isInteger(n) || n < 0 || n > 12) r.errores.push("--hasta debe ser un entero entre 0 y 12."); else r.hasta = n; }
    else if (a.startsWith("--resultado-09=")) { const p = a.slice(15); if (!p || /[\r\n]/.test(p)) r.errores.push("--resultado-09 requiere la ruta de un archivo."); else r.resultado09 = p; }
    else r.errores.push("Argumento no reconocido (el valor no se muestra). Usá --ayuda.");
  }
  if (r.resultado09 && !r.continuar) r.errores.push("--resultado-09 solo se usa con --continuar.");
  return r;
}

export function textoPlan() {
  const L = [];
  L.push("TILA · finalizar-staging — PLAN (modo --plan: no lee el entorno, no toca disco ni red, no ejecuta nada)");
  L.push("");
  L.push("Lo ÚNICO manual: (1) cargar las claves de TILA-STAGING en .env.staging · (2) ejecutar docs/staging/sql/09-secuencias-seed.sql en el SQL Editor de STAGING cuando se pida.");
  L.push("");
  L.push("Uso:");
  L.push("  node --env-file=.env.staging scripts/staging/finalizar-staging.mjs                     fases 0→5 (se detiene en la pausa del SQL 09; exit 4)");
  L.push("  node --env-file=.env.staging scripts/staging/finalizar-staging.mjs --continuar         revalida 0–2, comprueba secuencias y sigue 6→12 (pega el resultado del SQL 09 cuando lo pida,");
  L.push("                                                                                        o pasá --resultado-09=<archivo de texto con ese resultado>)");
  L.push("  opcional: --hasta=N (detiene tras la fase N; útil para ir de a poco: --hasta=3 solo verifica y hace el dry-run del seed)");
  L.push("");
  L.push("Fases (cada una solo corre si las anteriores dieron PASS; ante FAIL/INCONCLUSO/guarda se DETIENE, sin corregir nada):");
  for (const [n, t] of FASES) L.push(`  ${String(n).padStart(2)}  ${t}`);
  L.push("");
  L.push("App de staging: SOLO 127.0.0.1:3131 (legacy) · 127.0.0.2:3132 (dual) · 127.0.0.3:3133 (strict); nunca 0.0.0.0. Sin pasarela de pagos real.");
  L.push("Smoke por modo, separados: entre modos se limpian los restos de flujos y se re-aplica el seed (upsert) hasta partir de un estado conocido (seed intacto y 0 restos).");
  L.push("Escribe SOLO: estado local NO sensible y logs redactados en " + join(os.tmpdir(), "tila-finalizar-staging") + " y " + RUTA_INFORME + " (veredicto solo si TODO dio PASS).");
  L.push("NO ejecuta el SQL 09, NO usa pg, NO usa RPC, NO acepta claves por argv, NO imprime claves, NO hace commit/push/deploy.");
  L.push("");
  L.push("Plantilla de .env.staging (SOLO nombres; valores LITERALES: node --env-file NO expande ${…}, sin comillas ni comentarios en la línea; las carga SOLO vos, nunca por el chat):");
  for (const n of ["TILA_ENTORNO=staging", "TILA_STAGING_SUPABASE_REF=<ref de staging>", "STAGING_SUPABASE_URL=https://<ref>.supabase.co", "NEXT_PUBLIC_SUPABASE_URL=<la misma URL>", "SUPABASE_URL=<la misma URL>",
    "STAGING_ANON_KEY=<publishable/anon de staging>", "NEXT_PUBLIC_SUPABASE_ANON_KEY=<la misma>", "STAGING_SERVICE_ROLE_KEY=<secret/service_role de staging>", "SUPABASE_SERVICE_ROLE_KEY=<la misma>",
    "TILA_SESSION_SECRET=<≥ 32 caracteres propios de staging>", "NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3131", "(opcionales) MERCADOPAGO_ACCESS_TOKEN=TEST-…  ·  GOOGLE_*"]) L.push("  " + n);
  L.push("Códigos de salida: 0 terminó sin FAIL · 1 FAIL · 2 argumentos o guarda anti-producción · 3 INCONCLUSO bloqueante · 4 PAUSA manual (SQL 09).");
  return L.join("\n");
}

// ═══════════════ Parsers de las salidas de las herramientas ═══════════════
const TABLAS_SEED = ["usuarios", "vehiculos", "documentacion_chofer", "cargas", "paradas_viaje", "mensajes_viaje", "billetera_chofer", "viaje_evidencias", "consentimientos_legales"];
export function evaluarSeedDryRun(salida, { host }) {
  const errores = [];
  const d = /destino: (\S+)(?: \(local\))? \| clave: [^|]*\| modo: (DRY-RUN|APLICAR)/.exec(salida);
  if (!d) errores.push("no se pudo leer la línea de destino/modo");
  else { if (d[1] !== host) errores.push("el destino del seed NO es el host de staging esperado"); if (d[2] !== "DRY-RUN") errores.push("no es un DRY-RUN"); }
  for (const t of TABLAS_SEED) { const m = new RegExp(`^\\s+${t}\\s+(\\d+) filas`, "m").exec(salida); if (!m) errores.push(`falta la cantidad de ${t}`); else if (Number(m[1]) !== ESPERADO[t]) errores.push(`${t}: ${m[1]} filas, se esperaban ${ESPERADO[t]}`); }
  const st = /storage: (\d+) imágenes ficticias/.exec(salida);
  if (!st) errores.push("falta la línea de Storage"); else if (Number(st[1]) + 1 !== ESPERADO.storage) errores.push(`Storage: ${st[1]} imágenes (+1 de evidencia), se esperaban ${ESPERADO.storage} objetos`);
  const emails = [...new Set(salida.match(/[\w.+-]+@[\w.-]+\.[a-z]+/gi) ?? [])];
  const esperados = Object.keys(D.ID).map((k) => D.EMAIL(k));
  for (const e of emails) if (!e.endsWith(DOMINIO)) errores.push("hay un email fuera del dominio ficticio @tila-staging.invalid");
  for (const e of esperados) if (!emails.includes(e)) errores.push(`falta el usuario ficticio ${e.split("@")[0]}`);
  if (contieneProd(salida)) errores.push("la salida menciona una referencia a PRODUCCIÓN");
  if (!/secuencias \(el seed inserta ids explícitos/.test(salida)) errores.push("falta el aviso de secuencias");
  for (const t of SECUENCIAS) if (!new RegExp(`${t}\\s+${t}_id_seq`).test(salida)) errores.push(`el aviso de secuencias no incluye ${t}`);
  if (!/DRY-RUN: no se escribió nada/.test(salida)) errores.push("no confirma que no escribió nada");
  return { ok: errores.length === 0, errores: [...new Set(errores)] };
}

export function evaluarSeedAplicado(salida) {
  const errores = [];
  if (!/SEED APLICADO/.test(salida)) errores.push("no confirma «SEED APLICADO»");
  if (!/PASO MANUAL OBLIGATORIO/.test(salida)) errores.push("no muestra el paso manual de secuencias");
  if (contieneProd(salida)) errores.push("la salida menciona una referencia a PRODUCCIÓN");
  return { ok: errores.length === 0, errores };
}

export function parsearV3(salida, codigo) {
  const filas = [...salida.matchAll(/^(PASS|FAIL|SKIP)\s+([AB]\d{1,2})\s+(.*)$/gm)].map((m) => ({ id: m[2], estado: m[1], titulo: m[3].trim() }));
  const skipsObl = new Set([...salida.matchAll(/^\s+⚠ SKIP \(obligatoria\) ([AB]\d+):/gm)].map((m) => m[1]));
  const skipsNo = [...salida.matchAll(/^\s+· SKIP \(no obligatoria\) ([AB]\d+):\s*(.*)$/gm)].map((m) => ({ id: m[1], motivo: m[2].trim() }));
  const noObl = new Set(skipsNo.map((s) => s.id));
  const presentes = new Set(filas.map((f) => f.id));
  const faltan = IDS_V3.filter((i) => !presentes.has(i));
  const fails = filas.filter((f) => f.estado === "FAIL").map((f) => f.id);
  const skipsBloq = filas.filter((f) => f.estado === "SKIP" && !noObl.has(f.id)).map((f) => f.id);
  let estado = RES.PASS; const motivos = [];
  if (fails.length) { estado = RES.FAIL; motivos.push(`FAIL: ${fails.join(", ")}`); }
  else if (faltan.length) { estado = RES.INCONCLUSO; motivos.push(`no aparecen: ${faltan.join(", ")}`); }
  else if (skipsBloq.length || skipsObl.size) { estado = RES.INCONCLUSO; motivos.push(`SKIP obligatorio: ${[...new Set([...skipsBloq, ...skipsObl])].join(", ")}`); }
  else if (codigo !== 0) { estado = RES.INCONCLUSO; motivos.push(`código de salida inesperado (${codigo}) sin FAIL ni SKIP obligatorio`); }
  return { estado, filas, fails, faltan, skipsNoBloqueantes: skipsNo, motivos, pass: filas.filter((f) => f.estado === "PASS").length };
}

export function parsearRealtime(salida, codigo) {
  const acciones = [...salida.matchAll(/^  (R[1-6]) (.+?)\s+anon: (.+?)\s+control: (.+?)\s+→ (.+)$/gm)].map((m) => ({ id: m[1], titulo: m[2].trim(), anon: m[3].trim(), control: m[4].trim(), clase: m[5].trim() }));
  const controlValido = /control positivo: VÁLIDO/.test(salida); const controlInvalido = /control positivo: NO VÁLIDO/.test(salida);
  const run = /RESUMEN REALTIME \(run ([0-9a-f]+)\)/.exec(salida)?.[1] ?? null;
  let estado = RES.PASS; const motivos = [];
  if (codigo === 2) { estado = RES.GUARDA; motivos.push("guarda/configuración inválida"); }
  else if (codigo === 1) { estado = RES.FAIL; motivos.push("fallo real (restos de limpieza o error interno)"); }
  else if (codigo === 3) { estado = RES.INCONCLUSO; motivos.push("INCONCLUSO: el control positivo o una suscripción falló, o una acción no se aplicó"); }
  else if (codigo !== 0) { estado = RES.INCONCLUSO; motivos.push(`código inesperado ${codigo}`); }
  else if (acciones.length !== 6) { estado = RES.INCONCLUSO; motivos.push(`se esperaban 6 acciones y se leyeron ${acciones.length}`); }
  else if (controlInvalido || !controlValido) { estado = RES.INCONCLUSO; motivos.push("el control positivo no figura como VÁLIDO"); }
  return { estado, acciones, run, controlValido, motivos };
}

export function parsearFlujos(salida, codigo, modo) {
  const filas = [...salida.matchAll(/^(PASS|FAIL) \[([\w-]+)\] (\w+) · (.*?): /gm)].map((m) => ({ estado: m[1], modo: m[2], flujo: m[3], paso: m[4] }));
  const tot = /TOTAL (\d+) · PASS (\d+) · FAIL (\d+)/.exec(salida);
  const mezcla = filas.filter((f) => f.modo !== modo);
  const motivos = []; let estado = RES.PASS;
  if (!filas.length || !tot) { estado = RES.INCONCLUSO; motivos.push("no se pudo leer el resultado de flujos.mjs"); }
  else if (mezcla.length) { estado = RES.FAIL; motivos.push("aparecieron resultados de otro modo (mezcla)"); }
  else if (Number(tot[3]) > 0 || filas.some((f) => f.estado === "FAIL")) { estado = RES.FAIL; motivos.push(`${tot[3]} verificaciones FAIL`); }
  else if (codigo !== 0) { estado = RES.FAIL; motivos.push(`código de salida ${codigo}`); }
  const cobertura = {};
  for (const [clave, re] of [["publicación", /publicar/i], ["ofertas", /disponibles|oferta/i], ["aceptación", /aceptar/i], ["viaje activo", /viaje activo/i], ["GPS", /GPS/i], ["estados", /estado/i], ["chat", /chat/i],
    ["evidencias", /evidencia/i], ["finalización", /Viaje finalizado|finaliz/i], ["billetera", /billetera/i]]) cobertura[clave] = { pass: filas.filter((f) => re.test(f.paso) && f.estado === "PASS").length, fail: filas.filter((f) => re.test(f.paso) && f.estado === "FAIL").length };
  const porFlujo = {}; for (const f of filas) { porFlujo[f.flujo] ??= { pass: 0, fail: 0 }; porFlujo[f.flujo][f.estado === "PASS" ? "pass" : "fail"]++; }
  return { estado, total: tot ? Number(tot[1]) : 0, pass: tot ? Number(tot[2]) : 0, fail: tot ? Number(tot[3]) : 0, porFlujo, cobertura, motivos };
}

export function parsearGps(salida, codigo) {
  const m = /GPS simulado: (\d+) OK, (\d+) con error/.exec(salida);
  if (!m) return { estado: RES.INCONCLUSO, ok: 0, error: 0, motivos: ["no se pudo leer el resultado de simular-gps.mjs"] };
  const ok = Number(m[1]), error = Number(m[2]);
  return { estado: error === 0 && ok > 0 && codigo === 0 ? RES.PASS : RES.FAIL, ok, error, motivos: error ? [`${error} puntos con error`] : [] };
}

/** Salida de `limpiar-pruebas --contar`: estado del seed y residuos por clase. */
export function parsearContar(salida) {
  const seed = /^\s+seed: (intacto|alterado|ausente|no determinable) \((\d+)\/(\d+)/m.exec(salida);
  const clases = {}; let residuos = 0;
  for (const m of salida.matchAll(/^\s+(V3|Realtime|Flujos)\s*: (.*)$/gm)) {
    let suma = 0;
    for (const par of m[2].replace(/\(no incluidos[^)]*\)/, "").split(" · ")) { const n = /(\d+)\s*$/.exec(par.trim()); if (n && !/^corridas\b/.test(par.trim())) suma += Number(n[1]); }
    clases[m[1]] = suma; residuos += suma;
  }
  const dudas = [...salida.matchAll(/^\s+(NO reconocido\/omitido[^\n]*|lectura fallida:[^\n]*)$/gm)].map((m) => m[1]);
  return { seed: seed?.[1] ?? null, presentes: seed ? Number(seed[2]) : 0, esperadas: seed ? Number(seed[3]) : 0, clases, residuos, dudas, leido: !!seed && Object.keys(clases).length === 3 };
}

/** Pegado del resultado del SQL 09 (tabla de la verificación final): tolera tabs, barras verticales, comas y espacios. */
export function parsearResultado09(texto) {
  const filas = [];
  for (const linea of String(texto ?? "").split(/\r?\n/)) {
    const toks = linea.split(/[\s|,;\t]+/).map((t) => t.replace(/^["']|["']$/g, "")).filter((t) => t !== "");
    const i = toks.findIndex((t) => /^[a-z_]+_id_seq$/.test(t));
    if (i < 0) continue;
    const resto = toks.slice(i + 1); const estado = resto.find((t) => /^(PASS|FAIL)$/i.test(t))?.toUpperCase();
    const nums = resto.filter((t) => /^(\d+|null|NULL)$/.test(t)).map((t) => (/^\d+$/.test(t) ? Number(t) : null));
    if (!estado || nums.length < 2) continue;
    filas.push({ secuencia: toks[i], ultimo: nums[0], maxId: nums[1], estado });
  }
  return filas;
}

export function evaluarSecuencias(filas, maximos) {
  const errores = [];
  for (const t of SECUENCIAS) {
    const f = filas.find((x) => x.secuencia === `${t}_id_seq`);
    if (!f) { errores.push(`falta la fila de ${t}_id_seq en el resultado pegado`); continue; }
    if (f.estado !== "PASS") { errores.push(`${t}_id_seq figura como ${f.estado}`); continue; }
    const real = maximos[t];
    if (!real || real.error) { errores.push(`no se pudo leer MAX(id) real de ${t} por REST`); continue; }
    const max = real.max ?? 0;
    if (f.ultimo === null ? max !== 0 : f.ultimo < max) errores.push(`${t}_id_seq: último valor ${f.ultimo} por debajo del MAX(id) real (${max}); ¿pegaste un resultado anterior?`);
    if (f.maxId !== null && f.maxId > max) errores.push(`${t}: el resultado pegado dice MAX(id)=${f.maxId} pero REST lee ${max}: no corresponde a este estado`);
  }
  return { ok: errores.length === 0, errores };
}

// ═══════════════ Flags de Node heredables por los hijos ═══════════════
// entornoHijo NO propaga NODE_OPTIONS (podría traer --require / --inspect). Pero sin --use-system-ca el hijo no confía en los certificados del sistema y su fetch
// falla (UNABLE_TO_VERIFY_LEAF_SIGNATURE) aunque el padre conecte bien. Solo se copia esa bandera, como ARGUMENTO explícito de node; TLS nunca se desactiva.
export const FLAGS_NODE_HEREDABLES = Object.freeze(["--use-system-ca"]);
export function argsNodeHijo(env, execArgv = []) {
  const tokens = [...String(env?.NODE_OPTIONS ?? "").split(/\s+/), ...(Array.isArray(execArgv) ? execArgv : [])];
  return FLAGS_NODE_HEREDABLES.filter((f) => tokens.includes(f));
}

// ═══════════════ Salida de un hijo que falló: últimas líneas relevantes ═══════════════
const RUIDO_HIJO = /MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module|To eliminate this warning|--trace-warnings/;
const RE_CABECERAS = [/((?:authorization|proxy-authorization|set-cookie|x-api-key|apikey)["']?\s*[:=]\s*)[^\n]*/gi, /^(\s*cookie\s*[:=]\s*)[^\n]*/gim];
export const ocultarCabeceras = (t) => RE_CABECERAS.reduce((s, re) => s.replace(re, "$1[REDACTADO]"), String(t ?? ""));
export function ultimasLineasRelevantes(texto, max = 15) {
  return String(texto ?? "").split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() && !RUIDO_HIJO.test(l)).slice(-max).map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l));
}

// ═══════════════ Entorno de hijos (desde cero) ═══════════════
export function entornoHijo(base, cfg, { anon = false, service = false } = {}) {
  const e = {};
  const sistema = new Set(SISTEMA);
  for (const [k, v] of Object.entries(base)) if (sistema.has(k.toUpperCase()) && typeof v === "string") e[k] = v;
  e.TILA_ENTORNO = "staging"; e.TILA_STAGING_SUPABASE_REF = cfg.ref; e.STAGING_SUPABASE_URL = cfg.url;
  if (service) e.STAGING_SERVICE_ROLE_KEY = cfg.service;
  if (anon) e.STAGING_ANON_KEY = cfg.anon;
  return e;
}

// ═══════════════ Informe y veredicto ═══════════════
export const SIN_VERIFICAR = Object.freeze([
  "El comportamiento de PRODUCCIÓN no se midió: Realtime (R1–R6) se midió solo en staging; V3 compara contra lo esperado según el relevamiento del 18–19/09, no contra una corrida en producción.",
  "Pagos: no se usó pasarela real ni sandbox de Mercado Pago (rutas de checkout/webhook sin probar de extremo a extremo).",
  "Google Maps / Directions, notificaciones, apps móviles (Android/iOS) y Vercel (Preview/Production) no formaron parte de estas pruebas.",
  "Carga, concurrencia sostenida, tiempos de respuesta y límites de Supabase bajo uso real.",
  "Las secuencias se comprobaron con el resultado del SQL 09 pegado por el usuario (cruzado con MAX(id) por REST); el orquestador no puede leer secuencias por PostgREST.",
]);

export function veredicto(est) {
  const r = est.resultados ?? {};
  const motivos = [];
  const pasa = (k) => r[k]?.estado === RES.PASS;
  for (const [k, t] of [["fase0", "preflight"], ["fase1", "verificación local"], ["fase2", "verificación remota"], ["fase3", "seed dry-run"], ["fase4", "seed aplicado y verificado"], ["fase6", "secuencias"], ["fase7", "V3"], ["fase8", "app de staging"],
    ["fase9", "Realtime"], ["fase11", "limpieza"]]) if (!pasa(k)) motivos.push(`${t}: ${r[k]?.estado ?? "no ejecutada"}`);
  for (const m of MODOS) if (r[`modo_${m.modo}`]?.estado !== RES.PASS) motivos.push(`smoke ${m.modo}: ${r[`modo_${m.modo}`]?.estado ?? "no ejecutado"}`);
  return motivos.length ? { equivalente: false, motivos } : { equivalente: true, motivos: [] };
}

export function generarInforme(est, { fecha }) {
  const r = est.resultados ?? {}; const v = veredicto(est);
  const L = [];
  const fila = (k, nombre, extra = "") => `| ${nombre} | ${r[k]?.estado ?? "NO EJECUTADA"} | ${(r[k]?.detalle ?? extra).toString().replace(/\|/g, "/").slice(0, 300)} |`;
  L.push("# RESULTADO FINAL DE STAGING (generado por `scripts/staging/finalizar-staging.mjs`)", "");
  L.push(`Generado: ${fecha} · Proyecto de staging: \`${est.host ?? "?"}\` · Corrida: ${est.runId ?? "?"}${est.completa ? "" : " · **CORRIDA PARCIAL (se detuvo antes de terminar)**"}`, "");
  L.push("> Informe automático. No contiene claves, cookies, contraseñas ni tokens. Producción no fue tocada.", "");
  L.push("## Resumen por fase", "| Fase | Estado | Detalle |", "|---|---|---|");
  for (const [k, n] of [["fase0", "0 · Preflight"], ["fase1", "1 · Verificación local"], ["fase2", "2 · Verificación remota (solo lectura)"], ["fase3", "3 · Seed dry-run"], ["fase4", "4 · Seed aplicado"], ["fase6", "6 · Secuencias"],
    ["fase7", "7 · V3"], ["fase8", "8 · App de staging"], ["fase9", "9 · Realtime"], ["modo_legacy", "10 · Smoke LEGACY"], ["modo_dual", "10 · Smoke DUAL"], ["modo_strict", "10 · Smoke STRICT"], ["fase11", "11 · Limpieza"]]) L.push(fila(k, n));
  L.push("", "## Entorno", `Verificación local: **${r.fase1?.estado ?? "NO EJECUTADA"}** · remota (solo lectura): **${r.fase2?.estado ?? "NO EJECUTADA"}**. ${r.fase1?.detalle ?? ""}`);
  L.push("", "## Seed", `Dry-run: **${r.fase3?.estado ?? "NO EJECUTADA"}** · aplicado y verificado: **${r.fase4?.estado ?? "NO EJECUTADA"}**. ${r.fase4?.detalle ?? ""}`);
  L.push("", "## Secuencias", `**${r.fase6?.estado ?? "NO EJECUTADA"}** — ${r.fase6?.detalle ?? "sin datos"}`);
  const v3 = r.fase7?.datos;
  L.push("", "## V3 (A1–A15, B1–B16)", `Estado: **${r.fase7?.estado ?? "NO EJECUTADA"}**${v3 ? ` · PASS ${v3.pass} · FAIL ${v3.fails.length} · SKIP no bloqueantes ${v3.skipsNoBloqueantes.length}` : ""}`);
  if (v3) { for (const s of v3.skipsNoBloqueantes) L.push(`- SKIP no bloqueante ${s.id}: ${s.motivo}`); for (const f of v3.fails) L.push(`- **FAIL ${f}**`); }
  const rt = r.fase9?.datos;
  L.push("", "## Realtime", `Estado: **${r.fase9?.estado ?? "NO EJECUTADA"}**${rt ? ` · corrida ${rt.run ?? "?"} · control positivo ${rt.controlValido ? "VÁLIDO" : "NO VÁLIDO/sin evidencia"}` : ""}`);
  if (rt?.acciones?.length) { L.push("| Acción | anon | control positivo | Clasificación |", "|---|---|---|---|"); for (const a of rt.acciones) L.push(`| ${a.id} ${a.titulo} | ${a.anon} | ${a.control} | ${a.clase} |`); L.push("", "«ANON NO RECIBE» es un DATO medido, no un fallo; «INCONCLUSO» en una tabla no publicada no invalida la corrida."); }
  for (const m of MODOS) {
    const x = r[`modo_${m.modo}`]?.datos;
    L.push("", `## Smoke ${m.modo.toUpperCase()} (http://${m.host}:${m.puerto})`, `Estado: **${r[`modo_${m.modo}`]?.estado ?? "NO EJECUTADO"}**${x ? ` · ${x.flujos.pass}/${x.flujos.total} verificaciones PASS · GPS: ${x.gps.ok} puntos OK, ${x.gps.error} con error` : ""}`);
    if (x) L.push("Cobertura: " + Object.entries(x.flujos.cobertura).map(([k, c]) => `${k} ${c.pass}✔${c.fail ? `/${c.fail}✖` : ""}`).join(" · "));
  }
  L.push("", "## GPS y chat", ...MODOS.map((m) => { const x = r[`modo_${m.modo}`]?.datos; return `- ${m.modo}: GPS ${x ? `${x.gps.ok} OK / ${x.gps.error} error` : "no ejecutado"} · chat ${x ? `${x.flujos.cobertura["chat"]?.pass ?? 0} verificaciones PASS` : "no ejecutado"}`; }));
  L.push("", "## Limpieza", `**${r.fase11?.estado ?? "NO EJECUTADA"}** — ${r.fase11?.detalle ?? "sin datos"}`);
  L.push("", "## Diferencias encontradas");
  const dif = Object.entries(r).filter(([, x]) => x?.estado === RES.FAIL || x?.estado === RES.INCONCLUSO || x?.estado === RES.GUARDA);
  if (!dif.length) L.push("Ninguna FAIL ni INCONCLUSO bloqueante en las fases ejecutadas.");
  for (const [k, x] of dif) L.push(`- **${k}** (${x.estado}): ${x.detalle}`);
  L.push("", "## Qué quedó sin verificar", ...SIN_VERIFICAR.map((s) => `- ${s}`));
  L.push("", "## Veredicto");
  if (v.equivalente && est.completa) L.push("**STAGING FUNCIONALMENTE EQUIVALENTE A PRODUCCIÓN EN LAS PRUEBAS DEFINIDAS**", "", "(Alcance: solo las pruebas de este informe; ver «Qué quedó sin verificar».)");
  else L.push("**NO SE EMITE VEREDICTO DE EQUIVALENCIA.**", "", ...(v.motivos.length ? v.motivos.map((m) => `- ${m}`) : ["- La corrida no terminó."]));
  return L.join("\n") + "\n";
}

// ═══════════════ Orquestación ═══════════════
export async function main(argv, deps) {
  const out = deps.out ?? console.log, err = deps.err ?? console.error;
  const a = parsearArgs(argv);
  if (a.errores.length) { for (const e of a.errores) err(`[uso] ${e}`); return 2; }
  if (a.ayuda || a.plan) { out(textoPlan()); return 0; } // ← nada más: ni env, ni disco, ni red, ni procesos

  const env = deps.env ?? {};
  const raiz = deps.raiz ?? RAIZ_PROYECTO;
  const dirEstado = deps.dirEstado ?? join(os.tmpdir(), "tila-finalizar-staging");
  const T = { ...TIMEOUTS, ...(deps.timeouts ?? {}) };
  const ahora = deps.ahora ?? (() => new Date().toISOString());
  const secretos = [...SECRETAS.map((n) => env[n]), ...Object.values(D.CLAVES)].filter((x) => typeof x === "string" && x.length >= 8);
  const limpio = (t) => redactar(String(t ?? "").replace(/(destino: .*? \| clave: )[^|\n]*/g, "$1[CONFIGURADA] "), secretos);
  const log = (...p) => out(limpio(p.join(" ")));
  const guardarLog = (nombre, texto) => { try { deps.fs.mkdirSync(join(dirEstado, "logs"), { recursive: true }); deps.fs.writeFileSync(join(dirEstado, "logs", nombre), ocultarCabeceras(limpio(texto))); return true; } catch { return false; /* el log es accesorio */ } };
  const rutaEstado = join(dirEstado, "estado.json");
  let est = { version: 1, runId: (deps.runId ?? crypto.randomBytes(4).toString("hex")), iniciado: ahora(), fase: -1, resultados: {} };

  // ── señales: se apaga la app y se termina como INCONCLUSO ───────────────────────────────────────────────────────────────
  let abortado = false; let app = null;
  const alSenal = () => { abortado = true; };
  const senales = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];
  for (const s of senales) deps.proceso?.on?.(s, alSenal);
  const hayAbort = () => { if (abortado) throw Object.assign(new Error("interrumpido por el usuario"), { interrupcion: true }); };

  const guardarEstado = () => {
    const txt = JSON.stringify(est, null, 1);
    for (const s of secretos) if (txt.includes(s)) throw new Error("el estado contiene un secreto: NO se guarda");
    deps.fs.mkdirSync(dirEstado, { recursive: true }); deps.fs.writeFileSync(rutaEstado, txt);
  };
  const registrar = (clave, estado, detalle, datos) => { est.resultados[clave] = { estado, detalle: limpio(detalle), ...(datos ? { datos } : {}) }; if (estado === RES.PASS) log(`     ${est.resultados[clave].detalle}`); return est.resultados[clave]; };

  // ── helpers de ejecución ────────────────────────────────────────────────────────────────────────────────────────────────
  let cfg = null;
  const hijo = async (etiqueta, script, args, envHijo, timeoutMs) => {
    hayAbort();
    const r = await deps.ejecutarScript({ script, args, env: envHijo, timeoutMs, etiqueta, cwd: raiz, nodeArgs: argsNodeHijo(env, deps.execArgv) });
    const guardado = guardarLog(`${etiqueta}.txt`, `${script} ${args.join(" ")}\n(exit ${r.codigo}${r.agotado ? ", TIMEOUT" : ""})\n${r.salida}`);
    if (r.codigo !== 0 || r.agotado) {
      // el fallo de un hijo nunca queda oculto: ruta del log local + últimas líneas (ya redactadas). El STOP lo decide la fase que llamó.
      log(`  log local (redactado): ${join(dirEstado, "logs", `${etiqueta}.txt`)}${guardado ? "" : "  (NO se pudo guardar)"}`);
      const ult = ultimasLineasRelevantes(ocultarCabeceras(limpio(r.salida)));
      if (ult.length) { log(`  últimas líneas de «${etiqueta}» (redactadas):`); for (const l of ult) log(`    | ${l}`); } else log(`  «${etiqueta}» no produjo salida.`);
    }
    return r;
  };
  const modulo = async (etiqueta, fn, argv2, envMod) => {
    hayAbort();
    const lineas = [];
    const codigo = await fn(argv2, { env: envMod, out: (l) => lineas.push(String(l)), err: (l) => lineas.push(String(l)), proceso: new EventEmitter() });
    const salida = lineas.join("\n");
    guardarLog(`${etiqueta}.txt`, `${etiqueta} ${argv2.join(" ")}\n(exit ${codigo})\n${salida}`);
    return { codigo, salida };
  };
  const cliente = () => LP.envolverCliente(deps.crearCliente(cfg.url, cfg.service, { auth: { persistSession: false, autoRefreshToken: false } }), { incluirFlujos: false });
  const detenerApp = async () => {
    if (!app) return;
    const a2 = app; app = null;
    a2.senales.emit("SIGINT");
    await Promise.race([a2.promesa.catch(() => {}), new Promise((res) => setTimeout(res, T.apagadoMs).unref?.())]);
    log("[app] instancias de staging apagadas.");
  };
  const stop = (clave, estado, detalle, datos) => { const x = registrar(clave, estado, detalle, datos); log(`  ✖ ${estado}: ${x.detalle}`); return { detener: true, estado }; };

  // ═══ FASES ═══
  const fase0 = async () => {
    const errores = [];
    if (env.TILA_ENTORNO !== "staging") errores.push('TILA_ENTORNO debe ser exactamente "staging"');
    const ref = typeof env.TILA_STAGING_SUPABASE_REF === "string" ? env.TILA_STAGING_SUPABASE_REF : "";
    if (!/^[a-z0-9]{6,40}$/.test(ref)) errores.push("TILA_STAGING_SUPABASE_REF ausente o con formato inválido (un solo ref)");
    else if (ref === REF_PRODUCCION || ref.includes(REF_PRODUCCION)) errores.push("TILA_STAGING_SUPABASE_REF es el ref de PRODUCCIÓN");
    for (const n of ["STAGING_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
      const u = env[n];
      if (typeof u !== "string" || !u) { errores.push(`falta ${n}`); continue; }
      try {
        asegurarNoProduccion(u, { etiqueta: n, env: { TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: ref } });
        const p = new URL(u);
        if (p.protocol !== "https:" || p.port || p.username || p.password || (p.pathname !== "/" && p.pathname !== "") || p.search || p.hash) errores.push(`${n}: debe ser https://<ref>.supabase.co sin puerto, ruta ni credenciales`);
        else if (p.hostname.toLowerCase() !== `${ref}.supabase.co`) errores.push(`${n}: el host no coincide EXACTAMENTE con el ref de staging`);
      } catch (e) { errores.push(`${n}: ${String(e.message).replace(/^\[guarda\]\s*/, "")}`); }
    }
    for (const n of ["STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY"]) if (typeof env[n] !== "string" || !env[n].trim()) errores.push(`falta ${n}`);
    const sucias = Object.entries(env).filter(([, v]) => typeof v === "string" && V.valorDeProduccion(v)).map(([n]) => n).sort();
    if (sucias.length) errores.push(`variables con valores de PRODUCCIÓN (solo nombres): ${sucias.join(", ")}`);
    if (errores.length) return stop("fase0", RES.GUARDA, errores.join("; "));
    cfg = Object.freeze({ ref, host: `${ref}.supabase.co`, url: `https://${ref}.supabase.co`, anon: env.STAGING_ANON_KEY, service: env.STAGING_SERVICE_ROLE_KEY });
    est.ref = ref; est.host = cfg.host;
    registrar("fase0", RES.PASS, `staging ${cfg.host}; sin secretos en argumentos; entorno sin valores de producción`);
    return { detener: false };
  };

  const faseVerificar = async (n, argsV, clave, etiqueta) => {
    const { codigo, salida } = await modulo(etiqueta, (av, d) => deps.verificar(av, d), argsV, env);
    const lineas = salida.split("\n").filter((l) => /^\s+(PASS|FAIL|INCONCLUSO)\s+\w+/.test(l)).length;
    if (codigo === 0) { registrar(clave, RES.PASS, `${lineas} chequeos; todo PASS`); return { detener: false }; }
    const problemas = salida.split("\n").filter((l) => /^\s+(FAIL|INCONCLUSO)\s+\w+/.test(l)).map((l) => l.trim().replace(/\s+/g, " ")).slice(0, 6).join(" | ");
    const estado = codigo === 2 ? RES.GUARDA : codigo === 1 ? RES.FAIL : RES.INCONCLUSO;
    return stop(clave, estado, `verificar-entorno ${argsV[0]} terminó con exit ${codigo}: ${problemas || "ver el log"}`);
  };

  const soloLectura = async () => { const g = cliente(); const r = await g.from("usuarios").select("email"); if (r.error) throw new Error(`no se pudo leer usuarios (${r.error.message ?? "error"})`); return r.data ?? []; };

  const fase3 = async () => {
    const r = await hijo("fase3-seed-dryrun", "scripts/staging/seed/aplicar.mjs", [], entornoHijo(env, cfg, { service: true }), T.hijoCortoMs);
    if (r.agotado) return stop("fase3", RES.INCONCLUSO, "el dry-run del seed no terminó a tiempo");
    if (r.codigo !== 0) return stop("fase3", r.codigo === 2 ? RES.GUARDA : RES.FAIL, `aplicar.mjs (dry-run) terminó con exit ${r.codigo}`);
    const ev = evaluarSeedDryRun(r.salida, { host: cfg.host });
    if (!ev.ok) return stop("fase3", RES.FAIL, `el dry-run no coincide con lo esperado: ${ev.errores.join("; ")}`);
    registrar("fase3", RES.PASS, `9 tablas con las cantidades esperadas, ${ESPERADO.storage} objetos de Storage, emails solo ${DOMINIO}, aviso de secuencias presente, sin referencias a producción`);
    return { detener: false };
  };

  const seedYVerificar = async () => {
    const g = cliente();
    const v = await LP.verificarSeed(g, cfg.url, limpio);
    const totales = {};
    for (const t of TABLAS_SEED) { const r = await g.from(t).select("id"); if (r.error) throw new Error(`no se pudo contar ${t}`); totales[t] = (r.data ?? []).length; }
    const us = await g.from("usuarios").select("email");
    const fuera = (us.data ?? []).filter((u) => !String(u.email ?? "").endsWith(DOMINIO)).length;
    return { v, totales, fuera };
  };

  const fase4 = async () => {
    // 4.a nada que no sea ficticio en staging ANTES de escribir
    const previos = await soloLectura();
    const ajenos = previos.filter((u) => !String(u.email ?? "").endsWith(DOMINIO)).length;
    if (ajenos) return stop("fase4", RES.GUARDA, `staging ya tiene ${ajenos} usuario(s) con email fuera de ${DOMINIO}: podrían ser datos reales. No se aplicó nada`);
    // 4.b aplicar
    const r = await hijo("fase4-seed-aplicar", "scripts/staging/seed/aplicar.mjs", ["--aplicar", `--confirmar=${cfg.host}`], entornoHijo(env, cfg, { service: true }), T.seedMs);
    if (r.agotado) return stop("fase4", RES.INCONCLUSO, "aplicar.mjs no terminó a tiempo: el estado del seed es incierto");
    if (r.codigo !== 0) return stop("fase4", r.codigo === 2 ? RES.GUARDA : RES.FAIL, `aplicar.mjs --aplicar terminó con exit ${r.codigo}`);
    const ap = evaluarSeedAplicado(r.salida);
    if (!ap.ok) return stop("fase4", RES.FAIL, `salida inesperada del seed: ${ap.errores.join("; ")}`);
    // 4.c verificar por lectura
    const { v, totales, fuera } = await seedYVerificar();
    const errores = [];
    for (const t of TABLAS_SEED) if (totales[t] !== ESPERADO[t]) errores.push(`${t}: ${totales[t]} filas, se esperaban ${ESPERADO[t]}`);
    if (fuera) errores.push(`${fuera} usuario(s) fuera de ${DOMINIO}`);
    const totalEsperado = Object.values(ESPERADO).reduce((x, y) => x + y, 0);
    if (v.estado !== "intacto" || v.presentes !== totalEsperado || v.esperadas !== totalEsperado) errores.push(`seed ${v.estado} (${v.presentes}/${v.esperadas}; se esperaban ${totalEsperado}): ${[...v.faltantes, ...v.alteradas, ...v.errores].slice(0, 5).join(", ")}`);
    if (errores.length) return stop("fase4", RES.FAIL, errores.join("; "));
    registrar("fase4", RES.PASS, `seed aplicado y releído: ${TABLAS_SEED.map((t) => `${totales[t]} ${t}`).join(", ")}, ${ESPERADO.storage} objetos de Storage, todos los emails ${DOMINIO}`, { totales });
    est.fase = 4;
    return { detener: false };
  };

  const fase5 = () => {
    est.fase = 5; est.pausa = { desde: ahora() };
    guardarEstado();
    log("");
    log("SEED APLICADO CORRECTAMENTE.");
    log("AHORA EJECUTÁ EN TILA-STAGING:");
    log(`${RUTA_SQL_09}`);
    log("");
    log("Después volvé a ejecutar:");
    log("node --env-file=.env.staging scripts/staging/finalizar-staging.mjs --continuar");
    log("(Al pedirlo, pegá el resultado de la verificación final del SQL 09; o guardalo en un archivo y pasalo con --resultado-09=<archivo>.)");
    log("El orquestador NO ejecuta ese SQL, no usa pg ni RPC.");
    return { detener: true, estado: RES.PAUSA };
  };

  const fase6 = async () => {
    const g = cliente();
    const maximos = await SEC.maximosReales(g, SECUENCIAS);
    const texto = await deps.leerResultado09({ archivo: a.resultado09 ? resolve(raiz, a.resultado09) : null, tiempoMs: T.pegadoMs, log });
    if (!texto || !String(texto).trim()) {
      log("Falta el resultado de la verificación del SQL 09 (no se puede leer una secuencia por PostgREST y NO se da por pasada).");
      log(`Pegalo cuando se pida, o guardalo en un archivo y pasá --resultado-09=<archivo>. Archivo del SQL: ${RUTA_SQL_09}`);
      est.pausa = { desde: est.pausa?.desde ?? ahora(), esperandoResultado09: true }; guardarEstado();
      return { detener: true, estado: RES.PAUSA };
    }
    const filas = parsearResultado09(texto);
    const ev = evaluarSecuencias(filas, maximos);
    if (!ev.ok) return stop("fase6", RES.FAIL, ev.errores.join("; "));
    registrar("fase6", RES.PASS, `las 5 secuencias (${SECUENCIAS.join(", ")}) figuran PASS y su último valor ≥ MAX(id) real leído por REST (${SECUENCIAS.map((t) => `${t}=${maximos[t].max ?? 0}`).join(", ")}). Evidencia: resultado del SQL 09 pegado por el usuario (no verificable directamente por PostgREST).`, { maximos: Object.fromEntries(SECUENCIAS.map((t) => [t, maximos[t].max ?? 0])) });
    est.fase = 6; guardarEstado();
    return { detener: false };
  };

  const fase7 = async () => {
    const r = await hijo("fase7-v3", "scripts/staging/smoke/v3-anon.mjs", ["--limpiar"], entornoHijo(env, cfg, { anon: true, service: true }), T.v3Ms);
    if (r.agotado) return stop("fase7", RES.INCONCLUSO, "V3 no terminó a tiempo");
    if (r.codigo === 2 && !/^(PASS|FAIL|SKIP)\s+[AB]\d/m.test(r.salida)) return stop("fase7", RES.GUARDA, "V3 rechazó la configuración (guarda) antes de conectar");
    const p = parsearV3(r.salida, r.codigo);
    if (p.estado !== RES.PASS) return stop("fase7", p.estado, `V3: ${p.motivos.join("; ")}. No se corrige nada automáticamente`, p);
    registrar("fase7", RES.PASS, `A1–A15 y B1–B16: ${p.pass} PASS, 0 FAIL${p.skipsNoBloqueantes.length ? `, ${p.skipsNoBloqueantes.length} SKIP no bloqueante(s) documentado(s)` : ""}`, p);
    return { detener: false };
  };

  const fase8 = async () => {
    const senalesApp = new EventEmitter(); const lineas = [];
    let listoRes; const listo = new Promise((r) => { listoRes = r; });
    let terminado = null;
    const promesa = Promise.resolve(deps.levantar([], { env, out: (l) => { lineas.push(String(l)); if (/STAGING LISTO/.test(String(l))) listoRes(true); }, err: (l) => lineas.push(String(l)), proceso: senalesApp }))
      .then((c) => { terminado = c; listoRes(false); return c; }, (e) => { terminado = 1; lineas.push(String(e?.message ?? e)); listoRes(false); return 1; });
    app = { senales: senalesApp, promesa };
    const espera = new Promise((res) => setTimeout(() => res("timeout"), T.levantarMs).unref?.());
    const ok = await Promise.race([listo, espera]);
    guardarLog("fase8-levantar.txt", lineas.join("\n"));
    const salida = lineas.join("\n");
    if (ok !== true) { await detenerApp(); return stop("fase8", ok === "timeout" ? RES.INCONCLUSO : RES.FAIL, `la app de staging no quedó lista (${ok === "timeout" ? "timeout" : `levantar-staging terminó con exit ${terminado}`}): ${limpio(lineas.slice(-3).join(" | ")).slice(0, 240)}`); }
    const errores = [];
    if (!/\[escaneo\] OK/.test(salida)) errores.push("falta la confirmación del escaneo del build (sin el ref de producción)");
    if (/\[escaneo\] ✖/.test(salida)) errores.push("el escaneo del build encontró el ref de producción");
    if (salida.includes("0.0.0.0")) errores.push("aparece 0.0.0.0 en la salida del launcher");
    if (contieneProd(salida.replace(/\[escaneo\][^\n]*/g, ""))) errores.push("la salida del launcher menciona producción");
    for (const m of MODOS) if (!new RegExp(`\\[${m.modo}\\] pid \\d+ · http://${m.host.replace(/\./g, "\\.")}:${m.puerto} `).test(salida)) errores.push(`falta la instancia ${m.modo} en ${m.host}:${m.puerto}`);
    for (const m of MODOS) {
      try { const rr = await Promise.resolve(deps.fetch(`http://${m.host}:${m.puerto}${LV.RUTA_LISTO}`)); if (!rr.ok) errores.push(`${m.modo}: la comprobación propia respondió HTTP ${rr.status}`); }
      catch (e) { errores.push(`${m.modo}: sin respuesta a la comprobación propia`); }
    }
    if (errores.length) { await detenerApp(); return stop("fase8", RES.FAIL, errores.join("; ")); }
    registrar("fase8", RES.PASS, `build de staging sin ref de producción; 3 instancias listas: ${MODOS.map((m) => `${m.modo} ${m.host}:${m.puerto}`).join(", ")}; ninguna en 0.0.0.0`);
    return { detener: false };
  };

  const fase9 = async () => {
    const { codigo, salida } = await modulo("fase9-realtime", (av, d) => deps.realtime(av, d), [`--base=http://${MODOS[0].host}:${MODOS[0].puerto}`], env);
    const p = parsearRealtime(salida, codigo);
    if (p.estado !== RES.PASS) return stop("fase9", p.estado, `Realtime: ${p.motivos.join("; ")}${p.acciones.length ? ` (acciones leídas: ${p.acciones.map((x) => `${x.id} ${x.clase}`).join(", ")})` : ""}`, p);
    registrar("fase9", RES.PASS, `6 acciones clasificadas con control positivo VÁLIDO: ${p.acciones.map((x) => `${x.id} ${x.clase}`).join(" · ")}`, p);
    return { detener: false };
  };

  const contar = async (etiqueta) => { const c = await modulo(etiqueta, (av, d) => deps.limpiar(av, d), ["--contar", "--incluir-flujos"], env); return { ...c, p: parsearContar(c.salida) }; };
  const estadoConocido = (p) => p.leido && p.seed === "intacto" && p.residuos === 0 && p.dudas.length === 0;
  const prepararEstadoConocido = async (etiqueta) => {
    let c = await contar(`${etiqueta}-contar`);
    if (c.codigo === 2) return { ok: false, detalle: "limpiar-pruebas rechazó la configuración (guarda)", guarda: true };
    if (estadoConocido(c.p)) return { ok: true };
    log(`  estado no conocido (seed ${c.p.seed}, residuos ${c.p.residuos}): se limpian los restos de pruebas y se re-aplica el seed (upsert)…`);
    if (c.p.residuos > 0 || c.p.dudas.length) {
      const l = await modulo(`${etiqueta}-limpiar`, (av, d) => deps.limpiar(av, d), ["--aplicar", `--confirmar=${cfg.host}`, "--incluir-flujos"], env);
      if (l.codigo === 2) return { ok: false, guarda: true, detalle: "limpiar-pruebas rechazó la configuración (guarda)" };
      if (l.codigo === 1) return { ok: false, fallo: true, detalle: "la limpieza dejó restos o hubo un error (exit 1)" };
    }
    const s = await hijo(`${etiqueta}-reseed`, "scripts/staging/seed/aplicar.mjs", ["--aplicar", `--confirmar=${cfg.host}`], entornoHijo(env, cfg, { service: true }), T.seedMs);
    if (s.codigo !== 0) return { ok: false, detalle: `el re-seed terminó con exit ${s.codigo}` };
    c = await contar(`${etiqueta}-contar2`);
    return estadoConocido(c.p) ? { ok: true } : { ok: false, detalle: `no se logró un estado conocido (seed ${c.p.seed}, residuos ${c.p.residuos}${c.p.dudas.length ? ", hay elementos no reconocidos" : ""})` };
  };

  const fase10 = async () => {
    for (const m of MODOS) {
      hayAbort();
      log(`— Smoke ${m.modo.toUpperCase()} (http://${m.host}:${m.puerto}) —`);
      const base = `http://${m.host}:${m.puerto}`;
      const prep = await prepararEstadoConocido(`fase10-${m.modo}-previo`);
      if (!prep.ok) return stop(`modo_${m.modo}`, prep.guarda ? RES.GUARDA : prep.fallo ? RES.FAIL : RES.INCONCLUSO, `no se pudo partir de un estado conocido: ${prep.detalle}`);
      const envSmoke = { ...entornoHijo(env, cfg, {}) };
      const f = await hijo(`fase10-${m.modo}-flujos`, "scripts/staging/smoke/flujos.mjs", [`--modos=${m.modo}=${base}`], envSmoke, T.flujosMs);
      if (f.agotado) return stop(`modo_${m.modo}`, RES.INCONCLUSO, "flujos.mjs no terminó a tiempo");
      const pf = parsearFlujos(f.salida, f.codigo, m.modo);
      if (pf.estado !== RES.PASS) return stop(`modo_${m.modo}`, pf.estado, `flujos ${m.modo}: ${pf.motivos.join("; ")}. No se corrige nada automáticamente`, { flujos: pf });
      const g = await hijo(`fase10-${m.modo}-gps`, "scripts/staging/smoke/simular-gps.mjs", [`--base=${base}`, "--pasos=6", "--intervalo=500", "--carga=103", "--chofer=chofer1"], envSmoke, T.gpsMs);
      if (g.agotado) return stop(`modo_${m.modo}`, RES.INCONCLUSO, "simular-gps.mjs no terminó a tiempo");
      const pg = parsearGps(g.salida, g.codigo);
      if (pg.estado !== RES.PASS) return stop(`modo_${m.modo}`, pg.estado, `GPS ${m.modo}: ${pg.motivos.join("; ") || `exit ${g.codigo}`}`, { flujos: pf, gps: pg });
      registrar(`modo_${m.modo}`, RES.PASS, `flujos ${pf.pass}/${pf.total} PASS; GPS ${pg.ok} puntos OK`, { flujos: pf, gps: pg });
      log(`  ✔ ${m.modo}: ${pf.pass}/${pf.total} verificaciones PASS · GPS ${pg.ok} OK`);
    }
    return { detener: false };
  };

  const fase11 = async () => {
    await detenerApp();
    const previo = await contar("fase11-dryrun");
    if (previo.codigo === 2) return stop("fase11", RES.GUARDA, "limpiar-pruebas rechazó la configuración (guarda)");
    if (previo.p.dudas.length || !previo.p.leido) return stop("fase11", RES.INCONCLUSO, `el dry-run de limpieza no es concluyente: ${previo.p.dudas.slice(0, 3).join(" | ") || "no se pudo leer"}. No se borró nada`);
    let nota = `dry-run: ${previo.p.residuos} resto(s) de pruebas, seed ${previo.p.seed}`;
    if (previo.p.residuos > 0) {
      const l = await modulo("fase11-limpiar", (av, d) => deps.limpiar(av, d), ["--aplicar", `--confirmar=${cfg.host}`, "--incluir-flujos"], env);
      if (l.codigo === 1 || l.codigo === 2) return stop("fase11", l.codigo === 2 ? RES.GUARDA : RES.FAIL, `limpiar-pruebas --aplicar terminó con exit ${l.codigo} (restos o error)`);
    }
    if (previo.p.seed !== "intacto" || previo.p.residuos > 0) {
      const s = await hijo("fase11-reseed", "scripts/staging/seed/aplicar.mjs", ["--aplicar", `--confirmar=${cfg.host}`], entornoHijo(env, cfg, { service: true }), T.seedMs);
      if (s.codigo !== 0) return stop("fase11", RES.FAIL, `el re-seed (upsert; restaura el seed alterado por las pruebas) terminó con exit ${s.codigo}`);
      nota += "; seed re-aplicado (upsert)";
    }
    const fin = await contar("fase11-final");
    if (!estadoConocido(fin.p)) return stop("fase11", RES.FAIL, `tras la limpieza no quedó limpio: seed ${fin.p.seed}, ${fin.p.residuos} resto(s)`);
    registrar("fase11", RES.PASS, `${nota}. Verificación final: 0 restos V3/Realtime/smoke y seed intacto (${fin.p.presentes}/${fin.p.esperadas}); nunca TRUNCATE, DELETE sin filtro ni buckets vaciados`);
    return { detener: false };
  };

  const escribirInforme = (completa) => {
    est.completa = completa;
    const md = generarInforme(est, { fecha: ahora() });
    for (const s of secretos) if (md.includes(s)) throw new Error("el informe contiene un secreto: NO se escribe");
    deps.fs.writeFileSync(join(raiz, RUTA_INFORME), md);
    return md;
  };

  // ═══ Bucle ═══
  const plan = a.continuar ? [0, 1, 2, 6, 7, 8, 9, 10, 11, 12] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const acciones = { 0: fase0, 1: () => faseVerificar(1, ["--local"], "fase1", "fase1-verificar-local"), 2: () => faseVerificar(2, ["--remoto"], "fase2", "fase2-verificar-remoto"), 3: fase3, 4: fase4, 5: fase5, 6: fase6, 7: fase7, 8: fase8, 9: fase9, 10: fase10, 11: fase11 };
  let codigoFinal = 0; let detuvo = false;
  try {
    log(`FINALIZAR-STAGING · ${a.continuar ? "CONTINUAR" : "corrida nueva"} · corrida ${est.runId}${a.hasta < 12 ? ` · hasta la fase ${a.hasta}` : ""}`);
    let prevRef = null;
    if (a.continuar) {
      let prev = null;
      try { prev = JSON.parse(String(deps.fs.readFileSync(rutaEstado, "utf8"))); } catch { prev = null; }
      if (!prev || prev.version !== 1 || prev.fase < 5) { err("[finalizar-staging] no hay una corrida en pausa para continuar (falta el estado local o no llegó a la pausa del SQL 09). Ejecutá primero sin --continuar."); return 2; }
      est = { ...prev, resultados: prev.resultados ?? {} }; prevRef = prev.ref ?? null;
      log(`  estado previo cargado (corrida ${est.runId}, pausa desde ${est.pausa?.desde ?? "?"}); se revalidan las fases 0–2 antes de seguir`);
    } else { try { deps.fs.rmSync(rutaEstado, { force: true }); } catch { /* sin estado previo */ } }

    for (const n of plan) {
      if (n > a.hasta) { log(`--hasta=${a.hasta}: se detiene acá (fase ${a.hasta} completada).`); detuvo = true; break; }
      hayAbort();
      if (n === 12) {
        log(`Fase 12 — ${FASES[12][1]}`);
        const md = escribirInforme(true);
        const v = veredicto(est);
        log(`  informe escrito: ${RUTA_INFORME}`);
        log(v.equivalente ? "STAGING FUNCIONALMENTE EQUIVALENTE A PRODUCCIÓN EN LAS PRUEBAS DEFINIDAS" : `Sin veredicto de equivalencia: ${v.motivos.join("; ")}`);
        est.fase = 12; guardarEstado();
        codigoFinal = 0; if (!md) throw new Error("informe vacío");
        break;
      }
      log(`Fase ${n} — ${FASES[n][1]}`);
      const r = await acciones[n]();
      if (n === 0 && !r.detener && prevRef && cfg.ref !== prevRef) { const x = stop("fase0", RES.GUARDA, "el estado guardado pertenece a OTRO proyecto de staging: no se continúa"); codigoFinal = CODIGO[x.estado]; detuvo = true; break; }
      if (r.detener) { codigoFinal = CODIGO[r.estado]; detuvo = true; if (r.estado !== RES.PAUSA) { est.fase = Math.max(est.fase, n - 1); } break; }
      if (n !== 5 && n < 12) log(`  ✔ fase ${n} PASS`);
      if (n === 4 || n === 6) guardarEstado();
    }
    if (detuvo && codigoFinal !== 0 && codigoFinal !== 4 && (est.resultados?.fase4?.estado === RES.PASS || a.continuar)) {
      // corrida parcial: se deja constancia (sin veredicto) y se apaga la app
      await detenerApp();
      try { escribirInforme(false); log(`  informe PARCIAL escrito: ${RUTA_INFORME} (sin veredicto de equivalencia)`); } catch (e) { log(`  no se pudo escribir el informe parcial: ${String(e?.message ?? e).slice(0, 100)}`); }
      log("  Los datos de prueba que hayan quedado se limpian con: node --env-file=.env.staging scripts/staging/limpiar-pruebas.mjs --aplicar --confirmar=<host> --incluir-flujos (primero sin --aplicar para ver el dry-run).");
    }
  } catch (e) {
    if (e?.interrupcion) { codigoFinal = 3; log("INTERRUMPIDO: se apaga todo lo levantado; nada se limpia ni se corrige automáticamente."); }
    else { codigoFinal = 1; err(`[finalizar-staging] error inesperado: ${limpio(String(e?.message ?? e)).slice(0, 200)}`); }
  } finally {
    await detenerApp();
    for (const s of senales) deps.proceso?.off?.(s, alSenal);
  }
  return codigoFinal;
}

// ── Dependencias reales (se construyen solo al ejecutar el script; los tests usan falsos) ───────────────────────────────────
export function depsReales() {
  const ejecutarScript = ({ script, args, env: envHijo, timeoutMs, cwd, nodeArgs = [] }) => new Promise((res) => {
    const p = spawn(process.execPath, [...nodeArgs, resolve(cwd, script), ...args], { cwd, env: envHijo, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let salida = ""; let agotado = false;
    const juntar = (d) => { salida += String(d); if (salida.length > 4_000_000) salida = salida.slice(-3_000_000); };
    p.stdout.on("data", juntar); p.stderr.on("data", juntar);
    const t = setTimeout(() => { agotado = true; try { p.kill(); } catch { /* ya terminó */ } }, timeoutMs);
    p.once("error", (e) => { clearTimeout(t); res({ codigo: 1, salida: salida + String(e?.message ?? e), agotado }); });
    p.once("exit", (codigo) => { clearTimeout(t); res({ codigo: codigo ?? 1, salida, agotado }); });
  });
  const leerResultado09 = async ({ archivo, tiempoMs, log }) => {
    if (archivo) return readFileSync(archivo, "utf8");
    if (!process.stdin.isTTY) return null;
    log("Pegá acá el resultado de la verificación final del SQL 09 (filas secuencia / ultimo_valor / max_id / estado) y terminá con una línea vacía:");
    return await new Promise((res) => {
      let buf = ""; const fin = () => { process.stdin.off("data", onData); process.stdin.pause(); clearTimeout(t); res(buf); };
      const onData = (d) => { buf += String(d); if (/\r?\n\s*\r?\n$/.test(buf)) fin(); };
      const t = setTimeout(fin, tiempoMs);
      process.stdin.setEncoding("utf8"); process.stdin.resume(); process.stdin.on("data", onData);
    });
  };
  return {
    env: process.env, execArgv: process.execArgv, out: (l) => console.log(l), err: (l) => console.error(l), proceso: process, raiz: RAIZ_PROYECTO,
    fs: { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync },
    crearCliente: createClient,
    verificar: (av, d) => V.main(av, { ...V.depsReales(), ...d }),
    levantar: (av, d) => LV.main(av, { ...LV.depsReales(), ...d }),
    realtime: (av, d) => RT.main(av, { ...RT.depsReales(), ...d }),
    limpiar: (av, d) => LP.main(av, { ...LP.depsReales(), ...d }),
    ejecutarScript, leerResultado09,
    fetch: (u) => fetch(u, { signal: AbortSignal.timeout(TIMEOUTS.readinessMs) }),
  };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("finalizar-staging.mjs")) {
  main(process.argv.slice(2), depsReales()).then((c) => { process.exitCode = c; setTimeout(() => process.exit(c), TIMEOUTS.salidaForzadaMs).unref(); },
    (e) => { console.error("[finalizar-staging] error inesperado:", redactar(e?.message ?? e)); process.exitCode = 1; });
}
