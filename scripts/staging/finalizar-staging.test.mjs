// Tests LOCALES de finalizar-staging.mjs. Sin red, sin Supabase, sin Next, sin puertos, sin claves reales, sin .env.staging, sin ejecutar ninguna herramienta real:
// TODAS las herramientas hijas (verificar-entorno, aplicar.mjs, V3, launcher, realtime, flujos, GPS, limpiar-pruebas), el sistema de archivos y el Supabase son FALSOS en memoria.
// Ejecutar: node --test scripts/staging/finalizar-staging.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as F from "./finalizar-staging.mjs";
import * as D from "./seed/datos.mjs";
import * as SEC from "./seed/secuencias.mjs";
import { REF_PRODUCCION, HOSTS_PRODUCCION } from "./guardas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(AQUI, "finalizar-staging.mjs");
const REF = "abcdefghij0123456789";
const HOST = `${REF}.supabase.co`;
const URL_OK = `https://${HOST}`;
const ANON = "sb_publishable_TEST0123456789abcdefABCDEF";
const SVC = "sb_secret_TEST0123456789abcdefABCDEF";
const SESION = "Ab3dEf6hIj9lMn2pQr5tUv8xYz1BcD4FgH7kLo0sWq6RtVyZ";
const MP = "TEST-0123456789-fake-token-abcdef";
const RAIZ = "C:/repo", ESTADO = "C:/estado";
const norm = (p) => String(p).replaceAll("\\", "/");
const envOk = (extra = {}) => ({
  PATH: "C:\\bin", SystemRoot: "C:\\Windows", TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: REF, STAGING_SUPABASE_URL: URL_OK, NEXT_PUBLIC_SUPABASE_URL: URL_OK, SUPABASE_URL: URL_OK,
  STAGING_ANON_KEY: ANON, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, STAGING_SERVICE_ROLE_KEY: SVC, SUPABASE_SERVICE_ROLE_KEY: SVC, TILA_SESSION_SECRET: SESION, NEXT_PUBLIC_BASE_URL: "http://127.0.0.1:3131",
  MERCADOPAGO_ACCESS_TOKEN: MP, ...extra,
});
const SECRETOS = [ANON, SVC, SESION, MP, ...Object.values(D.CLAVES)];
const T = { hijoCortoMs: 2000, seedMs: 2000, v3Ms: 2000, flujosMs: 2000, gpsMs: 2000, levantarMs: 1500, readinessMs: 500, apagadoMs: 1000, pegadoMs: 500 };

// ═══════════════ Supabase + Storage falsos (con el seed real) ═══════════════
class Q {
  constructor(be, t) { this.be = be; this.t = t; this.op = null; this.f = []; }
  select(c) { if (!this.op) { this.op = "select"; this.cols = c; } return this; }
  delete() { this.be.escrituras.push(`delete ${this.t}`); this.op = "delete"; return this; } update() { this.be.escrituras.push(`update ${this.t}`); this.op = "update"; return this; }
  insert() { this.be.escrituras.push(`insert ${this.t}`); throw new Error("el orquestador no inserta"); } upsert() { this.be.escrituras.push(`upsert ${this.t}`); throw new Error("el orquestador no hace upsert"); }
  eq(c, v) { this.f.push(["eq", c, v]); return this; } in(c, v) { this.f.push(["in", c, v]); return this; } is(c, v) { this.f.push(["is", c, v]); return this; } like(c, v) { this.f.push(["like", c, v]); return this; }
  order(c, o) { this.ord = [c, o]; return this; } limit(n) { this.lim = n; return this; } single() { return this; } maybeSingle() { return this; } range() { return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const be = this.be; be.lecturas.push(this.t);
    if (be.falla?.(this.t)) return { data: null, error: { message: "boom" } };
    const tabla = be.tablas[this.t]; if (!tabla) return { data: null, error: { message: `no existe ${this.t}` } };
    let filas = tabla.filter((r) => this.f.every(([k, c, v]) => (k === "eq" ? String(r[c]) === String(v) : k === "in" ? v.map(String).includes(String(r[c])) : k === "is" ? (r[c] ?? null) === v : new RegExp(`^${String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`).test(String(r[c])))));
    if (this.ord) filas = filas.slice().sort((a, b) => (this.ord[1]?.ascending === false ? b[this.ord[0]] - a[this.ord[0]] : a[this.ord[0]] - b[this.ord[0]]));
    if (this.lim) filas = filas.slice(0, this.lim);
    const cols = this.cols && this.cols !== "*" ? this.cols.split(",").map((c) => c.trim()) : null;
    return { data: filas.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) : { ...r })), error: null };
  }
}
function bd() {
  const be = { tablas: {}, objetos: new Set(), lecturas: [], escrituras: [], falla: null };
  for (const t of ["usuarios", "vehiculos", "documentacion_chofer", "cargas", "paradas_viaje", "mensajes_viaje", "billetera_chofer", "viaje_evidencias", "consentimientos_legales", "tarifas_config"]) be.tablas[t] = [];
  be.sembrar = () => {
    const b = URL_OK;
    Object.assign(be.tablas, { usuarios: D.usuarios().map((u) => ({ ...u, password: "$2b$x" })), vehiculos: D.vehiculos(b), documentacion_chofer: D.documentacion(b).filas, cargas: D.cargas(), paradas_viaje: D.paradas(), mensajes_viaje: D.mensajes(),
      billetera_chofer: D.billetera(), viaje_evidencias: D.evidencias(b), consentimientos_legales: D.consentimientos() });
    be.objetos.clear(); for (const a of D.documentacion(b).archivos) be.objetos.add(`${a.bucket}/${a.ruta}`); be.objetos.add("documentacion-choferes/evidencias/103/carga_1.png");
  };
  be.crearCliente = () => ({ from: (t) => new Q(be, t), storage: { from: (bucket) => ({ list: async (prefijo, o = {}) => {
    const p = `${bucket}/${prefijo}/`; const h = new Map(); for (const k of be.objetos) if (k.startsWith(p)) { const [n, ...r] = k.slice(p.length).split("/"); h.set(n, r.length > 0); }
    return { data: [...h].map(([name, c]) => ({ name, id: c ? null : `i-${name}` })).slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100)), error: null };
  }, remove: async () => { be.escrituras.push("storage.remove"); return { data: [], error: null }; }, upload: async () => { be.escrituras.push("storage.upload"); return { data: null, error: null }; } }) } });
  return be;
}

// ═══════════════ Salidas falsas con el formato REAL de cada herramienta ═══════════════
const linea = (...p) => p.join("");
const salidaAplicar = (host, aplicar) => {
  const L = [`destino: ${host} | clave: sb_…EF (len 36) | modo: ${aplicar ? "APLICAR" : "DRY-RUN (no escribe)"}`];
  const n = F.ESPERADO; for (const t of ["usuarios", "vehiculos", "documentacion_chofer", "cargas", "paradas_viaje", "mensajes_viaje", "billetera_chofer", "viaje_evidencias", "consentimientos_legales"]) L.push(`  ${t.padEnd(24)} ${String(n[t]).padStart(3)} filas`);
  L.push(`  storage: ${D.documentacion(URL_OK).archivos.length} imágenes ficticias en buckets documentacion-choferes / vehiculos`, "  usuarios de prueba:");
  for (const k of Object.keys(D.ID)) L.push(`    ${D.ROL[k].padEnd(8)} ${D.EMAIL(k).padEnd(38)} clave: ${D.CLAVES[k]}`);
  const an = SEC.analizarSecuencias(D, URL_OK); L.push(...SEC.lineasSecuenciasDryRun(an));
  if (!aplicar) L.push("\nDRY-RUN: no se escribió nada. Agregá --aplicar (y --confirmar=<host> si no es local).");
  else { L.push("  ✔ usuarios: 6", ...SEC.lineasPasoSecuencias(an, Object.fromEntries(an.afectadas.map((a) => [a.tabla, { max: a.minimoTrasSeed }]))), "\nSEED APLICADO (falta el paso manual de secuencias: ver arriba)."); }
  return L.join("\n");
};
const salidaV3 = ({ fallar = [], skipObl = [], skipNo = [], sinIds = [] } = {}) => {
  const L = [];
  for (const id of F.IDS_V3) { if (sinIds.includes(id)) continue; const st = fallar.includes(id) ? "FAIL" : skipObl.includes(id) || skipNo.includes(id) ? "SKIP" : "PASS"; L.push(`${st.padEnd(4)} ${id.padEnd(3)} prueba ${id}`, "       esperado : x", "       observado: y"); }
  L.push("", "RESUMEN V3");
  for (const id of fallar) L.push(`  ✗ FAIL ${id}: algo`); for (const id of skipObl) L.push(`  ⚠ SKIP (obligatoria) ${id}: motivo`); for (const id of skipNo) L.push(`  · SKIP (no obligatoria) ${id}: no aplica en staging`);
  L.push("V3: fin");
  return L.join("\n");
};
const salidaRealtime = ({ controlValido = true, filas = null } = {}) => {
  const acc = filas ?? [["R1", "nueva carga", "NO LLEGÓ", "LLEGÓ", "ANON NO RECIBE"], ["R2", "cambio de estado (aceptar)", "NO LLEGÓ", "LLEGÓ", "ANON NO RECIBE"], ["R3", "mensaje de chat", "NO LLEGÓ", "LLEGÓ", "ANON NO RECIBE"],
    ["R4", "posición GPS simulada", "NO LLEGÓ", "LLEGÓ", "ANON NO RECIBE"], ["R5", "latido del chofer (ultima_senal_at)", "NO LLEGÓ", "NO LLEGÓ", "INCONCLUSO"], ["R6", "DELETE de carga ficticia marcada", "NO LLEGÓ", "LLEGÓ", "ANON NO RECIBE"]];
  return ["REALTIME · run abcd1234", "", "RESUMEN REALTIME (run abcd1234)", `  control positivo: ${controlValido ? "VÁLIDO (recibió los eventos de las tablas publicadas)" : "NO VÁLIDO o sin evidencia"}`,
    ...acc.map(([id, t, a, c, k]) => `  ${id} ${t.padEnd(38)} anon: ${a.padEnd(8)} control: ${c.padEnd(8)} → ${k}`), "  resultado: VÁLIDA → exit 0"].join("\n");
};
const salidaFlujos = (modo, { fallar = false, otroModo = false } = {}) => {
  const pasos = [["cliente", "login (rol cliente)"], ["cliente", "publicar → 200 y estado pendiente"], ["cliente", "chat: enviar al chofer"], ["chofer", "disponibles incluye la oferta nueva"], ["chofer", "aceptar con CARRERA"], ["chofer", "viaje activo (por id)"],
    ["chofer", "estado → Viaje finalizado"], ["chofer", "evidencia (evento chofer_en_camino)"], ["chofer", "GPS simulado: PATCH posición"], ["chofer", "billetera: acreditar viaje finalizado"], ["admin", "login (rol admin)"], ["auth", "solo cookie"]];
  const L = pasos.map(([f, p], i) => `${fallar && i === 3 ? "FAIL" : "PASS"} [${otroModo && i === 5 ? "dual" : modo}] ${f} · ${p}: 200${fallar && i === 3 ? "  (esperado 201)" : ""}`);
  L.push("", `TOTAL ${pasos.length} · PASS ${pasos.length - (fallar ? 1 : 0)} · FAIL ${fallar ? 1 : 0} | por modo [pass,fail]: {}`);
  return L.join("\n");
};
const salidaGps = (err = 0) => ["punto  1/7  lat=1 lng=2 vel=0  → 200", `GPS simulado: ${7 - err} OK, ${err} con error`].join("\n");
const salidaContar = (host, { residuos = 0, seed = "intacto", dudas = false } = {}) => ["LIMPIAR-PRUEBAS · DRY-RUN con lectura (--contar) · staging " + host + " · clave [CONFIGURADA]", "CONTEOS PREVISTOS (solo lectura):",
  "  V3        : usuarios 0 · paradas_viaje 0 · viaje_evidencias 0 · inesperadas 0 · tarifas_config 0 · seed con marcador V3 (a restaurar) 0 · Storage v3-marcador/ 0",
  "  Realtime  : corridas 0 · cargas 0 · mensajes_viaje 0 · usuarios 0", `  Flujos    : cargas ${residuos} · mensajes_viaje 0 · viaje_evidencias 0 · billetera_chofer 0 · paradas_viaje 0  (no incluidos sin --incluir-flujos)`,
  ...(dudas ? ["  NO reconocido/omitido (no se toca): cargas:9 (algo)"] : []), `  seed: ${seed} (${seed === "intacto" ? 100 : 97}/100 elementos presentes)`, "DRY-RUN: no se borró nada."].join("\n");
