// Tests del módulo de sesión. Ejecutar: npm test  (node:test, sin dependencias nuevas)
import test from "node:test";
import assert from "node:assert/strict";
import {
  firmarSesion, verificarSesion, resolverUsuario, modoAuth, leerCookie,
  cabeceraSetCookie, cabeceraBorrarCookie, NOMBRE_COOKIE_SESION,
} from "./sesion.ts";

const SECRETO = "s".repeat(40);
const ENV_LEGACY = {};
const ENV_DUAL = { TILA_AUTH_MODE: "dual", TILA_SESSION_SECRET: SECRETO };
const ENV_STRICT = { TILA_AUTH_MODE: "strict", TILA_SESSION_SECRET: SECRETO };
const UID = "11111111-1111-1111-1111-111111111111";
const OTRO = "22222222-2222-2222-2222-222222222222";

const req = (headers = {}, method = "GET") =>
  new Request("https://tila-logistica.vercel.app/api/x", { method, headers });

// ── firma / verificación ────────────────────────────────────────────────────
test("firmar/verificar ida y vuelta", () => {
  const t = firmarSesion(UID, { env: ENV_DUAL });
  const r = verificarSesion(t, { env: ENV_DUAL });
  assert.equal(r.ok, true);
  assert.equal(r.userId, UID);
  assert.equal(r.alcance, "completa");
});

test("sin secreto no se emite sesión", () => {
  assert.equal(firmarSesion(UID, { env: {} }), null);
  assert.equal(firmarSesion(UID, { env: { TILA_SESSION_SECRET: "corto" } }), null);
});

test("token manipulado se rechaza", () => {
  const t = firmarSesion(UID, { env: ENV_DUAL });
  const [cuerpo, firma] = t.split(".");
  const otroCuerpo = Buffer.from(JSON.stringify({ v: 1, sub: OTRO, scp: "completa", iat: 1, exp: 9999999999 })).toString("base64url");
  assert.equal(verificarSesion(`${otroCuerpo}.${firma}`, { env: ENV_DUAL }).motivo, "firma");
  assert.equal(verificarSesion(`${cuerpo}.AAAA`, { env: ENV_DUAL }).motivo, "firma");
  assert.equal(verificarSesion("basura", { env: ENV_DUAL }).motivo, "formato");
  assert.equal(verificarSesion("", { env: ENV_DUAL }).motivo, "formato");
});

test("secreto distinto se rechaza", () => {
  const t = firmarSesion(UID, { env: ENV_DUAL });
  assert.equal(verificarSesion(t, { env: { TILA_SESSION_SECRET: "x".repeat(40) } }).motivo, "firma");
});

test("expiración", () => {
  const ahora = 1_800_000_000_000;
  const t = firmarSesion(UID, { env: ENV_DUAL, ttlSeg: 60, ahora });
  assert.equal(verificarSesion(t, { env: ENV_DUAL, ahora: ahora + 59_000 }).ok, true);
  assert.equal(verificarSesion(t, { env: ENV_DUAL, ahora: ahora + 61_000 }).motivo, "expirada");
});

// ── modo legacy: comportamiento IDÉNTICO al actual ──────────────────────────
test("legacy: devuelve exactamente el header x-user-id", () => {
  const r = resolverUsuario(req({ "x-user-id": UID }), { env: ENV_LEGACY });
  assert.equal(r.userId, UID);
  assert.equal(r.fuente, "legacy-header");
});

test("legacy: sin header o header vacío → null (igual que !userId hoy)", () => {
  assert.equal(resolverUsuario(req(), { env: ENV_LEGACY }).userId, null);
  assert.equal(resolverUsuario(req({ "x-user-id": "" }), { env: ENV_LEGACY }).userId, null);
});

