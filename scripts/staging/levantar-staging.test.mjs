// Tests LOCALES de levantar-staging.mjs. No usan red, ni claves reales, ni Supabase, ni `next build`, ni Next, ni puertos, ni .env.staging (el reproductor del Worker de Next está en levantar-staging-worker.test.mjs):
// el sistema de archivos, los procesos, fetch, el chequeo de puertos y las señales son FALSOS y en memoria.
// Ejecutar: node --test scripts/staging/levantar-staging.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./levantar-staging.mjs";
import { REF_PRODUCCION, HOSTS_PRODUCCION } from "./guardas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(AQUI, "levantar-staging.mjs");

const REF = "abcdefghij0123456789";
const URL_OK = `https://${REF}.supabase.co`;
const ANON = "sb_publishable_TEST0123456789abcdefABCDEF";
const SVC = "sb_secret_TEST0123456789abcdefABCDEF";
const SESION = "S".repeat(20) + "e".repeat(30);
const MP = "TEST-0123456789-fake-token-abcdef";
const VALOR_DE_ENV_LOCAL = "VALOR-DE-PRODUCCION-EN-ENV-LOCAL-12345";
const TODOS_LOS_SECRETOS = [ANON, SVC, SESION, MP, VALOR_DE_ENV_LOCAL];

const envOk = (extra = {}) => ({
  PATH: "C:\\fake\\bin", Path: undefined, SystemRoot: "C:\\Windows", TEMP: "C:\\tmp",
  TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: REF,
  NEXT_PUBLIC_SUPABASE_URL: URL_OK, SUPABASE_URL: URL_OK,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SVC,
  TILA_SESSION_SECRET: SESION, NEXT_PUBLIC_BASE_URL: "http://127.0.0.1:3131",
  ...extra,
});
const sin = (env, ...nombres) => { const e = { ...env }; for (const n of nombres) delete e[n]; return e; };
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firmaFalsaFirmaFalsa1234`;

// ═══════════════ Falsos ═══════════════
/** FS falso: rutas con "/" → contenido. Soporta readdirSync (con y sin withFileTypes), readFileSync, existsSync. */
function fsFalso(archivos = {}) {
  const norm = (p) => String(p).replaceAll("\\", "/").replace(/\/+$/, "");
  const mapa = new Map(Object.entries(archivos).map(([k, v]) => [norm(k), v]));
  const hijosDe = (dir) => {
    const d = norm(dir) + "/"; const nombres = new Map();
    for (const k of mapa.keys()) if (k.startsWith(d)) { const resto = k.slice(d.length); const [n, ...r] = resto.split("/"); nombres.set(n, r.length > 0); }
    return nombres;
  };
  return {
    existsSync: (p) => mapa.has(norm(p)) || hijosDe(p).size > 0,
    readdirSync: (dir, op) => {
      const h = hijosDe(dir);
      if (!h.size) throw new Error("ENOENT");
      return [...h].map(([name, esDir]) => (op?.withFileTypes ? { name, isDirectory: () => esDir } : name));
    },
    readFileSync: (p) => { const v = mapa.get(norm(p)); if (v === undefined) throw new Error("ENOENT"); return typeof v === "string" ? Buffer.from(v) : v; },
  };
}
const RAIZ = "C:/repo";
const NEXT_BIN = `${RAIZ}/node_modules/next/dist/bin/next`;
const fsBase = (extra = {}) => fsFalso({
  [NEXT_BIN]: "// next",
  [`${RAIZ}/.env.local`]: `# prod\nMERCADOPAGO_ACCESS_TOKEN=${VALOR_DE_ENV_LOCAL}\nexport TILA_ENTORNO_PROD=1\nSUPABASE_URL=https://${REF_PRODUCCION}.supabase.co\nOTRA_VARIABLE_RARA=${VALOR_DE_ENV_LOCAL}\n`,
  [`${RAIZ}/app/.env.local`]: `VAR_EN_APP=${VALOR_DE_ENV_LOCAL}\n`,
  [`${RAIZ}/.next/static/chunks/a.js`]: `fetch("${URL_OK}")`,
  [`${RAIZ}/.next/server/app/b.js`]: "console.log(1)",
  ...extra,
});

class Hijo extends EventEmitter {
  constructor(pid, args, opts) { super(); this.pid = pid; this.args = args; this.opts = opts; this.stdout = new EventEmitter(); this.stderr = new EventEmitter(); this.muerto = false; }
  terminar(codigo = 0, senal = null) { if (this.muerto) return; this.muerto = true; this.emit("exit", codigo, senal); }
}

/** Dependencias falsas. `guion` permite personalizar el comportamiento. */
function depsFalsas({ env = envOk(), fs = fsBase(), puertoOcupado = [], buildCodigo = 0, fetchOk = true, sondaStatus = 200, extra = {} } = {}) {
  const salida = []; const errores = []; const spawns = []; const matados = []; const eventos = []; const llamadasFetch = [];
  const proceso = new EventEmitter();
  let pid = 1000;
  const d = {
    env, fs, raiz: RAIZ, nextBin: NEXT_BIN, execPath: "C:/node.exe",
    out: (l) => salida.push(String(l)), err: (l) => errores.push(String(l)),
    proceso,
    puertoLibre: async (host, puerto) => { eventos.push(`puerto:${host}:${puerto}`); return !puertoOcupado.includes(puerto); },
    spawn: (cmd, args, opts) => {
      const h = new Hijo(++pid, args, opts); h.cmd = cmd; spawns.push(h);
      const esBuild = args[args.indexOf(NEXT_BIN) + 1] === "build"; eventos.push(esBuild ? "spawn:build" : `spawn:start:${args[args.indexOf("-p") + 1]}`);
      if (esBuild) setImmediate(() => h.terminar(buildCodigo));
      return h;
    },
    matarArbol: (proc) => { matados.push(proc.pid); setImmediate(() => proc.terminar(1, "SIGTERM")); },
    fetch: async (u, init) => { llamadasFetch.push({ url: String(u), init }); return String(u).includes(L.RUTA_SONDA) ? { ok: sondaStatus === 200, status: sondaStatus } : { ok: fetchOk, status: fetchOk ? 200 : 503 }; },
    sleep: async () => {}, intentos: 3, esperaMs: 0,
    ...extra,
  };
  return { d, salida, errores, spawns, matados, eventos, proceso, llamadasFetch };
}
const todo = (x) => [...x.salida, ...x.errores].join("\n");
const sinSecretos = (texto) => { for (const s of TODOS_LOS_SECRETOS) assert.ok(!texto.includes(s), `se filtró un secreto (${s.slice(0, 6)}…)`); };
const tick = () => new Promise((r) => setImmediate(r));