const resultado09 = (be, { sobre = null, sinFilas = [], estado = "PASS", ultimoMenos = 0 } = {}) => {
  const filas = F.SECUENCIAS.filter((t) => !sinFilas.includes(t)).map((t) => { const max = Math.max(0, ...be.tablas[t].map((r) => r.id)); return `${t}_id_seq\t${Math.max(0, max - ultimoMenos)}\t${sobre ?? max}\t${estado}`; });
  return ["secuencia\tultimo_valor\tmax_id\testado", ...filas].join("\n");
};

// ═══════════════ Mundo: todas las herramientas falsas + registro de llamadas ═══════════════
function mundo({ env = envOk(), opc = {} } = {}) {
  const w = { be: bd(), salida: [], errores: [], hijos: [], modulos: [], eventos: [], residuos: 0, seed: "intacto", archivos: new Map(), appActiva: false, appApagada: 0, fetchLlamadas: [], escrituras: [] };
  const proceso = new EventEmitter();
  const fsMem = { files: w.archivos, mkdirSync() {}, writeFileSync: (p, t) => { w.escrituras.push(norm(p)); w.archivos.set(norm(p), String(t)); }, readFileSync: (p) => { if (!w.archivos.has(norm(p))) throw new Error("ENOENT"); return w.archivos.get(norm(p)); },
    existsSync: (p) => w.archivos.has(norm(p)), rmSync: (p) => { w.archivos.delete(norm(p)); } };
  const deps = {
    env, out: (l) => w.salida.push(String(l)), err: (l) => w.errores.push(String(l)), proceso, raiz: RAIZ, dirEstado: ESTADO, fs: fsMem, timeouts: T, runId: "run00001", ahora: () => "2026-09-21T12:00:00.000Z",
    crearCliente: w.be.crearCliente, fetch: async (u) => { w.fetchLlamadas.push(String(u)); return { ok: !opc.fetchFalla, status: opc.fetchFalla ? 503 : 200 }; },
    verificar: async (av, d) => { w.eventos.push(`verificar ${av[0]}`); w.modulos.push({ m: "verificar", av }); const cod = opc.verificar?.[av[0]] ?? 0; d.out(`  ${cod === 0 ? "PASS      " : "FAIL      "} L01  chequeo de prueba`); return cod; },
    ejecutarScript: async ({ script, args, env: eh, nodeArgs }) => {
      const nombre = script.split("/").pop(); w.hijos.push({ script: nombre, args, env: eh, nodeArgs }); w.eventos.push(`hijo ${nombre} ${args.join(" ")}`.trim());
      const aplicar = args.includes("--aplicar");
      if (nombre === "aplicar.mjs") {
        if (opc.aplicarCodigo && aplicar) return { codigo: opc.aplicarCodigo, salida: opc.aplicarSalida ?? "boom", agotado: opc.aplicarAgotado ?? false };
        if (aplicar) { if (!opc.noSembrar) { w.be.sembrar(); } w.seed = "intacto"; }
        const h = opc.hostSeed ?? HOST; let s = salidaAplicar(h, aplicar);
        if (opc.mutarDry && !aplicar) s = opc.mutarDry(s);
        return { codigo: 0, salida: s, agotado: false };
      }
      if (nombre === "v3-anon.mjs") return { codigo: opc.v3Codigo ?? 0, salida: salidaV3(opc.v3 ?? {}), agotado: false };
      if (nombre === "flujos.mjs") { w.residuos = 3; w.seed = "alterado"; const modo = args[0].slice(8).split("=")[0]; return { codigo: opc.flujosFalla === modo ? 1 : 0, salida: salidaFlujos(modo, { fallar: opc.flujosFalla === modo, otroModo: opc.flujosMezcla === modo }), agotado: false }; }
      if (nombre === "simular-gps.mjs") return { codigo: opc.gpsErr ? 1 : 0, salida: salidaGps(opc.gpsErr ?? 0), agotado: false };
      return { codigo: 1, salida: "script desconocido", agotado: false };
    },
    levantar: (av, d) => new Promise((res) => {
      w.eventos.push("levantar"); w.modulos.push({ m: "levantar", av });
      if (opc.levantarCodigo) { d.out("[build] FALLÓ."); return res(opc.levantarCodigo); }
      d.out("[build] next build (una sola vez, con variables de STAGING)…");
      d.out(opc.sinEscaneo ? "[escaneo] (omitido)" : "[escaneo] OK: 120 archivos sin referencia a Supabase de producción.");
      d.out("");
      d.out("STAGING LISTO (Ctrl+C para detener todo):");
      for (const m of F.MODOS) d.out(`  [${m.modo}] pid 10${m.puerto} · http://${opc.bind0 && m.modo === "dual" ? "0.0.0.0" : m.host}:${m.puerto} · TILA_AUTH_MODE=${m.modo} · Supabase ${HOST}`);
      w.appActiva = true;
      d.proceso.on("SIGINT", () => { w.appActiva = false; w.appApagada++; res(0); });
    }),
    realtime: async (av, d) => { w.eventos.push("realtime"); w.modulos.push({ m: "realtime", av }); d.out(salidaRealtime(opc.realtime ?? {})); return opc.realtimeCodigo ?? 0; },
    limpiar: async (av, d) => {
      w.modulos.push({ m: "limpiar", av }); w.eventos.push(`limpiar ${av.join(" ")}`);
      if (av.includes("--contar")) { d.out(salidaContar(HOST, { residuos: w.residuos, seed: w.seed, dudas: opc.dudas })); return 0; }
      const previo = w.seed; w.residuos = 0; d.out("RESULTADO: …"); return opc.limpiarCodigo ?? (previo === "intacto" ? 0 : 3);
    },
    leerResultado09: async ({ archivo }) => { w.eventos.push(`pegado ${archivo ? "archivo" : "stdin"}`); return opc.texto09 === undefined ? resultado09(w.be) : opc.texto09; },
  };
  if (opc.deps) Object.assign(deps, opc.deps);
  return { w, deps, proceso, correr: (argv) => F.main(argv, deps), texto: () => [...w.salida, ...w.errores].join("\n") };
}
const sinSecretos = (t, etiqueta = "") => { for (const s of SECRETOS) assert.ok(!String(t).includes(s), `${etiqueta} se filtró un secreto (${s.slice(0, 8)}…)`); };
const hijo = (m, script, cond = () => true) => m.w.hijos.filter((h) => h.script === script && cond(h));
const ARGS_FASES_0_5 = [];

