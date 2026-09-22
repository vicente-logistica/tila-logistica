// Lote 1 de migración al resolver de sesión: historial-cliente, historial-chofer, resumen-admin.
// Solo lecturas contra el Supabase SIMULADO. No toca producción.
//
//   node scripts/validacion-local/lote1.mjs golden <salida.json>   → captura respuestas del código ACTUAL (antes de migrar)
//   node scripts/validacion-local/lote1.mjs test   <golden.json> [salida.json]  → prueba legacy/dual/strict y compara con el golden
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

// ── rutas del lote ──────────────────────────────────────────────────────────
const RUTAS = [
  { ruta: "/api/cargas/historial-cliente", ok: "cliente", mal: "chofer", sinHeader: "missing x-user-id", prohibido: "Prohibido: solo clientes pueden acceder a esta ruta" },
  { ruta: "/api/cargas/historial-chofer", ok: "chofer", mal: "cliente", sinHeader: "missing x-user-id", prohibido: "Prohibido: solo choferes pueden acceder a esta ruta" },
  { ruta: "/api/chat/resumen-admin", ok: "admin", mal: "cliente", sinHeader: "No autorizado: falta x-user-id", prohibido: "Prohibido: se requiere rol admin" },
];
const NO_ENCONTRADO = "No autorizado: usuario no encontrado";