// ═══════════════ 1. Configuración de modos / hosts / puertos ═══════════════
test("modos: 3 instancias, hosts loopback distintos, puertos 3131/3132/3133, nunca 0.0.0.0", () => {
  assert.deepEqual(L.MODOS.map((m) => [m.modo, m.host, m.puerto]), [["legacy", "127.0.0.1", 3131], ["dual", "127.0.0.2", 3132], ["strict", "127.0.0.3", 3133]]);
  assert.deepEqual(L.validarModos(), []);
  assert.equal(new Set(L.MODOS.map((m) => m.host)).size, 3);
  assert.ok(L.MODOS.every((m) => m.host.startsWith("127.")));
});
test("validarModos rechaza 0.0.0.0, hosts repetidos, no-loopback, localhost, puertos repetidos y cantidad distinta de 3", () => {
  const M = (o) => L.MODOS.map((m, i) => ({ ...m, ...(o[i] ?? {}) }));
  assert.ok(L.validarModos(M([{ host: "0.0.0.0" }])).some((e) => e.includes("expone")));
  assert.ok(L.validarModos(M([{}, { host: "127.0.0.1" }])).some((e) => e.includes("host repetido")));
  assert.ok(L.validarModos(M([{ host: "192.168.1.5" }])).some((e) => e.includes("loopback")));
  assert.ok(L.validarModos(M([{ host: "localhost" }])).some((e) => e.includes("loopback")));
  assert.ok(L.validarModos(M([{}, { puerto: 3131 }])).some((e) => e.includes("puerto repetido")));
  assert.ok(L.validarModos(M([{ puerto: 80 }])).some((e) => e.includes("puerto inválido")));
  assert.ok(L.validarModos(L.MODOS.slice(0, 2)).some((e) => e.includes("exactamente 3")));
});
test("validarConfig propaga los errores de modos incorrectos", () => {
  const r = L.validarConfig(envOk(), { modos: [{ modo: "legacy", host: "0.0.0.0", puerto: 3131 }, L.MODOS[1], L.MODOS[2]] });
  assert.ok(r.errores.length && r.cfg === null);
});

