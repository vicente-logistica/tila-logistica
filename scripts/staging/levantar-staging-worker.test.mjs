// Tests LOCALES: ERR_WORKER_INVALID_EXEC_ARGV de `next build` con --use-system-ca. Sin red, sin Supabase, sin puertos, sin `next build`, sin .env*, sin levantar-staging real.
// Solo lanzan procesos `node` locales de corta vida que crean un Worker (worker_threads) — el de Node puro y la clase Worker REAL de Next (`next/dist/lib/worker`),
// con las mismas opciones que usa `turbopackBuildWithWorker` en el build (enableWorkerThreads: true).
// Causa: `next build` construye el env del worker con NODE_OPTIONS = process.execArgv + NODE_OPTIONS del padre. Node solo acepta un flag de PROCESO (como --use-system-ca)
// en el NODE_OPTIONS del env de un Worker si es idéntico al NODE_OPTIONS del proceso padre → con el flag solo por argv: ERR_WORKER_INVALID_EXEC_ARGV.
// Ejecutar: node --test scripts/staging/levantar-staging-worker.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as L from "./levantar-staging.mjs";
import { REF_PRODUCCION } from "./guardas.mjs";

const SOPORTADO = process.allowedNodeEnvironmentFlags.has("--use-system-ca");
const NEXT_WORKER = (() => { try { return createRequire(join(L.RAIZ_PROYECTO, "package.json")).resolve("next/dist/lib/worker"); } catch { return null; } })();
const CODIGO = "ERR_WORKER_INVALID_EXEC_ARGV";

