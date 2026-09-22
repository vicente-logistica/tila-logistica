// Lote 2 de migración al resolver de sesión: GET /api/admin/usuarios (solo lectura, solo admin).
// Solo lecturas contra el Supabase SIMULADO. No toca producción.
//
//   node scripts/validacion-local/lote2.mjs golden <salida.json>            → captura respuestas del código ACTUAL (antes de migrar)
//   node scripts/validacion-local/lote2.mjs test   <golden.json> [salida.json] → prueba legacy/dual/strict y compara con el golden
// Requiere TILA_VAL_DIR (donde levantar-entorno.mjs escribió estado.json).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { firmarSesion, NOMBRE_COOKIE_SESION } from "../../app/lib/auth/sesion.ts";
import { IDS, CLAVES, EMAILS } from "./mock-supabase.mjs";

const [, , comando, archivo1, archivo2] = process.argv;
const dir = process.env.TILA_VAL_DIR || path.join(os.tmpdir(), "tila-validacion");
const estado = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
const MOCK = `http://127.0.0.1:${estado.mock}`;
const SIN = "legacy-sin-secreto";
const ENV_SESION = { TILA_SESSION_SECRET: estado.secreto };
const base = (m) => { const x = estado.modos.find((y) => y.modo === m); return `http://${x.host}:${x.puerto}`; };
const INEXISTENTE = "00000000-0000-0000-0000-00000000dead";
const RUTA = "/api/admin/usuarios";
const COLUMNAS = "id,nombre,email,telefono,dni,vehiculo,rol,estado_aprobacion,estado_doc,eliminado,categoria_legal,tipo_vehiculo,tipo_carroceria,online,bateria_nivel,bateria_cargando,ultima_senal_at,created_at".split(",");
const MSG_NO_AUT = "No autorizado";