// ═══════════════ 2. Guardas de configuración ═══════════════
test("configuración válida: sin errores, cfg con solo variables de staging", () => {
  const r = L.validarConfig(envOk());
  assert.deepEqual(r.errores, []);
  assert.equal(r.cfg.ref, REF); assert.equal(r.cfg.supabaseHost, `${REF}.supabase.co`);
  assert.equal(r.cfg.vars.SUPABASE_SERVICE_ROLE_KEY, SVC);
});
for (const n of L.REQUERIDAS) {
  test(`variable obligatoria ausente → rechaza: ${n}`, () => {
    const r = L.validarConfig(sin(envOk(), n));
    assert.ok(r.errores.some((e) => e.includes(n)), r.errores.join("|"));
    assert.equal(r.cfg, null);
  });
  test(`variable obligatoria vacía → rechaza: ${n}`, () => {
    assert.ok(L.validarConfig(envOk({ [n]: "  " })).errores.length > 0);
  });
}
test("TILA_ENTORNO distinto de staging (local, produccion, undefined) → rechaza", () => {
  for (const v of ["local", "production", "produccion", "Staging", undefined]) assert.ok(L.validarConfig(envOk({ TILA_ENTORNO: v })).errores.some((e) => e.includes("TILA_ENTORNO")), String(v));
});
test("ref de producción → rechaza (en ref, en URLs y mezclado)", () => {
  assert.ok(L.validarConfig(envOk({ TILA_STAGING_SUPABASE_REF: REF_PRODUCCION })).errores.some((e) => e.includes("PRODUCCIÓN")));
  const prod = `https://${REF_PRODUCCION}.supabase.co`;
  const r = L.validarConfig(envOk({ TILA_STAGING_SUPABASE_REF: REF_PRODUCCION, NEXT_PUBLIC_SUPABASE_URL: prod, SUPABASE_URL: prod }));
  assert.ok(r.errores.length >= 3 && r.cfg === null);
});
test("URL apunta a producción → rechaza, aunque el ref declarado sea de staging", () => {
  const prod = `https://${REF_PRODUCCION}.supabase.co`;
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_URL: prod })).errores.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_URL")));
  assert.ok(L.validarConfig(envOk({ SUPABASE_URL: prod })).errores.some((e) => e.includes("SUPABASE_URL")));
});
test("ref de la URL ≠ TILA_STAGING_SUPABASE_REF → rechaza (URL y ref incoherentes)", () => {
  const otra = "https://zzzzzzzzzz0123456789.supabase.co";
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_URL: otra })).errores.some((e) => e.includes("no coincide")));
  assert.ok(L.validarConfig(envOk({ SUPABASE_URL: otra })).errores.some((e) => e.includes("no coincide")));
});
test("NEXT_PUBLIC_SUPABASE_URL ≠ SUPABASE_URL → rechaza", () => {
  const r = L.validarConfig(envOk({ SUPABASE_URL: "https://zzzzzzzzzz0123456789.supabase.co" }));
  assert.ok(r.errores.some((e) => e.includes("misma URL")));
});
test("URL malformada: http, puerto, ruta, credenciales, no-URL, host ajeno → rechaza", () => {
  for (const u of [`http://${REF}.supabase.co`, `https://${REF}.supabase.co:8443`, `https://${REF}.supabase.co/rest/v1`, `https://u:p@${REF}.supabase.co`, "no-es-url", "https://ejemplo.com", `https://${REF}.supabase.co?x=1`]) {
    assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_URL: u, SUPABASE_URL: u })).errores.length > 0, u);
  }
});
test("ref inválido: lista con comas, espacios, mayúsculas, comentario → rechaza", () => {
  for (const r of [`${REF},otro`, `${REF} # comentario`, REF.toUpperCase(), "corto"]) assert.ok(L.validarConfig(envOk({ TILA_STAGING_SUPABASE_REF: r })).errores.some((e) => e.includes("TILA_STAGING_SUPABASE_REF")), r);
});
test("claves: anon secreta, service pública, iguales, cortas, con espacios/comillas → rechaza", () => {
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: SVC })).errores.some((e) => e.includes("SECRETA")));
  assert.ok(L.validarConfig(envOk({ SUPABASE_SERVICE_ROLE_KEY: ANON })).errores.some((e) => e.includes("PÚBLICA")));
  assert.ok(L.validarConfig(envOk({ SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: REF }), NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "service_role", ref: REF }) })).errores.length > 0);
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "corta" })).errores.some((e) => e.includes("corta")));
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: `"${ANON}"` })).errores.some((e) => e.includes("comillas")));
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "sin formato conocido de clave aqui" })).errores.length > 0);
});
test("claves JWT: rol correcto y ref de staging → OK; ref de producción / otro ref / sin ref / rol cambiado → rechaza", () => {
  const ok = L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon", ref: REF }), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: REF }) }));
  assert.deepEqual(ok.errores, []);
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon", ref: REF_PRODUCCION }) })).errores.some((e) => e.includes("PRODUCCIÓN")));
  assert.ok(L.validarConfig(envOk({ SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: REF_PRODUCCION }) })).errores.some((e) => e.includes("PRODUCCIÓN")));
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon", ref: "otroref0123456789xyz" }) })).errores.some((e) => e.includes("no coincide")));
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon" }) })).errores.some((e) => e.includes("ref")));
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "service_role", ref: REF }) })).errores.some((e) => e.includes("rol")));
  assert.ok(L.validarConfig(envOk({ SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "anon", ref: REF }) })).errores.some((e) => e.includes("rol")));
});
test("TILA_SESSION_SECRET: corto, con espacios, reutiliza clave de Supabase → rechaza", () => {
  assert.ok(L.validarConfig(envOk({ TILA_SESSION_SECRET: "x".repeat(31) })).errores.some((e) => e.includes("32")));
  assert.ok(L.validarConfig(envOk({ TILA_SESSION_SECRET: "x".repeat(20) + " " + "y".repeat(20) })).errores.some((e) => e.includes("espacios")));
  assert.ok(L.validarConfig(envOk({ TILA_SESSION_SECRET: SVC.padEnd(32, "x"), SUPABASE_SERVICE_ROLE_KEY: SVC.padEnd(32, "x") })).errores.some((e) => e.includes("reutilizar")));
});
test("NEXT_PUBLIC_BASE_URL: app de producción / host remoto no declarado / no-URL → rechaza; loopback y host declarado → OK", () => {
  for (const u of ["https://tila-logistica.vercel.app", "https://tila-logistica.vercel.app/x", "https://otro.example.com", "no-url", "ftp://127.0.0.1"]) {
    assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_BASE_URL: u })).errores.length > 0, u);
  }
  assert.deepEqual(L.validarConfig(envOk({ NEXT_PUBLIC_BASE_URL: "http://localhost:3131" })).errores, []);
  assert.deepEqual(L.validarConfig(envOk({ NEXT_PUBLIC_BASE_URL: "https://tila-staging.vercel.app", TILA_STAGING_APP_HOSTS: "tila-staging.vercel.app" })).errores, []);
});
test("cualquier variable explícita con ref/host de producción → rechaza (sin nombrar su valor)", () => {
  for (const n of ["GOOGLE_SERVER_API_KEY", "MERCADOPAGO_WEBHOOK_SECRET", "NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID"]) {
    const r = L.validarConfig(envOk({ [n]: `algo-${REF_PRODUCCION}-algo` }));
    assert.ok(r.errores.some((e) => e.includes(n) && e.includes("PRODUCCIÓN")), n);
    assert.ok(!r.errores.join("\n").includes(REF_PRODUCCION), "el mensaje no debe repetir el valor");
  }
  assert.ok(L.validarConfig(envOk({ NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: "https://tila-logistica.vercel.app" })).errores.length > 0);
});
test("MERCADOPAGO_ACCESS_TOKEN de producción (APP_USR-) → rechaza; TEST- → OK", () => {
  assert.ok(L.validarConfig(envOk({ MERCADOPAGO_ACCESS_TOKEN: "APP_USR-123456789-real" })).errores.some((e) => e.includes("APP_USR")));
  assert.deepEqual(L.validarConfig(envOk({ MERCADOPAGO_ACCESS_TOKEN: MP })).errores, []);
});
test("NODE_TLS_REJECT_UNAUTHORIZED=0 → rechaza", () => {
  assert.ok(L.validarConfig(envOk({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })).errores.some((e) => e.includes("TLS")));
});
test("referencias ${…}: se resuelven contra el entorno; las no resueltas se rechazan", () => {
  const conRef = envOk({ STAGING_SUPABASE_URL: URL_OK, STAGING_ANON_KEY: ANON, STAGING_SERVICE_ROLE_KEY: SVC, NEXT_PUBLIC_SUPABASE_URL: "${STAGING_SUPABASE_URL}", SUPABASE_URL: "${STAGING_SUPABASE_URL}", NEXT_PUBLIC_SUPABASE_ANON_KEY: "${STAGING_ANON_KEY}", SUPABASE_SERVICE_ROLE_KEY: "${STAGING_SERVICE_ROLE_KEY}" });
  const r = L.validarConfig(conRef);
  assert.deepEqual(r.errores, []); assert.equal(r.cfg.vars.SUPABASE_URL, URL_OK); assert.equal(r.cfg.vars.NEXT_PUBLIC_SUPABASE_ANON_KEY, ANON);
  const rota = L.validarConfig(envOk({ NEXT_PUBLIC_SUPABASE_URL: "${NO_EXISTE}", SUPABASE_URL: "${NO_EXISTE}", NEXT_PUBLIC_SUPABASE_ANON_KEY: "${NO_EXISTE}" }));
  assert.ok(rota.errores.length >= 2 && rota.cfg === null);
});
test("coherencia con STAGING_*: si están definidas y difieren de las de la app → rechaza", () => {
  assert.ok(L.validarConfig(envOk({ STAGING_SUPABASE_URL: "https://zzzzzzzzzz0123456789.supabase.co" })).errores.some((e) => e.includes("incoherente")));
  assert.ok(L.validarConfig(envOk({ STAGING_ANON_KEY: "sb_publishable_OTRA0123456789abcdef" })).errores.some((e) => e.includes("incoherente")));
  assert.ok(L.validarConfig(envOk({ STAGING_SERVICE_ROLE_KEY: "sb_secret_OTRA0123456789abcdefghij" })).errores.some((e) => e.includes("incoherente")));
  assert.deepEqual(L.validarConfig(envOk({ STAGING_SUPABASE_URL: URL_OK + "/", STAGING_ANON_KEY: ANON, STAGING_SERVICE_ROLE_KEY: SVC })).errores, []);
});
test("no hay fallback silencioso: sin URL de app vars, las STAGING_* NO se usan de reemplazo", () => {
  const e = sin(envOk({ STAGING_SUPABASE_URL: URL_OK }), "SUPABASE_URL");
  assert.ok(L.validarConfig(e).errores.some((x) => x.includes("Falta la variable obligatoria SUPABASE_URL")));
});
test("TILA_AUTH_MODE presente en el entorno se ignora con aviso (el launcher la fija por instancia)", () => {
  const r = L.validarConfig(envOk({ TILA_AUTH_MODE: "strict" }));
  assert.deepEqual(r.errores, []); assert.ok(r.avisos.some((a) => a.includes("TILA_AUTH_MODE")));
});

