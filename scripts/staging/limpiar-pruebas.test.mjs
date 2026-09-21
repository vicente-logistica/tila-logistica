// Tests LOCALES de limpiar-pruebas.mjs. Sin red, sin Supabase real, sin claves reales, sin Storage real, sin Next, sin puertos, sin .env.staging:
// todo corre contra un Supabase y un Storage FALSOS en memoria, cargados con el SEED REAL (datos.mjs) más restos simulados de V3 / Realtime / flujos.
// Ejecutar: node --test scripts/staging/limpiar-pruebas.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./limpiar-pruebas.mjs";
import * as D from "./seed/datos.mjs";
import { REF_PRODUCCION, HOSTS_PRODUCCION } from "./guardas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(AQUI, "limpiar-pruebas.mjs");
const REF = "abcdefghij0123456789";
const HOST = `${REF}.supabase.co`;
const URL_OK = `https://${HOST}`;
const SVC = "sb_secret_TEST0123456789abcdefABCDEF";
const ANON = "sb_publishable_TEST0123456789abcdefABCDEF";
const V3 = "V3-MARCADOR";
const RUN3 = "a1b2c3", RUN3B = "0f0f0f", RT1 = "cafebabe", RT2 = "deadbeef";
const T_RAPIDO = { llamadaMs: 300, totalMs: 8000 };
const envOk = (extra = {}) => ({ TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: REF, STAGING_SUPABASE_URL: URL_OK, STAGING_SERVICE_ROLE_KEY: SVC, STAGING_ANON_KEY: ANON, ...extra });
const APLICAR = ["--aplicar", `--confirmar=${HOST}`];

// ═══════════════ Supabase + Storage FALSOS ═══════════════
class Q {
  constructor(be, tabla) { this.be = be; this.tabla = tabla; this.op = null; this.filtros = []; this.opts = {}; }
  select(cols) { if (!this.op) { this.op = "select"; this.cols = cols; } return this; }
  delete(o) { this.op = "delete"; this.opts = o ?? {}; return this; }
  update(v) { this.op = "update"; this.vals = v; return this; }
  insert() { this.be.llamadas.push({ op: "insert", tabla: this.tabla, filtros: [] }); throw new Error("el fake no espera INSERT"); }
  upsert() { this.be.llamadas.push({ op: "upsert", tabla: this.tabla, filtros: [] }); throw new Error("el fake no espera UPSERT"); }
  eq(c, v) { this.filtros.push(["eq", c, v]); return this; }
  in(c, v) { this.filtros.push(["in", c, v]); return this; }
  is(c, v) { this.filtros.push(["is", c, v]); return this; }
  like(c, v) { this.filtros.push(["like", c, v]); return this; }
  limit() { return this; } order() { return this; } range() { return this; } single() { return this; } maybeSingle() { return this; }
  then(res, rej) { return Promise.resolve().then(() => this.ejecutar()).then(res, rej); }
  coincide(f) {
    return this.filtros.every(([k, c, v]) => {
      if (k === "eq") return String(f[c]) === String(v);
      if (k === "in") return v.map(String).includes(String(f[c]));
      if (k === "is") return (f[c] ?? null) === v;
      return new RegExp(`^${String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`).test(String(f[c]));
    });
  }
  ejecutar() {
    const be = this.be;
    be.llamadas.push({ op: this.op, tabla: this.tabla, filtros: this.filtros.map((x) => x.slice()) });
    if (be.colgar?.(this.op, this.tabla)) return new Promise(() => {});
    const falla = be.fallar?.(this.op, this.tabla, this.filtros);
    if (falla) return { data: null, error: falla, count: null };
    const tabla = be.tablas[this.tabla];
    if (!tabla) return { data: null, error: { code: "42P01", message: `no existe ${this.tabla}` }, count: null };
    const filas = tabla.filter((f) => this.coincide(f));
    if (this.op === "select") {
      const cols = this.cols && this.cols !== "*" ? this.cols.split(",").map((c) => c.trim()) : null;
      return { data: filas.map((f) => (cols ? Object.fromEntries(cols.map((c) => [c, f[c] ?? null])) : { ...f })), error: null };
    }
    if (this.op === "update") { for (const f of filas) Object.assign(f, this.vals); return { data: null, error: null, count: filas.length }; }
    if (this.op === "delete") {
      for (const f of filas) { tabla.splice(tabla.indexOf(f), 1); if (this.tabla === "cargas") be.tablas.paradas_viaje = be.tablas.paradas_viaje.filter((p) => String(p.carga_id) !== String(f.id)); }
      return { data: null, error: null, count: filas.length };
    }
    return { data: null, error: { message: "op" }, count: null };
  }
}
class Backend {
  constructor() {
    this.tablas = { usuarios: [], vehiculos: [], documentacion_chofer: [], cargas: [], paradas_viaje: [], mensajes_viaje: [], billetera_chofer: [], viaje_evidencias: [], consentimientos_legales: [], tarifas_config: [], backup_usuarios_20260614: [{ id: "real-1", email: "persona.real@example.com" }] };
    this.objetos = new Set(); this.llamadas = []; this.storageLlamadas = []; this.clientes = 0; this.fallar = null; this.colgar = null; this.fallarStorage = null;
  }
  crearCliente = () => {
    this.clientes++;
    const be = this;
    return {
      from: (t) => new Q(be, t),
      storage: { from: (bucket) => ({
        list: async (prefijo, o = {}) => {
          be.storageLlamadas.push({ op: "list", bucket, prefijo });
          if (be.fallarStorage?.("list", bucket)) return { data: null, error: { message: "storage caído" } };
          const p = `${bucket}/${prefijo}/`; const hijos = new Map();
          for (const k of be.objetos) if (k.startsWith(p)) { const [n, ...r] = k.slice(p.length).split("/"); hijos.set(n, r.length > 0); }
          const todos = [...hijos].map(([name, carpeta]) => ({ name, id: carpeta ? null : `id-${name}` }));
          return { data: todos.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100)), error: null };
        },
        remove: async (rutas) => { be.storageLlamadas.push({ op: "remove", bucket, rutas: [...rutas] }); const quitados = rutas.filter((r) => be.objetos.delete(`${bucket}/${r}`)); return { data: quitados.map((name) => ({ name })), error: null }; },
        upload: async () => { be.storageLlamadas.push({ op: "upload", bucket }); return { data: null, error: null }; },
      }) },
    };
  };
}
const nuevoBackend = ({ seed = true } = {}) => {
  const be = new Backend();
  if (seed) {
    const base = URL_OK;
    Object.assign(be.tablas, {
      usuarios: D.usuarios().map((u) => ({ ...u, password: "$2b$hash" })), vehiculos: D.vehiculos(base), documentacion_chofer: D.documentacion(base).filas, cargas: D.cargas(), paradas_viaje: D.paradas(),
      mensajes_viaje: D.mensajes(), billetera_chofer: D.billetera(), viaje_evidencias: D.evidencias(base), consentimientos_legales: D.consentimientos(),
    });
    for (const a of D.documentacion(base).archivos) be.objetos.add(`${a.bucket}/${a.ruta}`);
    be.objetos.add("documentacion-choferes/evidencias/103/carga_1.png");
  }
  return be;
};
const clonar = (x) => JSON.parse(JSON.stringify(x));
const IDS_SEED = () => new Set([...Object.values(D.ID), ...D.cargas().map((c) => c.id)].map(String));
const seedTablas = (be) => clonar({ usuarios: be.tablas.usuarios.filter((u) => Object.values(D.ID).includes(u.id)), cargas: be.tablas.cargas.filter((c) => D.cargas().some((s) => s.id === c.id)), paradas: be.tablas.paradas_viaje.filter((p) => D.paradas().some((s) => s.id === p.id)),
  mensajes: be.tablas.mensajes_viaje.filter((m) => D.mensajes().some((s) => s.id === m.id)), billetera: be.tablas.billetera_chofer.filter((b) => D.billetera().some((s) => s.id === b.id)), vehiculos: be.tablas.vehiculos, docs: be.tablas.documentacion_chofer, evidencias: be.tablas.viaje_evidencias.filter((e) => D.evidencias(URL_OK).some((s) => s.id === e.id)), consent: be.tablas.consentimientos_legales.filter((c) => D.consentimientos().some((s) => s.id === c.id)) });