// ═══════════════ 1. Argumentos y --plan ═══════════════
test("claves / URLs / ref por argv → exit 2, sin eco y sin tocar nada", async () => {
  for (const a of [`--anon=${ANON}`, `--service-role=${SVC}`, `--key=${SVC}`, `--url=${URL_OK}`, "--ref=abc", "--token=x", "--host=x", SVC, ANON, "--supabase=x", "--secret=y"]) {
    const m = mundo(); const c = await m.correr([a]);
    assert.equal(c, 2, a); assert.equal(m.w.hijos.length, 0); assert.equal(m.w.modulos.length, 0); sinSecretos(m.texto(), a); assert.ok(!m.texto().includes(URL_OK));
  }
});
test("argumentos inválidos: desconocido, --hasta fuera de rango, --resultado-09 sin --continuar, --continuar con ruta vacía → exit 2", async () => {
  for (const a of [["--todo"], ["--hasta=13"], ["--hasta=-1"], ["--hasta=x"], ["--resultado-09=algo.txt"], ["--continuar", "--resultado-09="]]) assert.equal(await mundo().correr(a), 2, a.join(" "));
});
const trampa = (n) => new Proxy({}, { get() { throw new Error(`--plan tocó ${n}`); } });
test("--plan / --listar / --ayuda: sin env, sin disco, sin red, sin procesos; lista las 13 fases y la plantilla de .env.staging; exit 0", async () => {
  for (const flag of ["--plan", "--listar", "--ayuda"]) {
    const salida = [];
    const deps = { env: trampa("env"), fs: trampa("fs"), crearCliente: () => { throw new Error("cliente"); }, ejecutarScript: () => { throw new Error("hijo"); }, verificar: () => { throw new Error("verificar"); }, levantar: () => { throw new Error("levantar"); },
      realtime: () => { throw new Error("realtime"); }, limpiar: () => { throw new Error("limpiar"); }, fetch: () => { throw new Error("fetch"); }, proceso: trampa("proceso"), out: (l) => salida.push(l), err: () => { throw new Error("err"); } };
    assert.equal(await F.main([flag], deps), 0); const t = salida.join("\n");
    for (const [n] of F.FASES) assert.match(t, new RegExp(`\\n\\s+${n}\\s+\\S`)); for (const p of ["TILA_STAGING_SUPABASE_REF", "STAGING_SERVICE_ROLE_KEY", "TILA_SESSION_SECRET", "--continuar", "09-secuencias-seed.sql", "127.0.0.3:3133", "NO ejecuta el SQL 09"]) assert.ok(t.includes(p), p);
    assert.ok(!t.includes("sb_secret_") && !t.includes("sb_publishable_"));
  }
});
test("--plan corre como script real con entorno vacío; script real con clave por argv → exit 2", () => {
  const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" };
  const a = spawnSync(process.execPath, [SCRIPT, "--plan"], { env, encoding: "utf8", timeout: 30000 }); assert.equal(a.status, 0, a.stderr); assert.match(a.stdout, /Fases/);
  const b = spawnSync(process.execPath, [SCRIPT, `--anon=${ANON}`], { env, encoding: "utf8", timeout: 30000 }); assert.equal(b.status, 2); assert.ok(!b.stdout.includes(ANON) && !b.stderr.includes(ANON));
});
test("ESPERADO coincide con lo que realmente siembra datos.mjs (filas y objetos de Storage)", () => {
  const b = URL_OK; const d = D.documentacion(b);
  assert.deepEqual({ usuarios: D.usuarios().length, vehiculos: D.vehiculos(b).length, documentacion_chofer: d.filas.length, cargas: D.cargas().length, paradas_viaje: D.paradas().length, mensajes_viaje: D.mensajes().length,
    billetera_chofer: D.billetera().length, viaje_evidencias: D.evidencias(b).length, consentimientos_legales: D.consentimientos().length, storage: d.archivos.length + 1 }, { ...F.ESPERADO });
  assert.deepEqual([...F.SECUENCIAS].sort(), ["cargas", "consentimientos_legales", "paradas_viaje", "vehiculos", "viaje_evidencias"]);
  assert.deepEqual(F.MODOS.map((m) => `${m.modo} ${m.host}:${m.puerto}`), ["legacy 127.0.0.1:3131", "dual 127.0.0.2:3132", "strict 127.0.0.3:3133"]);
});

// ═══════════════ 2. Fase 0: preflight / guardas anti-producción ═══════════════
test("fase 0: producción o entorno inválido → exit 2 SIN ejecutar nada (ni hijos, ni módulos, ni red, ni disco)", async () => {
  const prod = `https://${REF_PRODUCCION}.supabase.co`;
  const casos = [envOk({ TILA_ENTORNO: "local" }), envOk({ TILA_ENTORNO: undefined }), envOk({ TILA_STAGING_SUPABASE_REF: REF_PRODUCCION, STAGING_SUPABASE_URL: prod, NEXT_PUBLIC_SUPABASE_URL: prod, SUPABASE_URL: prod }),
    envOk({ STAGING_SUPABASE_URL: prod }), envOk({ NEXT_PUBLIC_SUPABASE_URL: prod }), envOk({ SUPABASE_URL: prod }), envOk({ SUPABASE_URL: "https://zzzzzzzzzz0123456789.supabase.co" }), envOk({ SUPABASE_URL: `${URL_OK}:8443` }),
    envOk({ STAGING_SUPABASE_URL: `http://${HOST}` }), envOk({ NEXT_PUBLIC_BASE_URL: `https://${HOSTS_PRODUCCION[1]}` }), envOk({ OTRA: `https://${REF_PRODUCCION}.supabase.co/x` }), envOk({ TOKEN_RARO: `https://${HOSTS_PRODUCCION[1]}` }),
    envOk({ TILA_STAGING_SUPABASE_REF: `${REF},otro` })];
  for (const env of casos) {
    const m = mundo({ env }); const c = await m.correr([]);
    assert.equal(c, 2, m.texto()); assert.equal(m.w.hijos.length, 0); assert.equal(m.w.modulos.length, 0); assert.equal(m.w.be.lecturas.length, 0); assert.equal(m.w.archivos.size, 0); assert.equal(m.w.fetchLlamadas.length, 0); sinSecretos(m.texto());
  }
});
test("fase 0: faltan claves o el ref → exit 2; un env con valor de producción nombra solo la variable, no el valor", async () => {
  for (const n of ["STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY", "TILA_STAGING_SUPABASE_REF", "STAGING_SUPABASE_URL"]) { const e = envOk(); delete e[n]; assert.equal(await mundo({ env: e }).correr([]), 2, n); }
  const m = mundo({ env: envOk({ OTRA: `x${REF_PRODUCCION}y` }) }); await m.correr([]); assert.match(m.texto(), /OTRA/); assert.ok(!m.texto().includes(REF_PRODUCCION));
});

// ═══════════════ 3. Fases 1 y 2: verificar-entorno ═══════════════
test("fase 1: verificar-entorno --local con FAIL/guarda/INCONCLUSO → STOP con el código correspondiente y nada más se ejecuta", async () => {
  for (const [cod, esperado] of [[1, 1], [2, 2], [3, 3]]) {
    const m = mundo({ opc: { verificar: { "--local": cod } } }); const c = await m.correr([]);
    assert.equal(c, esperado); assert.deepEqual(m.w.modulos.map((x) => x.av[0]), ["--local"]); assert.equal(m.w.hijos.length, 0); assert.equal(m.w.be.lecturas.length, 0);
  }
});
test("fase 2: verificar-entorno --remoto con FAIL o INCONCLUSO → STOP; no se ejecuta el seed", async () => {
  for (const [cod, esperado] of [[1, 1], [3, 3]]) {
    const m = mundo({ opc: { verificar: { "--remoto": cod } } }); const c = await m.correr([]);
    assert.equal(c, esperado); assert.deepEqual(m.w.modulos.map((x) => x.av[0]), ["--local", "--remoto"]); assert.equal(m.w.hijos.length, 0);
  }
});

// ═══════════════ 4. Fase 3: dry-run del seed ═══════════════
test("fase 3: el dry-run se ejecuta SIN --aplicar, con env mínimo (solo service_role, sin anon, sin otras variables) y sin claves por argv", async () => {
  const m = mundo(); await m.correr(["--hasta=3"]);
  const h = hijo(m, "aplicar.mjs"); assert.equal(h.length, 1); assert.deepEqual(h[0].args, []);
  const permitidas = new Set(["TILA_ENTORNO", "TILA_STAGING_SUPABASE_REF", "STAGING_SUPABASE_URL", "STAGING_SERVICE_ROLE_KEY", "PATH", "SystemRoot"]);
  for (const k of Object.keys(h[0].env)) assert.ok(permitidas.has(k), `variable inesperada en el hijo: ${k}`);
  assert.ok(!("STAGING_ANON_KEY" in h[0].env) && !("TILA_SESSION_SECRET" in h[0].env) && !("MERCADOPAGO_ACCESS_TOKEN" in h[0].env));
});
test("fase 3: valida cantidades, dominio de emails, aviso de secuencias y ausencia de producción; guarda el log redactado", async () => {
  const m = mundo(); const c = await m.correr(["--hasta=3"]);
  assert.equal(c, 0, m.texto()); assert.match(m.texto(), /--hasta=3/); const log = [...m.w.archivos].find(([k]) => k.endsWith("fase3-seed-dryrun.txt"));
  assert.ok(log); sinSecretos(log[1], "log"); assert.ok(!Object.values(D.CLAVES).some((p) => log[1].includes(p))); assert.ok(!/sb_…EF/.test(log[1]), "la máscara parcial de la clave no debe quedar en el log");
});
test("fase 3: cualquier desvío del dry-run → STOP sin aplicar el seed (cantidad, email fuera de dominio, host, referencia a producción, falta el aviso de secuencias)", async () => {
  const mutaciones = {
    cantidad: (s) => s.replace(/(cargas\s+)7 filas/, "$18 filas"), email: (s) => s + "\n    cliente   persona.real@gmail.com   clave: x", host: (s) => s.replace(HOST, "otro00000000000000000.supabase.co"),
    produccion: (s) => s + `\nhttps://${REF_PRODUCCION}.supabase.co`, sinSecuencias: (s) => s.replace("secuencias (el seed inserta ids explícitos", "otra cosa"), storage: (s) => s.replace(/storage: \d+ imágenes/, "storage: 3 imágenes"),
    modoAplicar: (s) => s.replace("modo: DRY-RUN (no escribe)", "modo: APLICAR"), sinUsuario: (s) => s.replace("admin@tila-staging.invalid", "admin@otro.tila-staging.invalid"),
  };
  for (const [nombre, mut] of Object.entries(mutaciones)) {
    const m = mundo({ opc: { mutarDry: mut } }); const c = await m.correr([]);
    assert.ok([1, 2].includes(c), `${nombre}: ${m.texto()}`); assert.equal(hijo(m, "aplicar.mjs", (h) => h.args.includes("--aplicar")).length, 0, `${nombre}: no debe aplicarse`);
  }
});
test("fase 3: si aplicar.mjs falla (exit ≠ 0) → STOP", async () => {
  const m = mundo({ opc: { deps: { ejecutarScript: async () => ({ codigo: 2, salida: "guarda", agotado: false }) } } }); assert.equal(await m.correr([]), 2);
});