// ═══════════════ 3. Entorno de los hijos: sin herencia y sin contaminación por .env.local ═══════════════
test("nombresEnArchivosEnv: solo NOMBRES (no valores), de raíz y app/, ignora comentarios", () => {
  const n = L.nombresEnArchivosEnv(fsBase(), [RAIZ, `${RAIZ}/app`]);
  for (const esperado of ["MERCADOPAGO_ACCESS_TOKEN", "TILA_ENTORNO_PROD", "SUPABASE_URL", "OTRA_VARIABLE_RARA", "VAR_EN_APP"]) assert.ok(n.has(esperado), esperado);
  assert.ok(![...n].some((x) => x.includes(VALOR_DE_ENV_LOCAL)));
  assert.ok(!n.has("prod"));
});
test("construirEntorno: NO hereda process.env (basura del shell, NODE_OPTIONS, proxies, SUPABASE_* de prod, AWS…)", () => {
  const { cfg } = L.validarConfig(envOk());
  const base = envOk({ AWS_SECRET_ACCESS_KEY: "aws-secreto", NODE_OPTIONS: "--require evil.js", HTTPS_PROXY: "http://proxy", GITHUB_TOKEN: "ghp_x", SUPABASE_ACCESS_TOKEN: "sbp_x", STAGING_ANON_KEY: ANON });
  const e = L.construirEntorno(base, cfg, "legacy", new Set());
  for (const n of ["AWS_SECRET_ACCESS_KEY", "HTTPS_PROXY", "GITHUB_TOKEN", "SUPABASE_ACCESS_TOKEN", "STAGING_ANON_KEY", "TILA_STAGING_APP_HOSTS"]) assert.ok(!(n in e), n);
  assert.equal(e.NODE_OPTIONS, "--use-system-ca", "el NODE_OPTIONS del shell (--require evil.js) NO se hereda: el hijo recibe la constante del launcher");
  assert.equal(e.PATH, "C:\\fake\\bin"); assert.equal(e.SystemRoot, "C:\\Windows");
});
test("construirEntorno: un SUPABASE_URL de producción en el shell no llega a los hijos (se usa el validado)", () => {
  const { cfg } = L.validarConfig(envOk());
  const e = L.construirEntorno({ ...envOk(), SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` }, cfg, "dual", new Set());
  assert.equal(e.SUPABASE_URL, URL_OK);
});
test("construirEntorno: placeholders NO vacíos para nombres de .env.local y opcionales ausentes (anti-contaminación)", () => {
  const { cfg } = L.validarConfig(envOk());
  const nombres = L.nombresEnArchivosEnv(fsBase(), [RAIZ, `${RAIZ}/app`]);
  const e = L.construirEntorno(envOk(), cfg, "strict", nombres);
  for (const n of ["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET", "GOOGLE_SERVER_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "OTRA_VARIABLE_RARA", "VAR_EN_APP", "TILA_ENTORNO_PROD"]) assert.equal(e[n], L.PLACEHOLDER, n);
  assert.ok(Object.values(e).every((v) => typeof v === "string" && v !== ""), "ningún valor vacío (@next/env borra las claves con valor inicial vacío)");
  assert.ok(!Object.values(e).some((v) => String(v).includes(VALOR_DE_ENV_LOCAL) || String(v).includes(REF_PRODUCCION)));
  assert.equal(e.SUPABASE_URL, URL_OK); // aunque .env.local lo defina, gana la variable explícita de staging
});
test("construirEntorno: una opcional CONFIGURADA gana al placeholder", () => {
  const { cfg } = L.validarConfig(envOk({ MERCADOPAGO_ACCESS_TOKEN: MP }));
  const e = L.construirEntorno(envOk(), cfg, "legacy", new Set(["MERCADOPAGO_ACCESS_TOKEN"]));
  assert.equal(e.MERCADOPAGO_ACCESS_TOKEN, MP);
});
test("construirEntorno: TILA_AUTH_MODE por modo; NEXT_PUBLIC_* y secreto de sesión idénticos → un build sirve a los 3", () => {
  const { cfg } = L.validarConfig(envOk({ TILA_AUTH_MODE: "strict" })); // el de fuera se ignora
  const por = Object.fromEntries(L.MODOS.map(({ modo }) => [modo, L.construirEntorno(envOk({ TILA_AUTH_MODE: "strict" }), cfg, modo, new Set())]));
  assert.deepEqual(Object.values(por).map((e) => e.TILA_AUTH_MODE), ["legacy", "dual", "strict"]);
  for (const n of Object.keys(por.legacy).filter((k) => k.startsWith("NEXT_PUBLIC_") || k === "TILA_SESSION_SECRET" || k === "SUPABASE_URL")) {
    assert.equal(por.dual[n], por.legacy[n], n); assert.equal(por.strict[n], por.legacy[n], n);
  }
  for (const e of Object.values(por)) { assert.equal(e.NODE_ENV, "production"); assert.equal(e.TILA_ENTORNO, "staging"); assert.equal(e.TILA_STAGING_SUPABASE_REF, REF); assert.equal(e.NEXT_TELEMETRY_DISABLED, "1"); }
});

// ═══════════════ 4. Escaneo del build ═══════════════
test("escanearBuild: limpio → sin prohibidos; cuenta el host de la app como informativo", () => {
  const r = L.escanearBuild(fsBase({ [`${RAIZ}/.next/static/chunks/c.js`]: 'const H="tila-logistica.vercel.app"' }), `${RAIZ}/.next`);
  assert.deepEqual(r.prohibidos, []); assert.equal(r.avisosHostApp, 1); assert.ok(r.archivos >= 3);
});
test("escanearBuild: detecta el ref de producción en static y en server (aunque esté en mayúsculas)", () => {
  const r = L.escanearBuild(fsBase({ [`${RAIZ}/.next/static/chunks/x.js`]: `"${REF_PRODUCCION}"`, [`${RAIZ}/.next/server/app/y.html`]: `https://${REF_PRODUCCION.toUpperCase()}.supabase.co` }), `${RAIZ}/.next`);
  assert.equal(r.prohibidos.length, 2);
});
test("escanearBuild: ignora binarios y carpetas fuera de static/server", () => {
  const r = L.escanearBuild(fsFalso({ [`${RAIZ}/.next/static/img.png`]: REF_PRODUCCION, [`${RAIZ}/.next/cache/z.js`]: REF_PRODUCCION }), `${RAIZ}/.next`);
  assert.deepEqual(r.prohibidos, []); assert.equal(r.archivos, 0);
});

// ═══════════════ 5. Argumentos ═══════════════
test("argv: claves/URLs/refs por línea de comandos → rechazo (exit 3) sin imprimir el valor", async () => {
  for (const a of [`--url=${URL_OK}`, `--anon=${ANON}`, `--service-key=${SVC}`, "--ref=abc", "positional", "--puerto=1"]) {
    const x = depsFalsas();
    assert.equal(await L.main([a], x.d), 3, a);
    assert.ok(!todo(x).includes(ANON) && !todo(x).includes(SVC) && !todo(x).includes(URL_OK), "el valor del argumento no debe eco-arse");
    assert.equal(x.spawns.length, 0);
  }
});
test("argv: --plan + --check y --sin-build con --check/--plan → exit 3", async () => {
  for (const a of [["--plan", "--check"], ["--check", "--sin-build"], ["--plan", "--sin-build"]]) assert.equal(await L.main(a, depsFalsas().d), 3, a.join(" "));
});
test("parsearArgs: --listar es alias de --plan", () => { assert.equal(L.parsearArgs(["--listar"]).plan, true); });

// ═══════════════ 6. --plan: cero efectos ═══════════════
const trampa = (nombre) => new Proxy({}, { get() { throw new Error(`--plan tocó ${nombre}`); } });
test("--plan / --listar: no lee env, fs, red, procesos ni puertos; lista los 3 modos", async () => {
  for (const flag of ["--plan", "--listar"]) {
    const salida = [];
    const d = { env: trampa("env"), fs: trampa("fs"), spawn: () => { throw new Error("spawn"); }, fetch: () => { throw new Error("fetch"); }, puertoLibre: () => { throw new Error("puerto"); }, proceso: trampa("proceso"), matarArbol: () => { throw new Error("matar"); }, out: (l) => salida.push(l), err: () => { throw new Error("err"); } };
    assert.equal(await L.main([flag], d), 0);
    const t = salida.join("\n");
    for (const { modo, host, puerto } of L.MODOS) assert.ok(t.includes(`http://${host}:${puerto}`) && t.includes(`TILA_AUTH_MODE=${modo}`));
    for (const n of L.REQUERIDAS) assert.ok(t.includes(n));
    assert.ok(!t.includes("sb_secret_") && !t.includes("sb_publishable_"));
  }
});
test("--plan corre como script real sin .env.staging, sin variables y sin red (proceso hijo con entorno vacío)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--plan"], { env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" }, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("127.0.0.3:3133"));
});
test("script real con argumento prohibido → exit 3 (sin tocar nada)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--url=https://x.supabase.co"], { env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" }, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 3);
});
test("script real sin variables → exit 2 ANTES de compilar o lanzar nada (--check, entorno vacío)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--check"], { env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" }, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.includes("RECHAZADA"));
});