test("legacy: NO lee cookies ni Bearer aunque sean válidos", () => {
  const t = firmarSesion(UID, { env: ENV_DUAL });
  const r = resolverUsuario(req({ cookie: `${NOMBRE_COOKIE_SESION}=${t}`, authorization: `Bearer ${t}` }), { env: ENV_LEGACY });
  assert.equal(r.userId, null);
});

test("legacy: no recorta ni normaliza el header (valor crudo)", () => {
  assert.equal(resolverUsuario(req({ "x-user-id": "no-es-un-uuid" }), { env: ENV_LEGACY }).userId, "no-es-un-uuid");
});

test("modo por defecto y valores raros → legacy", () => {
  assert.equal(modoAuth({}), "legacy");
  assert.equal(modoAuth({ TILA_AUTH_MODE: "" }), "legacy");
  assert.equal(modoAuth({ TILA_AUTH_MODE: "loquesea" }), "legacy");
  assert.equal(modoAuth({ TILA_AUTH_MODE: " DUAL " }), "dual");
  assert.equal(modoAuth({ TILA_AUTH_MODE: "strict" }), "strict");
});

// ── modo dual ───────────────────────────────────────────────────────────────
test("dual: el header sigue funcionando (compatibilidad)", () => {
  const r = resolverUsuario(req({ "x-user-id": UID }), { env: ENV_DUAL });
  assert.equal(r.userId, UID);
  assert.equal(r.fuente, "legacy-header");
  assert.equal(r.coincideConSesion, null);
});

test("dual: header + cookie coincidentes → coincideConSesion true", () => {
  const t = firmarSesion(UID, { env: ENV_DUAL });
  const r = resolverUsuario(req({ "x-user-id": UID, cookie: `${NOMBRE_COOKIE_SESION}=${t}` }), { env: ENV_DUAL });
  assert.equal(r.userId, UID);
  assert.equal(r.coincideConSesion, true);
});

test("dual: header distinto a la cookie → gana el header (legacy) pero queda marcado como no coincidente", () => {
  const t = firmarSesion(UID, { env: ENV_DUAL });
  const r = resolverUsuario(req({ "x-user-id": OTRO, cookie: `${NOMBRE_COOKIE_SESION}=${t}` }), { env: ENV_DUAL });
  assert.equal(r.userId, OTRO);
  assert.equal(r.coincideConSesion, false);
});

test("dual: sin header, cookie válida → usuario de la sesión", () => {
  const t = firmarSesion(UID, { env: ENV_DUAL });
  const r = resolverUsuario(req({ cookie: `otra=1; ${NOMBRE_COOKIE_SESION}=${t}; x=y` }), { env: ENV_DUAL });
  assert.equal(r.userId, UID);
  assert.equal(r.fuente, "cookie");
});

test("dual: sin header, Bearer válido → usuario de la sesión", () => {
  const t = firmarSesion(UID, { env: ENV_DUAL });
  const r = resolverUsuario(req({ authorization: `Bearer ${t}` }), { env: ENV_DUAL });
  assert.equal(r.userId, UID);
  assert.equal(r.fuente, "bearer");
});

test("dual: sin header y cookie inválida → rechazo", () => {
  const r = resolverUsuario(req({ cookie: `${NOMBRE_COOKIE_SESION}=basura.basura` }), { env: ENV_DUAL });
  assert.equal(r.userId, null);
  assert.equal(r.motivo, "sesion_invalida");
});

test("dual: nada → sin_credenciales", () => {
  assert.equal(resolverUsuario(req(), { env: ENV_DUAL }).motivo, "sin_credenciales");
});

// ── modo strict ─────────────────────────────────────────────────────────────
test("strict: el header x-user-id ya NO autentica", () => {
  const r = resolverUsuario(req({ "x-user-id": UID }), { env: ENV_STRICT });
  assert.equal(r.userId, null);
  assert.equal(r.motivo, "sin_credenciales");
});