// ── datos sembrados (deterministas) ─────────────────────────────────────────
async function sembrar() {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
  const u = (n, rol, extra = {}) => ({
    id: `eeeeeeee-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, nombre: `Usuario ${n}`, email: `u${n}@tila.invalid`, password: "HASH-QUE-NO-DEBE-SALIR",
    telefono: `11000000${n}`, rol, dni: `2000000${n}`, alias_cbu_cvu: "CBU-QUE-NO-DEBE-SALIR", cuit_cuil: "20-1-1", estado_aprobacion: "aprobado", estado_doc: "completa",
    eliminado: false, online: false, bateria_nivel: 50 + n, bateria_cargando: n % 2 === 0, ultima_senal_at: `2027-01-0${n}T08:00:00.000Z`, created_at: `2027-01-0${n}T10:00:00.000Z`, ...extra,
  });
  await fetch(`${MOCK}/rest/v1/usuarios`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([
    u(1, "cliente"), u(2, "chofer", { online: true, categoria_legal: "N3", tipo_vehiculo: "Camión tractor", tipo_carroceria: "Batea", vehiculo: "Camión tractor" }),
    u(3, "chofer", { estado_aprobacion: "pendiente", estado_doc: "pendiente_actualizacion" }), u(4, "cliente", { eliminado: true }),
    u(5, "admin"), u(6, "chofer", { estado_aprobacion: "suspendido", estado_doc: "vencida" }),
  ]) });
}

const normalizar = (t) => t.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, (m) => (m.startsWith("2027") ? m : "<ts>")); // los sembrados (2027) son fijos; los del arranque del mock varían
async function http(m, headers = {}) {
  const r = await fetch(base(m) + RUTA, { headers });
  return { status: r.status, texto: normalizar(await r.text()) };
}
async function login(m, rol) {
  const r = await fetch(base(m) + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAILS[rol], password: CLAVES[rol] }) });
  const c = r.headers.getSetCookie().find((x) => x.startsWith(NOMBRE_COOKIE_SESION + "="));
  return c ? c.split(";")[0] : null;
}
const cookieDe = (m, rol, cache) => (cache[m + rol] ??= login(m, rol));
const firmada = (id, op = {}) => `${NOMBRE_COOKIE_SESION}=${firmarSesion(id, { env: ENV_SESION, ...op })}`;

// ── GOLDEN ──────────────────────────────────────────────────────────────────
if (comando === "golden") {
  await sembrar();
  const golden = {};
  for (const m of [SIN, "legacy"]) {
    golden[m] = {
      "valido(admin)": await http(m, { "x-user-id": IDS.admin }),
      "sin_header": await http(m),
      "inexistente": await http(m, { "x-user-id": INEXISTENTE }),
      "rol_incorrecto(cliente)": await http(m, { "x-user-id": IDS.cliente }),
      "rol_incorrecto(chofer)": await http(m, { "x-user-id": IDS.chofer }),
    };
  }
  const iguales = JSON.stringify(golden[SIN]) === JSON.stringify(golden.legacy);
  fs.writeFileSync(archivo1, JSON.stringify(golden[SIN], null, 2));
  console.log(`golden guardado (${Object.keys(golden[SIN]).length} respuestas) en ${archivo1} | servidor con y sin secreto idénticos: ${iguales}`);
  for (const [k, v] of Object.entries(golden[SIN])) console.log(`  ${v.status}  ${k}  ${v.texto.length > 100 ? v.texto.slice(0, 100) + "…" : v.texto}`);
  process.exit(iguales ? 0 : 1);
}

// ── TEST ────────────────────────────────────────────────────────────────────
if (comando !== "test") { console.error("uso: golden <out> | test <golden> [out]"); process.exit(2); }
const golden = JSON.parse(fs.readFileSync(archivo1, "utf8"));
await sembrar();
const resultados = [];
const cache = {};
function anotar(modo, prueba, esperado, real) {
  const pass = JSON.stringify(esperado) === JSON.stringify(real);
  resultados.push({ modo, prueba, esperado, real, pass });
  console.log(`${pass ? "PASS" : "FAIL"} [${modo}] admin/usuarios — ${prueba}: ${JSON.stringify(real)}${pass ? "" : `  (esperado ${JSON.stringify(esperado)})`}`);
}
const st = (r) => r.status;
const OK = golden["valido(admin)"];
const idem = (r) => r.status === OK.status && r.texto === OK.texto;
const malo = (c) => c.slice(0, -3) + "AAA";

const cAdmin = { legacy: await cookieDe("legacy", "admin", cache), dual: await cookieDe("dual", "admin", cache), strict: await cookieDe("strict", "admin", cache) };
const cCli = { legacy: await cookieDe("legacy", "cliente", cache), dual: await cookieDe("dual", "cliente", cache), strict: await cookieDe("strict", "cliente", cache) };
const cCho = { legacy: await cookieDe("legacy", "chofer", cache), dual: await cookieDe("dual", "chofer", cache), strict: await cookieDe("strict", "chofer", cache) };

// LEGACY — byte a byte como antes
anotar("legacy", "x-user-id de admin → idéntico al golden (código previo)", true, idem(await http("legacy", { "x-user-id": IDS.admin })));
for (const [k, cab] of [["sin_header", {}], ["inexistente", { "x-user-id": INEXISTENTE }], ["rol_incorrecto(cliente)", { "x-user-id": IDS.cliente }], ["rol_incorrecto(chofer)", { "x-user-id": IDS.chofer }]]) {
  const r = await http("legacy", cab), g = golden[k];
  anotar("legacy", `${k} → idéntico al golden`, `${g.status}|${g.texto}`, `${r.status}|${r.texto}`);
}
anotar("legacy", "códigos exactos: sin header 401 / inexistente 403 / rol incorrecto 403 (mensaje 'No autorizado')", [401, 403, 403, 403].map((s) => `${s} {"error":"${MSG_NO_AUT}"}`),
  [await http("legacy"), await http("legacy", { "x-user-id": INEXISTENTE }), await http("legacy", { "x-user-id": IDS.cliente }), await http("legacy", { "x-user-id": IDS.chofer })].map((r) => `${r.status} ${r.texto}`));
anotar("legacy", "cookie de admin sin header → IGNORADA (401 como antes)", 401, st(await http("legacy", { cookie: cAdmin.legacy })));
anotar("legacy", "cookie manipulada / expirada sin header → IGNORADAS (401)", [401, 401], [st(await http("legacy", { cookie: malo(cAdmin.legacy) })), st(await http("legacy", { cookie: firmada(IDS.admin, { ttlSeg: 60, ahora: Date.now() - 3_600_000 }) }))]);
anotar("legacy", "sesión limitada sin header → ignorada (401)", 401, st(await http("legacy", { cookie: firmada(IDS.admin, { alcance: "registro" }) })));

// DUAL
anotar("dual", "x-user-id de admin → idéntico al golden", true, idem(await http("dual", { "x-user-id": IDS.admin })));
anotar("dual", "cookie de admin SIN header → idéntico al golden", true, idem(await http("dual", { cookie: cAdmin.dual })));
anotar("dual", "cookie + header coincidentes → idéntico al golden", true, idem(await http("dual", { cookie: cAdmin.dual, "x-user-id": IDS.admin })));
anotar("dual", "cookie de admin + header de OTRO usuario (cliente) → manda el header (403)", 403, st(await http("dual", { cookie: cAdmin.dual, "x-user-id": IDS.cliente })));
anotar("dual", "cookie de cliente + header de admin → manda el header (200 idéntico)", true, idem(await http("dual", { cookie: cCli.dual, "x-user-id": IDS.admin })));
anotar("dual", "sin credenciales / uuid inexistente / rol cliente / rol chofer", [401, 403, 403, 403],
  [st(await http("dual")), st(await http("dual", { "x-user-id": INEXISTENTE })), st(await http("dual", { "x-user-id": IDS.cliente })), st(await http("dual", { "x-user-id": IDS.chofer }))]);
anotar("dual", "cookie de cliente / de chofer sin header → 403 (rol incorrecto)", [403, 403], [st(await http("dual", { cookie: cCli.dual })), st(await http("dual", { cookie: cCho.dual }))]);
anotar("dual", "cookie manipulada sin header → 401", 401, st(await http("dual", { cookie: malo(cAdmin.dual) })));
anotar("dual", "cookie expirada sin header → 401", 401, st(await http("dual", { cookie: firmada(IDS.admin, { ttlSeg: 60, ahora: Date.now() - 3_600_000 }) })));
anotar("dual", "sesión limitada (registro) sin header → 401", 401, st(await http("dual", { cookie: firmada(IDS.admin, { alcance: "registro" }) })));

// STRICT
anotar("strict", "cookie de admin → idéntico al golden", true, idem(await http("strict", { cookie: cAdmin.strict })));
anotar("strict", "solo x-user-id de admin → 401", 401, st(await http("strict", { "x-user-id": IDS.admin })));
anotar("strict", "cookie de cliente / de chofer → 403 (rol incorrecto)", [403, 403], [st(await http("strict", { cookie: cCli.strict })), st(await http("strict", { cookie: cCho.strict }))]);
anotar("strict", "cookie manipulada → 401", 401, st(await http("strict", { cookie: malo(cAdmin.strict) })));
anotar("strict", "cookie expirada → 401", 401, st(await http("strict", { cookie: firmada(IDS.admin, { ttlSeg: 60, ahora: Date.now() - 3_600_000 }) })));
anotar("strict", "cookie firmada con OTRO secreto → 401", 401, st(await http("strict", { cookie: `${NOMBRE_COOKIE_SESION}=${firmarSesion(IDS.admin, { env: { TILA_SESSION_SECRET: "otro".padEnd(48, "z") } })}` })));
anotar("strict", "sin credenciales → 401", 401, st(await http("strict")));
anotar("strict", "cookie de admin + x-user-id de OTRO → manda la sesión (200 idéntico)", true, idem(await http("strict", { cookie: cAdmin.strict, "x-user-id": IDS.cliente })));
anotar("strict", "sesión limitada (registro) → 401", 401, st(await http("strict", { cookie: firmada(IDS.admin, { alcance: "registro" }) })));
anotar("strict", "cookie válida de usuario inexistente → 403 (igual que legacy con uuid inexistente)", 403, st(await http("strict", { cookie: firmada(INEXISTENTE) })));

// CONTENIDO del golden: datos reales, columnas exactas, nada sensible
const g = JSON.parse(OK.texto);
// El simulador omite claves con valor undefined (Postgres devolvería null): se compara la UNIÓN de columnas de todas las filas
// y que en cada fila las claves respeten el orden relativo del SELECT.
const union = COLUMNAS.filter((c) => g.usuarios.some((x) => c in x));
const sinExtras = g.usuarios.every((x) => Object.keys(x).every((k) => COLUMNAS.includes(k)));
const ordenOk = g.usuarios.every((x) => { const idx = Object.keys(x).map((k) => COLUMNAS.indexOf(k)); return idx.every((v, i) => i === 0 || idx[i - 1] < v); });
anotar("golden", "la referencia tiene datos reales (≥ 8 usuarios: 3 base + 6 sembrados = 9)", true, g.usuarios.length >= 8);
anotar("golden", "columnas: ninguna de más, las 18 presentes entre todas las filas, orden relativo del SELECT", [true, 18, true], [sinExtras, union.length, ordenOk]);
anotar("golden", "no filtra password / cbu / cuit (columnas no incluidas)", false, /password|HASH-QUE|CBU-QUE|alias_cbu|cuit_cuil/i.test(OK.texto));
anotar("golden", "orden created_at DESC intacto (los sembrados 2027 primero, de más nuevo a más viejo)", true,
  g.usuarios.slice(0, 6).every((x, i, a) => i === 0 || a[i - 1].created_at >= x.created_at));
anotar("golden", "incluye usuarios eliminados (sin filtro: el filtro lo hace el frontend)", true, g.usuarios.some((x) => x.eliminado === true));

const fallos = resultados.filter((r) => !r.pass).length;
if (archivo2) fs.writeFileSync(archivo2, JSON.stringify(resultados, null, 2));
const porModo = {};
for (const r of resultados) { porModo[r.modo] ??= [0, 0]; porModo[r.modo][r.pass ? 0 : 1]++; }
console.log(`\nTOTAL ${resultados.length} · PASS ${resultados.length - fallos} · FAIL ${fallos} | por modo [pass,fail]: ${JSON.stringify(porModo)}`);
process.exit(fallos ? 1 : 0);