// ═══════════════ 7. --check: valida sin tocar nada ═══════════════
test("--check con variables falsas válidas: exit 0, sin spawn, sin puertos, sin fetch, sin señales", async () => {
  const x = depsFalsas({ extra: { fetch: async () => { throw new Error("fetch"); }, puertoLibre: async () => { throw new Error("puerto"); } } });
  x.d.spawn = () => { throw new Error("spawn"); };
  assert.equal(await L.main(["--check"], x.d), 0);
  const t = todo(x);
  assert.ok(t.includes("--check") && t.includes(`${REF}.supabase.co`) && t.includes("[CONFIGURADA]"));
  assert.equal(x.proceso.listenerCount("SIGINT"), 0);
  sinSecretos(t);
});
test("--check con producción: exit 2, sin efectos, y NO imprime ninguna clave", async () => {
  const prod = `https://${REF_PRODUCCION}.supabase.co`;
  const x = depsFalsas({ env: envOk({ NEXT_PUBLIC_SUPABASE_URL: prod, SUPABASE_URL: prod, TILA_STAGING_SUPABASE_REF: REF_PRODUCCION, MERCADOPAGO_ACCESS_TOKEN: "APP_USR-" + MP }) });
  x.d.spawn = () => { throw new Error("spawn"); };
  assert.equal(await L.main(["--check"], x.d), 2);
  const t = todo(x); sinSecretos(t); assert.ok(!t.includes("APP_USR-" + MP));
  assert.ok(t.includes("RECHAZADA"));
});
test("--check con variable faltante: exit 2 y nombra la variable", async () => {
  const x = depsFalsas({ env: sin(envOk(), "TILA_SESSION_SECRET") });
  assert.equal(await L.main(["--check"], x.d), 2);
  assert.ok(todo(x).includes("TILA_SESSION_SECRET"));
});
test("--check informa cuántos nombres de .env* neutraliza, sin mostrar sus valores", async () => {
  const x = depsFalsas();
  assert.equal(await L.main(["--check"], x.d), 0);
  assert.ok(/neutralizados con placeholder: [1-9]/.test(todo(x)));
  sinSecretos(todo(x));
});