const objetosSeed = (be) => [...be.objetos].filter((k) => !k.includes("/v3-marcador/")).sort();

// ── restos simulados ──
function restosV3(be, run = RUN3) {
  be.tablas.usuarios.push({ id: `v3u-${run}-1`, email: `v3-${run}-cliente@tila-staging.invalid`, nombre: V3, rol: "admin" }, { id: `v3u-${run}-2`, email: `v3-${run}-chofer@tila-staging.invalid`, nombre: V3, rol: "chofer" });
  be.tablas.paradas_viaje.push({ id: 900 + Number(`0x${run}`) % 50, carga_id: 101, orden: 99, direccion: V3, estado: "en_curso" });
  be.tablas.viaje_evidencias.push({ id: 950 + Number(`0x${run}`) % 50, carga_id: 101, evento: V3, observacion: `${V3}-2`, rol_usuario: "v3" });
  be.objetos.add(`vehiculos/v3-marcador/${run}/prueba.png`); be.objetos.add(`documentacion-choferes/v3-marcador/${run}/nota.txt`);
}
function restosRT(be, run = RT1, idCarga = 800) {
  const m = `REALTIME-MARCADOR-${run}`;
  be.tablas.cargas.push({ id: idCarga, detalles: m }, { id: idCarga + 1, detalles: m });
  be.tablas.paradas_viaje.push({ id: 700 + idCarga, carga_id: idCarga, orden: 0 });
  be.tablas.mensajes_viaje.push({ id: `rt-${run}`, viaje_id: idCarga, mensaje: m });
  be.tablas.usuarios.push({ id: `rt-u-${run}`, nombre: m, email: `realtime-${run}@tila-staging.invalid` });
}
function restosFlujos(be) {
  const c = (id, modo) => ({ id, detalles: `smoke ${modo}`, cliente_id: D.ID.cliente1, origen: "Rosario, Santa Fe", destino: "Córdoba, Córdoba", estado: "Viaje finalizado" });
  be.tablas.cargas.push(c(1, "legacy"), c(2, "dual"), c(3, "strict"));
  be.tablas.viaje_evidencias.push({ id: 60, carga_id: 1, evento: "chofer_en_camino" }, { id: 61, carga_id: 2, evento: "chofer_en_camino" });
  be.tablas.billetera_chofer.push({ id: "b-f1", chofer_id: D.ID.chofer1, viaje_id: "1", monto: 100 }, { id: "b-f2", chofer_id: D.ID.chofer2, viaje_id: "2", monto: 100 });
  be.tablas.mensajes_viaje.push({ id: "mf-1", viaje_id: 1, tipo_chat: "viaje", mensaje: "smoke chofer", remitente_id: D.ID.chofer2 });
  be.tablas.mensajes_viaje.push({ id: "mf-2", viaje_id: 103, tipo_chat: "viaje", mensaje: "smoke cliente legacy", remitente_id: D.ID.cliente1 }, { id: "mf-3", viaje_id: 103, tipo_chat: "soporte_cliente", mensaje: "smoke admin dual", remitente_id: D.ID.admin });
  be.tablas.paradas_viaje.push({ id: 71, carga_id: 2, orden: 0 });
}

async function correr(argv, { be = nuevoBackend(), env = envOk(), timeouts = T_RAPIDO, extra = {} } = {}) {
  const salida = [], errores = []; const proceso = new EventEmitter();
  const deps = { env, out: (l) => salida.push(String(l)), err: (l) => errores.push(String(l)), crearCliente: be.crearCliente, proceso, timeouts, ...extra };
  const codigo = await L.main(argv, deps);
  return { codigo, salida, errores, be, texto: [...salida, ...errores].join("\n"), proceso };
}
const escrituras = (be) => be.llamadas.filter((c) => c.op !== "select");
const borrados = (be) => be.llamadas.filter((c) => c.op === "delete");
const sinSecretos = (t) => { for (const s of [SVC, ANON]) assert.ok(!t.includes(s), "se filtró una clave"); assert.ok(!/authorization\s*[:=]|apikey\s*[:=]|bearer\s/i.test(t)); };

// ═══════════════ 1. Configuración y guardas anti-producción ═══════════════
test("staging válido: validarConfig OK y cfg con host exacto", () => {
  const r = L.validarConfig(envOk()); assert.deepEqual(r.errores, []); assert.equal(r.cfg.host, HOST); assert.equal(r.cfg.url, URL_OK);
});
test("producción rechazada: ref, URL, clave y combinaciones → exit 2, sin cliente ni operaciones", async () => {
  const prod = `https://${REF_PRODUCCION}.supabase.co`;
  const casos = [
    envOk({ TILA_STAGING_SUPABASE_REF: REF_PRODUCCION, STAGING_SUPABASE_URL: prod }), envOk({ STAGING_SUPABASE_URL: prod }), envOk({ TILA_STAGING_SUPABASE_REF: REF_PRODUCCION }),
    envOk({ STAGING_SERVICE_ROLE_KEY: `sb_secret_${REF_PRODUCCION}abcdefghijkl` }), envOk({ STAGING_SUPABASE_URL: `https://${HOSTS_PRODUCCION[1]}` }),
  ];
  for (const env of casos) for (const flags of [APLICAR, ["--contar"]]) {
    const be = nuevoBackend(); const x = await correr(flags, { be, env });
    assert.equal(x.codigo, 2, x.texto); assert.equal(be.clientes, 0); assert.equal(be.llamadas.length, 0); assert.match(x.texto, /RECHAZADA/); sinSecretos(x.texto);
  }
});
test("URL que no corresponde exactamente al ref / mal formada / http / con ruta o puerto → exit 2", async () => {
  for (const u of ["https://zzzzzzzzzz0123456789.supabase.co", `http://${HOST}`, `${URL_OK}/rest/v1`, `${URL_OK}:8443`, "no-es-url", "https://ejemplo.com", `https://u:p@${HOST}`]) {
    const be = nuevoBackend(); assert.equal((await correr(APLICAR, { be, env: envOk({ STAGING_SUPABASE_URL: u }) })).codigo, 2, u); assert.equal(be.clientes, 0);
  }
});
test("TILA_ENTORNO distinto de staging, ref inválido (lista, mayúsculas), clave pública o de otro proyecto → exit 2", async () => {
  const casos = [envOk({ TILA_ENTORNO: "local" }), envOk({ TILA_ENTORNO: undefined }), envOk({ TILA_STAGING_SUPABASE_REF: `${REF},otro` }), envOk({ TILA_STAGING_SUPABASE_REF: REF.toUpperCase() }),
    envOk({ STAGING_SERVICE_ROLE_KEY: ANON }), envOk({ STAGING_SERVICE_ROLE_KEY: "clave rara con espacios" }), envOk({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })];
  for (const env of casos) { const be = nuevoBackend(); assert.equal((await correr(APLICAR, { be, env })).codigo, 2); assert.equal(be.clientes, 0); }
});
test("falta cualquiera de las variables obligatorias → exit 2 antes de conectar", async () => {
  for (const n of ["TILA_ENTORNO", "TILA_STAGING_SUPABASE_REF", "STAGING_SUPABASE_URL", "STAGING_SERVICE_ROLE_KEY"]) {
    const env = envOk(); delete env[n]; const be = nuevoBackend();
    const x = await correr(APLICAR, { be, env }); assert.equal(x.codigo, 2, n); assert.equal(be.clientes, 0); assert.match(x.texto, new RegExp(n));
  }
});
test("claves / URL / ref por argumentos → exit 2, sin eco del valor y sin cliente", async () => {
  for (const a of [`--service-role=${SVC}`, `--key=${SVC}`, `--url=${URL_OK}`, "--ref=abc", `--anon=${ANON}`, "--token=x", SVC, "--supabase=x"]) {
    const be = nuevoBackend(); const x = await correr([...APLICAR, a], { be });
    assert.equal(x.codigo, 2, a); assert.equal(be.clientes, 0); assert.ok(!x.texto.includes(SVC) && !x.texto.includes(URL_OK));
  }
});
test("argumento desconocido o --modo inválido → exit 2", async () => {
  for (const a of ["--todo", "--truncate", "--modo=todo", "--borrar-todo"]) assert.equal((await correr([a])).codigo, 2, a);
});

