// Tests E3: logout, altas (cliente / chofer), sesión limitada "registro" y matriz legacy/dual/strict.
// Ejecutar: npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  firmarSesion, verificarSesion, resolverUsuario, leerCookie,
  setCookieSesion, setCookieBorrarSesion, cabeceraSetCookie,
  NOMBRE_COOKIE_SESION, TTL_SESION_REGISTRO_SEG, TTL_SESION_DEFECTO_SEG,
} from "./sesion.ts";

const SECRETO = "s".repeat(40);
const ENV = { legacy: {}, dual: { TILA_AUTH_MODE: "dual", TILA_SESSION_SECRET: SECRETO }, strict: { TILA_AUTH_MODE: "strict", TILA_SESSION_SECRET: SECRETO } };
const ENV_SECRETO = { TILA_SESSION_SECRET: SECRETO };
const UID = "11111111-1111-1111-1111-111111111111";
const OTRO = "22222222-2222-2222-2222-222222222222";

const reqHttp = (headers = {}, method = "POST") => new Request("http://localhost:3000/api/x", { method, headers });
const reqHttps = (headers = {}, method = "POST") => new Request("https://tila-logistica.vercel.app/api/x", { method, headers: { "x-forwarded-proto": "https", ...headers } });

/** Jar de cookies mínimo: aplica Set-Cookie como lo haría un navegador (Max-Age<=0 o Expires pasado → borra). */
function nuevoJar() {
  const m = new Map();
  return {
    aplicar(setCookie) {
      const [par, ...attrs] = setCookie.split(";").map((s) => s.trim());
      const i = par.indexOf("=");
      const nombre = par.slice(0, i), valor = par.slice(i + 1);
      const maxAge = attrs.find((a) => /^max-age=/i.test(a));
      const expires = attrs.find((a) => /^expires=/i.test(a));
      const vencida = (maxAge && Number(maxAge.split("=")[1]) <= 0) || (expires && new Date(expires.split("=")[1]).getTime() <= Date.now());
      if (vencida || valor === "") m.delete(nombre); else m.set(nombre, valor);
    },
    cabecera() { return [...m].map(([k, v]) => `${k}=${v}`).join("; "); },
    tiene(n) { return m.has(n); },
  };
}
const attrs = (c) => c.split(";").slice(1).map((s) => s.trim().split("=")[0].toLowerCase()).sort();