// ═══════════════ 8. Ejecución real (con procesos FALSOS) ═══════════════
test("ejecución completa: orden puertos → build → (escaneo) → 3 starts; sin shell; -H loopback; pid/puerto/modo impresos; secretos ausentes", async () => {
  const x = depsFalsas();
  const p = L.main([], x.d);
  await tick(); await tick(); await tick(); await tick();
  x.proceso.emit("SIGINT");
  assert.equal(await p, 0);
  assert.deepEqual(x.eventos.slice(0, 4), ["puerto:127.0.0.1:3131", "puerto:127.0.0.2:3132", "puerto:127.0.0.3:3133", "spawn:build"]);
  assert.deepEqual(x.eventos.slice(4), ["spawn:start:3131", "spawn:start:3132", "spawn:start:3133"]);
  const [build, ...inst] = x.spawns;
  assert.deepEqual(build.args, [NEXT_BIN, "build"]);
  assert.equal(build.cmd, "C:/node.exe");
  const HOSTS = { 3131: "127.0.0.1", 3132: "127.0.0.2", 3133: "127.0.0.3" };
  for (const h of inst) {
    const puerto = h.args[h.args.indexOf("-p") + 1];
    assert.equal(h.args[h.args.indexOf("-H") + 1], HOSTS[puerto]);
    assert.ok(!h.args.includes("0.0.0.0"));
    assert.equal(h.opts.shell, false); assert.equal(h.opts.cwd, RAIZ);
  }
  for (const h of x.spawns) { assert.equal(h.opts.shell, false); assert.equal(h.opts.env.NEXT_PUBLIC_SUPABASE_URL, URL_OK); }
  assert.deepEqual(inst.map((h) => h.opts.env.TILA_AUTH_MODE), ["legacy", "dual", "strict"]);
  assert.equal(build.opts.env.TILA_AUTH_MODE, "legacy");
  const t = todo(x);
  assert.ok(/\[legacy\] pid \d+ · http:\/\/127\.0\.0\.1:3131/.test(t) && /\[strict\] pid \d+ · http:\/\/127\.0\.0\.3:3133/.test(t));
  assert.ok(t.includes("--modos=legacy=http://127.0.0.1:3131,dual=http://127.0.0.2:3132,strict=http://127.0.0.3:3133"));
  sinSecretos(t);
});
test("los 3 hijos y el build reciben entornos SIN valores de .env.local ni de producción", async () => {
  const x = depsFalsas();
  const p = L.main([], x.d); for (let i = 0; i < 6; i++) await tick(); x.proceso.emit("SIGTERM"); await p;
  for (const h of x.spawns) {
    const vals = Object.values(h.opts.env).join("\n");
    assert.ok(!vals.includes(VALOR_DE_ENV_LOCAL) && !vals.includes(REF_PRODUCCION), "contaminación");
    assert.equal(h.opts.env.MERCADOPAGO_ACCESS_TOKEN, L.PLACEHOLDER);
    assert.equal(h.opts.env.OTRA_VARIABLE_RARA, L.PLACEHOLDER);
  }
});
test("puerto ocupado → exit 1 ANTES de compilar o lanzar nada", async () => {
  const x = depsFalsas({ puertoOcupado: [3132] });
  assert.equal(await L.main([], x.d), 1);
  assert.equal(x.spawns.length, 0); assert.ok(todo(x).includes("127.0.0.2:3132"));
});
test("configuración inválida → exit 2: no se consulta puertos ni se lanza nada", async () => {
  const x = depsFalsas({ env: sin(envOk(), "SUPABASE_SERVICE_ROLE_KEY") });
  assert.equal(await L.main([], x.d), 2);
  assert.equal(x.spawns.length, 0); assert.equal(x.eventos.length, 0);
});
test("el build falla → exit 1 y no se levanta ninguna instancia", async () => {
  const x = depsFalsas({ buildCodigo: 1 });
  assert.equal(await L.main([], x.d), 1);
  assert.equal(x.spawns.length, 1); assert.ok(todo(x).includes("FALLÓ"));
});
test("escaneo detecta producción en .next → exit 1 y no se levanta nada", async () => {
  const x = depsFalsas({ fs: fsBase({ [`${RAIZ}/.next/static/chunks/prod.js`]: `"https://${REF_PRODUCCION}.supabase.co"` }) });
  assert.equal(await L.main([], x.d), 1);
  assert.equal(x.spawns.length, 1); assert.ok(todo(x).includes("PRODUCCIÓN")); assert.ok(!todo(x).includes(`${REF_PRODUCCION}.supabase.co"`));
});
test("--sin-build: no compila pero escanea, y si .next tiene producción NO levanta", async () => {
  const limpio = depsFalsas();
  const p = L.main(["--sin-build"], limpio.d); for (let i = 0; i < 5; i++) await tick(); limpio.proceso.emit("SIGINT"); await p;
  assert.ok(!limpio.eventos.includes("spawn:build") && limpio.spawns.length === 3);
  const sucio = depsFalsas({ fs: fsBase({ [`${RAIZ}/.next/static/chunks/prod.js`]: REF_PRODUCCION }) });
  assert.equal(await L.main(["--sin-build"], sucio.d), 1); assert.equal(sucio.spawns.length, 0);
});
test(".next vacío (sin build) → exit 1, no levanta", async () => {
  const x = depsFalsas({ fs: fsFalso({ [NEXT_BIN]: "x" }) });
  assert.equal(await L.main(["--sin-build"], x.d), 1); assert.equal(x.spawns.length, 0);
});
test("falta el binario de Next → exit 1 sin lanzar", async () => {
  const x = depsFalsas({ fs: fsFalso({}) });
  assert.equal(await L.main([], x.d), 1); assert.equal(x.spawns.length, 0);
});
test("un hijo muere durante la ejecución → se apagan los otros y exit 1", async () => {
  const x = depsFalsas();
  const p = L.main([], x.d); for (let i = 0; i < 6; i++) await tick();
  const inst = x.spawns.slice(1); assert.equal(inst.length, 3);
  inst[1].terminar(9);
  assert.equal(await p, 1);
  assert.deepEqual(x.matados.sort(), [inst[0].pid, inst[2].pid].sort());
  assert.ok(todo(x).includes("terminó inesperadamente"));
  assert.equal(x.proceso.listenerCount("SIGINT"), 0, "se quitan los manejadores de señales");
});
test("un hijo no responde a la readiness → se apagan todos, exit 1", async () => {
  const x = depsFalsas({ fetchOk: false });
  assert.equal(await L.main([], x.d), 1);
  assert.equal(x.matados.length, 3); assert.ok(todo(x).includes("no respondieron"));
});
test("SIGINT/SIGTERM/SIGBREAK/SIGHUP → apagan las 3 instancias, exit 0; una segunda señal no las mata dos veces", async () => {
  for (const senal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
    const x = depsFalsas();
    const p = L.main([], x.d); for (let i = 0; i < 6; i++) await tick();
    x.proceso.emit(senal); x.proceso.emit(senal);
    assert.equal(await p, 0, senal);
    assert.equal(x.matados.length, 3, senal);
    assert.ok(!x.errores.some((e) => e.includes("inesperadamente")));
  }
});
test("señal DURANTE el build → se mata el build, no se levantan instancias, exit 0", async () => {
  const x = depsFalsas({ extra: {} });
  x.d.spawn = (cmd, args, opts) => { const h = new Hijo(77, args, opts); x.spawns.push(h); return h; }; // el build nunca termina solo
  const p = L.main([], x.d); for (let i = 0; i < 4; i++) await tick();
  x.proceso.emit("SIGINT");
  assert.equal(await p, 0);
  assert.equal(x.spawns.length, 1); assert.deepEqual(x.matados, [77]);
});
test("la salida de los hijos pasa por redactar: claves y JWT jamás aparecen", async () => {
  const x = depsFalsas();
  const p = L.main([], x.d); for (let i = 0; i < 6; i++) await tick();
  const [build, dual] = [x.spawns[0], x.spawns[2]];
  build.stdout.emit("data", `usando ${SVC}\n`);
  dual.stderr.emit("data", `token ${jwt({ role: "service_role", ref: REF })} y sesion ${SESION}\nlinea sin secreto\n`);
  dual.stdout.emit("data", `parcial ${ANON.slice(0, 15)}`); dual.stdout.emit("data", `${ANON.slice(15)}\n`);
  x.proceso.emit("SIGINT"); await p;
  const t = todo(x);
  sinSecretos(t); assert.ok(!t.includes("eyJ")); assert.ok(t.includes("[REDACTADO]")); assert.ok(t.includes("[dual] linea sin secreto"));
});
test("error de arranque de un hijo (spawn error) → exit 1 y apaga el resto", async () => {
  const x = depsFalsas();
  const p = L.main([], x.d); for (let i = 0; i < 6; i++) await tick();
  x.spawns[3].emit("error", new Error(`ENOENT con ${SVC}`));
  assert.equal(await p, 1); sinSecretos(todo(x));
});