// ═══════════════ 2. Dry-run: nada se borra, nada se conecta salvo lectura ═══════════════
test("sin --aplicar (dry-run sin --contar): no se crea cliente, no se conecta, no se borra; lista las clases; valida la configuración", async () => {
  const be = nuevoBackend(); restosV3(be); restosRT(be);
  const antes = clonar(be.tablas); const x = await correr([], { be });
  assert.equal(x.codigo, 0, x.texto); assert.equal(be.clientes, 0); assert.equal(be.llamadas.length, 0); assert.deepEqual(be.tablas, antes);
  assert.match(x.texto, /DRY-RUN/); assert.match(x.texto, /V3/); assert.match(x.texto, /Realtime/); assert.match(x.texto, /Flujos/); assert.match(x.texto, /VÁLIDA/);
  sinSecretos(x.texto);
});
test("dry-run sin ninguna variable: exit 0, lista de clases, sin conexión", async () => {
  const be = nuevoBackend(); const x = await correr([], { be, env: {} }); assert.equal(x.codigo, 0); assert.equal(be.clientes, 0); assert.match(x.texto, /solo se listan las clases/);
});
test("dry-run con entorno inválido (producción) → exit 2 aunque no haya --aplicar", async () => {
  const x = await correr([], { env: envOk({ TILA_STAGING_SUPABASE_REF: REF_PRODUCCION, STAGING_SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` }) }); assert.equal(x.codigo, 2);
});
test("--contar: conecta SOLO LECTURA (ninguna escritura ni remove/upload), informa conteos previstos y no borra", async () => {
  const be = nuevoBackend(); restosV3(be); restosRT(be); restosFlujos(be);
  const antes = clonar(be.tablas); const objs = [...be.objetos];
  const x = await correr(["--contar"], { be });
  assert.equal(x.codigo, 0, x.texto); assert.equal(escrituras(be).length, 0); assert.ok(be.storageLlamadas.every((c) => c.op === "list")); assert.deepEqual(be.tablas, antes); assert.deepEqual([...be.objetos], objs);
  assert.match(x.texto, /CONTEOS PREVISTOS/); assert.match(x.texto, /usuarios 2/); assert.match(x.texto, /Storage v3-marcador\/ 2/); assert.match(x.texto, /corridas 1/); assert.match(x.texto, /cargas 3/);
  sinSecretos(x.texto);
});
test("--aplicar sin --confirmar, o con host equivocado → exit 2, sin conectar ni borrar", async () => {
  for (const flags of [["--aplicar"], ["--aplicar", "--confirmar="], ["--aplicar", "--confirmar=otro.supabase.co"], ["--aplicar", `--confirmar=${REF_PRODUCCION}.supabase.co`], ["--aplicar", `--confirmar=${HOST}.evil.com`], ["--aplicar", `--confirmar=${URL_OK}`]]) {
    const be = nuevoBackend(); restosV3(be); const antes = clonar(be.tablas);
    const x = await correr(flags, { be }); assert.equal(x.codigo, 2, flags.join(" ")); assert.equal(be.clientes, 0); assert.equal(be.llamadas.length, 0); assert.deepEqual(be.tablas, antes); assert.match(x.texto, /--confirmar=/);
  }
});
test("--confirmar sin --aplicar no habilita ningún borrado", async () => {
  const be = nuevoBackend(); restosV3(be); const antes = clonar(be.tablas);
  const x = await correr([`--confirmar=${HOST}`], { be }); assert.equal(x.codigo, 0); assert.equal(be.clientes, 0); assert.deepEqual(be.tablas, antes);
});

// ═══════════════ 3. Limpieza de V3 ═══════════════
test("V3: borra SOLO lo que lleva sus marcadores, restaura, verifica y preserva el seed → exit 0", async () => {
  const be = nuevoBackend(); const semilla = seedTablas(be), obj = objetosSeed(be), backup = clonar(be.tablas.backup_usuarios_20260614);
  restosV3(be, RUN3); restosV3(be, RUN3B);
  const x = await correr(APLICAR, { be });
  assert.equal(x.codigo, 0, x.texto);
  assert.ok(!be.tablas.usuarios.some((u) => String(u.email).startsWith("v3-")));
  assert.ok(!be.tablas.paradas_viaje.some((p) => p.direccion === V3)); assert.ok(!be.tablas.viaje_evidencias.some((e) => e.evento === V3));
  assert.ok(![...be.objetos].some((k) => k.includes("/v3-marcador/")));
  assert.deepEqual(seedTablas(be), semilla, "seed intacto"); assert.deepEqual(objetosSeed(be), obj, "objetos de Storage del seed intactos"); assert.deepEqual(be.tablas.backup_usuarios_20260614, backup);
  assert.match(x.texto, /restos V3 0/); assert.match(x.texto, /LIMPIO Y VERIFICADO → exit 0/); assert.match(x.texto, /seed: intacto/); sinSecretos(x.texto);
});
test("V3: NO borra filas parecidas pero sin marcador exacto (email v3-* con otro nombre, nombre marcador con otro email, parada de otra carga)", async () => {
  const be = nuevoBackend(); restosV3(be);
  be.tablas.usuarios.push({ id: "p1", email: "v3-zzzzzz-cliente@tila-staging.invalid", nombre: "Persona Real" }, { id: "p2", email: "otra@ejemplo.com", nombre: V3 }, { id: "p3", email: "v3-abc@tila-staging.invalid", nombre: V3 });
  be.tablas.paradas_viaje.push({ id: 5000, carga_id: 102, orden: 99, direccion: V3 }, { id: 5001, carga_id: 101, orden: 1, direccion: V3 });
  const x = await correr(APLICAR, { be });
  for (const id of ["p1", "p2", "p3"]) assert.ok(be.tablas.usuarios.some((u) => u.id === id), id);
  assert.ok(be.tablas.paradas_viaje.some((p) => p.id === 5000) && be.tablas.paradas_viaje.some((p) => p.id === 5001));
  assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /NO reconocido\/omitido/);
});
test("V3: restaura columnas del SEED alteradas con el marcador (cargas.detalles, mensajes, vehiculos.color…) al valor del seed, sin borrar la fila", async () => {
  const be = nuevoBackend(); const s105 = D.cargas().find((c) => c.id === 105).detalles;
  be.tablas.cargas.find((c) => c.id === 105).detalles = V3;
  const m = D.mensajes().find((x) => x.viaje_id === 104); be.tablas.mensajes_viaje.find((x) => x.id === m.id).mensaje = `${V3}-2`;
  be.tablas.vehiculos.find((v) => v.id === D.VEHICULO_ID.chofer3).color = V3;
  const x = await correr(APLICAR, { be });
  assert.equal(be.tablas.cargas.find((c) => c.id === 105).detalles, s105); assert.equal(be.tablas.mensajes_viaje.find((y) => y.id === m.id).mensaje, m.mensaje);
  // vehiculos.color no está en el seed (undefined) → no restaurable: se informa y el resultado es parcial
  assert.equal(be.tablas.vehiculos.find((v) => v.id === D.VEHICULO_ID.chofer3).color, V3);
  assert.match(x.texto, /el seed no define el valor original/); assert.equal(x.codigo, 3, x.texto);
  assert.ok(be.tablas.cargas.some((c) => c.id === 105));
});
test("V3: tarifas_config con el numérico marcador y resto nulo se borra; si trae otros valores NO se borra ni restaura", async () => {
  const be = nuevoBackend();
  be.tablas.tarifas_config.push({ id: "t1", extra_fragil: 987654.321, precio_litro_combustible: null, litros_km_flete_chico: null, litros_km_camion_mediano: null, litros_km_camion_grande: null, extra_carga_cara: null });
  be.tablas.tarifas_config.push({ id: "t2", extra_fragil: 987654.321, precio_litro_combustible: 1500, litros_km_flete_chico: null, litros_km_camion_mediano: null, litros_km_camion_grande: null, extra_carga_cara: null });
  be.tablas.tarifas_config.push({ id: "t3", extra_fragil: 0.12, precio_litro_combustible: null });
  const x = await correr(APLICAR, { be });
  assert.deepEqual(be.tablas.tarifas_config.map((t) => t.id).sort(), ["t2", "t3"]); assert.match(x.texto, /tarifas_config#t2/); assert.equal(x.codigo, 3);
});
test("V3: filas creadas 'inesperadamente' (RLS permisiva) se borran solo con TODAS sus columnas marcadoras", async () => {
  const be = nuevoBackend();
  be.tablas.cargas.push({ id: 700, detalles: V3, estado: V3, origen: V3 }, { id: 701, detalles: V3, estado: "pendiente", origen: "X" });
  be.tablas.mensajes_viaje.push({ id: "mv1", mensaje: V3, remitente_rol: "v3", remitente_nombre: V3, viaje_id: 101 }, { id: "mv2", mensaje: V3, remitente_rol: "cliente", remitente_nombre: "Persona", viaje_id: 101 });
  be.tablas.billetera_chofer.push({ id: "bv", chofer_id: V3, viaje_id: V3 });
  be.tablas.consentimientos_legales.push({ id: 900, tipo_documento: V3, version_documento: "v3" });
  be.tablas.vehiculos.push({ id: 900, patente: "V3-MARC", marca: V3, modelo: V3 });
  be.tablas.documentacion_chofer.push({ id: "dv", tipo: V3, url: V3 });
  await correr(APLICAR, { be });
  assert.ok(!be.tablas.cargas.some((c) => c.id === 700)); assert.ok(be.tablas.cargas.some((c) => c.id === 701), "carga con solo detalles=marcador NO coincide con la plantilla completa: se conserva");
  assert.ok(!be.tablas.mensajes_viaje.some((m) => m.id === "mv1")); assert.ok(be.tablas.mensajes_viaje.some((m) => m.id === "mv2"));
  assert.ok(!be.tablas.billetera_chofer.some((b) => b.id === "bv")); assert.ok(!be.tablas.consentimientos_legales.some((c) => c.id === 900)); assert.ok(!be.tablas.vehiculos.some((v) => v.id === 900)); assert.ok(!be.tablas.documentacion_chofer.some((d) => d.id === "dv"));
});

// ═══════════════ 4. Limpieza de Realtime ═══════════════
test("Realtime: limpia por marcador exacto de CADA corrida (reutiliza limpiarPorMarcador), seed y otras filas intactos → exit 0", async () => {
  const be = nuevoBackend(); const semilla = seedTablas(be); restosRT(be, RT1, 800); restosRT(be, RT2, 810);
  be.tablas.cargas.push({ id: 5, detalles: "carga de una persona real" }); be.tablas.mensajes_viaje.push({ id: "real-m", viaje_id: 5, mensaje: "hola de verdad" });
  const x = await correr(APLICAR, { be });
  assert.equal(x.codigo, 0, x.texto);
  assert.ok(!be.tablas.cargas.some((c) => String(c.detalles).startsWith("REALTIME-MARCADOR-"))); assert.ok(!be.tablas.mensajes_viaje.some((m) => String(m.mensaje).startsWith("REALTIME-MARCADOR-")));
  assert.ok(!be.tablas.usuarios.some((u) => String(u.nombre).startsWith("REALTIME-MARCADOR-"))); assert.ok(!be.tablas.paradas_viaje.some((p) => p.carga_id >= 800), "paradas de las cargas marcadas caen por cascada");
  assert.ok(be.tablas.cargas.some((c) => c.id === 5) && be.tablas.mensajes_viaje.some((m) => m.id === "real-m")); assert.deepEqual(seedTablas(be), semilla);
  assert.match(x.texto, /restos Realtime 0/);
});
test("Realtime: marcador con formato NO reconocido no se borra y deja el resultado parcial (exit 3)", async () => {
  const be = nuevoBackend(); restosRT(be, RT1); be.tablas.cargas.push({ id: 9, detalles: "REALTIME-MARCADOR-XYZ" }, { id: 10, detalles: "REALTIME-MARCADOR-cafebabe-extra" });
  const x = await correr(APLICAR, { be });
  assert.ok(be.tablas.cargas.some((c) => c.id === 9) && be.tablas.cargas.some((c) => c.id === 10)); assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /marcador no reconocido/);
});
test("Realtime: todo delete lleva el marcador exacto de la corrida (mensaje / id+detalles / id+nombre)", async () => {
  const be = nuevoBackend(); restosRT(be, RT1);
  await correr(APLICAR, { be });
  const dels = borrados(be); assert.ok(dels.length >= 3);
  for (const d of dels) assert.ok(d.filtros.some(([k, c, v]) => k === "eq" && ["detalles", "mensaje", "nombre"].includes(c) && v === `REALTIME-MARCADOR-${RT1}`), JSON.stringify(d));
});

// ═══════════════ 5. Flujos (smoke) ═══════════════
test("Flujos SIN --incluir-flujos: se cuentan pero NO se tocan; resultado parcial (exit 3)", async () => {
  const be = nuevoBackend(); restosFlujos(be); const antes = clonar(be.tablas);
  const x = await correr(APLICAR, { be });
  assert.deepEqual(be.tablas, antes); assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /no incluidos/); assert.equal(borrados(be).length, 0);
});
test("Flujos CON --incluir-flujos: borra cargas smoke y sus hijas por relación demostrable; conserva el seed (incluidos los mensajes del viaje 103 que no son smoke) → exit 0", async () => {
  const be = nuevoBackend(); const semilla = seedTablas(be); restosFlujos(be);
  const x = await correr([...APLICAR, "--incluir-flujos"], { be });
  assert.equal(x.codigo, 0, x.texto);
  assert.ok(!be.tablas.cargas.some((c) => String(c.detalles).startsWith("smoke "))); assert.ok(!be.tablas.viaje_evidencias.some((e) => [60, 61].includes(e.id)));
  assert.ok(!be.tablas.billetera_chofer.some((b) => ["b-f1", "b-f2"].includes(b.id))); assert.ok(!be.tablas.mensajes_viaje.some((m) => ["mf-1", "mf-2", "mf-3"].includes(m.id))); assert.ok(!be.tablas.paradas_viaje.some((p) => p.id === 71));
  assert.deepEqual(seedTablas(be), semilla); assert.match(x.texto, /restos smoke 0/);
});
test("Flujos: una carga con detalles 'smoke legacy' pero de OTRO cliente, o con id del seed, no se toca (ajena) → exit 3", async () => {
  const be = nuevoBackend(); restosFlujos(be);
  be.tablas.cargas.push({ id: 50, detalles: "smoke legacy", cliente_id: D.ID.cliente2, origen: "Rosario, Santa Fe", destino: "Córdoba, Córdoba" }, { id: 51, detalles: "smoke dual", cliente_id: D.ID.cliente1, origen: "Otro lugar", destino: "Córdoba, Córdoba" });
  be.tablas.cargas.find((c) => c.id === 104).detalles = "smoke strict"; be.tablas.cargas.find((c) => c.id === 104).cliente_id = D.ID.cliente1;
  const x = await correr([...APLICAR, "--incluir-flujos"], { be });
  for (const id of [50, 51, 104]) assert.ok(be.tablas.cargas.some((c) => c.id === id), `carga ${id} debe conservarse`);
  assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /NO se toca/);
});
test("Flujos: los mensajes del seed con texto parecido pero remitente/canal distinto no se borran", async () => {
  const be = nuevoBackend(); restosFlujos(be);
  be.tablas.mensajes_viaje.push({ id: "otro1", viaje_id: 103, tipo_chat: "viaje", mensaje: "smoke cliente legacy", remitente_id: D.ID.chofer1 }, { id: "otro2", viaje_id: 103, tipo_chat: "soporte_chofer", mensaje: "smoke cliente dual", remitente_id: D.ID.cliente1 });
  await correr([...APLICAR, "--incluir-flujos"], { be });
  assert.ok(be.tablas.mensajes_viaje.some((m) => m.id === "otro1") && be.tablas.mensajes_viaje.some((m) => m.id === "otro2"));
});

// ═══════════════ 6. Storage ═══════════════
test("Storage: borra solo v3-marcador/<runId>/(prueba.png|nota.txt); no vacía buckets; seed y otros .png/.txt intactos", async () => {
  const be = nuevoBackend(); restosV3(be); const obj0 = objetosSeed(be);
  be.objetos.add("vehiculos/otra-carpeta/foto.png"); be.objetos.add("vehiculos/suelto.png"); be.objetos.add("documentacion-choferes/notas/nota.txt");
  const x = await correr(APLICAR, { be });
  assert.equal(x.codigo, 0, x.texto);
  assert.ok(![...be.objetos].some((k) => k.includes("v3-marcador/")));
  for (const k of ["vehiculos/otra-carpeta/foto.png", "vehiculos/suelto.png", "documentacion-choferes/notas/nota.txt", ...obj0]) assert.ok(be.objetos.has(k), k);
  const rem = be.storageLlamadas.filter((c) => c.op === "remove"); assert.ok(rem.length >= 1);
  for (const r of rem) for (const ruta of r.rutas) assert.match(ruta, /^v3-marcador\/[0-9a-f]{6}\/(prueba\.png|nota\.txt)$/);
  assert.ok(!be.storageLlamadas.some((c) => c.op === "upload"));
});
test("Storage: un objeto NO reconocido bajo v3-marcador/ se informa y NO se borra (exit 3)", async () => {
  const be = nuevoBackend(); restosV3(be); be.objetos.add(`vehiculos/v3-marcador/${RUN3}/otra-cosa.jpg`); be.objetos.add("vehiculos/v3-marcador/carpeta-rara/prueba.png");
  const x = await correr(APLICAR, { be });
  assert.ok(be.objetos.has(`vehiculos/v3-marcador/${RUN3}/otra-cosa.jpg`) && be.objetos.has("vehiculos/v3-marcador/carpeta-rara/prueba.png")); assert.equal(x.codigo, 3, x.texto);
});
test("Storage: si falta un objeto del seed se detecta como seed alterado (exit 3), sin tocar nada más", async () => {
  const be = nuevoBackend(); be.objetos.delete(`documentacion-choferes/${D.ID.chofer1}/dni_frente.png`);
  const x = await correr(APLICAR, { be }); assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /faltante: storage documentacion-choferes/);
});
test("Storage: la lista falla → no determinable, sin borrar objetos (exit 3)", async () => {
  const be = nuevoBackend(); restosV3(be); be.fallarStorage = (op) => op === "list";
  const x = await correr(APLICAR, { be }); assert.equal(x.codigo, 3, x.texto); assert.equal(be.storageLlamadas.filter((c) => c.op === "remove").length, 0);
});

// ═══════════════ 7. Invariantes de borrado: la guarda ═══════════════
test("JAMÁS un DELETE sin filtro ni solo por id/fecha; solo tablas de prueba; nunca backup_*; nunca UPDATE fuera de la restauración", async () => {
  const be = nuevoBackend(); restosV3(be); restosRT(be); restosFlujos(be); be.tablas.cargas.find((c) => c.id === 105).detalles = V3;
  await correr([...APLICAR, "--incluir-flujos"], { be });
  const ok = new Set(["usuarios", "paradas_viaje", "viaje_evidencias", "cargas", "mensajes_viaje", "billetera_chofer", "consentimientos_legales", "vehiculos", "documentacion_chofer", "tarifas_config"]);
  for (const d of borrados(be)) {
    assert.ok(d.filtros.length >= 1, "delete sin filtros"); assert.ok(d.filtros.every(([k]) => ["eq", "in", "is"].includes(k)), "operador no permitido");
    assert.ok(d.filtros.some(([k, c]) => k === "eq" && ["detalles", "mensaje", "nombre", "evento", "direccion", "tipo_documento", "patente", "tipo", "viaje_id", "email"].includes(c)) || d.filtros.some(([k, c]) => k === "in" && ["carga_id", "viaje_id"].includes(c)), `sin marcador ni relación: ${JSON.stringify(d)}`);
    assert.ok(ok.has(d.tabla) && !d.tabla.startsWith("backup_"));
  }
  assert.ok(escrituras(be).every((c) => ["delete", "update"].includes(c.op))); assert.ok(escrituras(be).filter((c) => c.op === "update").every((c) => c.tabla === "cargas"));
  assert.deepEqual(be.tablas.backup_usuarios_20260614, [{ id: "real-1", email: "persona.real@example.com" }]);
});
const guardado = (opts) => { const be = nuevoBackend(); return { be, g: L.envolverCliente(be.crearCliente(), opts) }; };
test("guarda: bloquea DELETE sin filtros, solo por id, por rango de fecha, por IN sin marcador, y no ejecuta nada", async () => {
  const { be, g } = guardado();
  await assert.rejects(async () => g.from("cargas").delete(), /BLOQUEADO/);
  await assert.rejects(async () => g.from("cargas").delete().eq("id", 1), /BLOQUEADO/);
  await assert.rejects(async () => g.from("usuarios").delete().in("id", ["a", "b"]), /BLOQUEADO/);
  await assert.rejects(async () => g.from("cargas").delete().lt("created_at", "2026-01-01"), /lt is not a function/);
  await assert.rejects(async () => g.from("cargas").delete().eq("id", 1).like("detalles", "%"), /BLOQUEADO/);
  assert.equal(be.llamadas.length, 0); assert.ok(g.bloqueos.length >= 4);
});
test("guarda: bloquea tablas backup_*, tablas fuera de la lista, insert/upsert/rpc y operaciones de Storage peligrosas", async () => {
  const { be, g } = guardado();
  await assert.rejects(async () => g.from("backup_usuarios_20260614").delete().eq("id", "real-1"), /backup_/);
  await assert.rejects(async () => g.from("backup_cargas_20260614").select("id"), /backup_/);
  await assert.rejects(async () => g.from("usuarios_secretos").delete().eq("nombre", V3).eq("id", 1), /BLOQUEADO/);
  assert.throws(() => g.from("cargas").insert({ a: 1 }), /nunca inserta/); assert.throws(() => g.from("cargas").upsert({ a: 1 }), /upsert/); assert.throws(() => g.rpc("truncate_all"), /BLOQUEADO/);
  for (const [b, rutas] of [["vehiculos", ["v3-marcador/abc123/otro.jpg"]], ["vehiculos", [`${D.ID.chofer1}/dni_frente.png`]], ["vehiculos", ["v3-marcador/../x.png"]], ["vehiculos", ["v3-marcador/zzzzzz/prueba.png"]], ["otro-bucket", ["v3-marcador/abc123/prueba.png"]], ["vehiculos", []], ["vehiculos", ["v3-marcador/abc123/prueba.png", "suelto.png"]]]) {
    await assert.rejects(async () => g.storage.from(b).remove(rutas), /BLOQUEADO/, `${b} ${rutas}`);
  }
  await assert.rejects(async () => g.storage.from("vehiculos").upload("x", Buffer.from("x")), /BLOQUEADO/); await assert.rejects(async () => g.storage.from("vehiculos").emptyBucket(), /BLOQUEADO/); assert.throws(() => g.storage.deleteBucket("vehiculos"), /BLOQUEADO/);
  assert.equal(be.llamadas.length, 0); assert.equal(be.storageLlamadas.length, 0);
});
test("guarda: UPDATE solo para restaurar la columna con el marcador V3 de una fila con id", async () => {
  const { be, g } = guardado();
  await assert.rejects(async () => g.from("usuarios").update({ rol: "cliente" }).eq("id", "x"), /BLOQUEADO/);
  await assert.rejects(async () => g.from("cargas").update({ detalles: "x" }), /BLOQUEADO/);
  await assert.rejects(async () => g.from("cargas").update({ detalles: "x" }).eq("id", 105), /BLOQUEADO/);
  await assert.rejects(async () => g.from("cargas").update({ detalles: "x", estado: "y" }).eq("id", 105).eq("detalles", V3), /BLOQUEADO/);
  await assert.rejects(async () => g.from("cargas").update({ estado: "y" }).eq("id", 105).eq("detalles", V3), /BLOQUEADO/);
  const ok = await g.from("cargas").update({ detalles: "x" }).eq("id", 105).eq("detalles", V3); assert.equal(ok.error, null);
  assert.equal(be.llamadas.filter((c) => c.op === "update").length, 1);
});
test("guarda (evaluarBorrado): plantillas de flujos exigen --incluir-flujos y relación DEMOSTRADA; V3/Realtime exigen marcador + id", () => {
  const cargaSmoke = [["eq", "id", 1], ["eq", "detalles", "smoke legacy"], ["eq", "cliente_id", D.ID.cliente1], ["eq", "origen", "Rosario, Santa Fe"], ["eq", "destino", "Córdoba, Córdoba"]];
  assert.equal(L.evaluarBorrado("cargas", cargaSmoke).ok, false); assert.equal(L.evaluarBorrado("cargas", cargaSmoke, { incluirFlujos: true }).ok, true);
  assert.equal(L.evaluarBorrado("cargas", cargaSmoke.filter((f) => f[1] !== "cliente_id"), { incluirFlujos: true }).ok, false);
  assert.equal(L.evaluarBorrado("mensajes_viaje", [["in", "viaje_id", [1, 2]]], { incluirFlujos: true }).ok, false, "un arreglo no demostrado no habilita el borrado");
  assert.equal(L.evaluarBorrado("cargas", [["eq", "id", 1], ["eq", "detalles", "REALTIME-MARCADOR-cafebabe"]]).ok, true);
  assert.equal(L.evaluarBorrado("cargas", [["eq", "detalles", "REALTIME-MARCADOR-cafebabe"]]).ok, false, "falta el id");
  assert.equal(L.evaluarBorrado("cargas", [["eq", "id", 1], ["eq", "detalles", "REALTIME-MARCADOR-XYZ"]]).ok, false);
  assert.equal(L.evaluarBorrado("mensajes_viaje", [["eq", "mensaje", "REALTIME-MARCADOR-cafebabe"]]).ok, true);
  assert.equal(L.evaluarBorrado("usuarios", [["eq", "id", "u"], ["eq", "nombre", V3], ["eq", "email", "v3-a1b2c3-cliente@tila-staging.invalid"]]).ok, true);
  assert.equal(L.evaluarBorrado("usuarios", [["eq", "id", "u"], ["eq", "nombre", V3]]).ok, false);
  assert.equal(L.evaluarBorrado("usuarios", [["eq", "id", D.ID.admin], ["eq", "nombre", "Admin Staging"]]).ok, false, "el seed no tiene plantilla");
  assert.equal(L.evaluarBorrado("tarifas_config", [["eq", "id", "t"], ["eq", "extra_fragil", 987654.321]]).ok, false, "exige el resto de columnas nulas");
});
test("no existe plantilla para ninguna tabla del seed fuera de las de prueba, ni para backup_*", () => {
  for (const t of ["backup_usuarios_20260614", "backup_cargas_20260614", "usuarios_backup", "tarifas", "storage.objects", "auth.users"]) assert.equal(L.evaluarBorrado(t, [["eq", "id", 1], ["eq", "nombre", V3]]).ok, false, t);
});

// ═══════════════ 8. Restos y errores → exit 1; parcial → exit 3 ═══════════════
test("restos detectados tras borrar (el DELETE no tiene efecto) → exit 1 con la lista de restos", async () => {
  const be = nuevoBackend(); restosV3(be); const orig = Q.prototype.ejecutar;
  be.fallar = null; Q.prototype.ejecutar = function () { if (this.op === "delete") { this.be.llamadas.push({ op: "delete", tabla: this.tabla, filtros: this.filtros.map((x) => x.slice()) }); return { data: null, error: null, count: 0 }; } return orig.call(this); };
  try { const x = await correr(APLICAR, { be }); assert.equal(x.codigo, 1, x.texto); assert.match(x.texto, /restos V3 [1-9]/); assert.match(x.texto, /RESTOS O ERRORES → exit 1/); } finally { Q.prototype.ejecutar = orig; }
});
test("error de la base al borrar → exit 1 (sin ocultarlo) y se informa el error sin secretos", async () => {
  const be = nuevoBackend(); restosV3(be); be.fallar = (op, tabla) => (op === "delete" && tabla === "usuarios" ? { code: "23503", message: `fk violada ${SVC}` } : null);
  const x = await correr(APLICAR, { be }); assert.equal(x.codigo, 1, x.texto); assert.match(x.texto, /error: usuarios#/); sinSecretos(x.texto);
});
test("la clave no responde en el preflight → exit 1 sin borrar nada", async () => {
  const be = nuevoBackend(); restosV3(be); be.fallar = () => ({ code: "401", message: "Invalid API key" }); const antes = clonar(be.tablas);
  const x = await correr(APLICAR, { be }); assert.equal(x.codigo, 1); assert.deepEqual(be.tablas, antes); assert.equal(escrituras(be).length, 0);
});
test("lectura fallida en una tabla → no determinable (exit 3) y NO se borra lo que no se pudo leer", async () => {
  const be = nuevoBackend(); restosV3(be); be.fallar = (op, tabla) => (op === "select" && tabla === "viaje_evidencias" ? { code: "XX", message: "boom" } : null);
  const x = await correr(APLICAR, { be }); assert.equal(x.codigo, 3, x.texto); assert.ok(be.tablas.viaje_evidencias.some((e) => e.evento === V3));
});
test("llamada que no responde → timeout, no determinable (exit 3), sin borrados a ciegas", async () => {
  const be = nuevoBackend(); restosV3(be); be.colgar = (op, tabla) => op === "select" && tabla === "paradas_viaje";
  const x = await correr(APLICAR, { be, timeouts: { llamadaMs: 60, totalMs: 8000 } }); assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /sin respuesta en 60 ms/);
});
test("timeout total agotado → interrumpe antes de seguir borrando (exit 3)", async () => {
  const be = nuevoBackend(); restosV3(be); restosRT(be);
  const x = await correr(APLICAR, { be, timeouts: { llamadaMs: 300, totalMs: -1 } }); assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /interrumpido/); assert.equal(borrados(be).length, 0);
});

// ═══════════════ 9. Seed: integridad ═══════════════
test("seed alterado (fila con otro valor) o borrado → exit 3 con indicación de re-aplicar el seed; nada del seed se borra ni se toca", async () => {
  const be = nuevoBackend(); be.tablas.cargas.find((c) => c.id === 103).lat = 0; be.tablas.mensajes_viaje.find((m) => m.leido === false).leido = true; be.tablas.paradas_viaje.splice(0, 1);
  const antes = clonar(be.tablas);
  const x = await correr(APLICAR, { be });
  assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /seed: alterado/); assert.match(x.texto, /alterado: cargas#103: lat/); assert.match(x.texto, /faltante: paradas_viaje#1/); assert.match(x.texto, /aplicar\.mjs --aplicar/);
  assert.deepEqual(be.tablas, antes);
});
test("las columnas de fecha del seed se ignoran (no dan falsos positivos por timestamps distintos)", async () => {
  const be = nuevoBackend(); for (const c of be.tablas.cargas) { c.created_at = "2030-01-01T00:00:00+00:00"; c.gps_actualizado = "2031-01-01T00:00:00Z"; } for (const u of be.tablas.usuarios) u.ultima_senal_at = "2032-01-01T00:00:00Z";
  const x = await correr(APLICAR, { be }); assert.equal(x.codigo, 0, x.texto); assert.match(x.texto, /seed: intacto/);
});
test("seed ausente (nunca aplicado): no es un resto de limpieza (exit 0)", async () => {
  const be = nuevoBackend({ seed: false }); restosV3(be);
  const x = await correr(APLICAR, { be }); assert.equal(x.codigo, 0, x.texto); assert.match(x.texto, /seed: ausente/);
});
test("limpiar pruebas NO modifica jamás el seed: ninguna operación de escritura apunta a una fila del seed salvo la restauración de columnas con marcador V3", async () => {
  const be = nuevoBackend(); restosV3(be); restosRT(be); restosFlujos(be); const ids = IDS_SEED();
  await correr([...APLICAR, "--incluir-flujos"], { be });
  for (const c of borrados(be)) { const id = c.filtros.find(([k, col]) => k === "eq" && col === "id")?.[2]; if (id !== undefined) assert.ok(!ids.has(String(id)), `se intentó borrar una fila del seed: ${c.tabla}#${id}`); }
});

// ═══════════════ 10. Reset del seed (operación distinta, delegada) ═══════════════
test("--modo=reset-seed: no conecta ni borra; explica y delega en seed/aplicar.mjs --reset (sin duplicar la lógica); exit 0", async () => {
  const be = nuevoBackend(); restosV3(be); const antes = clonar(be.tablas);
  const x = await correr(["--modo=reset-seed"], { be });
  assert.equal(x.codigo, 0, x.texto); assert.equal(be.clientes, 0); assert.deepEqual(be.tablas, antes); assert.match(x.texto, /seed\/aplicar\.mjs --aplicar --confirmar=.* --reset/); assert.match(x.texto, /Primero limpiar pruebas/);
});
test("--modo=reset-seed --aplicar → exit 2 (esta herramienta no resetea el seed) sin conectar", async () => {
  const be = nuevoBackend(); const x = await correr(["--modo=reset-seed", ...APLICAR], { be }); assert.equal(x.codigo, 2); assert.equal(be.clientes, 0); assert.match(x.texto, /aplicar\.mjs --reset/);
  const y = await correr(["--modo=reset-seed", "--aplicar"], { be, env: {} }); assert.equal(y.codigo, 2);
});
test("modo pruebas y reset-seed no se mezclan: limpiar pruebas no ejecuta el reset del seed y viceversa", async () => {
  const be = nuevoBackend(); const semilla = seedTablas(be); restosV3(be);
  await correr(APLICAR, { be }); assert.deepEqual(seedTablas(be), semilla);
});

// ═══════════════ 11. Secretos ═══════════════
test("ningún secreto en ninguna salida (éxito, error de base con la clave en el mensaje, config inválida, cliente que lanza)", async () => {
  const be = nuevoBackend(); restosV3(be); be.fallar = (op, tabla) => (tabla === "paradas_viaje" && op === "delete" ? { code: "XX", message: `x ${SVC} Bearer abcdef1234567890 apikey: zzzzzzzz12345678 eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firmafirmafirma` } : null);
  const x = await correr(APLICAR, { be }); sinSecretos(x.texto); for (const s of ["abcdef1234567890", "zzzzzzzz12345678", "eyJhbGci"]) assert.ok(!x.texto.includes(s));
  assert.match(x.texto, /\[CONFIGURADA\]/);
  const y = await correr(APLICAR, { env: envOk({ STAGING_SERVICE_ROLE_KEY: `${SVC} espacio` }) }); sinSecretos(y.texto);
  const z = await correr(APLICAR, { extra: { crearCliente: () => { throw new Error(`clave inválida ${SVC}`); } } }); assert.equal(z.codigo, 1); sinSecretos(z.texto);
});

// ═══════════════ 12. --plan ═══════════════
const trampa = (n) => new Proxy({}, { get() { throw new Error(`--plan tocó ${n}`); } });
test("--plan / --listar / --ayuda: sin env, sin clientes, sin red, sin borrar; explica qué limpia y qué preserva", async () => {
  for (const flag of ["--plan", "--listar", "--ayuda"]) {
    const salida = [];
    const deps = { env: trampa("env"), out: (l) => salida.push(l), err: () => { throw new Error("err"); }, crearCliente: () => { throw new Error("crearCliente"); }, proceso: trampa("proceso") };
    assert.equal(await L.main([flag], deps), 0); const t = salida.join("\n");
    for (const m of ["V3-MARCADOR", "REALTIME-MARCADOR-", "v3-marcador/", "smoke ", "PRESERVA", "reset-seed", "--incluir-flujos", "exit"]) assert.ok(t.includes(m), m);
    assert.ok(!t.includes("sb_secret_") && !t.includes("sb_publishable_"));
  }
});
test("--plan corre como script real con entorno vacío; el script real sin variables con --aplicar → exit 2; con clave por argv → exit 2", () => {
  const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" };
  const a = spawnSync(process.execPath, [SCRIPT, "--plan"], { env, encoding: "utf8", timeout: 30000 }); assert.equal(a.status, 0, a.stderr); assert.match(a.stdout, /QUÉ LIMPIA/);
  const b = spawnSync(process.execPath, [SCRIPT, ...APLICAR], { env, encoding: "utf8", timeout: 30000 }); assert.equal(b.status, 2, b.stdout + b.stderr); assert.match(b.stderr, /RECHAZADA/);
  const c = spawnSync(process.execPath, [SCRIPT, `--service-role=${SVC}`], { env, encoding: "utf8", timeout: 30000 }); assert.equal(c.status, 2); assert.ok(!c.stdout.includes(SVC) && !c.stderr.includes(SVC));
  const d = spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8", timeout: 30000 }); assert.equal(d.status, 0, d.stderr); assert.match(d.stdout, /DRY-RUN/);
});

// ═══════════════ 13. Códigos de salida y estructura ═══════════════
test("los códigos 0, 1, 2 y 3 son alcanzables y con el significado documentado", async () => {
  const c0 = (await correr(APLICAR, { be: (() => { const b = nuevoBackend(); restosV3(b); return b; })() })).codigo;
  const c1 = (await correr(APLICAR, { be: (() => { const b = nuevoBackend(); restosV3(b); b.fallar = (op, t) => (op === "delete" && t === "usuarios" ? { message: "x" } : null); return b; })() })).codigo;
  const c2 = (await correr(APLICAR, { env: {} })).codigo;
  const c3 = (await correr(APLICAR, { be: (() => { const b = nuevoBackend(); restosFlujos(b); return b; })() })).codigo;
  assert.deepEqual([c0, c1, c2, c3], [0, 1, 2, 3]);
});
test("resumirLimpieza: precedencia 1 > 3 > 0", () => {
  assert.equal(L.resumirLimpieza({}).codigo, 0);
  assert.equal(L.resumirLimpieza({ noDeterminables: ["x"] }).codigo, 3); assert.equal(L.resumirLimpieza({ interrumpido: true }).codigo, 3); assert.equal(L.resumirLimpieza({ seed: { estado: "alterado" } }).codigo, 3);
  assert.equal(L.resumirLimpieza({ seed: { estado: "ausente" } }).codigo, 0); assert.equal(L.resumirLimpieza({ seed: { estado: "intacto" } }).codigo, 0);
  assert.equal(L.resumirLimpieza({ restos: 1, noDeterminables: ["x"] }).codigo, 1); assert.equal(L.resumirLimpieza({ restos: 5, interrumpido: true }).codigo, 3); assert.equal(L.resumirLimpieza({ restos: 5, interrumpido: true, errores: ["e"] }).codigo, 1); assert.equal(L.resumirLimpieza({ errores: ["e"] }).codigo, 1); assert.equal(L.resumirLimpieza({ bloqueos: 1 }).codigo, 1);
});
test("los marcadores reconocidos son los de los scripts reales (fuente única: v3-anon.mjs y realtime.mjs)", async () => {
  const v3 = await import("./smoke/v3-anon.mjs"); const rt = await import("./smoke/realtime.mjs");
  assert.equal(v3.MARCADOR, "V3-MARCADOR"); assert.equal(v3.PREFIJO_STORAGE, "v3-marcador/"); assert.equal(v3.DOMINIO_EMAIL, "@tila-staging.invalid"); assert.equal(rt.PREFIJO_MARCADOR, "REALTIME-MARCADOR-");
  assert.equal(rt.emailDe("cafebabe"), "realtime-cafebabe@tila-staging.invalid");
});
test("auditoría estática: sin TRUNCATE/rpc/insert/upsert, sin fetch ni lectura de archivos, process.env una vez, sin literales de producción, imports mínimos", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const codigo = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/truncate\s*\(|\.rpc\s*\(|\.insert\s*\(|\.upsert\s*\(|\bfetch\s*\(|readFile|writeFile|child_process|shell\s*:\s*true|\bexec(Sync)?\s*\(/i.test(codigo.replace(/\.exec\(/g, "")));
  const usos = codigo.split("\n").map((l) => l.trim()).filter((l) => l.includes("process.env") && !l.startsWith("*") && !l.startsWith("/**"));
  assert.equal(usos.length, 1); assert.ok(!codigo.includes(REF_PRODUCCION) && HOSTS_PRODUCCION.every((h) => !codigo.includes(h)));
  const imports = [...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./guardas.mjs", "./seed/datos.mjs", "./smoke/realtime.mjs", "./smoke/v3-anon.mjs", "@supabase/supabase-js", "node:path"].sort());
  const fuera = codigo.replace(/export const TIMEOUTS = Object\.freeze\(\{[\s\S]*?\}\);/, "");
  assert.ok(!/setTimeout\([^)]*,\s*\d{2,}/.test(fuera));
});
