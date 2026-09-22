// Matriz HTTP de E3 (logout, alta de cliente, alta de chofer + sesión limitada) contra el entorno local aislado.
// Todo va al Supabase SIMULADO; no toca producción.
// Uso: TILA_VAL_DIR=<dir> node scripts/validacion-local/pruebas-e3-http.mjs [salida.json]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { firmarSesion, verificarSesion, NOMBRE_COOKIE_SESION } from "../../app/lib/auth/sesion.ts";
import { IDS, CLAVES, EMAILS } from "./mock-supabase.mjs";

const dir = process.env.TILA_VAL_DIR || path.join(os.tmpdir(), "tila-validacion");
const estado = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
const SECRETO = estado.secreto;
const ENV_SESION = { TILA_SESSION_SECRET: SECRETO };
const MODOS = ["legacy", "dual", "strict"];
const SIN = "legacy-sin-secreto";
const base = (m) => { const x = estado.modos.find((y) => y.modo === m); return `http://${x.host}:${x.puerto}`; };
const MOCK = `http://127.0.0.1:${estado.mock}`;
const CORRIDA = Date.now().toString(36);

const resultados = [];
function registrar(prueba, esperado, real, tipo = "PASS/FAIL", nota = "") {
  const pass = MODOS.every((m) => JSON.stringify(esperado[m]) === JSON.stringify(real[m]));
  resultados.push({ prueba, esperado, real, pass, tipo, nota });
  console.log(`${tipo === "INFO" ? "INFO" : pass ? "PASS" : "FAIL"}  ${prueba}  esperado=${JSON.stringify(esperado)} real=${JSON.stringify(real)}${nota ? "  · " + nota : ""}`);
}
const todos = (v) => Object.fromEntries(MODOS.map((m) => [m, v]));
const porModo = async (fn) => { const o = {}; for (const m of MODOS) o[m] = await fn(m); return o; };

// ── jar de cookies (como un navegador) ─────────────────────────────────────
function jar() {
  const c = new Map();
  return {
    set(setCookies) {
      for (const sc of setCookies) {
        const [par, ...attrs] = sc.split(";").map((s) => s.trim());
        const i = par.indexOf("="); const n = par.slice(0, i), v = par.slice(i + 1);
        const ma = attrs.find((a) => /^max-age=/i.test(a)); const ex = attrs.find((a) => /^expires=/i.test(a));
        const vencida = (ma && Number(ma.split("=")[1]) <= 0) || (ex && new Date(ex.split("=")[1]).getTime() <= Date.now());
        if (vencida || v === "") c.delete(n); else c.set(n, v);
      }
    },
    header() { return [...c].map(([k, v]) => `${k}=${v}`).join("; "); },
    valor(n) { return c.get(n) || null; },
  };
}
const cookiesDe = (r) => r.headers.getSetCookie();
const tokenDe = (r) => { const c = cookiesDe(r).find((x) => x.startsWith(NOMBRE_COOKIE_SESION + "=")); return c ? c.split(";")[0].split("=").slice(1).join("=") : null; };
const attrsDe = (r) => { const c = cookiesDe(r).find((x) => x.startsWith(NOMBRE_COOKIE_SESION + "=")) || ""; return c; };