// ═══════════════ 5. Fase 4: aplicar seed ═══════════════
test("fase 4: SOLO con 0–3 en PASS; aplica con --aplicar y --confirmar=<host EXACTO de staging>; verifica y NO escribe nada por su cuenta", async () => {
  const m = mundo(); const c = await m.correr(["--hasta=4"]);
  assert.equal(c, 0, m.texto());
  const ap = hijo(m, "aplicar.mjs", (h) => h.args.includes("--aplicar")); assert.equal(ap.length, 1); assert.deepEqual(ap[0].args, ["--aplicar", `--confirmar=${HOST}`]);
  assert.deepEqual(m.w.eventos.slice(0, 4), ["verificar --local", "verificar --remoto", "hijo aplicar.mjs", `hijo aplicar.mjs --aplicar --confirmar=${HOST}`]);
  assert.deepEqual(m.w.be.escrituras, [], "el orquestador solo LEE la base"); assert.match(m.texto(), /6 usuarios, 3 vehiculos, 26 documentacion_chofer, 7 cargas, 5 paradas_viaje, 8 mensajes_viaje, 2 billetera_chofer, 3 viaje_evidencias, 15 consentimientos_legales/);
});
test("fase 4: si las fases 0–3 no dieron PASS el seed NO se aplica (guarda, verificar, dry-run)", async () => {
  for (const opc of [{ verificar: { "--local": 1 } }, { verificar: { "--remoto": 3 } }, { mutarDry: (s) => s.replace("6 filas", "7 filas").replace(/(usuarios\s+)6 filas/, "$17 filas") }]) {
    const m = mundo({ opc }); assert.notEqual(await m.correr([]), 0); assert.equal(hijo(m, "aplicar.mjs", (h) => h.args.includes("--aplicar")).length, 0);
  }
  const g = mundo({ env: envOk({ SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` }) }); assert.equal(await g.correr([]), 2); assert.equal(g.w.hijos.length, 0);
});
test("fase 4: si staging YA tiene usuarios fuera de @tila-staging.invalid (¿datos reales?) → GUARDA (exit 2) y NO se aplica nada", async () => {
  const m = mundo(); m.w.be.tablas.usuarios.push({ id: "real", email: "persona.real@gmail.com" });
  const c = await m.correr([]); assert.equal(c, 2, m.texto()); assert.equal(hijo(m, "aplicar.mjs", (h) => h.args.includes("--aplicar")).length, 0); assert.match(m.texto(), /podrían ser datos reales/); assert.ok(!m.texto().includes("persona.real"));
});
test("fase 4: la verificación posterior detecta cantidades distintas, emails fuera de dominio, objetos de Storage faltantes o seed alterado → FAIL/STOP", async () => {
  const casos = {
    sobra: (m) => m.w.be.tablas.paradas_viaje.push({ id: 99, carga_id: 101, orden: 1 }), email: (m) => m.w.be.tablas.usuarios[0].email = "x@otro.com", storage: (m) => m.w.be.objetos.delete([...m.w.be.objetos][0]),
    falta: (m) => m.w.be.tablas.cargas.pop(), alterado: (m) => { m.w.be.tablas.cargas.find((c) => c.id === 103).lat = 0; },
  };
  for (const [n, f] of Object.entries(casos)) {
    const m = mundo({ opc: { noSembrar: true } }); m.w.be.sembrar(); f(m);
    const c = await m.correr([]); assert.equal(c, n === "email" ? 2 : 1, `${n}: ${m.texto()}`); assert.match(m.texto(), /FAIL|datos reales/);
  }
});
test("fase 4: aplicar.mjs con error, sin la confirmación «SEED APLICADO» o sin el paso manual → STOP", async () => {
  assert.equal(await mundo({ opc: { aplicarCodigo: 1 } }).correr([]), 1);
  const m = mundo({ opc: { deps: {} } }); const orig = m.deps.ejecutarScript;
  m.deps.ejecutarScript = async (x) => { const r = await orig(x); return x.args.includes("--aplicar") ? { ...r, salida: r.salida.replace("SEED APLICADO", "listo") } : r; };
  assert.equal(await m.correr([]), 1);
});

// ═══════════════ 6. Fase 5: pausa manual ═══════════════
test("fase 5: se DETIENE (exit 4) con el mensaje exacto, guarda un estado NO sensible y NO ejecuta el SQL 09, ni pg, ni RPC", async () => {
  const m = mundo(); const c = await m.correr([]);
  assert.equal(c, 4, m.texto());
  const t = m.texto();
  for (const s of ["SEED APLICADO CORRECTAMENTE.", "AHORA EJECUTÁ EN TILA-STAGING:", "docs/staging/sql/09-secuencias-seed.sql", "Después volvé a ejecutar:", "node --env-file=.env.staging scripts/staging/finalizar-staging.mjs --continuar"]) assert.ok(t.includes(s), s);
  const estado = m.w.archivos.get(`${ESTADO}/estado.json`); assert.ok(estado); const e = JSON.parse(estado);
  assert.equal(e.fase, 5); assert.equal(e.ref, REF); assert.equal(e.host, HOST); assert.equal(e.resultados.fase4.estado, "PASS"); sinSecretos(estado, "estado");
  assert.deepEqual(m.w.eventos.filter((x) => /levantar|realtime|v3|flujos|pegado/.test(x)), [], "nada de las fases 6+ antes de la pausa");
  assert.deepEqual(m.w.be.escrituras, []); assert.ok(!m.w.hijos.some((h) => /09|secuencias|psql|pg/.test(h.script + h.args.join(" "))));
  assert.ok(![...m.w.archivos.keys()].some((k) => k.includes("RESULTADO-FINAL")), "no se escribe el informe final en la pausa");
});

// ═══════════════ 7. --continuar y fase 6 ═══════════════
async function hastaPausa(opc = {}) { const m = mundo({ opc }); assert.equal(await m.correr([]), 4); m.w.salida.length = 0; m.w.eventos.length = 0; m.w.hijos.length = 0; m.w.modulos.length = 0; return m; }
test("--continuar sin estado (no hubo pausa) → exit 2 y nada se ejecuta; con un estado de OTRO proyecto → GUARDA", async () => {
  const m = mundo(); assert.equal(await m.correr(["--continuar"]), 2); assert.equal(m.w.hijos.length, 0); assert.match(m.texto(), /no hay una corrida en pausa/);
  const p = await hastaPausa(); const e = JSON.parse(p.w.archivos.get(`${ESTADO}/estado.json`)); e.ref = "otroref0123456789abcd"; p.w.archivos.set(`${ESTADO}/estado.json`, JSON.stringify(e));
  assert.equal(await p.correr(["--continuar", "--resultado-09=x.txt"]), 2); assert.match(p.texto(), /OTRO proyecto/); assert.deepEqual(p.w.eventos.filter((x) => /v3|levantar/.test(x)), []);
});
test("--continuar REVALIDA las fases 0–2 antes de seguir; si el entorno cambió a producción → exit 2 y no se ejecuta V3 ni nada", async () => {
  const p = await hastaPausa(); p.deps.env = envOk({ SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` });
  assert.equal(await p.correr(["--continuar"]), 2); assert.deepEqual(p.w.hijos, []); assert.deepEqual(p.w.eventos, []);
  const q = await hastaPausa(); q.deps.verificar = async () => 1; assert.equal(await q.correr(["--continuar"]), 1); assert.deepEqual(q.w.hijos, []);
});
test("fase 6: comprueba las 5 secuencias con el resultado pegado del SQL 09 CRUZADO con el MAX(id) leído por REST; no se salta la evidencia", async () => {
  const p = await hastaPausa(); const c = await p.correr(["--continuar", "--hasta=6"]);
  assert.equal(c, 0, p.texto()); assert.deepEqual(p.w.eventos.slice(0, 3), ["verificar --local", "verificar --remoto", "pegado stdin"]); assert.match(p.texto(), /las 5 secuencias/);
  assert.ok(p.w.be.lecturas.includes("paradas_viaje") && p.w.be.escrituras.length === 0);
});
test("fase 6: SIN resultado pegado (ni terminal ni archivo) → PAUSA (exit 4), NO se da por pasada y no corre V3", async () => {
  const p = await hastaPausa({ texto09: "" }); const c = await p.correr(["--continuar"]);
  assert.equal(c, 4); assert.ok(!p.w.eventos.some((x) => /v3|levantar|realtime/.test(x))); assert.match(p.texto(), /NO se da por pasada/);
});
test("fase 6: un resultado FALSO o desactualizado se rechaza (FAIL): estado FAIL, falta una fila, último valor por debajo del MAX(id), MAX(id) pegado ≠ REST, basura", async () => {
  const casos = [(be) => resultado09(be, { estado: "FAIL" }), (be) => resultado09(be, { sinFilas: ["cargas"] }), (be) => resultado09(be, { ultimoMenos: 1 }), (be) => resultado09(be, { sobre: 999999 }), () => "PASS PASS PASS", () => "texto cualquiera\notra línea"];
  for (const [i, f] of casos.entries()) {
    const p = await hastaPausa(); p.w.be.tablas.cargas.push({ id: 200 }); p.deps.leerResultado09 = async () => f(p.w.be);
    const c = await p.correr(["--continuar"]); assert.equal(c, 1, `caso ${i}: ${p.texto()}`); assert.ok(!p.w.eventos.some((x) => /v3/.test(x)), `caso ${i}: no debe correr V3`);
  }
});
test("fase 6: acepta el resultado por archivo (--resultado-09) y formatos con barras verticales o comas; el archivo se resuelve desde la raíz", async () => {
  const p = await hastaPausa(); let pedido = null; p.deps.leerResultado09 = async (x) => { pedido = x.archivo; return resultado09(p.w.be).replaceAll("\t", " | "); };
  assert.equal(await p.correr(["--continuar", "--resultado-09=res09.txt", "--hasta=6"]), 0); assert.equal(norm(pedido), norm(resolve(RAIZ, "res09.txt")));
  assert.equal(F.parsearResultado09("| paradas_viaje_id_seq | 5 | 5 | PASS |\ncargas_id_seq,107,107,PASS\nvehiculos_id_seq\tnull\tnull\tPASS").length, 3);
  assert.deepEqual(F.parsearResultado09("secuencia ultimo max estado\nfoo_id_seq 7 7 fail")[0], { secuencia: "foo_id_seq", ultimo: 7, maxId: 7, estado: "FAIL" });
});
test("fase 6: el orquestador NO ejecuta SQL, NO usa RPC ni pg: no hay escrituras en la base y ningún hijo referencia el SQL 09", async () => {
  const p = await hastaPausa(); await p.correr(["--continuar", "--hasta=6"]);
  assert.deepEqual(p.w.be.escrituras, []); assert.ok(!p.w.hijos.some((h) => h.args.join(" ").includes("09-secuencias")));
});

// ═══════════════ 8. Fase 7: V3 ═══════════════
test("fase 7: V3 corre con --limpiar, env mínimo (anon y service de staging), sin claves por argv; A1–A15 y B1–B16 PASS → PASS", async () => {
  const p = await hastaPausa(); const c = await p.correr(["--continuar", "--hasta=7"]); assert.equal(c, 0, p.texto());
  const v3 = hijo(p, "v3-anon.mjs"); assert.equal(v3.length, 1); assert.deepEqual(v3[0].args, ["--limpiar"]);
  assert.equal(v3[0].env.STAGING_ANON_KEY, ANON); assert.equal(v3[0].env.STAGING_SERVICE_ROLE_KEY, SVC); assert.ok(!v3[0].args.join(" ").includes(SVC) && !v3[0].args.join(" ").includes(ANON));
  for (const k of Object.keys(v3[0].env)) assert.ok(["PATH", "SystemRoot", "TILA_ENTORNO", "TILA_STAGING_SUPABASE_REF", "STAGING_SUPABASE_URL", "STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY"].includes(k), k);
  assert.match(p.texto(), /A1–A15 y B1–B16: 31 PASS, 0 FAIL/);
});
test("fase 7: cualquier FAIL → STOP (exit 1) sin corregir nada ni seguir; SKIP obligatorio o pruebas ausentes → INCONCLUSO (exit 3)", async () => {
  for (const [v3, esperado] of [[{ fallar: ["B4"] }, 1], [{ skipObl: ["B8"] }, 3], [{ sinIds: ["A7"] }, 3]]) {
    const p = await hastaPausa({ v3 }); assert.equal(await p.correr(["--continuar"]), esperado, JSON.stringify(v3)); assert.ok(!p.w.eventos.some((x) => /levantar|realtime|flujos/.test(x))); assert.ok(!p.w.hijos.some((h) => h.script === "aplicar.mjs"), "no se corrige/reseedea");
  }
});
test("fase 7: un SKIP explícitamente NO obligatorio no bloquea y queda documentado en el informe", async () => {
  const p = await hastaPausa({ v3: { skipNo: ["A13"] } }); assert.equal(await p.correr(["--continuar"]), 0, p.texto());
  assert.match(p.texto(), /1 SKIP no bloqueante/); const md = [...p.w.archivos].find(([k]) => k.endsWith("RESULTADO-FINAL-STAGING.md"))[1]; assert.match(md, /SKIP no bloqueante A13: no aplica en staging/);
});
test("parsearV3: tabla de decisión (código inesperado sin causa → INCONCLUSO; FAIL prioriza)", () => {
  assert.equal(F.parsearV3(salidaV3(), 0).estado, "PASS"); assert.equal(F.parsearV3(salidaV3(), 3).estado, "INCONCLUSO"); assert.equal(F.parsearV3(salidaV3({ fallar: ["A1"] }), 1).estado, "FAIL");
  assert.equal(F.parsearV3("", 0).estado, "INCONCLUSO"); assert.equal(F.parsearV3(salidaV3({ fallar: ["A1"], sinIds: ["B2"] }), 1).estado, "FAIL");
});

// ═══════════════ 9. Fase 8: levantar la app ═══════════════
test("fase 8: levanta SOLO legacy 127.0.0.1:3131, dual 127.0.0.2:3132, strict 127.0.0.3:3133; verifica escaneo del build y readiness propia; al terminar apaga las instancias", async () => {
  const p = await hastaPausa(); const c = await p.correr(["--continuar", "--hasta=8"]);
  assert.equal(c, 0, p.texto()); assert.deepEqual(p.w.fetchLlamadas.slice(0, 3), F.MODOS.map((m) => `http://${m.host}:${m.puerto}/api/mercadopago/webhook`));
  assert.equal(p.w.appActiva, false); assert.equal(p.w.appApagada, 1); assert.match(p.texto(), /sin ref de producción; 3 instancias listas/); assert.ok(!p.w.fetchLlamadas.some((u) => u.includes("0.0.0.0")));
});
test("fase 8: el launcher falla, falta la confirmación del escaneo, aparece 0.0.0.0 o una readiness propia falla → STOP, las instancias se cierran y no corre Realtime", async () => {
  for (const opc of [{ levantarCodigo: 1 }, { sinEscaneo: true }, { bind0: true }, { fetchFalla: true }]) {
    const p = await hastaPausa(opc); const c = await p.correr(["--continuar"]);
    assert.ok([1, 3].includes(c), JSON.stringify(opc) + p.texto()); assert.equal(p.w.appActiva, false, JSON.stringify(opc)); assert.ok(!p.w.eventos.includes("realtime"), JSON.stringify(opc));
  }
});
test("fase 8: si el launcher no llega a 'LISTO' a tiempo → INCONCLUSO (exit 3) y se apaga", async () => {
  const p = await hastaPausa(); p.deps.levantar = (av, d) => new Promise((res) => { d.proceso.on("SIGINT", () => res(0)); });
  p.deps.timeouts = { ...T, levantarMs: 60 }; assert.equal(await p.correr(["--continuar"]), 3);
});

// ═══════════════ 10. Fase 9: Realtime ═══════════════
test("fase 9: ejecuta realtime.mjs contra la instancia legacy loopback; guarda R1–R6 con anon, control positivo y clasificación; 'NO LLEGÓ' NO es un fallo", async () => {
  const p = await hastaPausa(); const c = await p.correr(["--continuar", "--hasta=9"]); assert.equal(c, 0, p.texto());
  const rt = p.w.modulos.find((x) => x.m === "realtime"); assert.deepEqual(rt.av, ["--base=http://127.0.0.1:3131"]);
  const est = JSON.parse(p.w.archivos.get(`${ESTADO}/estado.json`)); assert.ok(est.resultados.fase6);
  const pr = F.parsearRealtime(salidaRealtime(), 0); assert.equal(pr.acciones.length, 6); assert.equal(pr.acciones[0].anon, "NO LLEGÓ"); assert.equal(pr.acciones[0].control, "LLEGÓ"); assert.equal(pr.estado, "PASS");
});
test("fase 9: control positivo que falla (exit 3) → INCONCLUSO y STOP; FAIL real (exit 1) → STOP; sin 6 acciones o control no válido → INCONCLUSO; la app se apaga", async () => {
  for (const [opc, esperado] of [[{ realtimeCodigo: 3 }, 3], [{ realtimeCodigo: 1 }, 1], [{ realtimeCodigo: 2 }, 2], [{ realtime: { controlValido: false } }, 3], [{ realtime: { filas: [["R1", "x", "LLEGÓ", "LLEGÓ", "ANON RECIBE"]] } }, 3]]) {
    const p = await hastaPausa(opc); assert.equal(await p.correr(["--continuar"]), esperado, JSON.stringify(opc)); assert.equal(p.w.appActiva, false); assert.ok(!p.w.hijos.some((h) => h.script === "flujos.mjs"), "no corren los smoke");
  }
});

// ═══════════════ 11. Fase 10: smoke por modo ═══════════════
test("fase 10: legacy, dual y strict por SEPARADO y en orden; cada uno con su --modos=<solo ese>; sin claves por argv; GPS por modo; entre modos se limpia y re-aplica el seed", async () => {
  const p = await hastaPausa(); const c = await p.correr(["--continuar", "--hasta=10"]); assert.equal(c, 0, p.texto());
  const fl = hijo(p, "flujos.mjs"); assert.deepEqual(fl.map((h) => h.args), F.MODOS.map((m) => [`--modos=${m.modo}=http://${m.host}:${m.puerto}`]));
  const gps = hijo(p, "simular-gps.mjs"); assert.deepEqual(gps.map((h) => h.args[0]), F.MODOS.map((m) => `--base=http://${m.host}:${m.puerto}`));
  for (const h of [...fl, ...gps]) { assert.ok(!h.args.join(" ").match(/--anon|--supabase|--service|sb_/), "sin claves por argv"); assert.ok(!("STAGING_SERVICE_ROLE_KEY" in h.env) && !("STAGING_ANON_KEY" in h.env)); }
  const ev = p.w.eventos; const iF = ev.map((x, i) => (x.startsWith("hijo flujos.mjs") ? i : -1)).filter((i) => i >= 0);
  for (const i of iF.slice(1)) { const entre = ev.slice(iF[iF.indexOf(i) - 1], i); assert.ok(entre.some((x) => x.startsWith("limpiar --aplicar")) && entre.some((x) => x.startsWith("hijo aplicar.mjs --aplicar")), "entre modos: limpieza + re-seed"); }
  assert.match(p.texto(), /Smoke LEGACY[\s\S]*Smoke DUAL[\s\S]*Smoke STRICT/i.source ? /Smoke LEGACY[\s\S]*Smoke DUAL[\s\S]*Smoke STRICT/ : /x/);
});
test("fase 10: un FAIL en un modo detiene TODO (no corre el modo siguiente, no se mezclan resultados) y no corrige nada", async () => {
  const p = await hastaPausa({ flujosFalla: "dual" }); const c = await p.correr(["--continuar"]);
  assert.equal(c, 1, p.texto()); assert.deepEqual(hijo(p, "flujos.mjs").map((h) => h.args[0].slice(8).split("=")[0]), ["legacy", "dual"]); assert.equal(hijo(p, "simular-gps.mjs").length, 1); assert.equal(p.w.appActiva, false);
  const est = JSON.parse(p.w.archivos.get(`${ESTADO}/estado.json`)); assert.ok(est.fase >= 5);
});
test("fase 10: resultados de OTRO modo dentro de la corrida de un modo → FAIL (mezcla); error de GPS → FAIL; no se pasa a strict", async () => {
  const a = await hastaPausa({ flujosMezcla: "legacy" }); assert.equal(await a.correr(["--continuar"]), 1); assert.match(a.texto(), /mezcla/);
  const b = await hastaPausa({ gpsErr: 2 }); assert.equal(await b.correr(["--continuar"]), 1); assert.equal(hijo(b, "flujos.mjs").length, 1);
});
test("fase 10: si no se logra partir de un estado conocido (seed alterado que no se restaura) → STOP INCONCLUSO antes de correr flujos", async () => {
  const p = await hastaPausa(); const orig = p.deps.ejecutarScript;
  p.deps.ejecutarScript = async (x) => { const r = await orig(x); if (x.script.endsWith("aplicar.mjs") && x.args.includes("--aplicar")) p.w.seed = "alterado"; return r; };
  p.w.seed = "alterado"; assert.equal(await p.correr(["--continuar"]), 3); assert.equal(hijo(p, "flujos.mjs").length, 0);
});
test("parsearFlujos / parsearGps: cobertura por área, sin mezcla, exit ≠ 0 y errores", () => {
  const ok = F.parsearFlujos(salidaFlujos("legacy"), 0, "legacy"); assert.equal(ok.estado, "PASS"); assert.ok(ok.cobertura["GPS"].pass >= 1 && ok.cobertura["chat"].pass >= 1 && ok.cobertura["billetera"].pass >= 1); assert.ok(ok.porFlujo.cliente && ok.porFlujo.chofer && ok.porFlujo.admin && ok.porFlujo.auth);
  assert.equal(F.parsearFlujos(salidaFlujos("legacy"), 1, "legacy").estado, "FAIL"); assert.equal(F.parsearFlujos("", 0, "legacy").estado, "INCONCLUSO"); assert.equal(F.parsearFlujos(salidaFlujos("legacy", { fallar: true }), 1, "legacy").estado, "FAIL");
  assert.equal(F.parsearGps(salidaGps(), 0).estado, "PASS"); assert.equal(F.parsearGps(salidaGps(1), 1).estado, "FAIL"); assert.equal(F.parsearGps("", 0).estado, "INCONCLUSO");
});

// ═══════════════ 12. Fase 11: limpieza ═══════════════
test("fase 11: primero DRY-RUN; luego, con --aplicar --confirmar=<host> --incluir-flujos; re-aplica el seed si quedó alterado; verificación final limpia; la app ya está apagada", async () => {
  const p = await hastaPausa(); const c = await p.correr(["--continuar", "--hasta=11"]); assert.equal(c, 0, p.texto());
  const ev = p.w.eventos; const iD = ev.lastIndexOf("limpiar --contar --incluir-flujos"); assert.ok(iD > 0);
  const ult = ev.slice(ev.indexOf("hijo flujos.mjs --modos=strict=http://127.0.0.3:3133"));
  const orden = ult.filter((x) => /^limpiar|aplicar\.mjs/.test(x)); assert.deepEqual(orden, ["limpiar --contar --incluir-flujos", `limpiar --aplicar --confirmar=${HOST} --incluir-flujos`, `hijo aplicar.mjs --aplicar --confirmar=${HOST}`, "limpiar --contar --incluir-flujos"].filter(Boolean).slice(0, 4).map((x) => x));
  assert.equal(p.w.appActiva, false); assert.match(p.texto(), /0 restos V3\/Realtime\/smoke y seed intacto/); assert.equal(p.w.residuos, 0); assert.equal(p.w.seed, "intacto");
});
test("fase 11: dudas del dry-run (elementos no reconocidos) → INCONCLUSO sin borrar; limpieza con error/restos → FAIL; guarda → exit 2", async () => {
  const a = await hastaPausa({ dudas: true }); assert.equal(await a.correr(["--continuar"]), 3, a.texto());
  const b = await hastaPausa({ limpiarCodigo: 1 }); assert.equal(await b.correr(["--continuar"]), 1);
  const c = await hastaPausa({ limpiarCodigo: 2 }); assert.equal(await c.correr(["--continuar"]), 2);
});
test("parsearContar: seed, residuos por clase (sin contar 'corridas') y dudas", () => {
  const p = F.parsearContar(salidaContar(HOST, { residuos: 4, seed: "alterado", dudas: true }));
  assert.equal(p.seed, "alterado"); assert.equal(p.residuos, 4); assert.equal(p.clases.Flujos, 4); assert.equal(p.dudas.length, 1); assert.equal(p.leido, true);
  const ok = F.parsearContar(salidaContar(HOST)); assert.equal(ok.residuos, 0); assert.equal(ok.seed, "intacto"); assert.equal(F.parsearContar("nada").leido, false);
});

// ═══════════════ 13. Fase 12: informe y veredicto ═══════════════
test("corrida completa: exit 0, informe en docs/staging/RESULTADO-FINAL-STAGING.md con todas las secciones y el veredicto EXACTO; sin secretos", async () => {
  const p = await hastaPausa(); const c = await p.correr(["--continuar"]); assert.equal(c, 0, p.texto());
  const md = p.w.archivos.get(norm(join(RAIZ, F.RUTA_INFORME))); assert.ok(md);
  for (const s of ["## Resumen por fase", "## Entorno", "## Seed", "## Secuencias", "## V3", "## Realtime", "## Smoke LEGACY", "## Smoke DUAL", "## Smoke STRICT", "## GPS y chat", "## Limpieza", "## Diferencias encontradas", "## Qué quedó sin verificar", "## Veredicto"]) assert.ok(md.includes(s), s);
  assert.match(md, /\*\*STAGING FUNCIONALMENTE EQUIVALENTE A PRODUCCIÓN EN LAS PRUEBAS DEFINIDAS\*\*/); assert.match(md, /ANON NO RECIBE/); assert.match(md, /INCONCLUSO/); assert.match(md, /no se midió/);
  sinSecretos(md, "informe"); assert.ok(!md.includes(REF_PRODUCCION)); assert.match(p.texto(), /STAGING FUNCIONALMENTE EQUIVALENTE A PRODUCCIÓN EN LAS PRUEBAS DEFINIDAS/);
});
test("el veredicto de equivalencia NO se emite si hay cualquier FAIL / INCONCLUSO / fase sin ejecutar", () => {
  const base = { completa: true, host: HOST, runId: "r", resultados: Object.fromEntries(["fase0", "fase1", "fase2", "fase3", "fase4", "fase6", "fase7", "fase8", "fase9", "fase11", "modo_legacy", "modo_dual", "modo_strict"].map((k) => [k, { estado: "PASS", detalle: "ok" }])) };
  assert.equal(F.veredicto(base).equivalente, true); assert.match(F.generarInforme(base, { fecha: "x" }), /STAGING FUNCIONALMENTE EQUIVALENTE/);
  for (const k of Object.keys(base.resultados)) for (const estado of ["FAIL", "INCONCLUSO"]) {
    const e = { ...base, resultados: { ...base.resultados, [k]: { estado, detalle: "x" } } }; assert.equal(F.veredicto(e).equivalente, false, `${k} ${estado}`);
    const md = F.generarInforme(e, { fecha: "x" }); assert.ok(!md.includes("STAGING FUNCIONALMENTE EQUIVALENTE A PRODUCCIÓN EN LAS PRUEBAS DEFINIDAS**"), `${k} ${estado}`); assert.match(md, /NO SE EMITE VEREDICTO/);
  }
  const falta = { ...base, resultados: { ...base.resultados } }; delete falta.resultados.fase9; assert.equal(F.veredicto(falta).equivalente, false);
  assert.match(F.generarInforme({ ...base, completa: false }, { fecha: "x" }), /CORRIDA PARCIAL/); assert.ok(!F.generarInforme({ ...base, completa: false }, { fecha: "x" }).includes("EQUIVALENTE A PRODUCCIÓN EN LAS PRUEBAS DEFINIDAS**"));
});
test("una corrida que se detiene por FAIL después del seed escribe un informe PARCIAL sin veredicto; una que falla antes del seed (guarda) no escribe informe", async () => {
  const p = await hastaPausa({ v3: { fallar: ["B4"] } }); assert.equal(await p.correr(["--continuar"]), 1);
  const md = p.w.archivos.get(norm(join(RAIZ, F.RUTA_INFORME))); assert.ok(md); assert.match(md, /CORRIDA PARCIAL/); assert.match(md, /NO SE EMITE VEREDICTO/); assert.match(md, /FAIL B4/); assert.match(p.texto(), /limpiar-pruebas\.mjs/);
  const g = mundo({ env: envOk({ SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` }) }); await g.correr([]); assert.ok(![...g.w.archivos.keys()].some((k) => k.includes("RESULTADO-FINAL")));
});

// ═══════════════ 14. Seguridad transversal ═══════════════
test("NINGÚN secreto en ninguna salida, log, estado, informe, argumento ni entorno de hijo indebido (corrida completa con secretos centinela)", async () => {
  const p = await hastaPausa(); await p.correr(["--continuar"]);
  sinSecretos(p.texto(), "salida"); for (const [k, v] of p.w.archivos) sinSecretos(v, k);
  for (const h of p.w.hijos) { sinSecretos(h.args.join(" "), "argv " + h.script); assert.ok(!("TILA_SESSION_SECRET" in h.env) && !("MERCADOPAGO_ACCESS_TOKEN" in h.env), h.script); }
  assert.ok(![...p.w.archivos.keys()].some((k) => !k.startsWith(ESTADO) && !k.endsWith("RESULTADO-FINAL-STAGING.md")), "solo escribe en la carpeta de estado y en el informe");
  assert.ok(!p.texto().includes("Staging-Admin-1234"), "las claves del seed ficticio tampoco se imprimen");
});
test("los secretos que aparezcan en la salida de una herramienta hija se redactan antes de imprimirse o guardarse", async () => {
  const m = mundo({ opc: { deps: {} } }); const orig = m.deps.ejecutarScript;
  m.deps.ejecutarScript = async (x) => { const r = await orig(x); return { ...r, salida: r.salida + `\nfiltrado ${SVC} y ${ANON} y ${SESION} Bearer abcdef1234567890 eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firmafirmafirma` }; };
  await m.correr(["--hasta=3"]); sinSecretos(m.texto()); for (const [k, v] of m.w.archivos) { sinSecretos(v, k); assert.ok(!v.includes("eyJhbGci")); }
});
test("producción JAMÁS: ningún hijo ni módulo recibe argumentos, entorno o URL con el ref/host de producción, en ninguna corrida", async () => {
  const p = await hastaPausa(); await p.correr(["--continuar"]);
  const todo = JSON.stringify([...p.w.hijos, ...p.w.modulos, ...p.w.fetchLlamadas]); assert.ok(!todo.includes(REF_PRODUCCION)); for (const h of HOSTS_PRODUCCION) assert.ok(!todo.includes(h));
});
test("el orquestador solo LEE la base: cero insert/update/delete/upsert/storage.remove/upload desde su propio cliente", async () => {
  const p = await hastaPausa(); await p.correr(["--continuar"]); assert.deepEqual(p.w.be.escrituras, []);
});
test("una señal (Ctrl+C) durante la corrida apaga las instancias, termina INCONCLUSO (3) y NO limpia ni corrige automáticamente", async () => {
  const p = await hastaPausa(); let disparado = false;
  const orig = p.deps.ejecutarScript; p.deps.ejecutarScript = async (x) => { if (x.script.endsWith("flujos.mjs") && !disparado) { disparado = true; p.proceso.emit("SIGINT"); } return orig(x); };
  const c = await p.correr(["--continuar"]); assert.equal(c, 3, p.texto()); assert.equal(p.w.appActiva, false); assert.match(p.texto(), /INTERRUMPIDO/); assert.equal(p.proceso.listenerCount("SIGINT"), 0);
  assert.ok(!p.w.modulos.some((x) => x.m === "limpiar" && x.av.includes("--aplicar")));
});
test("excepción inesperada → exit 1 sin secretos y con la app apagada", async () => {
  const p = await hastaPausa(); p.deps.realtime = async () => { throw new Error(`boom ${SVC}`); };
  const c = await p.correr(["--continuar"]); assert.equal(c, 1); sinSecretos(p.texto()); assert.equal(p.w.appActiva, false);
});
test("entornoHijo: parte de cero (sin heredar), con solo las variables pedidas", () => {
  const cfg = { ref: REF, url: URL_OK, anon: ANON, service: SVC };
  const base = envOk({ AWS_SECRET: "x", NODE_OPTIONS: "--require evil", TILA_SESSION_SECRET: SESION });
  assert.deepEqual(Object.keys(F.entornoHijo(base, cfg, {})).sort(), ["PATH", "STAGING_SUPABASE_URL", "SystemRoot", "TILA_ENTORNO", "TILA_STAGING_SUPABASE_REF"].sort());
  const c = F.entornoHijo(base, cfg, { service: true, anon: true }); assert.equal(c.STAGING_SERVICE_ROLE_KEY, SVC); assert.equal(c.STAGING_ANON_KEY, ANON); assert.ok(!("AWS_SECRET" in c) && !("NODE_OPTIONS" in c));
});
// ═══════════════ 12. Diagnóstico de hijos que fallan + heredar el flag de certificados del sistema ═══════════════
const SALIDA_FALLO = [
  "(node:23816) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///C:/repo/app/lib/tarifas.ts is not specified",
  "Reparsing as ES module because module syntax was detected. This incurs a performance overhead.",
  "(Use `node --trace-warnings ...` to show where the warning was created)",
  `destino: ${HOST} | clave: ${SVC} | modo: APLICAR`,
  "  bucket documentacion-choferes: (fetch failed; causa: UNABLE_TO_VERIFY_LEAF_SIGNATURE)",
  "[error] name: Error",
  "[error] message: [storage documentacion-choferes/x/dni_frente.png] fetch failed",
  "[error] cause.code: UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "[error] cause.message: unable to verify the first certificate",
  `Authorization: Bearer ${SVC}`,
  `apikey: ${ANON}`,
  "cookie: sb-access-token=abc123secreto",
  `clave de sesión filtrada: ${SESION} y token ${MP}`,
].join("\n");
test("hijo con exit ≠ 0: muestra la ruta del log y las últimas líneas ya REDACTADAS (sin ruido, sin secretos) y hace STOP inmediato", async () => {
  const m = mundo({ opc: { aplicarCodigo: 1, aplicarSalida: SALIDA_FALLO } }); const c = await m.correr([]); const t = m.texto();
  assert.equal(c, 1, t);
  assert.ok(norm(t).includes(`${ESTADO}/logs/fase4-seed-aplicar.txt`), "muestra la ruta del log local");
  for (const s of ["cause.code: UNABLE_TO_VERIFY_LEAF_SIGNATURE", "cause.message: unable to verify the first certificate", "fetch failed", "últimas líneas de «fase4-seed-aplicar»"]) assert.ok(t.includes(s), s);
  assert.ok(!/MODULE_TYPELESS|Reparsing|trace-warnings/.test(t), "sin ruido de warnings");
  sinSecretos(t); assert.ok(!t.includes("abc123secreto"), "cookie redactada"); assert.match(t, /Authorization: \[REDACTADO\]/i);
  const log = m.w.archivos.get(`${ESTADO}/logs/fase4-seed-aplicar.txt`); assert.ok(log.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE")); sinSecretos(log, "log"); assert.ok(!log.includes("abc123secreto"));
  assert.match(t, /aplicar\.mjs --aplicar terminó con exit 1/, "el STOP se mantiene");
  assert.deepEqual(m.w.eventos.filter((x) => /levantar|realtime|v3|flujos|pegado|limpiar/.test(x)), []); assert.ok(!t.includes("SEED APLICADO CORRECTAMENTE"), "no llega a la pausa (fase 5)"); assert.equal(m.w.archivos.has(`${ESTADO}/estado.json`), false);
});
test("hijo con TIMEOUT o sin salida: también muestra el log; y si el log no se pudo escribir lo dice", async () => {
  const a = mundo({ opc: { aplicarCodigo: 1, aplicarAgotado: true, aplicarSalida: "" } }); assert.equal(await a.correr([]), 3); assert.match(a.texto(), /log local \(redactado\):/); assert.match(a.texto(), /no produjo salida/);
  const b = mundo({ opc: { aplicarCodigo: 1, aplicarSalida: "algo" } }); b.deps.fs = { ...b.deps.fs, writeFileSync: () => { throw new Error("disco lleno"); } };
  assert.equal(await b.correr([]), 1); assert.match(b.texto(), /\(NO se pudo guardar\)/);
});
test("ultimasLineasRelevantes: descarta el ruido de Node, conserva solo las últimas N y acota el largo; ocultarCabeceras tapa Authorization/apikey/cookie", () => {
  const l = F.ultimasLineasRelevantes(["(node:1) [MODULE_TYPELESS_PACKAGE_JSON] Warning: x", "", ...Array.from({ length: 30 }, (_, i) => `l${i}`), "x".repeat(500)].join("\n"), 5);
  assert.equal(l.length, 5); assert.equal(l[3], "l29"); assert.ok(l[4].length <= 301 && l[4].endsWith("…")); assert.ok(!l.some((x) => /MODULE_TYPELESS/.test(x)));
  const t = F.ocultarCabeceras("Authorization: Bearer zzz\nAPIKEY=abc\nSet-Cookie: s=1\ncookie: a=b\nsolo cookie: 200 y sigue"); assert.ok(!/zzz|abc|s=1|a=b/.test(t)); assert.ok(t.includes("solo cookie: 200 y sigue"), "no rompe texto normal");
});
test("cada fase con hijo (3, 4 y V3 en --continuar) que falle con exit ≠ 0 o TIMEOUT DETIENE la corrida: ninguna fase posterior corre", async () => {
  const despues = /levantar|realtime|flujos|limpiar|pegado/;
  for (const cod of [1, 2]) { // fase 3 (dry-run del seed)
    const m = mundo({ opc: { deps: { ejecutarScript: async () => ({ codigo: cod, salida: "x", agotado: false }) } } }); assert.equal(await m.correr([]), cod); assert.deepEqual(m.w.modulos.map((x) => x.av[0]), ["--local", "--remoto"]); assert.equal(m.w.be.lecturas.length, 0, "no llega a la fase 4");
  }
  for (const [opc, esperado] of [[{ aplicarCodigo: 1 }, 1], [{ aplicarCodigo: 2 }, 2], [{ aplicarCodigo: 1, aplicarAgotado: true }, 3]]) { // fase 4 (aplicar)
    const m = mundo({ opc }); assert.equal(await m.correr([]), esperado, JSON.stringify(opc)); assert.equal(hijo(m, "aplicar.mjs", (h) => h.args.includes("--aplicar")).length, 1, "sin reintento"); assert.deepEqual(m.w.be.lecturas.filter((t) => t !== "usuarios"), [], "no verifica ni continúa");
    assert.ok(!m.w.eventos.some((x) => despues.test(x))); assert.equal(m.w.archivos.has(`${ESTADO}/estado.json`), false);
  }
  const v3 = await hastaPausa(); v3.deps.ejecutarScript = async ({ script }) => ({ codigo: script.endsWith("v3-anon.mjs") ? 1 : 0, salida: "boom", agotado: false }); // fase 7 (V3)
  assert.ok([1, 3].includes(await v3.correr(["--continuar"])), "FAIL o INCONCLUSO, nunca 0"); assert.ok(!v3.w.eventos.some((x) => /levantar|realtime|flujos|limpiar/.test(x)), "V3 con exit ≠ 0: no se levanta la app ni se sigue");
});
test("TLS: NODE_OPTIONS=--use-system-ca llega a TODOS los hijos como argumento de node (no como NODE_OPTIONS), sin desactivar TLS ni heredar el resto", async () => {
  for (const [nombre, env, execArgv] of [["NODE_OPTIONS", envOk({ NODE_OPTIONS: "--use-system-ca" }), []], ["mezclado con opciones peligrosas", envOk({ NODE_OPTIONS: "--require evil.js --use-system-ca --inspect" }), []], ["execArgv del padre", envOk(), ["--use-system-ca"]]]) {
    const m = mundo({ env }); m.deps.execArgv = execArgv; const c = await m.correr(["--hasta=4"]); assert.equal(c, 0, m.texto());
    assert.ok(m.w.hijos.length >= 2, nombre);
    for (const h of m.w.hijos) { assert.deepEqual(h.nodeArgs, ["--use-system-ca"], `${nombre}: ${h.script}`); assert.ok(!("NODE_OPTIONS" in h.env) && !("NODE_TLS_REJECT_UNAUTHORIZED" in h.env) && !("NODE_EXTRA_CA_CERTS" in h.env), "el env del hijo sigue armado desde cero"); }
  }
  const sin = mundo({ env: envOk({ NODE_OPTIONS: "--require evil.js", NODE_TLS_REJECT_UNAUTHORIZED: "0" }) }); await sin.correr(["--hasta=4"]);
  for (const h of sin.w.hijos) assert.deepEqual(h.nodeArgs, [], "sin el flag en el padre no se inventa ni se cuela otro");
});
test("argsNodeHijo: solo --use-system-ca es heredable; jamás --require, --inspect, --disable-warning ni desactivar TLS", () => {
  assert.deepEqual(F.argsNodeHijo({ NODE_OPTIONS: "--use-system-ca" }), ["--use-system-ca"]); assert.deepEqual(F.argsNodeHijo({ NODE_OPTIONS: "  --max-old-space-size=4096   --use-system-ca " }), ["--use-system-ca"]);
  assert.deepEqual(F.argsNodeHijo({}, ["--use-system-ca", "--inspect"]), ["--use-system-ca"]); assert.deepEqual(F.argsNodeHijo({ NODE_OPTIONS: "--use-system-ca" }, ["--use-system-ca"]), ["--use-system-ca"], "sin duplicados");
  for (const e of [{}, { NODE_OPTIONS: "" }, { NODE_OPTIONS: "--require evil.js" }, { NODE_OPTIONS: "--use-system-cax" }, { NODE_OPTIONS: "--use-openssl-ca" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, null, undefined]) assert.deepEqual(F.argsNodeHijo(e), []);
  assert.deepEqual([...F.FLAGS_NODE_HEREDABLES], ["--use-system-ca"]);
});
test("TLS (real): depsReales().ejecutarScript lanza node CON --use-system-ca como argumento; el hijo lo ve en execArgv y un exit ≠ 0 vuelve con su salida", { skip: !process.allowedNodeEnvironmentFlags.has("--use-system-ca") }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "tila-hijo-")); writeFileSync(join(dir, "sonda.mjs"), 'console.log("EXECARGV=" + JSON.stringify(process.execArgv) + " NODE_OPTIONS=" + (process.env.NODE_OPTIONS ?? "(no)")); process.exit(7);');
  try {
    const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" };
    const con = await F.depsReales().ejecutarScript({ script: "sonda.mjs", args: [], env, timeoutMs: 20000, cwd: dir, nodeArgs: F.argsNodeHijo({ NODE_OPTIONS: "--use-system-ca" }) });
    assert.equal(con.codigo, 7); assert.match(con.salida, /EXECARGV=\["--use-system-ca"\] NODE_OPTIONS=\(no\)/);
    const sin = await F.depsReales().ejecutarScript({ script: "sonda.mjs", args: [], env, timeoutMs: 20000, cwd: dir }); assert.match(sin.salida, /EXECARGV=\[\] NODE_OPTIONS=\(no\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("auditoría estática: sin pg/RPC/setval/psql, sin shell, sin 0.0.0.0 como destino, sin lectura del SQL 09, spawn solo de node, imports acotados, process.env solo en depsReales", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const cod = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
  assert.ok(!/from "pg"|from "postgres"|\.rpc\(|setval\(|psql|shell\s*:\s*true|(?<![.\w])exec(Sync)?\(|DATABASE_URL|TRUNCATE\s|truncate\(/i.test(cod.replace(/"[^"\n]*(TRUNCATE|setval|pg|RPC)[^"\n]*"/gi, '""').replace(/`[^`\n]*(TRUNCATE|setval|pg|RPC)[^`\n]*`/gi, "``")));
  assert.equal((cod.match(/spawn\(/g) ?? []).length, 1); assert.match(cod, /spawn\(process\.execPath, \[\.\.\.nodeArgs, resolve\(cwd, script\)/);
  assert.ok(!/readFileSync\([^)]*RUTA_SQL_09|readFileSync\([^)]*09-secuencias/.test(cod)); assert.ok(!/["'`]-H["'`]\s*,\s*["'`]0\.0\.0\.0/.test(cod));
  const usos = cod.split("\n").filter((l) => l.includes("process.env")); assert.ok(usos.length === 1 && /env: process\.env/.test(usos[0]), usos.join("|"));
  const imports = [...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./guardas.mjs", "./levantar-staging.mjs", "./limpiar-pruebas.mjs", "./seed/datos.mjs", "./seed/secuencias.mjs", "./smoke/realtime.mjs", "./smoke/v3-anon.mjs", "./verificar-entorno.mjs",
    "@supabase/supabase-js", "node:child_process", "node:crypto", "node:events", "node:fs", "node:os", "node:path", "node:url"].sort());
  assert.ok(!REF_PRODUCCION || !cod.includes(REF_PRODUCCION), "el ref de producción no está escrito en el orquestador");
  const fuera = cod.replace(/export const TIMEOUTS = Object\.freeze\(\{[\s\S]*?\}\);/, ""); assert.ok(!/setTimeout\([^)]*,\s*\d{2,}/.test(fuera), "tiempos solo en TIMEOUTS");
});
test("códigos de salida alcanzables: 0, 1, 2, 3 y 4", async () => {
  const p = await hastaPausa();
  const cods = [await p.correr(["--continuar"]), await mundo({ opc: { aplicarCodigo: 1 } }).correr([]), await mundo({ env: {} }).correr([]), await mundo({ opc: { verificar: { "--remoto": 3 } } }).correr([]), await mundo().correr([])];
  assert.deepEqual(cods, [0, 1, 2, 3, 4]);
});