// ── datos sembrados (deterministas) para que las respuestas tengan contenido ─
async function sembrar() {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
  const post = (t, filas) => fetch(`${MOCK}/rest/v1/${t}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(filas) });
  const carga = (id, extra) => ({ id, cliente_id: IDS.cliente, chofer_id: IDS.chofer, estado: "En ruta", origen: `Origen ${id}`, destino: `Destino ${id}`, vehiculo: "Camión rígido", tipo_vehiculo: "Camión rígido",
    categoria_legal: "N2", peso: "1t", tipo_carga: "Carga común", km_estimados: 100 * id, precio_cliente: 100000 * id, pago_chofer: 80000 * id, comision_plataforma: 20000 * id,
    pago_estado: "pagado", oculto_cliente: false, oculto_chofer: false, created_at: `2026-09-0${id}T10:00:00.000Z`, ...extra });
  await post("cargas", [carga(3, {}), carga(4, { oculto_cliente: true }), carga(5, { oculto_chofer: true, created_at: "2026-09-09T10:00:00.000Z" })]);
  const msg = (id, viaje, tipo, leido, rem) => ({ id, viaje_id: viaje, tipo_chat: tipo, remitente_id: rem, remitente_rol: "x", remitente_nombre: "x", mensaje: `m${id}`, leido, created_at: `2026-09-10T10:0${id % 10}:00.000Z` });
  await post("mensajes_viaje", [
    msg(101, 1, "viaje", false, IDS.chofer), msg(102, 1, "viaje", false, IDS.cliente), msg(103, 1, "soporte_cliente", false, IDS.cliente),
    msg(104, 2, "soporte_chofer", false, IDS.chofer), msg(105, 2, "viaje", true, IDS.chofer), msg(106, 3, "soporte_cliente", false, IDS.cliente),
  ]);
}

// ── utilidades ──────────────────────────────────────────────────────────────
const normalizar = (t) => t.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, "<ts>");
async function http(m, ruta, headers = {}) {
  const r = await fetch(base(m) + ruta, { headers });
  const texto = normalizar(await r.text());
  return { status: r.status, texto };
}
async function login(m, rol) {
  const r = await fetch(base(m) + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAILS[rol], password: CLAVES[rol] }) });
  const c = r.headers.getSetCookie().find((x) => x.startsWith(NOMBRE_COOKIE_SESION + "="));
  return c ? c.split(";")[0] : null; // "tila_sesion=<token>"
}
const cookieDe = (m, rol, cache) => (cache[m + rol] ??= login(m, rol));

// ── GOLDEN: código actual, identidad válida y errores de legacy ─────────────
if (comando === "golden") {
  await sembrar();
  const golden = {};
  for (const m of [SIN, "legacy"]) {
    golden[m] = {};
    for (const { ruta, ok, mal } of RUTAS) {
      golden[m][`${ruta} :: valido(${ok})`] = await http(m, ruta, { "x-user-id": IDS[ok] });
      golden[m][`${ruta} :: sin_header`] = await http(m, ruta);
      golden[m][`${ruta} :: inexistente`] = await http(m, ruta, { "x-user-id": INEXISTENTE });
      golden[m][`${ruta} :: rol_incorrecto(${mal})`] = await http(m, ruta, { "x-user-id": IDS[mal] });
    }
  }
  const iguales = JSON.stringify(golden[SIN]) === JSON.stringify(golden.legacy);
  fs.writeFileSync(archivo1, JSON.stringify(golden[SIN], null, 2));
  console.log(`golden guardado (${Object.keys(golden[SIN]).length} respuestas) en ${archivo1} | servidor con y sin secreto idénticos: ${iguales}`);
  for (const [k, v] of Object.entries(golden[SIN])) console.log(`  ${v.status}  ${k}  ${v.texto.length > 90 ? v.texto.slice(0, 90) + "…" : v.texto}`);
  process.exit(iguales ? 0 : 1);
}

// ── TEST: legacy / dual / strict por ruta ───────────────────────────────────
if (comando !== "test") { console.error("uso: golden <out> | test <golden> [out]"); process.exit(2); }
const golden = JSON.parse(fs.readFileSync(archivo1, "utf8"));
await sembrar();
const resultados = [];
const cache = {};
function anotar(modo, ruta, prueba, esperado, real, extra = "") {
  const pass = JSON.stringify(esperado) === JSON.stringify(real);
  resultados.push({ modo, ruta, prueba, esperado, real, pass });
  console.log(`${pass ? "PASS" : "FAIL"} [${modo}] ${ruta.replace("/api/", "")} — ${prueba}: ${JSON.stringify(real)}${pass ? "" : `  (esperado ${JSON.stringify(esperado)})`}${extra}`);
}
const st = (r) => r.status;
const stmsg = (r) => `${r.status} ${JSON.parse(r.texto).error}`;
const tokenMalo = (c) => c.slice(0, -3) + "AAA";

for (const R of RUTAS) {
  const { ruta, ok, mal } = R;
  const OK = golden[`${ruta} :: valido(${ok})`];
  const idem = (r) => r.status === OK.status && r.texto === OK.texto; // idéntico al golden (código previo)
  const cok = { legacy: await cookieDe("legacy", ok, cache), dual: await cookieDe("dual", ok, cache), strict: await cookieDe("strict", ok, cache) };
  const cmal = { legacy: await cookieDe("legacy", mal, cache), dual: await cookieDe("dual", mal, cache), strict: await cookieDe("strict", mal, cache) };

  // LEGACY — byte a byte como antes
  anotar("legacy", ruta, "x-user-id válido → idéntico al golden (código previo)", true, idem(await http("legacy", ruta, { "x-user-id": IDS[ok] })));
  for (const k of ["sin_header", "inexistente", `rol_incorrecto(${mal})`]) {
    const cab = k === "sin_header" ? {} : k === "inexistente" ? { "x-user-id": INEXISTENTE } : { "x-user-id": IDS[mal] };
    const r = await http("legacy", ruta, cab), g = golden[`${ruta} :: ${k}`];
    anotar("legacy", ruta, `${k} → idéntico al golden`, `${g.status}|${g.texto}`, `${r.status}|${r.texto}`);
  }
  anotar("legacy", ruta, "mensajes exactos: sin header / inexistente / rol", [`401 ${R.sinHeader}`, `401 ${NO_ENCONTRADO}`, `403 ${R.prohibido}`],
    [stmsg(await http("legacy", ruta)), stmsg(await http("legacy", ruta, { "x-user-id": INEXISTENTE })), stmsg(await http("legacy", ruta, { "x-user-id": IDS[mal] }))]);
  anotar("legacy", ruta, "cookie válida sin header → IGNORADA (401 como antes)", `401 ${R.sinHeader}`, stmsg(await http("legacy", ruta, { cookie: cok.legacy })));

  // DUAL
  anotar("dual", ruta, "x-user-id válido → idéntico al golden", true, idem(await http("dual", ruta, { "x-user-id": IDS[ok] })));
  anotar("dual", ruta, "cookie válida SIN header → idéntico al golden", true, idem(await http("dual", ruta, { cookie: cok.dual })));
  anotar("dual", ruta, "cookie + header coincidentes → idéntico al golden", true, idem(await http("dual", ruta, { cookie: cok.dual, "x-user-id": IDS[ok] })));
  anotar("dual", ruta, "cookie válida + header de OTRO usuario (rol incorrecto) → manda el header (403)", 403, st(await http("dual", ruta, { cookie: cok.dual, "x-user-id": IDS[mal] })));
  anotar("dual", ruta, "cookie de OTRO rol + header válido → manda el header (200 idéntico)", true, idem(await http("dual", ruta, { cookie: cmal.dual, "x-user-id": IDS[ok] })));
  anotar("dual", ruta, "sin credenciales / uuid inexistente / rol incorrecto", [401, 401, 403],
    [st(await http("dual", ruta)), st(await http("dual", ruta, { "x-user-id": INEXISTENTE })), st(await http("dual", ruta, { "x-user-id": IDS[mal] }))]);
  anotar("dual", ruta, "cookie de otro rol sin header → 403", 403, st(await http("dual", ruta, { cookie: cmal.dual })));

  // STRICT
  anotar("strict", ruta, "cookie válida → idéntico al golden", true, idem(await http("strict", ruta, { cookie: cok.strict })));
  anotar("strict", ruta, "solo x-user-id (válido) → 401", 401, st(await http("strict", ruta, { "x-user-id": IDS[ok] })));
  anotar("strict", ruta, "cookie de otro rol → 403", `403 ${R.prohibido}`, stmsg(await http("strict", ruta, { cookie: cmal.strict })));
  anotar("strict", ruta, "cookie manipulada → 401", 401, st(await http("strict", ruta, { cookie: tokenMalo(cok.strict) })));
  anotar("strict", ruta, "sin credenciales → 401", 401, st(await http("strict", ruta)));
  anotar("strict", ruta, "cookie válida + x-user-id de OTRO → manda la sesión (200 idéntico)", true, idem(await http("strict", ruta, { cookie: cok.strict, "x-user-id": IDS[mal] })));
  anotar("strict", ruta, "cookie expirada / firmada con otro secreto → 401", [401, 401], [
    st(await http("strict", ruta, { cookie: `${NOMBRE_COOKIE_SESION}=${firmarSesion(IDS[ok], { env: ENV_SESION, ttlSeg: 60, ahora: Date.now() - 3_600_000 })}` })),
    st(await http("strict", ruta, { cookie: `${NOMBRE_COOKIE_SESION}=${firmarSesion(IDS[ok], { env: { TILA_SESSION_SECRET: "otro".padEnd(48, "z") } })}` })),
  ]);
  anotar("strict", ruta, "sesión limitada (alcance registro) → 401 (no es sesión de panel)", 401,
    st(await http("strict", ruta, { cookie: `${NOMBRE_COOKIE_SESION}=${firmarSesion(IDS[ok], { env: ENV_SESION, alcance: "registro" })}` })));
}

// contenido: el golden debe tener datos reales (no vacío) para que la comparación valga
const gc = golden[`/api/cargas/historial-cliente :: valido(cliente)`], gh = golden[`/api/cargas/historial-chofer :: valido(chofer)`], gr = golden[`/api/chat/resumen-admin :: valido(admin)`];
anotar("golden", "todas", "las referencias tienen datos (no son respuestas vacías)", [true, true, true],
  [JSON.parse(gc.texto).cargas.length >= 3, JSON.parse(gh.texto).cargas.length >= 3, Object.keys(JSON.parse(gr.texto).resumen).length >= 2]);
anotar("golden", "historial-cliente", "filtro oculto_cliente intacto (la carga 4 oculta NO aparece)", false, JSON.parse(gc.texto).cargas.some((c) => c.id === 4));
anotar("golden", "historial-chofer", "filtro oculto_chofer intacto (la carga 5 oculta NO aparece)", false, JSON.parse(gh.texto).cargas.some((c) => c.id === 5));

const fallos = resultados.filter((r) => !r.pass).length;
if (archivo2) fs.writeFileSync(archivo2, JSON.stringify(resultados, null, 2));
const porModo = {};
for (const r of resultados) { porModo[r.modo] ??= [0, 0]; porModo[r.modo][r.pass ? 0 : 1]++; }
console.log(`\nTOTAL ${resultados.length} · PASS ${resultados.length - fallos} · FAIL ${fallos} | por modo [pass,fail]: ${JSON.stringify(porModo)}`);
process.exit(fallos ? 1 : 0);
