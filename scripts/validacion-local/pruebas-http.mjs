// Matriz de pruebas HTTP contra el entorno local aislado (ver levantar-entorno.mjs).
// Todo va al Supabase SIMULADO. No toca producción.
// Uso: TILA_VAL_DIR=<dir> node scripts/validacion-local/pruebas-http.mjs [salida.json]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { firmarSesion, verificarSesion, NOMBRE_COOKIE_SESION } from "../../app/lib/auth/sesion.ts";
import { IDS, CLAVES, EMAILS } from "./mock-supabase.mjs";

const dir = process.env.TILA_VAL_DIR || path.join(os.tmpdir(), "tila-validacion");
const estado = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
const SECRETO = estado.secreto;
const ENV_SESION = { TILA_SESSION_SECRET: SECRETO };
const base = (modo) => { const m = estado.modos.find((x) => x.modo === modo); return `http://${m.host}:${m.puerto}`; };
const SENSIBLES = ["password", "cuit_cuil", "antecedentes", "alias_cbu_cvu", "titular_cuenta", "banco_billetera", "metodo_cobro", "cnrt_ruta", "vtv_rto"];
const MODOS = ["legacy", "dual", "strict"];

const resultados = []; // { prueba, esperado: {legacy,dual,strict}, real: {..}, pass }
const registrar = (prueba, esperado, real, nota = "") => {
  const pass = MODOS.every((m) => String(esperado[m]) === String(real[m]));
  resultados.push({ prueba, esperado, real, pass, nota });
  console.log(`${pass ? "PASS" : "FAIL"}  ${prueba}  esperado=${JSON.stringify(esperado)} real=${JSON.stringify(real)}${nota ? "  · " + nota : ""}`);
};

async function login(url, rol, extraHeaders = {}, clave = CLAVES[rol]) {
  const r = await fetch(url + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify({ email: EMAILS[rol], password: clave }),
  });
  const texto = await r.text();
  return { status: r.status, texto, json: (() => { try { return JSON.parse(texto); } catch { return null; } })(), setCookie: r.headers.getSetCookie(), headers: r.headers };
}
const tokenDe = (setCookie) => (setCookie.find((c) => c.startsWith(NOMBRE_COOKIE_SESION + "=")) || "").split(";")[0].split("=").slice(1).join("=");
const api = async (url, ruta, headers = {}, metodo = "GET") => {
  const r = await fetch(url + ruta, { method: metodo, headers });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
};

// ── 1. LOGIN ────────────────────────────────────────────────────────────────
const L = {};
for (const modo of [...MODOS, "legacy-sin-secreto"]) L[modo] = { chofer: await login(base(modo), "chofer"), cliente: await login(base(modo), "cliente"), admin: await login(base(modo), "admin") };

// 1.1 cuerpo == esperado (columnas del usuario sin campos sensibles) y idéntico entre modos y sin secreto
const esperadoCuerpo = (rol) => {
  // el mock devuelve la misma fila que usa el login; se reconstruye la fila esperada desde el propio mock
  return fetch("http://127.0.0.1:4545/rest/v1/usuarios?select=*&id=eq." + IDS[rol]).then((r) => r.json()).then(([u]) => ({
    ok: true, usuario: Object.fromEntries(Object.entries(u).filter(([k]) => !SENSIBLES.includes(k))),
  }));
};
for (const rol of ["cliente", "chofer", "admin"]) {
  const gold = JSON.stringify(await esperadoCuerpo(rol));
  const real = {}; const exp = {};
  for (const m of MODOS) { real[m] = L[m][rol].status === 200 && L[m][rol].texto === gold; exp[m] = true; }
  registrar(`login ${rol}: 200 + cuerpo idéntico al esperado (ok+usuario sin campos sensibles)`, exp, real);
  const ident = {}; const expI = {};
  for (const m of MODOS) { ident[m] = L[m][rol].texto === L["legacy-sin-secreto"][rol].texto; expI[m] = true; }
  registrar(`login ${rol}: cuerpo byte a byte IGUAL al del servidor SIN secreto (código sin efecto)`, expI, ident);
}
{
  const real = {}, exp = {};
  for (const m of MODOS) { const t = L[m].chofer.texto; real[m] = !/password|cuit_cuil|antecedentes|alias_cbu|token|tila_sesion/i.test(t); exp[m] = true; }
  registrar("login: el cuerpo NO expone password/CBU/token/cookie", exp, real);
}
{
  const real = {}, exp = {};
  for (const m of MODOS) { const h = L[m].chofer.headers; real[m] = `${h.get("content-type")}|${L[m].chofer.status}` === `${L["legacy-sin-secreto"].chofer.headers.get("content-type")}|200`; exp[m] = true; }
  registrar("login: status y Content-Type iguales al servidor sin secreto", exp, real);
}