// ═══════════════ 9. redactar / auditoría estática del propio script ═══════════════
test("redactar: reemplaza secretos exactos, sb_*, JWT; ignora secretos cortos", () => {
  const t = L.redactar(`a ${SVC} b ${ANON} c ${jwt({ role: "anon", ref: REF })} d ${SESION} e ab`, [SESION, "ab"]);
  assert.ok(!t.includes(SVC) && !t.includes(ANON) && !t.includes(SESION) && !t.includes("eyJ")); assert.ok(t.includes(" e ab"));
});
test("auditoría estática: sin shell:true, sin 0.0.0.0 como destino, sin process.env directo en spawn, sin lectura de argv para secretos, sin red externa", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const codigo = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/shell\s*:\s*true/.test(codigo), "shell:true");
  assert.ok(!/["'`]-H["'`]\s*,\s*["'`]0\.0\.0\.0/.test(codigo), "bind 0.0.0.0");
  assert.ok(!/(?<![.\w])exec(Sync)?\s*\(/.test(codigo), "exec con shell");
  // process.env solo se lee UNA vez (depsReales → validación y lista de variables del sistema); nunca se pasa a un hijo tal cual.
  const usos = codigo.split("\n").map((l) => l.trim()).filter((l) => l.includes("process.env") && !l.startsWith("*") && !l.startsWith("/**") && !l.includes('"'));
  assert.deepEqual(usos, ["env: process.env,"], "process.env solo debe aparecer en depsReales");
  assert.ok(!/\.\.\.\s*process\.env/.test(codigo), "spread de process.env");
  assert.ok(!/https?:\/\/(?!\$\{|127\.|<ref>)/.test(codigo.replace(/https:\/\/\$\{ref\}/g, "")), "URL externa fija en el código");
  for (const h of HOSTS_PRODUCCION) assert.ok(!codigo.includes(h) || false, `host de producción literal: ${h}`);
  assert.ok(codigo.includes("tila-logistica.vercel.app") === false);
  assert.ok(!codigo.includes(REF_PRODUCCION), "el script no repite el ref de producción (lo importa de guardas.mjs)");
});
test("el script no importa módulos de red (http/https/dns/tls) ni instala nada", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["./guardas.mjs", "node:child_process", "node:fs", "node:net", "node:path", "node:url"].sort());
  assert.ok(!/["'`](npm|npx)(\.cmd)?["'`]/.test(src), "el script no invoca npm/npx");
});

// ═══════════════ 9. TLS (NODE_OPTIONS=--use-system-ca constante) y sonda de Supabase read-only ═══════════════
const correrYApagar = async (x, senal = "SIGINT") => { const p = L.main([], x.d); for (let i = 0; i < 8; i++) await tick(); x.proceso.emit(senal); return p; };