const http = async (m, ruta, { metodo = "GET", headers = {}, body } = {}) => {
  const r = await fetch(base(m) + ruta, { method: metodo, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* no JSON */ }
  return { status: r.status, texto, json, headers: r.headers };
};
const loginHttp = (m, rol, extra = {}) => http(m, "/api/auth/login", { metodo: "POST", headers: extra, body: { email: EMAILS[rol], password: CLAVES[rol] } });
const aprobarChofer = (id) => fetch(`${MOCK}/rest/v1/usuarios?id=eq.${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ estado_aprobacion: "aprobado" }) });

const cuerpoCliente = (m, tag) => ({ nombre: "Cliente E3", email: `cli.${CORRIDA}.${tag}.${m}@tila.invalid`, password: "Clave-Prueba-12", telefono: "1111111111", acepta_terminos: true });
const cuerpoChofer = (m, tag) => ({ nombre: "Chofer E3", email: `cho.${CORRIDA}.${tag}.${m}@tila.invalid`, password: "Clave-Prueba-12", telefono: "1122222222", dni: "30111222", cuit_cuil: "20-30111222-3", licencia: "L-1", patente: "ab123cd", tipo_vehiculo: "Camión rígido", categoria_legal: "N2", acepta_terminos: true, acepta_contrato: true });
const sinId = (j) => JSON.parse(JSON.stringify(j, (k, v) => (k === "id" ? "<id>" : v)));

// ═══ 1. LOGOUT ═════════════════════════════════════════════════════════════
{
  const ses = {};
  for (const m of MODOS) ses[m] = tokenDe(await loginHttp(m, "chofer"));
  const norm = (r) => `${r.status}|${r.texto}|${(r.headers.get("cache-control") || "")}`;

  registrar("logout: 200 y cuerpo {\"ok\":true} con cookie válida", todos("200|{\"ok\":true}|no-store"),
    await porModo(async (m) => norm(await http(m, "/api/auth/logout", { metodo: "POST", headers: { cookie: `${NOMBRE_COOKIE_SESION}=${ses[m]}` } }))));
  registrar("logout: sin cookie → misma respuesta (no revela si había sesión)", todos("200|{\"ok\":true}|no-store"),
    await porModo(async (m) => norm(await http(m, "/api/auth/logout", { metodo: "POST" }))));
  registrar("logout: cookie manipulada + x-user-id ajeno → misma respuesta", todos("200|{\"ok\":true}|no-store"),
    await porModo(async (m) => norm(await http(m, "/api/auth/logout", { metodo: "POST", headers: { cookie: `${NOMBRE_COOKIE_SESION}=basura.basura`, "x-user-id": IDS.admin } }))));
  registrar("logout: no depende de x-user-id (con y sin header, mismo Set-Cookie)", todos(true),
    await porModo(async (m) => {
      const a = await http(m, "/api/auth/logout", { metodo: "POST" });
      const b = await http(m, "/api/auth/logout", { metodo: "POST", headers: { "x-user-id": IDS.chofer } });
      return JSON.stringify(cookiesDe(a)) === JSON.stringify(cookiesDe(b));
    }));
  registrar("logout: Set-Cookie borra tila_sesion (vacía, Path=/, HttpOnly, SameSite=Lax, Max-Age=0, Expires pasado, sin Secure en http)", todos(true),
    await porModo(async (m) => { const c = attrsDe(await http(m, "/api/auth/logout", { metodo: "POST" })); return c.startsWith(`${NOMBRE_COOKIE_SESION}=;`) && /Path=\//.test(c) && /HttpOnly/.test(c) && /SameSite=Lax/.test(c) && /Max-Age=0/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c) && !/Secure/.test(c); }));
  registrar("logout: atributos IGUALES a los de la cookie que emite el login (Path, HttpOnly, SameSite; Secure por https)", todos(true),
    await porModo(async (m) => {
      const emitida = attrsDe(await loginHttp(m, "chofer")); const borrada = attrsDe(await http(m, "/api/auth/logout", { metodo: "POST" }));
      const set = (c) => ["Path=/", "HttpOnly", "SameSite=Lax"].every((a) => c.includes(a));
      const emH = attrsDe(await loginHttp(m, "chofer", { "x-forwarded-proto": "https" })); const brH = attrsDe(await http(m, "/api/auth/logout", { metodo: "POST", headers: { "x-forwarded-proto": "https" } }));
      return set(emitida) && set(borrada) && !/Secure/.test(emitida) && !/Secure/.test(borrada) && /Secure/.test(emH) && /Secure/.test(brH);
    }));
  registrar("logout: GET no está permitido (405)", todos(405), await porModo(async (m) => (await http(m, "/api/auth/logout")).status));

  // ciclo completo con jar: login → cookie autentica → logout → cookie borrada → ya no autentica
  const RUTA = "/api/chofer/billetera";
  registrar("ciclo con jar: login → billetera con la cookie", { legacy: 401, dual: 200, strict: 200 }, await porModo(async (m) => {
    const j = jar(); j.set(cookiesDe(await loginHttp(m, "chofer")));
    globalThis.__jar = globalThis.__jar || {}; globalThis.__jar[m] = j;
    return (await http(m, RUTA, { headers: { cookie: j.header() } })).status;
  }), "PASS/FAIL", "legacy ignora la cookie (mismo comportamiento de siempre)");
  registrar("ciclo con jar: logout → la cookie desaparece del jar", todos(false), await porModo(async (m) => {
    const j = globalThis.__jar[m]; j.set(cookiesDe(await http(m, "/api/auth/logout", { metodo: "POST", headers: { cookie: j.header() } })));
    return !!j.valor(NOMBRE_COOKIE_SESION);
  }));
  registrar("ciclo con jar: después del logout, la cookie sola YA NO autentica", todos(401), await porModo(async (m) => (await http(m, RUTA, { headers: { cookie: globalThis.__jar[m].header() } })).status));
  registrar("logout (info): un token ya copiado antes del logout sigue siendo válido hasta vencer (sesión sin estado en servidor)", { legacy: 401, dual: 200, strict: 200 },
    await porModo(async (m) => (await http(m, RUTA, { headers: { cookie: `${NOMBRE_COOKIE_SESION}=${ses[m]}` } })).status), "INFO", "limitación conocida: revocación server-side requiere estado (ver riesgos)");
}

// ═══ 2. ALTA DE CLIENTE ════════════════════════════════════════════════════
{
  const res = {};
  for (const m of [...MODOS, SIN]) res[m] = await http(m, "/api/usuarios/registro-cliente", { metodo: "POST", body: cuerpoCliente(m, "ok") });
  const ref = res[SIN];
  registrar("alta cliente: 201 y cuerpo = {ok:true, usuario:{id,nombre,email,rol:'cliente',telefono}}", todos(true),
    await porModo(async (m) => res[m].status === 201 && res[m].json.ok === true && Object.keys(res[m].json.usuario).sort().join() === "email,id,nombre,rol,telefono" && res[m].json.usuario.rol === "cliente"));
  registrar("alta cliente: respuesta IGUAL a la del servidor SIN secreto (mismo status y forma; solo cambian id y email)", todos(true),
    await porModo(async (m) => { const a = sinId(res[m].json), b = sinId(ref.json); a.usuario.email = b.usuario.email = "<email>"; return res[m].status === ref.status && JSON.stringify(a) === JSON.stringify(b); }));
  registrar("alta cliente: emite cookie tila_sesion (HttpOnly, Lax, 90 días, sesión COMPLETA del usuario nuevo)", todos(true),
    await porModo(async (m) => { const c = attrsDe(res[m]); const v = verificarSesion(tokenDe(res[m]) || "", { env: ENV_SESION }); return /HttpOnly/.test(c) && /SameSite=Lax/.test(c) && /Max-Age=7776000/.test(c) && v.ok && v.alcance === "completa" && v.userId === res[m].json.usuario.id; }));
  registrar("alta cliente: SIN secreto no emite ninguna cookie (comportamiento anterior)", { legacy: 0, dual: 0, strict: 0 },
    { legacy: cookiesDe(res[SIN]).length, dual: cookiesDe(res[SIN]).length, strict: cookiesDe(res[SIN]).length }, "PASS/FAIL", "servidor sin secreto");
  registrar("alta cliente: el token no aparece en el cuerpo", todos(true), await porModo(async (m) => !res[m].texto.includes(tokenDe(res[m]))));
  registrar("alta cliente: la cookie recién emitida autentica en dual/strict (rol cliente → 403 en ruta de chofer), legacy la ignora", { legacy: 401, dual: 403, strict: 403 },
    await porModo(async (m) => (await http(m, "/api/chofer/billetera", { headers: { cookie: `${NOMBRE_COOKIE_SESION}=${tokenDe(res[m])}` } })).status));
  // validaciones intactas
  registrar("alta cliente: sin aceptar términos → 400, mismo cuerpo que sin secreto, SIN cookie", todos("400|0|true"), await porModo(async (m) => {
    const b = { ...cuerpoCliente(m, "v1"), acepta_terminos: false };
    const x = await http(m, "/api/usuarios/registro-cliente", { metodo: "POST", body: b }); const y = await http(SIN, "/api/usuarios/registro-cliente", { metodo: "POST", body: b });
    return `${x.status}|${cookiesDe(x).length}|${x.texto === y.texto}`;
  }));
  registrar("alta cliente: email duplicado → 409, mismo cuerpo que sin secreto, SIN cookie", todos("409|0|true"), await porModo(async (m) => {
    const x = await http(m, "/api/usuarios/registro-cliente", { metodo: "POST", body: cuerpoCliente(m, "ok") }); const y = await http(SIN, "/api/usuarios/registro-cliente", { metodo: "POST", body: cuerpoCliente(SIN, "ok") });
    return `${x.status}|${cookiesDe(x).length}|${x.texto === y.texto}`;
  }));
  registrar("alta cliente: el consentimiento legal se registra igual (2 filas: terminos + privacidad)", todos(2), await porModo(async (m) => {
    const id = res[m].json.usuario.id; const j = await (await fetch(`${MOCK}/rest/v1/consentimientos_legales?usuario_id=eq.${id}`)).json(); return j.length;
  }));
}

// ═══ 3. ALTA DE CHOFER + SESIÓN LIMITADA ═══════════════════════════════════
{
  const alta = {}, vehiculo = {}, ids = {};
  for (const m of [...MODOS, SIN]) alta[m] = await http(m, "/api/usuarios/registro-chofer-usuario", { metodo: "POST", body: cuerpoChofer(m, "a") });
  const ref = alta[SIN];
  for (const m of [...MODOS, SIN]) ids[m] = alta[m].json.usuario.id;

  registrar("alta chofer: 201 y cuerpo {ok:true, usuario:{id,nombre,email,rol:'chofer'}}", todos(true),
    await porModo(async (m) => alta[m].status === 201 && Object.keys(alta[m].json.usuario).sort().join() === "email,id,nombre,rol" && alta[m].json.usuario.rol === "chofer"));
  registrar("alta chofer: respuesta IGUAL a la del servidor SIN secreto (solo cambian id y email)", todos(true),
    await porModo(async (m) => { const a = sinId(alta[m].json), b = sinId(ref.json); a.usuario.email = b.usuario.email = "<e>"; return alta[m].status === ref.status && JSON.stringify(a) === JSON.stringify(b); }));
  registrar("alta chofer: emite cookie de sesión LIMITADA (alcance registro, 30 min, HttpOnly, Lax)", todos(true),
    await porModo(async (m) => { const c = attrsDe(alta[m]); const v = verificarSesion(tokenDe(alta[m]) || "", { env: ENV_SESION }); return /HttpOnly/.test(c) && /SameSite=Lax/.test(c) && /Max-Age=1800/.test(c) && v.ok && v.alcance === "registro" && v.userId === ids[m]; }));
  registrar("alta chofer: SIN secreto no emite cookie (comportamiento anterior)", { legacy: 0, dual: 0, strict: 0 },
    { legacy: cookiesDe(ref).length, dual: cookiesDe(ref).length, strict: cookiesDe(ref).length }, "PASS/FAIL", "servidor sin secreto");
  registrar("alta chofer: la cuenta queda pendiente y el login sigue rechazado (403), sin cookie", todos("403|0"), await porModo(async (m) => {
    const x = await http(m, "/api/auth/login", { metodo: "POST", body: { email: cuerpoChofer(m, "a").email, password: "Clave-Prueba-12" } }); return `${x.status}|${cookiesDe(x).length}`;
  }));

  const cookieLim = Object.fromEntries(MODOS.map((m) => [m, `${NOMBRE_COOKIE_SESION}=${tokenDe(alta[m])}`]));
  const OK_VEH = { legacy: "401", dual: "201", strict: "201" };

  // pasos del registro real con la sesión limitada SOLA (sin x-user-id)
  registrar("sesión limitada: POST /api/chofer/vehiculos (paso del registro)", OK_VEH, await porModo(async (m) => {
    const r = await http(m, "/api/chofer/vehiculos", { metodo: "POST", headers: { cookie: cookieLim[m] }, body: { marca: "Iveco", modelo: "Tector", anio: 2020, patente: "AB123CD", tipo_vehiculo: "Camión rígido", capacidad_kg: 8000 } });
    vehiculo[m] = r.json?.vehiculo?.id; return String(r.status);
  }), "PASS/FAIL", "legacy ignora cookies: sigue exigiendo x-user-id como siempre");
  // en legacy no se creó el vehículo con cookie → créalo con x-user-id (camino real actual) para poder seguir
  vehiculo.legacy = (await http("legacy", "/api/chofer/vehiculos", { metodo: "POST", headers: { "x-user-id": ids.legacy }, body: { marca: "Iveco", modelo: "Tector", anio: 2020, patente: "AB123CD", tipo_vehiculo: "Camión rígido" } })).json?.vehiculo?.id;
  const urlDoc = (m, t) => `${MOCK}/storage/v1/object/public/documentacion-choferes/${ids[m]}/${t}.png`;
  registrar("sesión limitada: POST /api/chofer/documentacion (subida de DNI)", { legacy: "401", dual: "200", strict: "200" }, await porModo(async (m) =>
    String((await http(m, "/api/chofer/documentacion", { metodo: "POST", headers: { cookie: cookieLim[m] }, body: { tipo: "dni_frente", url: urlDoc(m, "dni_frente") } })).status)));
  registrar("sesión limitada: POST /api/chofer/documentacion (código de antecedentes)", { legacy: "401", dual: "200", strict: "200" }, await porModo(async (m) =>
    String((await http(m, "/api/chofer/documentacion", { metodo: "POST", headers: { cookie: cookieLim[m] }, body: { tipo: "antecedentes_codigo", url: "COD-123" } })).status)));
  registrar("sesión limitada: PATCH /api/chofer/vehiculos/[id]/docs (foto de la cédula)", { legacy: "401", dual: "200", strict: "200" }, await porModo(async (m) =>
    String((await http(m, `/api/chofer/vehiculos/${vehiculo[m]}/docs`, { metodo: "PATCH", headers: { cookie: cookieLim[m] }, body: { cedula_verde_url: urlDoc(m, "cedula_verde") } })).status)));
  registrar("compat: el frontend actual (x-user-id, sin cookie) sigue funcionando en legacy y dual", { legacy: "200", dual: "200", strict: "401" }, await porModo(async (m) =>
    String((await http(m, "/api/chofer/documentacion", { metodo: "POST", headers: { "x-user-id": ids[m] }, body: { tipo: "licencia", url: urlDoc(m, "licencia") } })).status)));
  registrar("sesión limitada NO puede subir la URL de OTRO chofer (la validación de propiedad sigue activa)", { legacy: "401", dual: "403", strict: "403" }, await porModo(async (m) =>
    String((await http(m, "/api/chofer/documentacion", { metodo: "POST", headers: { cookie: cookieLim[m] }, body: { tipo: "dni_dorso", url: `${MOCK}/storage/v1/object/public/documentacion-choferes/${IDS.chofer}/dni_dorso.png` } })).status)));

  // límites de la sesión limitada
  const rutasNormales = [
    ["GET", "/api/chofer/billetera", "billetera (ruta ya migrada al resolver)"],
    ["GET", "/api/cargas/disponibles", "cargas disponibles (panel chofer)"],
    ["GET", "/api/cargas/activa", "viaje activo del chofer"],
    ["GET", "/api/cargas/historial-chofer", "historial del chofer"],
    ["PATCH", `/api/chofer/vehiculos/${"VID"}/activo`, "cambiar vehículo activo"],
    ["GET", "/api/cargas/historial-cliente", "panel cliente"],
    ["GET", "/api/admin/cargas", "admin"],
    ["GET", "/api/admin/usuarios", "admin"],
    ["POST", "/api/chat/mensaje", "chat"],
  ];
  for (const [metodo, ruta, nombre] of rutasNormales) {
    registrar(`sesión limitada NO sirve para: ${nombre} (${metodo} ${ruta.replace("VID", "…")})`, todos(401), await porModo(async (m) =>
      (await http(m, ruta.replace("VID", String(vehiculo[m])), { metodo, headers: { cookie: cookieLim[m] }, body: metodo === "GET" ? undefined : {} })).status));
  }
  registrar("sesión limitada expirada → rechazada en las rutas de registro", { legacy: "401", dual: "401", strict: "401" }, await porModo(async (m) => {
    const t = firmarSesion(ids[m], { env: ENV_SESION, alcance: "registro", ttlSeg: 1800, ahora: Date.now() - 3600_000 });
    return String((await http(m, "/api/chofer/documentacion", { metodo: "POST", headers: { cookie: `${NOMBRE_COOKIE_SESION}=${t}` }, body: { tipo: "seguro", url: urlDoc(m, "seguro") } })).status);
  }));
  registrar("sesión limitada con alcance falsificado a 'completa' → rechazada por firma", { legacy: "401", dual: "401", strict: "401" }, await porModo(async (m) => {
    const [cuerpo, firma] = tokenDe(alta[m]).split("."); const p = JSON.parse(Buffer.from(cuerpo, "base64url").toString()); p.scp = "completa";
    const falso = `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${firma}`;
    return String((await http(m, "/api/chofer/billetera", { headers: { cookie: `${NOMBRE_COOKIE_SESION}=${falso}` } })).status);
  }));

  // login posterior → sesión normal que reemplaza a la limitada
  for (const m of MODOS) await aprobarChofer(ids[m]);
  const jarM = {};
  registrar("login posterior (cuenta ya aprobada) → 200 y cookie de sesión COMPLETA", todos(true), await porModo(async (m) => {
    const j = jar(); j.set(cookiesDe(alta[m]));
    const antes = verificarSesion(j.valor(NOMBRE_COOKIE_SESION), { env: ENV_SESION }).alcance;
    const l = await http(m, "/api/auth/login", { metodo: "POST", body: { email: cuerpoChofer(m, "a").email, password: "Clave-Prueba-12" } });
    j.set(cookiesDe(l)); jarM[m] = j;
    const desp = verificarSesion(j.valor(NOMBRE_COOKIE_SESION), { env: ENV_SESION });
    return l.status === 200 && antes === "registro" && desp.ok && desp.alcance === "completa" && desp.userId === ids[m];
  }));
  registrar("tras el login la sesión completa SÍ sirve para el panel (billetera): legacy ignora cookies", { legacy: 401, dual: 200, strict: 200 }, await porModo(async (m) =>
    (await http(m, "/api/chofer/billetera", { headers: { cookie: jarM[m].header() } })).status));
  registrar("y la sesión completa sigue aceptada en las rutas de registro/documentación", { legacy: "401", dual: "200", strict: "200" }, await porModo(async (m) =>
    String((await http(m, "/api/chofer/documentacion", { metodo: "POST", headers: { cookie: jarM[m].header() }, body: { tipo: "vtv_rto", url: urlDoc(m, "vtv_rto") } })).status)));
}

const fallos = resultados.filter((r) => !r.pass && r.tipo !== "INFO").length;
fs.writeFileSync(process.argv[2] || path.join(dir, "resultados-e3-http.json"), JSON.stringify(resultados, null, 2));
console.log(`\nTOTAL ${resultados.length} pruebas · PASS ${resultados.filter((r) => r.pass && r.tipo !== "INFO").length} · INFO ${resultados.filter((r) => r.tipo === "INFO").length} · FAIL ${fallos}`);
process.exit(fallos ? 1 : 0);