// 1.2 cookie
const cookieProps = (m, rol = "chofer") => {
  const c = L[m][rol].setCookie.find((x) => x.startsWith(NOMBRE_COOKIE_SESION + "=")) || "";
  return { c, tok: tokenDe(L[m][rol].setCookie) };
};
{
  const real = {}, exp = {};
  for (const m of MODOS) real[m] = L[m].chofer.setCookie.filter((c) => c.startsWith(NOMBRE_COOKIE_SESION + "=")).length; for (const m of MODOS) exp[m] = 1;
  registrar("login chofer: emite exactamente 1 cookie tila_sesion", exp, real);
  const r2 = {}, e2 = {};
  for (const m of MODOS) { const { c } = cookieProps(m); r2[m] = /;\s*HttpOnly/i.test(c); e2[m] = true; }
  registrar("cookie tila_sesion es HttpOnly", e2, r2);
  const r3 = {}, e3 = {};
  for (const m of MODOS) { const { c } = cookieProps(m); r3[m] = /;\s*SameSite=Lax/i.test(c) && /;\s*Path=\//i.test(c) && /Max-Age=7776000/.test(c); e3[m] = true; }
  registrar("cookie: SameSite=Lax, Path=/, Max-Age=90 días", e3, r3);
  const r4 = {}, e4 = {};
  for (const m of MODOS) { const { c } = cookieProps(m); r4[m] = !/;\s*Secure/i.test(c); e4[m] = true; }
  registrar("cookie SIN Secure sobre http (localhost)", e4, r4, "un navegador rechazaría Secure sobre http en hosts no-localhost");
  const r5 = {}, e5 = {};
  for (const m of MODOS) {
    const x = await login(base(m), "chofer", { "x-forwarded-proto": "https" });
    r5[m] = /;\s*Secure/i.test(x.setCookie.find((c) => c.startsWith(NOMBRE_COOKIE_SESION + "=")) || ""); e5[m] = true;
  }
  registrar("cookie CON Secure cuando llega por https (x-forwarded-proto, como en Vercel)", e5, r5);
  const r6 = {}, e6 = {};
  for (const m of MODOS) {
    const v = verificarSesion(cookieProps(m).tok, { env: ENV_SESION });
    r6[m] = v.ok && v.userId === IDS.chofer && v.alcance === "completa"; e6[m] = true;
  }
  registrar("el token de la cookie verifica y pertenece al usuario logueado (sub=chofer, alcance completa)", e6, r6);
  const r7 = {}, e7 = {};
  for (const m of MODOS) { const tok = cookieProps(m).tok; r7[m] = !!tok && !L[m].chofer.texto.includes(tok) && ![...L[m].chofer.headers.entries()].some(([k, v]) => k !== "set-cookie" && v.includes(tok)); e7[m] = true; }
  registrar("el token NO aparece en el cuerpo ni en ninguna otra cabecera (solo en Set-Cookie)", e7, r7);
  const r8 = {}, e8 = {};
  for (const m of MODOS) { const s = L[m].chofer.setCookie.length; r8[m] = s; e8[m] = 1; }
  registrar("servidor SIN secreto: login sin Set-Cookie (comportamiento anterior)", { legacy: 0, dual: 0, strict: 0 }, { legacy: L["legacy-sin-secreto"].chofer.setCookie.length, dual: L["legacy-sin-secreto"].admin.setCookie.length, strict: L["legacy-sin-secreto"].cliente.setCookie.length }, "los 3 roles en el servidor sin secreto");
}
// 1.3 login fallido
{
  const real = {}, exp = {};
  for (const m of MODOS) {
    const x = await login(base(m), "chofer", {}, "clave-incorrecta");
    const y = await login(base("legacy-sin-secreto"), "chofer", {}, "clave-incorrecta");
    real[m] = `${x.status}|${x.setCookie.length}|${x.texto === y.texto}`; exp[m] = "401|0|true";
  }
  registrar("login con clave incorrecta: 401, mismo cuerpo que sin secreto, SIN cookie", exp, real);
}

// ── 2. RUTA PILOTO /api/chofer/billetera ────────────────────────────────────
const tokChofer = Object.fromEntries(MODOS.map((m) => [m, tokenDe(L[m].chofer.setCookie)]));
const tokCliente = Object.fromEntries(MODOS.map((m) => [m, tokenDe(L[m].cliente.setCookie)]));
const RUTA = "/api/chofer/billetera";
const casoPiloto = async (nombre, mkHeaders, esperado, nota = "") => {
  const real = {};
  for (const m of MODOS) { const r = await api(base(m), RUTA, mkHeaders(m)); real[m] = `${r.status}${r.status === 200 ? ":" + (r.json.data?.length ?? "?") + "mov/" + (r.json.data?.[0]?.monto ?? "?") : ""}`; }
  registrar(`piloto billetera — ${nombre}`, esperado, real, nota);
};
const OK = "200:1mov/1850000";
await casoPiloto("solo x-user-id (chofer)", () => ({ "x-user-id": IDS.chofer }), { legacy: OK, dual: OK, strict: 401 });
await casoPiloto("solo cookie válida (chofer)", (m) => ({ cookie: `${NOMBRE_COOKIE_SESION}=${tokChofer[m]}` }), { legacy: 401, dual: OK, strict: OK }, "legacy ignora la cookie");
await casoPiloto("solo Bearer válido (chofer)", (m) => ({ authorization: `Bearer ${tokChofer[m]}` }), { legacy: 401, dual: OK, strict: OK });
await casoPiloto("cookie + x-user-id iguales", (m) => ({ cookie: `${NOMBRE_COOKIE_SESION}=${tokChofer[m]}`, "x-user-id": IDS.chofer }), { legacy: OK, dual: OK, strict: OK });
await casoPiloto("cookie de chofer + x-user-id de OTRO usuario (cliente)", (m) => ({ cookie: `${NOMBRE_COOKIE_SESION}=${tokChofer[m]}`, "x-user-id": IDS.cliente }), { legacy: 403, dual: 403, strict: OK }, "strict: manda la sesión; dual: manda el header (compatibilidad)");
await casoPiloto("solo cookie válida de CLIENTE (rol equivocado)", (m) => ({ cookie: `${NOMBRE_COOKIE_SESION}=${tokCliente[m]}` }), { legacy: 401, dual: 403, strict: 403 }, "identifica bien; el rol lo rechaza la ruta");
await casoPiloto("cookie manipulada", (m) => ({ cookie: `${NOMBRE_COOKIE_SESION}=${tokChofer[m].slice(0, -3)}AAA` }), { legacy: 401, dual: 401, strict: 401 });
await casoPiloto("cookie firmada con OTRO secreto", () => ({ cookie: `${NOMBRE_COOKIE_SESION}=${firmarSesion(IDS.chofer, { env: { TILA_SESSION_SECRET: "otro-secreto-".padEnd(48, "z") } })}` }), { legacy: 401, dual: 401, strict: 401 });
await casoPiloto("cookie expirada", () => ({ cookie: `${NOMBRE_COOKIE_SESION}=${firmarSesion(IDS.chofer, { env: ENV_SESION, ttlSeg: 60, ahora: Date.now() - 3600_000 })}` }), { legacy: 401, dual: 401, strict: 401 });
await casoPiloto("cookie de sesión 'registro' en ruta que no la permite", () => ({ cookie: `${NOMBRE_COOKIE_SESION}=${firmarSesion(IDS.chofer, { env: ENV_SESION, alcance: "registro" })}` }), { legacy: 401, dual: 401, strict: 401 });
await casoPiloto("x-user-id inexistente", () => ({ "x-user-id": "00000000-0000-0000-0000-00000000dead" }), { legacy: 401, dual: 401, strict: 401 });
await casoPiloto("sin credenciales", () => ({}), { legacy: 401, dual: 401, strict: 401 });
await casoPiloto("x-user-id de cliente (rol equivocado)", () => ({ "x-user-id": IDS.cliente }), { legacy: 403, dual: 403, strict: 401 });
{
  // legacy: respuesta idéntica al servidor sin secreto para el mismo header
  const a = await api(base("legacy"), RUTA, { "x-user-id": IDS.chofer });
  const b = await api(base("legacy-sin-secreto"), RUTA, { "x-user-id": IDS.chofer });
  const same = JSON.stringify(a.json) === JSON.stringify(b.json) && a.status === b.status;
  registrar("piloto: legacy con secreto == servidor sin secreto (mismo cuerpo y status)", { legacy: true, dual: true, strict: true }, { legacy: same, dual: same, strict: same }, "misma respuesta");
}

// ── 3. RUTAS NO MIGRADAS: deben comportarse EXACTAMENTE igual en los 3 modos ─
const noMig = [
  ["GET /api/cargas/disponibles (chofer, header)", "/api/cargas/disponibles", { "x-user-id": IDS.chofer }, (r) => r.status === 200 && r.json.cargas?.length === 1],
  ["GET /api/admin/cargas (admin, header)", "/api/admin/cargas", { "x-user-id": IDS.admin }, (r) => r.status === 200 && r.json.cargas?.length === 2],
  ["GET /api/cargas/activa (chofer, header)", "/api/cargas/activa", { "x-user-id": IDS.chofer }, (r) => r.status === 200],
];
for (const [nombre, ruta, headers, ok] of noMig) {
  const real = {}, exp = {};
  for (const m of MODOS) { real[m] = ok(await api(base(m), ruta, headers)); exp[m] = true; }
  registrar(`no migrada ${nombre}: sigue funcionando (x-user-id)`, exp, real);
}
{
  const real = {}, exp = {};
  for (const m of MODOS) { const r = await api(base(m), "/api/cargas/disponibles", { cookie: `${NOMBRE_COOKIE_SESION}=${tokChofer[m]}` }); real[m] = r.status; exp[m] = 401; }
  registrar("no migrada /api/cargas/disponibles: cookie sola NO autentica (aún no usa el resolver)", exp, real, "confirma que ninguna otra API cambió");
}
{
  const real = {}, exp = {};
  for (const m of MODOS) { const r = await api(base(m), "/api/admin/cargas", { "x-user-id": IDS.cliente }); real[m] = r.status; exp[m] = 403; }
  registrar("no migrada /api/admin/cargas: cliente sigue recibiendo 403", exp, real);
}

// Rutas migradas en el Lote 1 (ya no son "no migradas"): x-user-id sigue valiendo en legacy y dual; strict lo rechaza por diseño.
for (const [nombre, ruta, headers] of [
  ["GET /api/cargas/historial-cliente (cliente, header)", "/api/cargas/historial-cliente", { "x-user-id": IDS.cliente }],
  ["GET /api/cargas/historial-chofer (chofer, header)", "/api/cargas/historial-chofer", { "x-user-id": IDS.chofer }],
]) {
  const real = {};
  for (const m of MODOS) real[m] = (await api(base(m), ruta, headers)).status === 200;
  registrar(`migrada (lote 1) ${nombre}: x-user-id vale en legacy/dual; strict lo rechaza`, { legacy: true, dual: true, strict: false }, real, "cambio esperado por diseño");
}

const fallos = resultados.filter((r) => !r.pass).length;
fs.writeFileSync(process.argv[2] || path.join(dir, "resultados-http.json"), JSON.stringify(resultados, null, 2));
console.log(`\nTOTAL ${resultados.length} pruebas · PASS ${resultados.length - fallos} · FAIL ${fallos}`);
process.exit(fallos ? 1 : 0);