test("las 3 instancias (y el build) reciben NODE_OPTIONS=--use-system-ca constante y NINGÚN flag de node por argv (ERR_WORKER_INVALID_EXEC_ARGV en `next build`)", async () => {
  const x = depsFalsas();
  assert.equal(await correrYApagar(x), 0);
  const [build, ...inst] = x.spawns; assert.equal(inst.length, 3);
  for (const h of [build, ...inst]) { assert.equal(h.args[0], NEXT_BIN); assert.ok(!h.args.includes("--use-system-ca")); assert.equal(h.opts.env.NODE_OPTIONS, "--use-system-ca"); assert.equal(h.cmd, "C:/node.exe"); }
  assert.deepEqual(inst.map((h) => h.args[h.args.indexOf("-p") + 1]), ["3131", "3132", "3133"]);
  assert.deepEqual(L.FLAGS_NODE_HIJOS, ["--use-system-ca"]);
});
test("ningún hijo desactiva TLS: sin NODE_TLS_REJECT_UNAUTHORIZED ni rejectUnauthorized, y el único flag de node es --use-system-ca (por NODE_OPTIONS)", async () => {
  const x = depsFalsas();
  assert.equal(await correrYApagar(x), 0);
  for (const h of x.spawns) {
    assert.ok(!("NODE_TLS_REJECT_UNAUTHORIZED" in h.opts.env));
    assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized|insecure/i.test(JSON.stringify([h.args, h.opts])));
    assert.deepEqual(h.args.filter((a) => a.startsWith("--")), []); assert.equal(h.opts.env.NODE_OPTIONS, "--use-system-ca");
  }
  // y si el entorno de entrada lo trae en 0, el launcher rechaza (exit 2) sin lanzar nada
  const malo = depsFalsas({ env: envOk({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }) });
  assert.equal(await L.main([], malo.d), 2); assert.equal(malo.spawns.length, 0);
});
test("NODE_OPTIONS y NODE_EXTRA_CA_CERTS del shell NO se heredan (aunque traigan --require/--inspect); el hijo recibe solo la constante --use-system-ca", async () => {
  const x = depsFalsas({ env: envOk({ NODE_OPTIONS: "--require C:/evil.js --inspect=0.0.0.0:9229 --use-system-ca", NODE_EXTRA_CA_CERTS: "C:/x/ca.pem", HTTPS_PROXY: "http://proxy:1", SSL_CERT_FILE: "C:/x.pem" }) });
  assert.equal(await correrYApagar(x), 0);
  for (const h of x.spawns) {
    for (const n of ["NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "SSL_CERT_FILE"]) assert.ok(!(n in h.opts.env), n);
    assert.equal(h.opts.env.NODE_OPTIONS, "--use-system-ca");
    assert.ok(!h.args.some((a) => /evil|inspect/.test(a)));
  }
});
test("entorno aislado: sigue sin valores de .env.local ni de producción y con placeholders (con el flag TLS presente)", async () => {
  const x = depsFalsas();
  assert.equal(await correrYApagar(x), 0);
  for (const h of x.spawns) {
    const vals = Object.values(h.opts.env).join("\n");
    assert.ok(!vals.includes(VALOR_DE_ENV_LOCAL) && !vals.includes(REF_PRODUCCION));
    assert.equal(h.opts.env.OTRA_VARIABLE_RARA, L.PLACEHOLDER);
    assert.equal(h.opts.env.TILA_ENTORNO, "staging");
  }
});
test("bind loopback intacto: -H 127.0.0.1/2/3, nunca 0.0.0.0, :: ni localhost (ni en args ni en la sonda)", async () => {
  const x = depsFalsas();
  assert.equal(await correrYApagar(x), 0);
  const inst = x.spawns.slice(1);
  assert.deepEqual(inst.map((h) => h.args[h.args.indexOf("-H") + 1]), ["127.0.0.1", "127.0.0.2", "127.0.0.3"]);
  for (const h of x.spawns) assert.ok(!h.args.some((a) => a === "0.0.0.0" || a === "::" || a === "localhost"));
  for (const c of x.llamadasFetch) assert.ok(/^http:\/\/127\.0\.0\.[123]:313[123]\//.test(c.url), c.url);
  assert.ok(!JSON.stringify(x.llamadasFetch).includes("0.0.0.0"));
});
test("producción sigue bloqueada: con URL/ref de producción no se lanza nada ni se sondea", async () => {
  const prod = `https://${REF_PRODUCCION}.supabase.co`;
  const x = depsFalsas({ env: envOk({ NEXT_PUBLIC_SUPABASE_URL: prod, SUPABASE_URL: prod, TILA_STAGING_SUPABASE_REF: REF_PRODUCCION }) });
  assert.equal(await L.main([], x.d), 2);
  assert.equal(x.spawns.length, 0); assert.equal(x.llamadasFetch.length, 0); assert.equal(x.eventos.length, 0);
});
test("sonda: GET (sin cuerpo ni cookies) a /api/cargas/disponibles en cada instancia con x-user-id del chofer1 del seed; el webhook no se usa como sonda", async () => {
  const x = depsFalsas();
  assert.equal(await correrYApagar(x), 0);
  const sondas = x.llamadasFetch.filter((c) => c.url.includes(L.RUTA_SONDA));
  assert.deepEqual(sondas.map((c) => c.url), ["http://127.0.0.1:3131/api/cargas/disponibles", "http://127.0.0.2:3132/api/cargas/disponibles", "http://127.0.0.3:3133/api/cargas/disponibles"]);
  for (const c of sondas) {
    assert.equal(c.init.method, "GET"); assert.equal(c.init.body, undefined);
    assert.deepEqual(Object.keys(c.init.headers), ["x-user-id"]);
  }
  assert.ok(!L.RUTA_SONDA.includes("mercadopago") && !L.RUTA_SONDA.includes("webhook"));
  // la sonda va DESPUÉS de la readiness y ANTES de "STAGING LISTO"
  const t = todo(x);
  assert.ok(t.indexOf("[sonda] legacy") > -1 && t.indexOf("[sonda] strict") < t.indexOf("STAGING LISTO"));
});
test("la ruta de la sonda existe en app/api, exporta solo GET y no escribe (sin insert/update/delete/upsert/rpc)", () => {
  const src = readFileSync(resolve(AQUI, "..", "..", "app", "api", "cargas", "disponibles", "route.ts"), "utf8");
  assert.ok(/export async function GET/.test(src));
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(src));
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(src));
});
test("ID_USUARIO_SONDA coincide con el chofer1 del seed", async () => {
  const { ID } = await import("./seed/datos.mjs");
  assert.equal(L.ID_USUARIO_SONDA, ID.chofer1);
});
test("sondearSupabase: 200 y 403 → ok; 401, 500, 404, sin status, red caída → fallo; el detalle no filtra secretos", async () => {
  const con = (f) => L.sondearSupabase(f, { host: "127.0.0.1", puerto: 3131 });
  assert.equal((await con(async () => ({ status: 200 }))).ok, true);
  assert.equal((await con(async () => ({ status: 403 }))).ok, true);
  for (const st of [401, 500, 404, undefined]) assert.equal((await con(async () => ({ status: st }))).ok, false, String(st));
  const caido = await con(async () => { throw Object.assign(new Error("ECONNREFUSED " + SVC), { name: "TypeError" }); });
  assert.equal(caido.ok, false); assert.ok(!caido.detalle.includes(SVC));
});
test("sonda con 401 (la app no llega a Supabase: caso UNABLE_TO_VERIFY_LEAF_SIGNATURE) → exit 1, se apagan las 3 y no aparece STAGING LISTO", async () => {
  const x = depsFalsas({ sondaStatus: 401 });
  assert.equal(await L.main([], x.d), 1);
  assert.equal(x.matados.length, 3);
  const t = todo(x);
  assert.ok(t.includes("no pudo consultar Supabase") && !t.includes("STAGING LISTO"));
});
test("sonda con 500 en una sola instancia → se apagan todas, exit 1", async () => {
  const x = depsFalsas();
  const base = x.d.fetch;
  x.d.fetch = async (u, init) => (String(u).startsWith("http://127.0.0.2:3132") && String(u).includes(L.RUTA_SONDA) ? { ok: false, status: 500 } : base(u, init));
  assert.equal(await L.main([], x.d), 1);
  assert.equal(x.matados.length, 3); assert.ok(todo(x).includes("dual"));
});
test("fallo de arranque de UNA instancia (muere antes de la readiness) → se cierran las otras, exit 1 y no se sondea", async () => {
  const x = depsFalsas({ fetchOk: false, extra: { intentos: 10000, sleep: () => tick() } }); // la readiness sigue esperando mientras la instancia muere
  const p = L.main([], x.d); for (let i = 0; i < 6; i++) await tick();
  const inst = x.spawns.slice(1); assert.equal(inst.length, 3);
  inst[2].terminar(1);
  assert.equal(await p, 1);
  assert.deepEqual(x.matados.sort(), [inst[0].pid, inst[1].pid].sort());
  assert.ok(!x.llamadasFetch.some((c) => c.url.includes(L.RUTA_SONDA)), "no se sondea si la readiness no pasó");
});
test("--check no lanza procesos ni sondas; el plan menciona --use-system-ca y la sonda de solo lectura", async () => {
  const x = depsFalsas();
  assert.equal(await L.main(["--check"], x.d), 0);
  assert.equal(x.spawns.length, 0); assert.equal(x.llamadasFetch.length, 0);
  const plan = L.textoPlan();
  assert.ok(plan.includes("--use-system-ca") && plan.includes("SOLO LECTURA") && plan.includes(L.RUTA_SONDA));
});