const dir = mkdtempSync(join(tmpdir(), "tila-worker-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

// Entorno mínimo REAL (Node en Windows necesita SystemRoot); se le quita todo lo que pueda contaminar (NODE_OPTIONS, CA extra, TLS).
const entornoLimpio = (extra = {}) => {
  const e = {}; for (const [k, v] of Object.entries(process.env)) if (!/^(NODE_OPTIONS|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED)$/i.test(k)) e[k] = v;
  return { ...e, ...extra };
};
const correr = (args, env, cwd = dir) => spawnSync(process.execPath, args, { env, cwd, encoding: "utf8", timeout: 60000, windowsHide: true, shell: false });
const salida = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`;

// ── Worker de Node puro: reproduce lo que hace Next con el env del worker ─────────────────────────────────────────────────
writeFileSync(join(dir, "nodo-puro.mjs"), `
import { Worker, isMainThread } from "node:worker_threads";
if (!isMainThread) { console.log("WORKER_VIVO NODE_OPTIONS=" + JSON.stringify(process.env.NODE_OPTIONS)); }
else {
  // Igual que next/dist/lib/worker.js: NODE_OPTIONS del worker = execArgv + NODE_OPTIONS del padre.
  const heredado = [...process.execArgv, ...String(process.env.NODE_OPTIONS ?? "").split(/\\s+/).filter(Boolean)];
  try { const w = new Worker(new URL(import.meta.url), { env: { ...process.env, NODE_OPTIONS: heredado.join(" ") } }); w.on("exit", () => {}); }
  catch (e) { console.log("WORKER_FALLO " + e.code + " :: " + e.message); process.exitCode = 1; }
}
`);
test("Worker de Node puro: --use-system-ca SOLO por argv → ERR_WORKER_INVALID_EXEC_ARGV (el fallo real de la Fase 8)", { skip: !SOPORTADO }, () => {
  const r = correr(["--use-system-ca", join(dir, "nodo-puro.mjs")], entornoLimpio());
  assert.match(salida(r), new RegExp(`WORKER_FALLO ${CODIGO} :: .*--use-system-ca is not allowed in NODE_OPTIONS`));
  assert.equal(r.status, 1);
});
test("Worker de Node puro: --use-system-ca por NODE_OPTIONS (padre y worker idénticos) → el worker arranca", { skip: !SOPORTADO }, () => {
  const r = correr([join(dir, "nodo-puro.mjs")], entornoLimpio({ NODE_OPTIONS: "--use-system-ca" }));
  assert.match(salida(r), /WORKER_VIVO NODE_OPTIONS="--use-system-ca"/); assert.doesNotMatch(salida(r), new RegExp(CODIGO)); assert.equal(r.status, 0);
});
test("Worker de Node puro: el flag no equivale a debilitar TLS — con NODE_OPTIONS distinto al del padre Node sigue rechazándolo", { skip: !SOPORTADO }, () => {
  writeFileSync(join(dir, "distinto.mjs"), `import { Worker, isMainThread } from "node:worker_threads";
if (isMainThread) { try { new Worker(new URL(import.meta.url), { env: { ...process.env, NODE_OPTIONS: "--use-system-ca --max-old-space-size=256" } }); console.log("ACEPTADO"); } catch (e) { console.log("RECHAZADO " + e.code); } }`);
  assert.match(salida(correr([join(dir, "distinto.mjs")], entornoLimpio({ NODE_OPTIONS: "--use-system-ca" }))), new RegExp(`RECHAZADO ${CODIGO}`));
});

// ── Worker REAL de Next (mismas opciones que turbopackBuildWithWorker) ────────────────────────────────────────────────────
writeFileSync(join(dir, "impl.cjs"), `const tls = require("node:tls");
exports.info = async () => ({ execArgv: process.execArgv, NODE_OPTIONS: process.env.NODE_OPTIONS ?? null, ca: tls.getCACertificates("default").length, bundled: tls.rootCertificates.length,
  tlsInseguro: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? null, caExtra: process.env.NODE_EXTRA_CA_CERTS ?? null, envNombres: Object.keys(process.env) });
`);
writeFileSync(join(dir, "next-worker.mjs"), `
import { createRequire } from "node:module";
const { Worker } = createRequire(${JSON.stringify(join(L.RAIZ_PROYECTO, "package.json"))})("next/dist/lib/worker");
try {
  const w = new Worker(${JSON.stringify(join(dir, "impl.cjs"))}, { exposedMethods: ["info"], enableWorkerThreads: true, debuggerPortOffset: -1, isolatedMemory: false, numWorkers: 1, maxRetries: 0, forkOptions: { env: { NEXT_PRIVATE_BUILD_WORKER: "1" } } });
  console.log("WORKER_OK " + JSON.stringify(await w.info())); await w.end(); process.exit(0);
} catch (e) { console.log("WORKER_FALLO " + (e.code ?? e.name) + " :: " + e.message); process.exit(1); }
`);
const conNext = { skip: !SOPORTADO || !NEXT_WORKER };
const infoWorker = (r) => { const m = /WORKER_OK (.*)/.exec(salida(r)); return m ? JSON.parse(m[1]) : null; };
const cfgFalsa = { vars: {}, opcionalesPresentes: {}, ref: "abcdefghij0123456789" };

test("Worker REAL de Next: el argsNext ANTERIOR (--use-system-ca antes del binario, sin NODE_OPTIONS) reproduce ERR_WORKER_INVALID_EXEC_ARGV", conNext, () => {
  const anterior = ["--use-system-ca", join(dir, "next-worker.mjs"), "build"];
  const r = correr(anterior, entornoLimpio());
  assert.match(salida(r), new RegExp(`WORKER_FALLO ${CODIGO} :: .*--use-system-ca is not allowed in NODE_OPTIONS`)); assert.equal(r.status, 1);
});
test("Worker REAL de Next: solución elegida (launcher actual: argsNext sin flags + env del hijo con NODE_OPTIONS=--use-system-ca) → el worker arranca y confía en los CA del sistema", conNext, () => {
  const env = L.construirEntorno(process.env, cfgFalsa, "legacy", new Set());
  const args = L.argsNext(join(dir, "next-worker.mjs"), "build");
  assert.equal(env.NODE_OPTIONS, "--use-system-ca"); assert.ok(!args.some((a) => a.startsWith("--")));
  const r = correr(args, env); const info = infoWorker(r);
  assert.ok(info, salida(r)); assert.doesNotMatch(salida(r), new RegExp(CODIGO)); assert.equal(r.status, 0);
  assert.deepEqual(info.execArgv, []); assert.equal(info.NODE_OPTIONS, "--use-system-ca");
  assert.ok(info.ca >= info.bundled, "el store por defecto incluye los CA integrados");
  const sistema = spawnSync(process.execPath, ["-p", "require('tls').getCACertificates('system').length"], { env: entornoLimpio(), encoding: "utf8" }).stdout.trim();
  if (Number(sistema) > 0) assert.ok(info.ca > info.bundled, "con certificados de sistema disponibles, el worker los ve (esto es lo que evita UNABLE_TO_VERIFY_LEAF_SIGNATURE)");
});
test("Worker REAL de Next: sin el flag el worker arranca pero NO ve los CA del sistema (control: el flag es lo que cambia)", conNext, () => {
  const r = correr([join(dir, "next-worker.mjs"), "build"], entornoLimpio()); const info = infoWorker(r);
  assert.ok(info, salida(r)); assert.equal(info.ca, info.bundled);
});
test("Worker REAL de Next + shell contaminado (--require, --inspect, CA extra, TLS=0, proxies, ref de producción): el hijo recibe SOLO la constante y no hereda nada peligroso", conNext, () => {
  const sucio = { ...process.env, NODE_OPTIONS: "--require C:/evil.js --inspect=0.0.0.0:9229 --use-system-ca", NODE_EXTRA_CA_CERTS: "C:/x/evil-ca.pem", NODE_TLS_REJECT_UNAUTHORIZED: "0",
    HTTPS_PROXY: "http://proxy:1", SSL_CERT_FILE: "C:/x.pem", SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` };
  const env = L.construirEntorno(sucio, cfgFalsa, "legacy", new Set());
  assert.equal(env.NODE_OPTIONS, L.NODE_OPTIONS_HIJOS); assert.equal(env.NODE_OPTIONS, "--use-system-ca");
  for (const n of ["NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "HTTPS_PROXY", "SSL_CERT_FILE", "SUPABASE_URL"]) assert.ok(!(n in env), n);
  assert.ok(!JSON.stringify(env).includes(REF_PRODUCCION), "ningún valor del hijo referencia la Supabase de producción");
  const r = correr(L.argsNext(join(dir, "next-worker.mjs"), "build"), env); const info = infoWorker(r);
  assert.ok(info, salida(r));
  assert.equal(info.NODE_OPTIONS, "--use-system-ca"); assert.doesNotMatch(JSON.stringify(info), /evil|inspect|--require/);
  assert.equal(info.tlsInseguro, null); assert.equal(info.caExtra, null);
  assert.ok(!info.envNombres.some((n) => /^(NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|HTTPS_PROXY|SSL_CERT_FILE)$/i.test(n)));
});

// ── Unitarios del launcher (sin procesos) ─────────────────────────────────────────────────────────────────────────────────
test("argsNext ya no antepone flags de node (van por NODE_OPTIONS constante); build e instancias comparten la misma constante", () => {
  assert.deepEqual(L.argsNext("next.js", "build"), ["next.js", "build"]);
  assert.deepEqual(L.argsNext("next.js", "start", ["-H", "127.0.0.1", "-p", "3131"]), ["next.js", "start", "-H", "127.0.0.1", "-p", "3131"]);
  assert.deepEqual([...L.FLAGS_NODE_HIJOS], ["--use-system-ca"]); assert.equal(L.NODE_OPTIONS_HIJOS, "--use-system-ca");
  for (const modo of ["legacy", "dual", "strict"]) assert.equal(L.construirEntorno({}, cfgFalsa, modo, new Set()).NODE_OPTIONS, "--use-system-ca");
});
test("un .env* que declare NODE_OPTIONS no puede pisar la constante con un placeholder ni con otro valor", () => {
  const e = L.construirEntorno({ NODE_OPTIONS: "--inspect" }, cfgFalsa, "legacy", new Set(["NODE_OPTIONS"]));
  assert.equal(e.NODE_OPTIONS, "--use-system-ca");
});