test("strict: header falso + sesión de otro → gana la sesión (no se puede suplantar)", () => {
  const t = firmarSesion(UID, { env: ENV_STRICT });
  const r = resolverUsuario(req({ "x-user-id": OTRO, cookie: `${NOMBRE_COOKIE_SESION}=${t}` }), { env: ENV_STRICT });
  assert.equal(r.userId, UID);
});

test("strict: sesión válida por cookie", () => {
  const t = firmarSesion(UID, { env: ENV_STRICT });
  assert.equal(resolverUsuario(req({ cookie: `${NOMBRE_COOKIE_SESION}=${t}` }), { env: ENV_STRICT }).userId, UID);
});

test("strict: sesión expirada", () => {
  const ahora = 1_800_000_000_000;
  const t = firmarSesion(UID, { env: ENV_STRICT, ttlSeg: 10, ahora });
  const r = resolverUsuario(req({ authorization: `Bearer ${t}` }), { env: ENV_STRICT, ahora: ahora + 20_000 });
  assert.equal(r.motivo, "sesion_expirada");
});

test("strict sin secreto configurado → falla cerrado (config_incompleta)", () => {
  const r = resolverUsuario(req({ "x-user-id": UID }), { env: { TILA_AUTH_MODE: "strict" } });
  assert.equal(r.userId, null);
  assert.equal(r.motivo, "config_incompleta");
});

test("alcance registro: rechazado salvo que la ruta lo permita", () => {
  const t = firmarSesion(UID, { env: ENV_STRICT, alcance: "registro" });
  const h = { authorization: `Bearer ${t}` };
  assert.equal(resolverUsuario(req(h), { env: ENV_STRICT }).motivo, "alcance_insuficiente");
  assert.equal(resolverUsuario(req(h), { env: ENV_STRICT, permitirAlcanceRegistro: true }).userId, UID);
});

// ── CSRF / origen ───────────────────────────────────────────────────────────
test("cookie + POST desde otro origen → origen_invalido", () => {
  const t = firmarSesion(UID, { env: ENV_STRICT });
  const r = resolverUsuario(
    req({ cookie: `${NOMBRE_COOKIE_SESION}=${t}`, origin: "https://evil.example" }, "POST"),
    { env: ENV_STRICT },
  );
  assert.equal(r.motivo, "origen_invalido");
});

test("cookie + POST mismo origen o sin Origin → ok", () => {
  const t = firmarSesion(UID, { env: ENV_STRICT });
  const c = `${NOMBRE_COOKIE_SESION}=${t}`;
  assert.equal(resolverUsuario(req({ cookie: c, origin: "https://tila-logistica.vercel.app", host: "tila-logistica.vercel.app" }, "POST"), { env: ENV_STRICT }).userId, UID);
  assert.equal(resolverUsuario(req({ cookie: c }, "POST"), { env: ENV_STRICT }).userId, UID);
});

test("GET con cookie no exige Origin", () => {
  const t = firmarSesion(UID, { env: ENV_STRICT });
  assert.equal(resolverUsuario(req({ cookie: `${NOMBRE_COOKIE_SESION}=${t}`, origin: "https://evil.example" }, "GET"), { env: ENV_STRICT }).userId, UID);
});

// ── cookies ─────────────────────────────────────────────────────────────────
test("Set-Cookie: HttpOnly, SameSite=Lax, Secure solo si corresponde", () => {
  const c = cabeceraSetCookie("abc.def", { secure: true, ttlSeg: 100 });
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Secure/);
  assert.match(c, /Max-Age=100/);
  assert.doesNotMatch(cabeceraSetCookie("abc.def", { secure: false }), /Secure/);
  assert.match(cabeceraBorrarCookie(), /Max-Age=0/);
});

test("leerCookie", () => {
  assert.equal(leerCookie("a=1; tila_sesion=xyz; b=2", "tila_sesion"), "xyz");
  assert.equal(leerCookie("a=1", "tila_sesion"), null);
  assert.equal(leerCookie(null, "tila_sesion"), null);
});