// ══ LOGOUT ══════════════════════════════════════════════════════════════════
test("logout: la cookie de borrado usa los MISMOS atributos que la cookie emitida (http)", () => {
  const emitida = setCookieSesion(reqHttp(), UID, { env: ENV_SECRETO });
  const borrado = setCookieBorrarSesion(reqHttp());
  const comunes = ["path", "httponly", "samesite"];
  for (const a of comunes) { assert.ok(attrs(emitida).includes(a) && attrs(borrado).includes(a), `falta ${a}`); }
  assert.match(emitida, /SameSite=Lax/); assert.match(borrado, /SameSite=Lax/);
  assert.match(borrado, /Path=\//);
  assert.doesNotMatch(emitida, /Secure/); assert.doesNotMatch(borrado, /Secure/);
});

test("logout: en https la cookie de borrado también lleva Secure (igual que la emitida)", () => {
  assert.match(setCookieSesion(reqHttps(), UID, { env: ENV_SECRETO }), /;\s*Secure/);
  assert.match(setCookieBorrarSesion(reqHttps()), /;\s*Secure/);
});

test("logout: expira inmediatamente (Max-Age=0 y Expires en el pasado) y sin valor", () => {
  const c = setCookieBorrarSesion(reqHttp());
  assert.match(c, new RegExp(`^${NOMBRE_COOKIE_SESION}=;`));
  assert.match(c, /Max-Age=0/);
  const exp = /Expires=([^;]+)/.exec(c)[1];
  assert.ok(new Date(exp).getTime() < Date.now());
});

test("logout: cookie existente → queda eliminada del jar", () => {
  const jar = nuevoJar();
  jar.aplicar(setCookieSesion(reqHttp(), UID, { env: ENV_SECRETO }));
  assert.equal(jar.tiene(NOMBRE_COOKIE_SESION), true);
  jar.aplicar(setCookieBorrarSesion(reqHttp()));
  assert.equal(jar.tiene(NOMBRE_COOKIE_SESION), false);
});

test("logout: sin cookie → respuesta segura (mismo Set-Cookie, no falla)", () => {
  const jar = nuevoJar();
  assert.doesNotThrow(() => jar.aplicar(setCookieBorrarSesion(reqHttp())));
  assert.equal(setCookieBorrarSesion(reqHttp()), setCookieBorrarSesion(reqHttp({ cookie: "" })));
});

test("logout: cookie manipulada → igual se borra (no depende del contenido ni de x-user-id)", () => {
  const jar = nuevoJar();
  jar.aplicar(`${NOMBRE_COOKIE_SESION}=manipulada.basura; Path=/; HttpOnly`);
  const salida = setCookieBorrarSesion(reqHttp({ cookie: `${NOMBRE_COOKIE_SESION}=manipulada.basura`, "x-user-id": OTRO }));
  jar.aplicar(salida);
  assert.equal(jar.tiene(NOMBRE_COOKIE_SESION), false);
  assert.equal(salida, setCookieBorrarSesion(reqHttp()), "la salida no debe variar con cookie ni x-user-id");
});

for (const modo of ["dual", "strict"]) {
  test(`logout [${modo}]: después de borrar la cookie, la cookie sola ya no autentica`, () => {
    const jar = nuevoJar();
    jar.aplicar(setCookieSesion(reqHttp(), UID, { env: ENV[modo] }));
    const antes = resolverUsuario(reqHttp({ cookie: jar.cabecera() }, "GET"), { env: ENV[modo] });
    assert.equal(antes.userId, UID);
    jar.aplicar(setCookieBorrarSesion(reqHttp()));
    const despues = resolverUsuario(reqHttp({ cookie: jar.cabecera() }, "GET"), { env: ENV[modo] });
    assert.equal(despues.userId, null);
  });
}

// ══ REGISTRO CLIENTE ═══════════════════════════════════════════════════════
test("registro cliente: con secreto emite cookie de sesión COMPLETA (90 días), HttpOnly", () => {
  const c = setCookieSesion(reqHttp(), UID, { env: ENV_SECRETO });
  assert.ok(c);
  assert.match(c, /HttpOnly/); assert.match(c, new RegExp(`Max-Age=${TTL_SESION_DEFECTO_SEG}`));
  const v = verificarSesion(leerCookie(c.split(";")[0], NOMBRE_COOKIE_SESION), { env: ENV_SECRETO });
  assert.equal(v.ok, true); assert.equal(v.userId, UID); assert.equal(v.alcance, "completa");
});

test("registro cliente: SIN secreto no emite nada (comportamiento idéntico al anterior)", () => {
  assert.equal(setCookieSesion(reqHttp(), UID, { env: {} }), null);
  assert.equal(setCookieSesion(reqHttp(), UID, { env: { TILA_SESSION_SECRET: "corto" } }), null);
});

test("registro cliente: la sesión emitida autentica en dual/strict y NO en legacy", () => {
  const cookie = setCookieSesion(reqHttp(), UID, { env: ENV_SECRETO }).split(";")[0];
  assert.equal(resolverUsuario(reqHttp({ cookie }, "GET"), { env: ENV.legacy }).userId, null);
  assert.equal(resolverUsuario(reqHttp({ cookie }, "GET"), { env: ENV.dual }).userId, UID);
  assert.equal(resolverUsuario(reqHttp({ cookie }, "GET"), { env: ENV.strict }).userId, UID);
});

// ══ REGISTRO CHOFER: SESIÓN LIMITADA ═══════════════════════════════════════
const cookieLimitada = (extra = {}) => setCookieSesion(reqHttp(), UID, { env: ENV_SECRETO, alcance: "registro", ...extra }).split(";")[0];

test("sesión limitada: alcance 'registro', vence en 30 min (no 90 días)", () => {
  const c = setCookieSesion(reqHttp(), UID, { env: ENV_SECRETO, alcance: "registro" });
  assert.match(c, new RegExp(`Max-Age=${TTL_SESION_REGISTRO_SEG}`));
  assert.equal(TTL_SESION_REGISTRO_SEG, 1800);
  const v = verificarSesion(c.split(";")[0].split("=").slice(1).join("="), { env: ENV_SECRETO });
  assert.equal(v.alcance, "registro");
});

for (const modo of ["dual", "strict"]) {
  test(`sesión limitada [${modo}]: válida SOLO en rutas que la permiten`, () => {
    const cookie = cookieLimitada();
    const permitida = resolverUsuario(reqHttp({ cookie }, "POST"), { env: ENV[modo], permitirAlcanceRegistro: true });
    assert.equal(permitida.userId, UID);
  });
  test(`sesión limitada [${modo}]: NO sirve para APIs normales (panel cliente/chofer/admin, billetera…)`, () => {
    const cookie = cookieLimitada();
    const normal = resolverUsuario(reqHttp({ cookie }, "GET"), { env: ENV[modo] });
    assert.equal(normal.userId, null);
    assert.equal(normal.motivo, "alcance_insuficiente");
  });
  test(`sesión limitada [${modo}]: vence rápido (rechazada a los 31 min, aceptada a los 29)`, () => {
    const ahora = 1_800_000_000_000;
    const cookie = setCookieSesion(reqHttp(), UID, { env: ENV_SECRETO, alcance: "registro", ahora }).split(";")[0];
    const r = (t) => resolverUsuario(reqHttp({ cookie }, "POST"), { env: ENV[modo], permitirAlcanceRegistro: true, ahora: ahora + t });
    assert.equal(r(29 * 60_000).userId, UID);
    assert.equal(r(31 * 60_000).userId, null);
  });
}

test("sesión limitada [legacy]: se ignora por completo (solo x-user-id, como hoy)", () => {
  const cookie = cookieLimitada();
  assert.equal(resolverUsuario(reqHttp({ cookie }, "POST"), { env: ENV.legacy, permitirAlcanceRegistro: true }).userId, null);
  assert.equal(resolverUsuario(reqHttp({ "x-user-id": UID }, "POST"), { env: ENV.legacy, permitirAlcanceRegistro: true }).userId, UID);
});

test("sesión limitada [dual]: x-user-id sigue mandando (compatibilidad con el frontend actual)", () => {
  const cookie = cookieLimitada();
  const r = resolverUsuario(reqHttp({ cookie, "x-user-id": UID }, "POST"), { env: ENV.dual, permitirAlcanceRegistro: true });
  assert.equal(r.userId, UID); assert.equal(r.coincideConSesion, true);
});

test("sesión limitada [strict]: x-user-id ajeno no suplanta; la sesión limitada no se puede ampliar", () => {
  const cookie = cookieLimitada();
  const r = resolverUsuario(reqHttp({ cookie, "x-user-id": OTRO }, "POST"), { env: ENV.strict, permitirAlcanceRegistro: true });
  assert.equal(r.userId, UID, "manda la sesión, no el header");
  const sinPermiso = resolverUsuario(reqHttp({ cookie, "x-user-id": OTRO }, "POST"), { env: ENV.strict });
  assert.equal(sinPermiso.userId, null);
});

test("sesión limitada: origen cruzado en POST se rechaza (CSRF)", () => {
  const cookie = cookieLimitada();
  const r = resolverUsuario(reqHttp({ cookie, origin: "https://evil.example" }, "POST"), { env: ENV.strict, permitirAlcanceRegistro: true });
  assert.equal(r.motivo, "origen_invalido");
});

test("login posterior REEMPLAZA la sesión limitada por una completa (misma cookie, mismo jar)", () => {
  const jar = nuevoJar();
  jar.aplicar(setCookieSesion(reqHttp(), UID, { env: ENV_SECRETO, alcance: "registro" }));
  const antes = verificarSesion(leerCookie(jar.cabecera(), NOMBRE_COOKIE_SESION), { env: ENV_SECRETO });
  assert.equal(antes.alcance, "registro");
  // login exitoso: emite sesión completa con el mismo nombre de cookie
  jar.aplicar(setCookieSesion(reqHttp(), UID, { env: ENV_SECRETO }));
  const despues = verificarSesion(leerCookie(jar.cabecera(), NOMBRE_COOKIE_SESION), { env: ENV_SECRETO });
  assert.equal(despues.alcance, "completa");
  assert.equal(jar.cabecera().split(";").length, 1, "una sola cookie tila_sesion");
  for (const modo of ["dual", "strict"]) {
    assert.equal(resolverUsuario(reqHttp({ cookie: jar.cabecera() }, "GET"), { env: ENV[modo] }).userId, UID);
  }
});

test("una sesión firmada como 'completa' no puede degradarse/ampliarse editando el alcance", () => {
  const t = firmarSesion(UID, { env: ENV_SECRETO, alcance: "registro" });
  const [cuerpo, firma] = t.split(".");
  const p = JSON.parse(Buffer.from(cuerpo, "base64url").toString());
  p.scp = "completa";
  const ampliado = `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${firma}`;
  assert.equal(verificarSesion(ampliado, { env: ENV_SECRETO }).ok, false);
});

test("matriz: token de registro y token completo son distintos aunque sea el mismo usuario", () => {
  const a = firmarSesion(UID, { env: ENV_SECRETO, alcance: "registro", ahora: 1e12 });
  const b = firmarSesion(UID, { env: ENV_SECRETO, alcance: "completa", ahora: 1e12 });
  assert.notEqual(a, b);
  assert.ok(typeof cabeceraSetCookie(a) === "string");
});
