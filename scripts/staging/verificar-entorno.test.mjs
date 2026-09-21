// Tests LOCALES de verificar-entorno.mjs. Sin red, sin Supabase, sin claves reales, sin puertos, sin git real, sin leer los .env* reales:
// entorno, sistema de archivos, git y fetch son FALSOS y en memoria.
// Ejecutar: node --test scripts/staging/verificar-entorno.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as V from "./verificar-entorno.mjs";
import { REF_PRODUCCION, HOSTS_PRODUCCION } from "./guardas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(AQUI, "verificar-entorno.mjs");
const REF = "abcdefghij0123456789";
const HOST = `${REF}.supabase.co`;
const URL_OK = `https://${HOST}`;
const ANON = "sb_publishable_TEST0123456789abcdefABCDEF";
const SVC = "sb_secret_TEST0123456789abcdefABCDEF";
const SESION = "Ab3dEf6hIj9lMn2pQr5tUv8xYz1BcD4FgH7kLo0sWq6RtVyZ"; // 48 caracteres variados (ficticio)
const MP = "TEST-0123456789-fake-token-abcdef";
const VALOR_ENV_LOCAL = "VALOR-SECRETO-DE-ENV-LOCAL-98765";
const CUERPO_SECRETO = "CUERPO-REMOTO-NO-DEBE-IMPRIMIRSE";
const SECRETOS = [ANON, SVC, SESION, MP, VALOR_ENV_LOCAL, CUERPO_SECRETO];
const RAIZ = "C:/repo";
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firmaFalsaFirmaFalsa1234`;

const envOk = (extra = {}) => ({
  PATH: "C:\\fake\\bin", TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: REF,
  STAGING_SUPABASE_URL: URL_OK, NEXT_PUBLIC_SUPABASE_URL: URL_OK, SUPABASE_URL: URL_OK,
  STAGING_ANON_KEY: ANON, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, STAGING_SERVICE_ROLE_KEY: SVC, SUPABASE_SERVICE_ROLE_KEY: SVC,
  TILA_SESSION_SECRET: SESION, NEXT_PUBLIC_BASE_URL: "http://127.0.0.1:3131", ...extra,
});
const sin = (e, ...n) => { const x = { ...e }; for (const k of n) delete x[k]; return x; };

// ═══════════════ Falsos ═══════════════
function fsFalso(archivos = {}) {
  const norm = (p) => String(p).replaceAll("\\", "/").replace(/\/+$/, "");
  const mapa = new Map(Object.entries(archivos).map(([k, v]) => [norm(k), v]));
  return {
    existsSync: (p) => mapa.has(norm(p)),
    readFileSync: (p) => { const v = mapa.get(norm(p)); if (v === undefined) throw new Error("ENOENT"); return Buffer.from(v); },
    readdirSync: (dir) => { const d = norm(dir) + "/"; const n = new Set(); for (const k of mapa.keys()) if (k.startsWith(d) && !k.slice(d.length).includes("/")) n.add(k.slice(d.length)); if (!n.size && ![...mapa.keys()].some((k) => k.startsWith(d))) throw new Error("ENOENT"); return [...n]; },
  };
}
/** git falso: { ignorado, trackeado, error } → responde SOLO a los dos comandos de lectura esperados. */
function gitFalso({ ignorado = true, trackeado = false, error = false, statusIgnore = null } = {}) {
  const llamadas = [];
  const git = (args) => {
    llamadas.push([...args]);
    if (error) return { status: null, stdout: "", stderr: "", error: "spawn git ENOENT" };
    if (args[0] === "check-ignore") return { status: statusIgnore ?? (ignorado ? 0 : 1), stdout: ignorado ? `.gitignore:54:.env*\t${V.ARCHIVO_STAGING}\n` : "", stderr: "", error: null };
    if (args[0] === "ls-files") return { status: 0, stdout: trackeado ? `${V.ARCHIVO_STAGING}\n` : "", stderr: "", error: null };
    throw new Error(`git no esperado: ${args.join(" ")}`);
  };
  git.llamadas = llamadas; return git;
}
/** fetch falso: `regla(url, init)` → {status, body, headers, colgar, lanzar}. */
function fetchFalso(regla) {
  const llamadas = [];
  const f = async (url, init) => {
    llamadas.push({ url: String(url), init });
    const r = await regla(String(url), init);
    if (r.lanzar) throw new Error(r.lanzar);
    if (r.colgar) return new Promise(() => {});
    return { status: r.status, text: async () => r.body ?? "", headers: { get: (h) => (r.headers ?? {})[h.toLowerCase()] ?? null } };
  };
  f.llamadas = llamadas; return f;
}
const OPENAPI = '{"swagger":"2.0","info":{"title":"PostgREST"}}';
const reglaOk = (extra = {}) => (url) => (url.endsWith("/rest/v1/") ? { status: 200, body: OPENAPI, ...extra } : { status: 200, body: `{"external":{}} ${CUERPO_SECRETO}`, ...extra });
const trampa = (n) => new Proxy({}, { get() { throw new Error(`tocó ${n}`); } });

function armar({ env = envOk(), archivos = {}, git = gitFalso(), fetch = fetchFalso(reglaOk()), timeouts } = {}) {
  const salida = [], errores = [];
  const deps = { env, fs: fsFalso(archivos), git, fetch, raiz: RAIZ, out: (l) => salida.push(String(l)), err: (l) => errores.push(String(l)), timeouts };
  return { deps, salida, errores, git, fetch };
}
async function correr(argv, opts = {}) {
  const x = armar(opts);
  const codigo = await V.main(argv, x.deps);
  return { ...x, codigo, texto: [...x.salida, ...x.errores].join("\n") };
}
const estado = (x, id) => { const l = x.salida.find((s) => new RegExp(`^  (PASS|FAIL|INCONCLUSO|N/A)\\s+${id}\\s`).test(s)); assert.ok(l, `sin línea para ${id}\n${x.texto}`); return /^  (PASS|FAIL|INCONCLUSO|N\/A)/.exec(l)[1]; };
const sinSecretos = (t) => { for (const s of SECRETOS) assert.ok(!t.includes(s), `se filtró un secreto (${s.slice(0, 8)}…)`); assert.ok(!/authorization\s*[:=]|bearer\s|apikey\s*[:=]/i.test(t)); };

// ═══════════════ 1. Nivel local: configuración válida ═══════════════
test("--local con staging válido: todos PASS (F01 aviso, L11 N/A con claves sb_*), exit 0, sin red", async () => {
  const x = await correr(["--local"], { fetch: () => { throw new Error("fetch no debe usarse"); } });
  assert.equal(x.codigo, 0, x.texto);
  for (const id of ["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10", "L12", "L13", "L14", "L15", "L16", "G01", "G02", "F01", "F02"]) assert.equal(estado(x, id), "PASS", id);
  assert.equal(estado(x, "L11"), "N/A"); assert.match(x.texto, /todavía no existe/); assert.match(x.texto, /con aviso/); assert.match(x.texto, /RESULTADO: PASS → exit 0/);
  assert.match(x.texto, /el nivel remoto .* no se ejecutó|no se ejecutó/); sinSecretos(x.texto);
});
test("sin modo = --local: no se conecta nunca por defecto", async () => {
  const x = await correr([], { fetch: () => { throw new Error("fetch no debe usarse"); } });
  assert.equal(x.codigo, 0, x.texto); assert.match(x.texto, /sin modo: por defecto --local/); assert.equal(x.fetch.llamadas?.length ?? 0, 0);
});
test("--local jamás usa la red ni siquiera con el entorno inválido (fetch como trampa)", async () => {
  for (const env of [envOk(), {}, envOk({ SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` }), envOk({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })]) {
    const x = await correr(["--local"], { env, fetch: trampa("fetch") }); assert.ok([0, 1, 2, 3].includes(x.codigo));
  }
});
test("los mensajes nunca incluyen valores de variables (solo nombres y estados)", async () => {
  const x = await correr(["--local"], { env: envOk({ NEXT_PUBLIC_SUPABASE_URL: "https://otro0000000000000000.supabase.co", SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co`, TILA_SESSION_SECRET: "corto" }) });
  sinSecretos(x.texto); assert.ok(!x.texto.includes(REF_PRODUCCION)); assert.ok(!x.texto.includes("otro0000000000000000"));
});

// ═══════════════ 2. Ref / URL / producción ═══════════════
test("ref/URL incoherentes: la URL de staging no corresponde al ref → FAIL de guarda (exit 2)", async () => {
  const x = await correr(["--local"], { env: envOk({ STAGING_SUPABASE_URL: "https://zzzzzzzzzz0123456789.supabase.co" }) });
  assert.equal(estado(x, "L03"), "FAIL"); assert.equal(x.codigo, 2);
});
test("URL malformada / http / puerto / ruta / credenciales / host ajeno → L03 FAIL (exit 2)", async () => {
  for (const u of [`http://${HOST}`, `${URL_OK}:8443`, `${URL_OK}/rest/v1`, `https://u:p@${HOST}`, "no-es-url", "https://ejemplo.com", `${URL_OK}?a=1`]) {
    const x = await correr(["--local"], { env: envOk({ STAGING_SUPABASE_URL: u }) }); assert.equal(estado(x, "L03"), "FAIL", u); assert.equal(x.codigo, 2, u);
  }
});
test("URL de producción en STAGING_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL o SUPABASE_URL → FAIL de guarda (exit 2)", async () => {
  const prod = `https://${REF_PRODUCCION}.supabase.co`;
  for (const n of ["STAGING_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
    const x = await correr(["--local"], { env: envOk({ [n]: prod }) }); assert.equal(x.codigo, 2, n); assert.match(x.texto, /PRODUCCIÓN/); assert.equal(estado(x, "L15"), "FAIL");
  }
});
test("ref de producción → FAIL de guarda (exit 2); ref inválido (lista, mayúsculas, corto) también", async () => {
  assert.equal((await correr(["--local"], { env: envOk({ TILA_STAGING_SUPABASE_REF: REF_PRODUCCION, STAGING_SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` }) })).codigo, 2);
  for (const r of [`${REF},otro`, REF.toUpperCase(), "corto", `${REF} # c`]) { const x = await correr(["--local"], { env: envOk({ TILA_STAGING_SUPABASE_REF: r }) }); assert.equal(estado(x, "L02"), "FAIL", r); assert.equal(x.codigo, 2, r); }
});
test("TILA_ENTORNO distinto de staging (local, produccion, ausente) → FAIL de guarda (exit 2)", async () => {
  for (const v of ["local", "produccion", "production", "Staging", undefined]) { const x = await correr(["--local"], { env: envOk({ TILA_ENTORNO: v }) }); assert.equal(estado(x, "L01"), "FAIL", String(v)); assert.equal(x.codigo, 2); }
});
test("NEXT_PUBLIC_SUPABASE_URL y SUPABASE_URL incoherentes con STAGING_SUPABASE_URL → FAIL (exit 1), no de guarda", async () => {
  const otra = "https://zzzzzzzzzz0123456789.supabase.co";
  for (const [n, id] of [["NEXT_PUBLIC_SUPABASE_URL", "L04"], ["SUPABASE_URL", "L05"]]) { const x = await correr(["--local"], { env: envOk({ [n]: otra }) }); assert.equal(estado(x, id), "FAIL", n); assert.equal(x.codigo, 1, x.texto); }
  assert.equal((await correr(["--local"], { env: envOk({ NEXT_PUBLIC_SUPABASE_URL: URL_OK + "/" }) })).codigo, 0, "la barra final se tolera");
});

// ═══════════════ 3. Variables faltantes ═══════════════
test("cada variable obligatoria ausente → FAIL en su chequeo (guarda→2 para entorno/ref/URL; resto→1)", async () => {
  const casos = [["TILA_ENTORNO", "L01", 2], ["TILA_STAGING_SUPABASE_REF", "L02", 2], ["STAGING_SUPABASE_URL", "L03", 2], ["NEXT_PUBLIC_SUPABASE_URL", "L04", 1], ["SUPABASE_URL", "L05", 1], ["STAGING_ANON_KEY", "L06", 1],
    ["STAGING_SERVICE_ROLE_KEY", "L07", 1], ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "L08", 1], ["SUPABASE_SERVICE_ROLE_KEY", "L09", 1], ["TILA_SESSION_SECRET", "L12", 1], ["NEXT_PUBLIC_BASE_URL", "L13", 1]];
  for (const [n, id, codigo] of casos) {
    const x = await correr(["--local"], { env: sin(envOk(), n) }); assert.equal(estado(x, id), "FAIL", n); assert.equal(x.codigo, codigo, `${n}\n${x.texto}`); assert.match(x.texto, /falta/);
  }
});
test("variables vacías o solo espacios cuentan como ausentes", async () => {
  for (const n of ["STAGING_ANON_KEY", "TILA_SESSION_SECRET", "NEXT_PUBLIC_BASE_URL"]) assert.equal((await correr(["--local"], { env: envOk({ [n]: "   " }) })).codigo, 1, n);
});

// ═══════════════ 4. Claves: cruzadas, incoherentes, forma ═══════════════
test("anon y service_role CRUZADAS (intercambiadas) → FAIL en L06, L07 y L10 (exit 1)", async () => {
  const x = await correr(["--local"], { env: envOk({ STAGING_ANON_KEY: SVC, NEXT_PUBLIC_SUPABASE_ANON_KEY: SVC, STAGING_SERVICE_ROLE_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: ANON }) });
  for (const id of ["L06", "L07", "L10"]) assert.equal(estado(x, id), "FAIL", id); assert.equal(x.codigo, 1); sinSecretos(x.texto);
});
test("cruce parcial: anon con sb_secret_, service con sb_publishable_, misma clave en ambas, o cruce en las variables de la app → FAIL", async () => {
  for (const env of [envOk({ STAGING_ANON_KEY: SVC, NEXT_PUBLIC_SUPABASE_ANON_KEY: SVC }), envOk({ STAGING_SERVICE_ROLE_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: ANON }), envOk({ STAGING_SERVICE_ROLE_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: ANON, STAGING_ANON_KEY: ANON, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON }),
    envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: SVC }), envOk({ SUPABASE_SERVICE_ROLE_KEY: ANON })]) {
    const x = await correr(["--local"], { env }); assert.equal(x.codigo, 1, x.texto); assert.equal(estado(x, "L10"), "FAIL");
  }
});
test("claves JWT con rol cambiado (anon con service_role / service con anon) → FAIL", async () => {
  const a = jwt({ role: "anon", ref: REF }), s = jwt({ role: "service_role", ref: REF });
  assert.equal((await correr(["--local"], { env: envOk({ STAGING_ANON_KEY: a, NEXT_PUBLIC_SUPABASE_ANON_KEY: a, STAGING_SERVICE_ROLE_KEY: s, SUPABASE_SERVICE_ROLE_KEY: s }) })).codigo, 0);
  const x = await correr(["--local"], { env: envOk({ STAGING_ANON_KEY: s, NEXT_PUBLIC_SUPABASE_ANON_KEY: s, STAGING_SERVICE_ROLE_KEY: a, SUPABASE_SERVICE_ROLE_KEY: a }) });
  assert.equal(x.codigo, 1); assert.equal(estado(x, "L06"), "FAIL"); assert.equal(estado(x, "L07"), "FAIL");
});
test("claves JWT: ref de staging → L11 PASS; ref de producción u otro ref → FAIL de guarda (exit 2); sin ref → INCONCLUSO (exit 3)", async () => {
  const a = (ref) => jwt({ role: "anon", ref }), s = (ref) => jwt({ role: "service_role", ref });
  const par = (ra, rs) => envOk({ STAGING_ANON_KEY: a(ra), NEXT_PUBLIC_SUPABASE_ANON_KEY: a(ra), STAGING_SERVICE_ROLE_KEY: s(rs), SUPABASE_SERVICE_ROLE_KEY: s(rs) });
  const ok = await correr(["--local"], { env: par(REF, REF) }); assert.equal(estado(ok, "L11"), "PASS"); assert.equal(ok.codigo, 0);
  const prod = await correr(["--local"], { env: par(REF_PRODUCCION, REF) }); assert.equal(estado(prod, "L11"), "FAIL"); assert.equal(prod.codigo, 2); assert.match(prod.texto, /PRODUCCIÓN/);
  assert.equal((await correr(["--local"], { env: par(REF, "otroref0123456789xyz") })).codigo, 2);
  const sinRef = await correr(["--local"], { env: envOk({ STAGING_ANON_KEY: jwt({ role: "anon" }), NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon" }) }) }); assert.equal(estado(sinRef, "L11"), "INCONCLUSO"); assert.equal(sinRef.codigo, 3);
});
test("NEXT_PUBLIC_SUPABASE_ANON_KEY ≠ STAGING_ANON_KEY → L08 FAIL; SUPABASE_SERVICE_ROLE_KEY ≠ STAGING_SERVICE_ROLE_KEY → L09 FAIL (valores no impresos)", async () => {
  const otraAnon = "sb_publishable_OTRA0123456789abcdefABCDE", otraSvc = "sb_secret_OTRA0123456789abcdefABCDEFG";
  const a = await correr(["--local"], { env: envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: otraAnon }) }); assert.equal(estado(a, "L08"), "FAIL"); assert.equal(a.codigo, 1); assert.ok(!a.texto.includes(otraAnon));
  const b = await correr(["--local"], { env: envOk({ SUPABASE_SERVICE_ROLE_KEY: otraSvc }) }); assert.equal(estado(b, "L09"), "FAIL"); assert.equal(b.codigo, 1); assert.ok(!b.texto.includes(otraSvc));
});
test("claves con espacios/comillas, cortas, sin formato conocido o con referencia ${…} → FAIL", async () => {
  for (const v of [`"${ANON}"`, `${ANON} `, "corta", "una clave rara sin formato conocido 1234567890", "${STAGING_ANON_KEY}"]) { const x = await correr(["--local"], { env: envOk({ STAGING_ANON_KEY: v }) }); assert.equal(estado(x, "L06"), "FAIL", v); assert.equal(x.codigo, 1); }
});
test("clave con ref/host de producción → FAIL de guarda (exit 2)", async () => {
  const x = await correr(["--local"], { env: envOk({ STAGING_ANON_KEY: `sb_publishable_${REF_PRODUCCION}abcdefghij`, NEXT_PUBLIC_SUPABASE_ANON_KEY: `sb_publishable_${REF_PRODUCCION}abcdefghij` }) }); assert.equal(x.codigo, 2);
});

// ═══════════════ 5. Secreto de sesión, base URL, TLS, MP ═══════════════
test("TILA_SESSION_SECRET: corto (<32), con espacios, poca variedad o reutilizando una clave → FAIL; 32 exactos → PASS", async () => {
  for (const s of ["x".repeat(31), "a".repeat(40), `${"ab".repeat(10)} ${"cd".repeat(10)}`, SVC.padEnd(40, "x")]) { const x = await correr(["--local"], { env: envOk({ TILA_SESSION_SECRET: s, ...(s.startsWith("sb_") ? { STAGING_SERVICE_ROLE_KEY: s, SUPABASE_SERVICE_ROLE_KEY: s } : {}) }) }); assert.equal(estado(x, "L12"), "FAIL", s.slice(0, 6)); assert.equal(x.codigo, 1); }
  assert.equal(estado(await correr(["--local"], { env: envOk({ TILA_SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz012345" }) }), "L12"), "PASS");
});
test("NEXT_PUBLIC_BASE_URL: app de producción → FAIL de guarda (2); host remoto no declarado / no-URL → FAIL (1); loopback y host declarado → PASS", async () => {
  const p = await correr(["--local"], { env: envOk({ NEXT_PUBLIC_BASE_URL: `https://${HOSTS_PRODUCCION[1]}` }) }); assert.equal(p.codigo, 2); assert.equal(estado(p, "L13"), "FAIL");
  for (const u of ["https://otro.example.com", "no-url"]) assert.equal((await correr(["--local"], { env: envOk({ NEXT_PUBLIC_BASE_URL: u }) })).codigo, 1, u);
  assert.equal((await correr(["--local"], { env: envOk({ NEXT_PUBLIC_BASE_URL: "http://localhost:3131" }) })).codigo, 0);
  assert.equal((await correr(["--local"], { env: envOk({ NEXT_PUBLIC_BASE_URL: "https://tila-staging.vercel.app", TILA_STAGING_APP_HOSTS: "tila-staging.vercel.app" }) })).codigo, 0);
});
test("NODE_TLS_REJECT_UNAUTHORIZED=0 → L14 FAIL (exit 1); ausente u otro valor → PASS", async () => {
  const x = await correr(["--local"], { env: envOk({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }) }); assert.equal(estado(x, "L14"), "FAIL"); assert.equal(x.codigo, 1);
  assert.equal(estado(await correr(["--local"], { env: envOk({ NODE_TLS_REJECT_UNAUTHORIZED: "1" }) }), "L14"), "PASS");
});
test("MERCADOPAGO_ACCESS_TOKEN: APP_USR- (producción) → FAIL de guarda (2); TEST- → PASS; ausente → PASS con aviso", async () => {
  assert.equal((await correr(["--local"], { env: envOk({ MERCADOPAGO_ACCESS_TOKEN: "APP_USR-123456789-produccion" }) })).codigo, 2);
  const t = await correr(["--local"], { env: envOk({ MERCADOPAGO_ACCESS_TOKEN: MP }) }); assert.equal(t.codigo, 0); sinSecretos(t.texto);
  assert.match((await correr(["--local"])).texto, /no configurada/);
});

// ═══════════════ 6. Contaminación de producción ═══════════════
test("contaminación del entorno efectivo: cualquier variable (aunque no sea crítica) con ref/host de producción → FAIL de guarda, informando SOLO nombres", async () => {
  for (const [n, v] of [["OTRA_URL", `https://${REF_PRODUCCION}.supabase.co/rest/v1`], ["PROXY_APP", `https://${HOSTS_PRODUCCION[1]}/api`], ["DATABASE_URL", `postgres://u:p@db.${REF_PRODUCCION}.supabase.co:5432/postgres`]]) {
    const x = await correr(["--local"], { env: envOk({ [n]: v }) });
    assert.equal(estado(x, "L15"), "FAIL", n); assert.equal(x.codigo, 2); assert.ok(x.texto.includes(n)); assert.ok(!x.texto.includes(REF_PRODUCCION) && !x.texto.includes(v));
  }
});
test("contaminación por JWT de producción (el ref viene dentro del token, no como texto) → detectada", async () => {
  const j = jwt({ role: "anon", ref: REF_PRODUCCION });
  const x = await correr(["--local"], { env: envOk({ ALGUN_TOKEN: j }) }); assert.equal(estado(x, "L15"), "FAIL"); assert.equal(x.codigo, 2); assert.ok(x.texto.includes("ALGUN_TOKEN")); assert.ok(!x.texto.includes(j));
});
test("un valor de producción del shell que pisa a .env.staging (Node --env-file no sobrescribe) se detecta porque el entorno EFECTIVO es el que se revisa", async () => {
  const x = await correr(["--local"], { env: envOk({ SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` }), archivos: { [`${RAIZ}/.env.staging`]: `SUPABASE_URL=${URL_OK}\n` } });
  assert.equal(x.codigo, 2); assert.equal(estado(x, "L05"), "FAIL"); assert.equal(estado(x, "L15"), "FAIL"); assert.ok(x.texto.includes("SUPABASE_URL"));
});
test("entorno limpio: L15 PASS y dice cuántas variables revisó", async () => { const x = await correr(["--local"]); assert.equal(estado(x, "L15"), "PASS"); assert.match(x.texto, /variables revisadas/); });

// ═══════════════ 7. Archivos .env* (solo nombres) ═══════════════
test(".env.staging inexistente: estado ESPERADO (PASS con aviso), no un fallo", async () => {
  const x = await correr(["--local"]); assert.equal(estado(x, "F01"), "PASS"); assert.match(x.texto, /estado esperado/); assert.equal(x.codigo, 0);
});
test(".env.staging existente sin producción: PASS (solo nombres revisados)", async () => {
  const x = await correr(["--local"], { archivos: { [`${RAIZ}/.env.staging`]: `# c\nTILA_ENTORNO=staging\nSTAGING_ANON_KEY=${ANON}\nSTAGING_SERVICE_ROLE_KEY=${SVC}\n` } });
  assert.equal(estado(x, "F01"), "PASS"); assert.match(x.texto, /3 variables/); sinSecretos(x.texto);
});
test(".env.staging con valores de producción (texto o JWT) → FAIL de guarda (2) con solo NOMBRES", async () => {
  const j = jwt({ role: "service_role", ref: REF_PRODUCCION });
  const x = await correr(["--local"], { archivos: { [`${RAIZ}/.env.staging`]: `SUPABASE_URL=https://${REF_PRODUCCION}.supabase.co\nSUPABASE_SERVICE_ROLE_KEY="${j}"\nOK=1\n` } });
  assert.equal(estado(x, "F01"), "FAIL"); assert.equal(x.codigo, 2); assert.match(x.texto, /SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/); assert.ok(!x.texto.includes(j) && !x.texto.includes(REF_PRODUCCION));
});
test(".env.local y app/.env.local con valores de producción: AVISO (PASS), sin imprimir contenido ni el ref; el veredicto no cambia", async () => {
  const x = await correr(["--local"], { archivos: {
    [`${RAIZ}/.env.local`]: `NEXT_PUBLIC_SUPABASE_URL=https://${REF_PRODUCCION}.supabase.co\nMERCADOPAGO_ACCESS_TOKEN=${VALOR_ENV_LOCAL}\n`,
    [`${RAIZ}/app/.env.local`]: `SUPABASE_URL=https://${REF_PRODUCCION}.supabase.co\n`, [`${RAIZ}/.env`]: "X=1\n" } });
  assert.equal(x.codigo, 0, x.texto); assert.equal(estado(x, "F02"), "PASS");
  assert.match(x.texto, /AVISO: contienen valores de producción/); assert.match(x.texto, /\.env\.local \(NEXT_PUBLIC_SUPABASE_URL\)/); assert.match(x.texto, /app\/\.env\.local \(SUPABASE_URL\)/); assert.match(x.texto, /levantar-staging\.mjs/);
  sinSecretos(x.texto); assert.ok(!x.texto.includes(REF_PRODUCCION));
});
test("analizarArchivoEnv: solo nombres; ignora comentarios; detecta ref/host/JWT de producción", () => {
  const a = V.analizarArchivoEnv(`# ${REF_PRODUCCION}\nA=1\nexport B="https://${HOSTS_PRODUCCION[1]}"\nC=${jwt({ ref: REF_PRODUCCION })}\nD='ok'\n\nmal linea\n`);
  assert.deepEqual(a.nombres, ["A", "B", "C", "D"]); assert.deepEqual(a.conProduccion, ["B", "C"]);
});
test("fs ilegible / inexistente no rompe: F01 INCONCLUSO si no se puede leer; F02 sigue", async () => {
  const x = armar({ archivos: { [`${RAIZ}/.env.staging`]: "A=1" } });
  x.deps.fs.readFileSync = () => { throw new Error("EACCES"); };
  assert.equal(estado({ salida: (await (async () => { await V.main(["--local"], x.deps); return x.salida; })()), texto: x.salida.join("\n") }, "F01"), "INCONCLUSO");
});

// ═══════════════ 8. Git (solo lectura, con fake) ═══════════════
test("git: .env.staging ignorado y no trackeado → PASS; los comandos son EXACTAMENTE check-ignore -v y ls-files (solo lectura)", async () => {
  const git = gitFalso(); const x = await correr(["--local"], { git });
  assert.equal(estado(x, "G01"), "PASS"); assert.equal(estado(x, "G02"), "PASS"); assert.match(x.texto, /\.gitignore:54:\.env\*/);
  assert.deepEqual(git.llamadas, [["check-ignore", "-v", ".env.staging"], ["ls-files", "--", ".env.staging"]]);
});
test("git: NO ignorado → FAIL (exit 1); trackeado → FAIL de guarda (exit 2)", async () => {
  const a = await correr(["--local"], { git: gitFalso({ ignorado: false }) }); assert.equal(estado(a, "G01"), "FAIL"); assert.equal(a.codigo, 1);
  const b = await correr(["--local"], { git: gitFalso({ trackeado: true }) }); assert.equal(estado(b, "G02"), "FAIL"); assert.equal(b.codigo, 2); assert.match(b.texto, /git rm --cached/);
});
test("git no disponible, sin repositorio (status 128) o que lanza → INCONCLUSO (exit 3), sin asumir", async () => {
  for (const git of [gitFalso({ error: true }), gitFalso({ statusIgnore: 128 }), () => { throw new Error("boom"), 0; }]) { const x = await correr(["--local"], { git }); assert.equal(estado(x, "G01"), "INCONCLUSO"); assert.equal(x.codigo, 3, x.texto); }
  const sinGit = armar(); delete sinGit.deps.git; assert.equal(await V.main(["--local"], sinGit.deps), 3);
});
test("git nunca recibe comandos de escritura (add, commit, rm, config, check-ignore sin -v no, etc.)", async () => {
  const git = gitFalso(); await correr(["--local"], { git });
  for (const args of git.llamadas) assert.ok(["check-ignore", "ls-files"].includes(args[0]));
});

// ═══════════════ 9. Argumentos ═══════════════
test("claves/URLs/ref por argv → exit 2, sin eco y sin tocar entorno, git ni red", async () => {
  for (const a of [`--anon=${ANON}`, `--key=${SVC}`, `--service-role=${SVC}`, `--secret=${SESION}`, `--token=x`, `--supabase-url=${URL_OK}`, `--ref=${REF}`, "--url=x", "--apikey=y", SVC, ANON]) {
    const g = gitFalso(); const x = await correr(["--local", a], { git: g, fetch: trampa("fetch") });
    assert.equal(x.codigo, 2, a); assert.equal(g.llamadas.length, 0); sinSecretos(x.texto); assert.ok(!x.texto.includes(URL_OK) && !x.texto.includes(REF));
  }
});
test("argumento desconocido, --plan combinado con --local/--remoto → exit 2", async () => {
  for (const a of [["--todo"], ["--plan", "--local"], ["--plan", "--remoto"], ["--fix"]]) assert.equal((await correr(a)).codigo, 2, a.join(" "));
});

// ═══════════════ 10. --plan ═══════════════
test("--plan / --listar / --ayuda: sin env, sin fs, sin git, sin red; explica ambos niveles; exit 0", async () => {
  for (const flag of ["--plan", "--listar", "--ayuda"]) {
    const salida = [];
    const deps = { env: trampa("env"), fs: trampa("fs"), git: () => { throw new Error("git"); }, fetch: () => { throw new Error("fetch"); }, out: (l) => salida.push(l), err: () => { throw new Error("err"); } };
    assert.equal(await V.main([flag], deps), 0); const t = salida.join("\n");
    for (const m of ["NIVEL A", "NIVEL B", "L01", "L15", "G01", "G02", "F01", "R01", "R03", "/auth/v1/settings", "apikey", "SOLO LECTURA", "INCONCLUSO", "--remoto", "Sin modo", "0 todo PASS"]) assert.ok(t.includes(m), m);
    assert.ok(!t.includes("sb_secret_") && !t.includes("sb_publishable_"));
  }
});
test("--plan corre como script real con entorno vacío (sin git, sin archivos, sin red); argumento prohibido → exit 2", () => {
  const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" };
  const a = spawnSync(process.execPath, [SCRIPT, "--plan"], { env, encoding: "utf8", timeout: 30000 }); assert.equal(a.status, 0, a.stderr); assert.match(a.stdout, /NIVEL B/);
  const b = spawnSync(process.execPath, [SCRIPT, `--anon=${ANON}`], { env, encoding: "utf8", timeout: 30000 }); assert.equal(b.status, 2); assert.ok(!b.stdout.includes(ANON) && !b.stderr.includes(ANON));
});

// ═══════════════ 11. Nivel remoto (fake) ═══════════════
test("--remoto solo corre tras pasar --local: si el local falla (guarda o FAIL o INCONCLUSO) NO se abre ninguna conexión", async () => {
  const casos = [[envOk({ SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` }), 2], [envOk({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_OTRA0123456789abcdefABCDE" }), 1], [{}, 2], [envOk({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }), 1]];
  for (const [env, codigo] of casos) { const f = fetchFalso(reglaOk()); const x = await correr(["--remoto"], { env, fetch: f }); assert.equal(x.codigo, codigo, x.texto); assert.equal(f.llamadas.length, 0); assert.match(x.texto, /REMOTO NO EJECUTADO/); }
  const f = fetchFalso(reglaOk()); const x = await correr(["--remoto"], { git: gitFalso({ error: true }), fetch: f }); assert.equal(x.codigo, 3); assert.equal(f.llamadas.length, 0);
});
test("--remoto con local PASS y respuestas 200: R01–R03 PASS, exit 0; exactamente 3 GET de SOLO LECTURA al origen de staging, solo header apikey", async () => {
  const f = fetchFalso(reglaOk()); const x = await correr(["--remoto"], { fetch: f });
  assert.equal(x.codigo, 0, x.texto); for (const id of ["R01", "R02", "R03"]) assert.equal(estado(x, id), "PASS", id); assert.equal(estado(x, "R04"), "N/A");
  assert.deepEqual(f.llamadas.map((c) => c.url), [`${URL_OK}/auth/v1/settings`, `${URL_OK}/auth/v1/settings`, `${URL_OK}/rest/v1/`]);
  assert.deepEqual(f.llamadas.map((c) => c.init.headers.apikey), [ANON, SVC, SVC]);
  for (const c of f.llamadas) { assert.equal(c.init.method, "GET"); assert.deepEqual(Object.keys(c.init.headers).sort(), ["accept", "apikey"]); assert.equal(c.init.redirect, "manual"); assert.equal(c.init.body, undefined); assert.ok(c.url.startsWith(`${URL_OK}/`)); }
  sinSecretos(x.texto);
});
test("remoto: 401 'Invalid API key' → FAIL (exit 1), para anon y para service; el cuerpo no se imprime", async () => {
  const rechazo = (clave) => (url, init) => (init.headers.apikey === clave ? { status: 401, body: `{"message":"Invalid API key","hint":"${CUERPO_SECRETO}"}` } : reglaOk()(url));
  const a = await correr(["--remoto"], { fetch: fetchFalso(rechazo(ANON)) }); assert.equal(estado(a, "R01"), "FAIL"); assert.equal(a.codigo, 1); sinSecretos(a.texto);
  const s = await correr(["--remoto"], { fetch: fetchFalso(rechazo(SVC)) }); assert.equal(estado(s, "R02"), "FAIL"); assert.equal(s.codigo, 1); sinSecretos(s.texto);
});
test("remoto: 403, 401 con otro mensaje, 404, 5xx, redirección y cuerpo inesperado → INCONCLUSO (exit 3), nunca PASS ni FAIL asumidos", async () => {
  for (const r of [{ status: 403, body: "{}" }, { status: 401, body: '{"message":"otra cosa"}' }, { status: 404, body: "" }, { status: 503, body: "" }, { status: 302, body: "" }]) {
    const x = await correr(["--remoto"], { fetch: fetchFalso(() => r) }); assert.equal(estado(x, "R01"), "INCONCLUSO", JSON.stringify(r)); assert.equal(estado(x, "R02"), "INCONCLUSO"); assert.equal(x.codigo, 3, x.texto);
  }
});
test("remoto: red caída o excepción → INCONCLUSO (exit 3); sin respuesta a tiempo → INCONCLUSO por timeout", async () => {
  const a = await correr(["--remoto"], { fetch: fetchFalso(() => ({ lanzar: "ECONNREFUSED" })) }); assert.equal(a.codigo, 3); assert.equal(estado(a, "R01"), "INCONCLUSO");
  const b = await correr(["--remoto"], { fetch: fetchFalso(() => ({ colgar: true })), timeouts: { llamadaMs: 40, totalMs: 5000 } }); assert.equal(b.codigo, 3, b.texto); assert.match(b.texto, /sin respuesta en 40 ms/);
});
test("remoto: R03 (privilegios elevados) sin OpenAPI o 401/403 → INCONCLUSO, no FAIL; con OpenAPI → PASS", async () => {
  const x = await correr(["--remoto"], { fetch: fetchFalso((url) => (url.endsWith("/rest/v1/") ? { status: 401, body: '{"message":"x"}' } : { status: 200, body: "{}" })) });
  assert.equal(estado(x, "R01"), "PASS"); assert.equal(estado(x, "R03"), "INCONCLUSO"); assert.equal(x.codigo, 3);
  const y = await correr(["--remoto"], { fetch: fetchFalso((url) => (url.endsWith("/rest/v1/") ? { status: 200, body: '{"ok":true}' } : { status: 200, body: "{}" })) }); assert.equal(estado(y, "R03"), "INCONCLUSO");
});
test("remoto: header sb-project-ref distinto del ref de staging → FAIL de guarda (exit 2); igual → PASS", async () => {
  const mal = await correr(["--remoto"], { fetch: fetchFalso(reglaOk({ headers: { "sb-project-ref": REF_PRODUCCION } })) }); assert.equal(estado(mal, "R04"), "FAIL"); assert.equal(mal.codigo, 2); assert.ok(!mal.texto.includes(REF_PRODUCCION));
  const bien = await correr(["--remoto"], { fetch: fetchFalso(reglaOk({ headers: { "sb-project-ref": REF } })) }); assert.equal(estado(bien, "R04"), "PASS"); assert.equal(bien.codigo, 0);
});
test("remoto: la URL usada se construye desde el ref validado, NO desde las URLs crudas del entorno", async () => {
  const f = fetchFalso(reglaOk()); await correr(["--remoto"], { env: envOk({ NEXT_PUBLIC_SUPABASE_URL: URL_OK + "/" }), fetch: f });
  for (const c of f.llamadas) assert.ok(c.url.startsWith(`https://${HOST}/`));
});
test("remoto sin fetch inyectado → INCONCLUSO (exit 3), sin excepciones", async () => {
  const x = armar(); delete x.deps.fetch; assert.equal(await V.main(["--remoto"], x.deps), 3);
});
test("clasificarRespuestaClave: tabla de decisión", () => {
  const C = V.clasificarRespuestaClave;
  assert.equal(C({ status: 200, cuerpo: "" }).veredicto, "aceptada"); assert.equal(C({ status: 401, cuerpo: '{"message":"Invalid API key"}' }).veredicto, "rechazada"); assert.equal(C({ status: 401, cuerpo: "INVALID API KEY" }).veredicto, "rechazada");
  for (const s of [301, 302, 400, 403, 404, 429, 500, 503]) assert.equal(C({ status: s, cuerpo: "Invalid API key" }).veredicto, "ambigua", String(s));
  assert.equal(C({ status: 401, cuerpo: "otra" }).veredicto, "ambigua");
});

// ═══════════════ 12. Resumen, secretos y estructura ═══════════════
test("resumir: precedencia 2 → 1 → 3 → 0 y N/A no cuenta", () => {
  const k = (estado, guarda = false) => ({ estado, guarda });
  assert.equal(V.resumir([k("PASS"), k("N/A")]).codigo, 0); assert.equal(V.resumir([k("INCONCLUSO"), k("PASS")]).codigo, 3); assert.equal(V.resumir([k("FAIL"), k("INCONCLUSO")]).codigo, 1);
  assert.equal(V.resumir([k("FAIL", true), k("FAIL")]).codigo, 2); assert.equal(V.resumir([k("FAIL", true), k("INCONCLUSO")]).codigo, 2); assert.equal(V.resumir([k("PASS", true)]).codigo, 0);
});
test("los códigos 0, 1, 2 y 3 son alcanzables", async () => {
  const c = [(await correr(["--local"])).codigo, (await correr(["--local"], { env: envOk({ SUPABASE_URL: "https://otro0000000000000000.supabase.co" }) })).codigo, (await correr(["--local"], { env: {} })).codigo, (await correr(["--local"], { git: gitFalso({ error: true }) })).codigo];
  assert.deepEqual(c, [0, 1, 2, 3]);
});
test("ningún secreto aparece en ninguna salida (local, remoto, errores), aunque estén en variables inesperadas o en .env*", async () => {
  const salidas = [];
  salidas.push((await correr(["--local"], { env: envOk({ MERCADOPAGO_ACCESS_TOKEN: MP, NADA: SVC }) })).texto);
  salidas.push((await correr(["--remoto"], { env: envOk({ MERCADOPAGO_ACCESS_TOKEN: MP }), fetch: fetchFalso(reglaOk()) })).texto);
  salidas.push((await correr(["--remoto"], { fetch: fetchFalso(() => ({ lanzar: `fallo con ${SVC} y ${ANON} Bearer abcdef1234567890` })) })).texto);
  salidas.push((await correr(["--local"], { env: envOk({ SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` }), archivos: { [`${RAIZ}/.env.local`]: `X=${VALOR_ENV_LOCAL}\nSUPABASE_URL=https://${REF_PRODUCCION}.supabase.co\n` } })).texto);
  for (const t of salidas) { sinSecretos(t); assert.ok(!t.includes("abcdef1234567890")); }
  assert.ok(salidas[0].includes("[CONFIGURADA]"));
});
test("auditoría estática: red solo en llamar() con GET; git solo en depsReales; process.env solo en depsReales; sin shell, sin escritura, sin Authorization, sin métodos mutantes", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const lineas = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/**"));
  const codigo = lineas.join("\n");
  assert.equal((codigo.match(/deps\.fetch\(/g) ?? []).length, 1, "un único punto de red");
  assert.ok(!/["'`](POST|PUT|PATCH|DELETE)["'`]/.test(codigo)); assert.ok(!/\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/.test(codigo));
  assert.ok(!/authorization["'`]?s*:/i.test(codigo) && !/bearers*${/i.test(codigo), "no se arma Authorization"); assert.ok(!/writeFile|appendFile|unlink|rmSync|mkdirSync|copyFile|rename/.test(codigo));
  assert.ok(!/shell\s*:\s*true/.test(codigo)); assert.equal((codigo.match(/spawnSync\(/g) ?? []).length, 1); assert.match(codigo, /spawnSync\("git"/);
  const usosEnv = lineas.filter((l) => l.includes("process.env")); assert.ok(usosEnv.length >= 1 && usosEnv.every((l) => /get env\(\)|process\.env\[k\]|typeof process\.env/.test(l)), "process.env solo dentro de depsReales");
  assert.ok(!codigo.includes(REF_PRODUCCION) && HOSTS_PRODUCCION.every((h) => !codigo.includes(h)));
  const imports = [...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./guardas.mjs", "./smoke/v3-anon.mjs", "node:child_process", "node:fs", "node:path", "node:url"].sort());
  const fuera = codigo.replace(/export const TIMEOUTS = Object\.freeze\(\{[\s\S]*?\}\);/, ""); assert.ok(!/setTimeout\([^)]*,\s*\d{2,}/.test(fuera), "tiempos solo en TIMEOUTS");
});
test("valorDeProduccion y constantes", () => {
  assert.equal(V.valorDeProduccion(`x${REF_PRODUCCION}y`), true); assert.equal(V.valorDeProduccion(jwt({ ref: REF_PRODUCCION })), true); assert.equal(V.valorDeProduccion(jwt({ ref: REF })), false); assert.equal(V.valorDeProduccion(URL_OK), false);
  assert.equal(V.SECRETO_SESION_MIN, 32); assert.ok(Object.isFrozen(V.TIMEOUTS)); assert.equal(V.ARCHIVO_STAGING, ".env.staging");
});
