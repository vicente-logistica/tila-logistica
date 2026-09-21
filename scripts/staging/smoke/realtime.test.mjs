// Tests LOCALES de realtime.mjs. Sin red, sin Supabase real, sin claves reales, sin Next, sin puertos, sin .env.staging:
// todo corre contra un Supabase y una app FALSOS en memoria (con Realtime simulado, política de entrega configurable para anon y para el control).
// Ejecutar: node --test scripts/staging/smoke/realtime.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "./realtime.mjs";
import { REF_PRODUCCION, HOSTS_PRODUCCION } from "../guardas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(AQUI, "realtime.mjs");
const REF = "abcdefghij0123456789";
const URL_OK = `https://${REF}.supabase.co`;
const ANON = "sb_publishable_TEST0123456789abcdefABCDEF";
const SVC = "sb_secret_TEST0123456789abcdefABCDEF";
const RUN = "abcd1234";
const MARCA = `REALTIME-MARCADOR-${RUN}`;
const OTRA_MARCA = "REALTIME-MARCADOR-deadbeef";
const BASE = "http://127.0.0.1:3131";

const envOk = (extra = {}) => ({ TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: REF, STAGING_SUPABASE_URL: URL_OK, STAGING_ANON_KEY: ANON, STAGING_SERVICE_ROLE_KEY: SVC, ...extra });
// Tiempos chicos para que los tests sean rápidos (la lógica es idéntica; en producción son los de TIMEOUTS)
const T_RAPIDO = { suscripcionMs: 150, esperaEventoMs: 70, esperaPostSuscripcionMs: 5, llamadaMs: 400, limpiezaMs: 800, totalMs: 8000, pollMs: 4 };

// ═══════════════ Supabase FALSO con Realtime simulado ═══════════════
class Q {
  constructor(be, rol, tabla) { this.be = be; this.rol = rol; this.tabla = tabla; this.op = null; this.filtros = []; this.opts = {}; this.retorna = false; this.unico = false; }
  insert(fila) { this.op = "insert"; this.fila = fila; return this; }
  update(vals, opts) { this.op = "update"; this.vals = vals; this.opts = opts ?? {}; return this; }
  delete(opts) { this.op = "delete"; this.opts = opts ?? {}; return this; }
  select() { if (!this.op) this.op = "select"; else this.retorna = true; return this; }
  single() { this.unico = true; return this; }
  eq(c, v) { this.filtros.push(["eq", c, v]); return this; }
  in(c, v) { this.filtros.push(["in", c, v]); return this; }
  then(res, rej) { return Promise.resolve().then(() => this.ejecutar()).then(res, rej); }
  filas() { return this.be.tablas[this.tabla].filter((f) => this.filtros.every(([k, c, v]) => (k === "eq" ? String(f[c]) === String(v) : v.map(String).includes(String(f[c]))))); }
  ejecutar() {
    const be = this.be;
    be.llamadas.push({ rol: this.rol, op: this.op, tabla: this.tabla, filtros: this.filtros.map(([, c, v]) => [c, v]) });
    const falla = be.fallar?.(this.rol, this.op, this.tabla);
    if (falla) return { data: null, error: falla, count: null };
    if (this.rol === "anon" && !(this.op === "update" && this.tabla === "usuarios" && be.anonUpdateUsuarios)) return { data: null, error: null, count: 0 }; // RLS: sin efecto
    if (this.op === "insert") {
      const f = { ...this.fila }; if (f.id === undefined) f.id = be.sec++;
      be.tablas[this.tabla].push(f); be.emitir(this.tabla, "INSERT", f, {});
      return { data: this.unico ? { id: f.id } : [{ id: f.id }], error: null };
    }
    if (this.op === "update") {
      const fs = this.filas(); for (const f of fs) { Object.assign(f, this.vals); be.emitir(this.tabla, "UPDATE", f, { id: f.id }); }
      return { data: null, error: null, count: fs.length };
    }
    if (this.op === "delete") {
      const fs = be.deleteNoop ? [] : this.filas();
      for (const f of fs) { be.tablas[this.tabla].splice(be.tablas[this.tabla].indexOf(f), 1); be.emitir(this.tabla, "DELETE", {}, { id: f.id }); }
      return { data: null, error: null, count: fs.length };
    }
    return { data: this.filas().map((f) => ({ ...f })), error: null };
  }
}
class Backend {
  constructor() {
    this.tablas = { cargas: [], mensajes_viaje: [], usuarios: [], paradas_viaje: [] };
    this.sec = 5000; this.llamadas = []; this.subs = []; this.appLlamadas = []; this.clientes = 0;
    this.publicadas = new Set(["cargas", "mensajes_viaje"]);
    this.ve = { anon: () => false }; // (tabla, tipo, fila) => ¿recibe anon el evento?
    this.dropControl = false; this.latencia = 4; this.anonUpdateUsuarios = true; this.deleteNoop = false;
    this.modoSub = { anon: {}, service: {} }; this.appStatus = {}; this.fallar = null;
    this.tSub = []; this.tApp = []; // instantes (Date.now) en que se entregó SUBSCRIBED y en que se recibió cada llamada a la app
  }
  emitir(tabla, tipo, nueva, vieja) {
    if (!this.publicadas.has(tabla)) return;
    for (const s of this.subs) {
      if (s.tabla !== tabla || !(s.evento === "*" || s.evento === tipo)) continue;
      if (s.rol === "service" ? this.dropControl : !this.ve.anon(tabla, tipo, nueva)) continue;
      setTimeout(() => s.cb({ eventType: tipo, new: { ...nueva }, old: { ...vieja } }), this.latencia);
    }
  }
  crearCliente = (url, key) => {
    this.clientes++;
    const be = this; const rol = key === ANON ? "anon" : "service";
    const cliente = {
      channel() {
        const b = {};
        const ch = {
          on(_t, f, cb) { b.tabla = f.table; b.evento = f.event; b.cb = cb; return ch; },
          subscribe(cb) {
            const modo = be.modoSub[rol][b.tabla] ?? "ok";
            if (modo === "ok") { be.subs.push({ ...b, rol, cliente }); setTimeout(() => { be.tSub.push(Date.now()); cb("SUBSCRIBED"); }, 2); }
            else if (modo === "error") setTimeout(() => cb("CHANNEL_ERROR", { message: `no se pudo suscribir ${key}` }), 2);
            // "nunca": no llama al callback
            return ch;
          },
        };
        return ch;
      },
      removeAllChannels() { be.subs = be.subs.filter((s) => s.cliente !== cliente); return Promise.resolve(); },
      realtime: { disconnect() {} },
      from: (tabla) => new Q(be, rol, tabla),
    };
    return cliente;
  };
  iniciarSesion = async (_base, clave) => {
    if (this.loginFalla) throw new Error("login falló: 500");
    const id = clave === "cliente1" ? "u-cli-1" : "u-cho-2";
    const be = this;
    const api = async (metodo, ruta, cuerpo) => {
      be.appLlamadas.push(`${metodo} ${ruta}`); be.tApp.push(Date.now());
      const st = be.appStatus[ruta]; if (st) return { status: st, json: { error: "x" } };
      if (ruta === "/api/cargas/publicar") { const f = { id: be.sec++, detalles: cuerpo.detalles, estado: "pendiente", cliente_id: id }; be.tablas.cargas.push(f); be.emitir("cargas", "INSERT", f, {}); return { status: 200, json: { carga: { id: f.id } } }; }
      const carga = be.tablas.cargas.find((c) => String(c.id) === String(cuerpo.carga_id));
      if (ruta === "/api/cargas/aceptar") { Object.assign(carga, { chofer_id: id, estado: "Chofer asignado" }); be.emitir("cargas", "UPDATE", carga, { id: carga.id }); return { status: 200, json: { ok: true } }; }
      if (ruta === "/api/chat/mensaje") { const f = { id: `m${be.sec++}`, viaje_id: cuerpo.viaje_id, mensaje: cuerpo.mensaje }; be.tablas.mensajes_viaje.push(f); be.emitir("mensajes_viaje", "INSERT", f, {}); return { status: 200, json: { ok: true } }; }
      if (ruta === "/api/cargas/gps") { Object.assign(carga, { lat: cuerpo.lat, lng: cuerpo.lng }); be.emitir("cargas", "UPDATE", carga, { id: carga.id }); return { status: 200, json: { ok: true } }; }
      return { status: 404, json: null };
    };
    return { id, api };
  };
}
/** Semilla: filas que NO llevan el marcador de la corrida y que la limpieza jamás debe tocar. */
function conSemilla(be) {
  be.tablas.cargas.push({ id: 101, detalles: "Carga ficticia de staging #101" }, { id: 102, detalles: OTRA_MARCA }, { id: 103, detalles: null });
  be.tablas.mensajes_viaje.push({ id: "m1", viaje_id: 101, mensaje: "hola" }, { id: "m2", viaje_id: 102, mensaje: OTRA_MARCA });
  be.tablas.usuarios.push({ id: "s1", nombre: "Chofer Dos Ficticio", email: "chofer2@tila-staging.invalid" }, { id: "s2", nombre: OTRA_MARCA, email: "realtime-deadbeef@tila-staging.invalid" });
  be.tablas.paradas_viaje.push({ id: 1, carga_id: 101 });
  return be;
}
const instantanea = (be) => JSON.stringify(be.tablas);

async function correr(argv, { be = new Backend(), env = envOk(), timeouts = T_RAPIDO, senal = null, extra = {} } = {}) {
  const salida = [], errores = [];
  const proceso = new EventEmitter();
  const deps = { env, out: (l) => salida.push(String(l)), err: (l) => errores.push(String(l)), crearCliente: be.crearCliente, iniciarSesion: be.iniciarSesion, proceso, timeouts, runId: RUN, ...extra };
  if (senal) setTimeout(() => proceso.emit(senal.tipo), senal.enMs);
  const codigo = await R.main(argv, deps);
  return { codigo, salida, errores, be, texto: [...salida, ...errores].join("\n"), proceso };
}
const ARGS = [`--base=${BASE}`];
const accion = (x, id) => {
  // busca la línea de resumen "  R1 titulo   anon: X control: Y → CLASE"
  const l = x.salida.find((s) => s.startsWith(`  ${id} `) && s.includes("→"));
  assert.ok(l, `sin línea de resumen para ${id}\n${x.texto}`);
  const m = /anon: (.+?)\s+control: (.+?)\s+→ (.+)$/.exec(l);
  return { anon: m[1].trim(), control: m[2].trim(), clase: m[3].trim() };
};
const marcasVivas = (be) => ["cargas", "mensajes_viaje", "usuarios"].flatMap((t) => be.tablas[t].filter((f) => [f.detalles, f.mensaje, f.nombre].includes(MARCA)).map((f) => `${t}:${f.id}`));

// ═══════════════ 1. Control positivo OK + interpretación de anon ═══════════════
test("control OK y anon recibe todo → ANON RECIBE, exit 0 (R5: tabla no publicada → INCONCLUSO no bloqueante)", async () => {
  const be = new Backend(); be.ve.anon = () => true;
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 0, x.texto);
  for (const id of ["R1", "R2", "R3", "R4", "R6"]) assert.deepEqual(accion(x, id), { anon: "LLEGÓ", control: "LLEGÓ", clase: "ANON RECIBE" }, id);
  assert.equal(accion(x, "R5").clase, "INCONCLUSO");
  assert.match(x.texto, /resultado: VÁLIDA → exit 0/);
  assert.deepEqual(marcasVivas(be), []);
});
test("anon NO recibe nada pero el control sí → ANON NO RECIBE (medido, no asumido), exit 0", async () => {
  const be = new Backend(); be.ve.anon = () => false;
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 0, x.texto);
  for (const id of ["R1", "R2", "R3", "R4", "R6"]) assert.deepEqual(accion(x, id), { anon: "NO LLEGÓ", control: "LLEGÓ", clase: "ANON NO RECIBE" }, id);
});
test("mezcla: anon recibe solo DELETE → R6 ANON RECIBE y el resto ANON NO RECIBE (el resultado depende de lo medido)", async () => {
  const be = new Backend(); be.ve.anon = (_t, tipo) => tipo === "DELETE";
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 0, x.texto);
  assert.equal(accion(x, "R6").clase, "ANON RECIBE");
  for (const id of ["R1", "R2", "R3", "R4"]) assert.equal(accion(x, id).clase, "ANON NO RECIBE", id);
});
test("usuarios publicada y visible para anon → R5 ANON RECIBE (latido por cliente supabase-js anon)", async () => {
  const be = new Backend(); be.publicadas.add("usuarios"); be.ve.anon = () => true;
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 0, x.texto);
  assert.deepEqual(accion(x, "R5"), { anon: "LLEGÓ", control: "LLEGÓ", clase: "ANON RECIBE" });
});
test("usuarios publicada pero oculta a anon → R5 ANON NO RECIBE", async () => {
  const be = new Backend(); be.publicadas.add("usuarios");
  const x = await correr(ARGS, { be });
  assert.equal(accion(x, "R5").clase, "ANON NO RECIBE");
});
test("el control NO simula a anon: si el control recibe y anon no, los eventos de anon son 0 (buffers separados)", async () => {
  const be = new Backend(); be.ve.anon = () => false;
  const x = await correr(ARGS, { be });
  assert.match(x.texto, /eventos correlacionados: anon 0 · control [1-9]/);
});

// ═══════════════ 2. Control positivo falla → INCONCLUSO ═══════════════
test("el control se suscribe pero NO recibe eventos → INCONCLUSO (exit 3) y NO se concluye nada sobre anon aunque anon reciba", async () => {
  const be = new Backend(); be.ve.anon = () => true; be.dropControl = true;
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3, x.texto);
  for (const id of ["R1", "R2", "R3", "R4", "R6"]) { const a = accion(x, id); assert.equal(a.clase, "INCONCLUSO", id); assert.equal(a.control, "NO LLEGÓ"); }
  assert.ok(!x.texto.includes("ANON RECIBE →") && !accion(x, "R1").clase.includes("RECIBE"));
  assert.match(x.texto, /control positivo: NO VÁLIDO/);
  assert.deepEqual(marcasVivas(be), []);
});
test("el control no logra suscribirse a cargas → INCONCLUSO, exit 3, no se aplica NINGUNA acción de la app", async () => {
  const be = new Backend(); be.ve.anon = () => true; be.modoSub.service.cargas = "error";
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3, x.texto);
  assert.deepEqual(be.appLlamadas, [], "no debe crear datos que no puede medir");
  for (const a of R.ACCIONES) assert.equal(accion(x, a.id).clase, "INCONCLUSO");
  assert.match(x.texto, /CONTROL POSITIVO no logró suscribirse/);
  assert.deepEqual(marcasVivas(be), []);
});
test("suscripción del control que NUNCA llega a SUBSCRIBED → TIMED_OUT y exit 3", async () => {
  const be = new Backend(); be.modoSub.service.mensajes_viaje = "nunca";
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3, x.texto);
  assert.match(x.texto, /mensajes_viaje\s+anon: SUBSCRIBED · control: TIMED_OUT/);
});
test("suscripción de ANON que nunca llega a SUBSCRIBED (el control sí) → esas acciones INCONCLUSO bloqueantes, exit 3", async () => {
  const be = new Backend(); be.modoSub.anon.cargas = "nunca";
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3, x.texto);
  const a = accion(x, "R1"); assert.equal(a.anon, "ERROR"); assert.equal(a.control, "LLEGÓ"); assert.equal(a.clase, "INCONCLUSO");
  assert.equal(accion(x, "R3").clase, "ANON NO RECIBE"); // mensajes_viaje sí suscripta
});
test("suscripción de anon con CHANNEL_ERROR → INCONCLUSO (exit 3)", async () => {
  const be = new Backend(); be.modoSub.anon.mensajes_viaje = "error";
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3); assert.equal(accion(x, "R3").anon, "ERROR");
});
test("tabla no publicada con suscripción rechazada para ambos (usuarios) → R5 INCONCLUSO no bloqueante, exit 0", async () => {
  const be = new Backend(); be.modoSub.anon.usuarios = "error"; be.modoSub.service.usuarios = "error";
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 0, x.texto);
  assert.equal(accion(x, "R5").clase, "INCONCLUSO");
});

// ═══════════════ 3. Timeouts ═══════════════
test("evento que llega DESPUÉS de la ventana de espera cuenta como NO LLEGÓ; con el control tardío → INCONCLUSO", async () => {
  const be = new Backend(); be.ve.anon = () => true; be.latencia = 400; // > esperaEventoMs
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3, x.texto);
  assert.equal(accion(x, "R1").control, "NO LLEGÓ");
  await new Promise((r) => setTimeout(r, 450)); // deja vaciar los temporizadores del fake
});
test("timeout TOTAL: se corta la corrida, se limpia y sale 3 (INCONCLUSO)", async () => {
  const be = new Backend(); be.latencia = 300;
  const x = await correr(ARGS, { be, timeouts: { ...T_RAPIDO, totalMs: 40, esperaEventoMs: 500 } });
  assert.equal(x.codigo, 3, x.texto);
  assert.match(x.texto, /timeout total/);
  assert.deepEqual(marcasVivas(be), []);
  await new Promise((r) => setTimeout(r, 350));
});
test("llamada a la app que no responde → INCONCLUSO por timeout de llamada, limpieza hecha", async () => {
  const be = new Backend();
  const colgado = async () => ({ id: "u", api: () => new Promise(() => {}) });
  const x = await correr(ARGS, { be, extra: { iniciarSesion: colgado } });
  assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /sin respuesta en \d+ ms/);
  assert.deepEqual(marcasVivas(be), []);
});
test("señal (SIGINT) durante la corrida → INCONCLUSO (3), sin resultados falsos y con limpieza", async () => {
  const be = new Backend(); be.latencia = 300;
  const x = await correr(ARGS, { be, senal: { tipo: "SIGINT", enMs: 40 }, timeouts: { ...T_RAPIDO, esperaEventoMs: 2000 } });
  assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /interrumpido/);
  assert.deepEqual(marcasVivas(be), []); assert.equal(x.proceso.listenerCount("SIGINT"), 0);
  await new Promise((r) => setTimeout(r, 350));
});

// ═══════════════ 4. Acciones que no se aplican ═══════════════
test("la app rechaza R1 (HTTP 500) → R1 INCONCLUSO, R2–R4 dependen de R1, R5 y R6 igual se miden; exit 3", async () => {
  const be = new Backend(); be.publicadas.add("usuarios"); be.appStatus["/api/cargas/publicar"] = 500;
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3, x.texto);
  for (const id of ["R1", "R2", "R3", "R4"]) assert.equal(accion(x, id).clase, "INCONCLUSO", id);
  assert.match(x.texto, /depende de R1/);
  assert.notEqual(accion(x, "R6").clase, "INCONCLUSO");
});
test("anon no puede aplicar el UPDATE de R5 (RLS: 0 filas) → R5 no aplicada, INCONCLUSO bloqueante, sin usar service_role de reemplazo", async () => {
  const be = new Backend(); be.anonUpdateUsuarios = false;
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3, x.texto); assert.match(x.texto, /afectó 0 fila/);
  assert.ok(!be.llamadas.some((c) => c.rol === "service" && c.op === "update"), "el control/svc no debe aplicar el latido en lugar de anon");
});
test("login en la app falla → INCONCLUSO (3) y no se crea ningún dato antes de la limpieza", async () => {
  const be = new Backend(); be.loginFalla = true;
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3, x.texto);
  assert.ok(!be.llamadas.some((c) => c.op === "insert"));
});
test("no se puede crear la carga ficticia de R6 → INCONCLUSO (3) y se limpia lo creado (usuario marcado)", async () => {
  const be = new Backend(); be.fallar = (rol, op, tabla) => (op === "insert" && tabla === "cargas" ? { code: "XX000", message: "boom" } : null);
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 3, x.texto); assert.deepEqual(marcasVivas(be), []);
});

// ═══════════════ 5. DELETE ═══════════════
test("DELETE: carga ficticia marcada creada por el control, borrada por el control; se observa anon y control", async () => {
  const be = new Backend(); be.ve.anon = (_t, tipo) => tipo !== "DELETE";
  const x = await correr(ARGS, { be });
  assert.deepEqual(accion(x, "R6"), { anon: "NO LLEGÓ", control: "LLEGÓ", clase: "ANON NO RECIBE" });
  const ins = be.llamadas.find((c) => c.rol === "service" && c.op === "insert" && c.tabla === "cargas"); assert.ok(ins);
  const del = be.llamadas.filter((c) => c.op === "delete" && c.tabla === "cargas");
  assert.ok(del.length >= 1 && del.every((c) => c.filtros.some(([col, v]) => col === "detalles" && v === MARCA)));
});
test("DELETE: la carga del seed (id 101) no se toca y la ficticia desaparece", async () => {
  const be = conSemilla(new Backend()); be.ve.anon = () => true;
  const antes = be.tablas.cargas.filter((c) => c.id === 101 || c.id === 102 || c.id === 103).map((c) => JSON.stringify(c));
  const x = await correr(ARGS, { be });
  assert.equal(accion(x, "R6").clase, "ANON RECIBE");
  const despues = be.tablas.cargas.filter((c) => c.id === 101 || c.id === 102 || c.id === 103).map((c) => JSON.stringify(c));
  assert.deepEqual(despues, antes);
});
test("DELETE que no se aplica (count 0) → R6 no aplicada → INCONCLUSO y exit 1 por restos de limpieza", async () => {
  const be = new Backend(); be.deleteNoop = true;
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 1, x.texto); assert.match(x.texto, /RESTO/); assert.match(x.texto, /--limpiar-run=abcd1234/);
});

// ═══════════════ 6. Limpieza: solo el marcador ═══════════════
test("limpieza: elimina TODO lo marcado de esta corrida y NADA más (seed y marcador de otra corrida intactos)", async () => {
  const be = conSemilla(new Backend()); be.ve.anon = () => true;
  const semilla = JSON.stringify({ c: be.tablas.cargas.filter((c) => !String(c.detalles ?? "").includes(MARCA)), m: be.tablas.mensajes_viaje.slice(), u: be.tablas.usuarios.slice(), p: be.tablas.paradas_viaje.slice() });
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 0, x.texto);
  assert.deepEqual(marcasVivas(be), []);
  const despues = JSON.stringify({ c: be.tablas.cargas, m: be.tablas.mensajes_viaje, u: be.tablas.usuarios, p: be.tablas.paradas_viaje });
  assert.equal(despues, semilla);
  assert.match(x.texto, /limpieza: OK \(0 restos\)/);
});
test("limpieza: TODO delete lleva el marcador exacto; nunca sin filtro; solo tablas de la prueba; nunca por producción", async () => {
  const be = conSemilla(new Backend()); be.ve.anon = () => true;
  await correr(ARGS, { be });
  const dels = be.llamadas.filter((c) => c.op === "delete");
  assert.ok(dels.length >= 3);
  for (const d of dels) {
    assert.ok(d.filtros.length >= 1, "delete sin filtro");
    assert.ok(d.filtros.some(([col, v]) => v === MARCA && ["detalles", "mensaje", "nombre"].includes(col)), `delete sin marcador exacto: ${JSON.stringify(d)}`);
    assert.ok(["cargas", "mensajes_viaje", "usuarios"].includes(d.tabla));
  }
  assert.ok(be.llamadas.every((c) => ["insert", "update", "delete", "select"].includes(c.op)), "solo operaciones acotadas (no TRUNCATE ni RPC)");
});
test("limpieza: el service_role solo se usa para fixtures, DELETE de R6 y limpieza/verificación (nunca update); anon solo hace el UPDATE de R5", async () => {
  const be = new Backend();
  await correr(ARGS, { be });
  assert.ok(be.llamadas.filter((c) => c.rol === "anon").every((c) => c.op === "update" && c.tabla === "usuarios"));
  assert.ok(!be.llamadas.some((c) => c.rol === "service" && c.op === "update"));
});
test("limpieza: con la corrida cortada (INCONCLUSO) igualmente se limpia y verifica", async () => {
  const be = conSemilla(new Backend()); be.modoSub.service.cargas = "error";
  await correr(ARGS, { be });
  assert.deepEqual(marcasVivas(be), []);
  assert.ok(be.llamadas.some((c) => c.op === "select" && c.tabla === "cargas"), "verificó por marcador");
});
test("limpieza incompleta (el DELETE falla) → exit 1 y se informan los restos", async () => {
  const be = new Backend();
  be.fallar = (rol, op, tabla) => (op === "delete" && tabla === "usuarios" ? { code: "23503", message: "fk" } : null);
  const x = await correr(ARGS, { be });
  assert.equal(x.codigo, 1, x.texto); assert.match(x.texto, /RESTO/); assert.match(x.texto, /limpieza: INCOMPLETA/);
});
test("borrarConMarcador rechaza borrados sin filtro / sin marcador / con marcador mal formado, sin tocar la base", async () => {
  const be = new Backend(); const svc = be.crearCliente(URL_OK, SVC);
  await assert.rejects(() => R.borrarConMarcador(svc, "cargas", [], { col: "detalles", valor: MARCA }), /rechazado/);
  await assert.rejects(() => R.borrarConMarcador(svc, "cargas", [["id", 1]], { col: "detalles", valor: MARCA }), /rechazado/);
  await assert.rejects(() => R.borrarConMarcador(svc, "cargas", [["detalles", "hola"]], { col: "detalles", valor: "hola" }), /rechazado/);
  await assert.rejects(() => R.borrarConMarcador(svc, "cargas", [["detalles", "REALTIME-MARCADOR-"]], { col: "detalles", valor: "REALTIME-MARCADOR-" }), /rechazado/);
  await assert.rejects(() => R.borrarConMarcador(svc, "cargas", [["detalles", "REALTIME-MARCADOR-abc"]], { col: "detalles", valor: "REALTIME-MARCADOR-abc" }), /rechazado/);
  await assert.rejects(() => R.borrarConMarcador(svc, "cargas", [["id", 1]], { col: "id", valor: 1 }), /rechazado/);
  assert.equal(be.llamadas.length, 0);
  const ok = await R.borrarConMarcador(svc, "cargas", [["detalles", MARCA]], { col: "detalles", valor: MARCA });
  assert.equal(ok.error, null);
});
test("limpiarPorMarcador: no borra un usuario con el nombre marcado pero email distinto (omitido)", async () => {
  const be = new Backend(); be.tablas.usuarios.push({ id: "x1", nombre: MARCA, email: "otra@tila-staging.invalid" });
  const svc = be.crearCliente(URL_OK, SVC);
  const rep = await R.limpiarPorMarcador(svc, RUN);
  assert.equal(be.tablas.usuarios.length, 1); assert.equal(rep.omitidos.length, 1); assert.equal(rep.ok, false);
});
test("--limpiar-run=<runId>: recupera SOLO el marcador de ese run; no toca seed ni otras corridas; sin Realtime ni app", async () => {
  const be = conSemilla(new Backend());
  be.tablas.cargas.push({ id: 900, detalles: "REALTIME-MARCADOR-11223344" }, { id: 901, detalles: "REALTIME-MARCADOR-11223344" });
  be.tablas.mensajes_viaje.push({ id: "mm", viaje_id: 900, mensaje: "REALTIME-MARCADOR-11223344" });
  be.tablas.usuarios.push({ id: "uu", nombre: "REALTIME-MARCADOR-11223344", email: "realtime-11223344@tila-staging.invalid" });
  const antes = be.tablas.cargas.filter((c) => !String(c.detalles ?? "").includes("11223344")).length;
  const x = await correr(["--limpiar-run=11223344"], { be });
  assert.equal(x.codigo, 0, x.texto);
  assert.equal(be.tablas.cargas.length, antes); assert.ok(!be.tablas.mensajes_viaje.some((m) => m.id === "mm")); assert.ok(!be.tablas.usuarios.some((u) => u.id === "uu"));
  assert.ok(be.tablas.cargas.some((c) => c.detalles === OTRA_MARCA), "otra corrida intacta");
  assert.deepEqual(be.appLlamadas, []); assert.equal(be.subs.length, 0);
});
test("--limpiar-run inválido o combinado con otras opciones → exit 2", async () => {
  for (const a of [["--limpiar-run=abc"], ["--limpiar-run=ZZZZZZZZ"], ["--limpiar-run=11223344", `--base=${BASE}`], ["--limpiar-run="]]) {
    const be = new Backend(); assert.equal((await correr(a, { be })).codigo, 2, a.join(" ")); assert.equal(be.clientes, 0);
  }
});

// ═══════════════ 7. Secretos ═══════════════
test("ningún secreto en la salida (ni en errores que los contengan), ni headers/Authorization/apikey", async () => {
  const be = new Backend(); be.ve.anon = () => true;
  be.fallar = (rol, op, tabla) => (op === "insert" && tabla === "usuarios" ? { code: "XX", message: `boom ${ANON} ${SVC} Bearer abcdef1234567890 apikey: zzzzzzzz12345678 eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firmafirmafirma` } : null);
  const x = await correr(ARGS, { be });
  const t = x.texto;
  for (const s of [ANON, SVC, "abcdef1234567890", "zzzzzzzz12345678", "eyJhbGci"]) assert.ok(!t.includes(s), `se filtró ${s.slice(0, 8)}`);
  assert.ok(!/authorization\s*[:=]/i.test(t) && !/apikey\s*[:=]/i.test(t));
  assert.match(t, /\[CONFIGURADA\]/);
});
test("error inesperado (crearCliente lanza con la clave en el mensaje) → exit 1 y sin secretos", async () => {
  const x = await correr(ARGS, { extra: { crearCliente: () => { throw new Error(`clave inválida ${SVC} y ${ANON}`); } } });
  assert.equal(x.codigo, 1); assert.ok(!x.texto.includes(SVC) && !x.texto.includes(ANON));
});
test("fallas que traen las claves en el mensaje durante la limpieza tampoco las filtran", async () => {
  const be = new Backend(); be.fallar = (rol, op) => (op === "select" ? { code: "42501", message: `denegado ${SVC}` } : null);
  const x = await correr(ARGS, { be });
  assert.ok(!x.texto.includes(SVC));
});

// ═══════════════ 8. Argumentos y guardas ═══════════════
test("claves / URL / ref por argv → exit 2, el valor no se muestra y no se crea ningún cliente", async () => {
  for (const a of [`--anon=${ANON}`, `--service-role=${SVC}`, `--key=${SVC}`, `--url=${URL_OK}`, "--ref=abc", "--token=x", "--apikey=y", SVC, "--supabase=x"]) {
    const be = new Backend(); const x = await correr([...ARGS, a], { be });
    assert.equal(x.codigo, 2, a); assert.equal(be.clientes, 0);
    assert.ok(!x.texto.includes(SVC) && !x.texto.includes(ANON) && !x.texto.includes(URL_OK));
  }
});
test("argumento desconocido o --espera fuera de rango → exit 2", async () => {
  for (const a of ["--otra-cosa", "--espera=5", "--espera=999999", "--espera=abc", "--esperado-anon=R9=LLEGA", "--esperado-anon=R1=TAL"]) assert.equal((await correr([...ARGS, a])).codigo, 2, a);
});
test("producción rechazada: ref, URL, base de la app; nunca se crea un cliente", async () => {
  const prod = `https://${REF_PRODUCCION}.supabase.co`;
  const casos = [
    [ARGS, envOk({ TILA_STAGING_SUPABASE_REF: REF_PRODUCCION, STAGING_SUPABASE_URL: prod })],
    [ARGS, envOk({ STAGING_SUPABASE_URL: prod })],
    [ARGS, envOk({ STAGING_ANON_KEY: `sb_publishable_${REF_PRODUCCION}abcdefghij` })],
    [[`--base=https://${HOSTS_PRODUCCION[1]}`], envOk()],
    [[`--base=https://${HOSTS_PRODUCCION[1]}/x`], envOk({ TILA_STAGING_APP_HOSTS: "otro.example.com" })],
    [[`--base=https://otro.example.com`], envOk()],
    [ARGS, envOk({ TILA_ENTORNO: "produccion" })],
    [ARGS, envOk({ TILA_ENTORNO: "local" })],
    [[], envOk()],
  ];
  for (const [args, env] of casos) {
    const be = new Backend(); const x = await correr(args, { be, env });
    assert.equal(x.codigo, 2, `${args.join(" ")} ${x.texto}`); assert.equal(be.clientes, 0); assert.match(x.texto, /RECHAZADA/);
    assert.ok(!x.texto.includes(SVC) && !x.texto.includes(ANON));
  }
});
test("variables faltantes o mal formadas → exit 2", async () => {
  for (const n of ["TILA_ENTORNO", "TILA_STAGING_SUPABASE_REF", "STAGING_SUPABASE_URL", "STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY"]) {
    const env = envOk(); delete env[n]; assert.equal((await correr(ARGS, { env })).codigo, 2, n);
  }
  assert.equal((await correr(ARGS, { env: envOk({ STAGING_ANON_KEY: SVC }) })).codigo, 2);
  assert.equal((await correr(ARGS, { env: envOk({ STAGING_SERVICE_ROLE_KEY: ANON }) })).codigo, 2);
});
test("URL http de la app sin host permitido, con credenciales, o base ausente → exit 2; loopback OK", async () => {
  assert.equal((await correr(["--base=http://u:p@127.0.0.1:3131"])).codigo, 2);
  const ok = await correr(["--base=http://127.0.0.2:3132"]); assert.notEqual(ok.codigo, 2);
  const remoto = await correr(["--base=https://tila-staging.vercel.app"], { env: envOk({ TILA_STAGING_APP_HOSTS: "tila-staging.vercel.app" }) }); assert.notEqual(remoto.codigo, 2);
});

// ═══════════════ 9. --plan ═══════════════
const trampa = (n) => new Proxy({}, { get() { throw new Error(`--plan tocó ${n}`); } });
test("--plan / --listar: no lee env, no crea clientes, no abre red, no ejecuta ni limpia nada; lista las 6 acciones", async () => {
  for (const flag of ["--plan", "--listar"]) {
    const salida = [];
    const deps = { env: trampa("env"), out: (l) => salida.push(l), err: () => { throw new Error("err"); }, crearCliente: () => { throw new Error("crearCliente"); }, iniciarSesion: () => { throw new Error("iniciarSesion"); }, proceso: trampa("proceso") };
    assert.equal(await R.main([flag], deps), 0);
    const t = salida.join("\n");
    for (const a of R.ACCIONES) assert.ok(t.includes(a.id) && t.includes(`${a.tabla}/${a.tipo}`));
    assert.match(t, /CONTROL POSITIVO/); assert.match(t, /exit|salida/); assert.match(t, /DELETE/);
    assert.ok(!t.includes("sb_secret_") && !t.includes("sb_publishable_"));
  }
});
test("--plan corre como script real, sin variables ni red (entorno vacío)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--plan"], { env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" }, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /R6/);
});
test("script real sin variables → exit 2 sin abrir conexiones; con clave por argv → exit 2", () => {
  const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" };
  const a = spawnSync(process.execPath, [SCRIPT, `--base=${BASE}`], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(a.status, 2, a.stdout + a.stderr); assert.match(a.stderr, /RECHAZADA/);
  const b = spawnSync(process.execPath, [SCRIPT, `--anon=${ANON}`], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(b.status, 2); assert.ok(!b.stdout.includes(ANON) && !b.stderr.includes(ANON));
});

// ═══════════════ 10. Códigos de salida y clasificación (puras) ═══════════════
test("clasificarAccion: tabla de decisión", () => {
  const C = R.clasificarAccion; const L = "LLEGÓ", N = "NO LLEGÓ", E = "ERROR";
  assert.equal(C({ aplicada: true, anon: L, control: L, tabla: "cargas" }).clase, "ANON RECIBE");
  assert.equal(C({ aplicada: true, anon: N, control: L, tabla: "cargas" }).clase, "ANON NO RECIBE");
  for (const anon of [L, N, E]) { const r = C({ aplicada: true, anon, control: N, tabla: "cargas" }); assert.equal(r.clase, "INCONCLUSO"); assert.equal(r.bloquea, true); }
  assert.equal(C({ aplicada: true, anon: L, control: E, tabla: "cargas" }).clase, "INCONCLUSO");
  assert.equal(C({ aplicada: true, anon: E, control: L, tabla: "cargas" }).clase, "INCONCLUSO");
  assert.equal(C({ aplicada: false, anon: N, control: N, tabla: "cargas" }).bloquea, true);
  const u = C({ aplicada: true, anon: N, control: N, tabla: "usuarios" }); assert.equal(u.clase, "INCONCLUSO"); assert.equal(u.bloquea, false);
});
test("resumir: precedencia de códigos 1 > 3 > diferencia > 0", () => {
  const ok = { ok: true }, mal = { ok: false };
  const A = (id, clase, bloquea = false) => ({ id, clase, bloquea });
  assert.equal(R.resumir({ acciones: [A("R1", "ANON RECIBE")], limpieza: ok }).codigo, 0);
  assert.equal(R.resumir({ acciones: [A("R1", "INCONCLUSO", true)], limpieza: ok }).codigo, 3);
  assert.equal(R.resumir({ acciones: [A("R5", "INCONCLUSO", false)], limpieza: ok }).codigo, 0);
  assert.equal(R.resumir({ acciones: [A("R1", "INCONCLUSO", true)], limpieza: mal }).codigo, 1);
  assert.equal(R.resumir({ acciones: [], limpieza: ok, errorInterno: "x" }).codigo, 1);
  assert.equal(R.resumir({ acciones: [], limpieza: null }).codigo, 1);
  assert.equal(R.resumir({ acciones: [], limpieza: ok, interrupcionInconcluso: "señal" }).codigo, 3);
  assert.equal(R.resumir({ acciones: [A("R1", "ANON NO RECIBE")], limpieza: ok, esperado: { R1: "LLEGA" } }).codigo, 1);
  assert.equal(R.resumir({ acciones: [A("R1", "ANON NO RECIBE")], limpieza: ok, esperado: { R1: "NO_LLEGA" } }).codigo, 0);
  assert.equal(R.resumir({ acciones: [A("R1", "INCONCLUSO", true)], limpieza: ok, esperado: { R1: "LLEGA" } }).codigo, 3);
});
test("--esperado-anon: coincide → 0; difiere → 1 (DIFERENCIA); no se exige nada si no se pasa", async () => {
  const be1 = new Backend(); const ok = await correr([...ARGS, "--esperado-anon=R1=NO_LLEGA,R6=NO_LLEGA"], { be: be1 });
  assert.equal(ok.codigo, 0, ok.texto);
  const be2 = new Backend(); const dif = await correr([...ARGS, "--esperado-anon=R1=LLEGA"], { be: be2 });
  assert.equal(dif.codigo, 1, dif.texto); assert.match(dif.texto, /DIFERENCIA con --esperado-anon → R1/);
  assert.deepEqual(marcasVivas(be2), []);
});
test("los códigos 0, 1, 2 y 3 son los únicos posibles", async () => {
  const vistos = new Set();
  vistos.add((await correr(ARGS, { be: (() => { const b = new Backend(); b.ve.anon = () => true; return b; })() })).codigo);
  vistos.add((await correr([...ARGS, "--esperado-anon=R1=LLEGA"])).codigo);
  vistos.add((await correr([])).codigo);
  const be = new Backend(); be.dropControl = true; vistos.add((await correr(ARGS, { be })).codigo);
  assert.deepEqual([...vistos].sort(), [0, 1, 2, 3]);
});

// ═══════════════ 11. Bearer / estructura del script ═══════════════
test("corrección del Bearer: R5 usa el cliente supabase-js anon (sin fetch ni headers manuales) y aplica el UPDATE con count", async () => {
  const src = readFileSync(SCRIPT, "utf8");
  const codigo = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/\bfetch\s*\(/.test(codigo), "no debe haber fetch manual");
  assert.ok(!/["'`]authorization["'`]/i.test(codigo) && !/bearer\s/i.test(codigo.replace(/\/\*[\s\S]*?\*\//g, "")), "no se fabrican headers Authorization");
  assert.ok(!/headers\s*:/.test(codigo), "no se arman headers a mano");
  assert.ok(/anon\.from\("usuarios"\)\.update\(/.test(codigo));
  const be = new Backend(); await correr(ARGS, { be });
  const r5 = be.llamadas.find((c) => c.rol === "anon"); assert.deepEqual([r5.op, r5.tabla], ["update", "usuarios"]);
  assert.equal(r5.filtros.length, 1); assert.equal(r5.filtros[0][0], "id");
});
test("auditoría estática: solo variables de entorno; sin shell/exec; process.env una vez (depsReales); sin lectura de .env; sin producción literal; imports mínimos", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const codigo = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/child_process|shell\s*:\s*true/.test(codigo));
  assert.ok(!/(?<![.\w])exec(Sync)?\s*\(/.test(codigo));
  assert.equal((codigo.match(/process\.env/g) ?? []).length, 1);
  assert.ok(!/readFile|writeFile|\.env\.staging|dotenv/.test(codigo), "no lee ni escribe archivos");
  assert.ok(!codigo.includes(REF_PRODUCCION) && HOSTS_PRODUCCION.every((h) => !codigo.includes(h)));
  assert.ok(!/TRUNCATE/i.test(codigo.replace(/nunca TRUNCATE[^"\n]*/gi, "")), "sin TRUNCATE");
  const imports = [...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["../guardas.mjs", "./util.mjs", "./v3-anon.mjs", "@supabase/supabase-js", "node:crypto", "node:path"].sort());
});
test("los tiempos están centralizados en TIMEOUTS: sin números mágicos de espera fuera de la constante", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const codigo = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const fuera = codigo.replace(/export const TIMEOUTS = Object\.freeze\(\{[\s\S]*?\}\);/, "");
  assert.ok(!/setTimeout\([^)]*,\s*\d{2,}/.test(fuera) && !/dormir\(\s*\d/.test(fuera) && !/\b\d{4,}\b/.test(fuera.replace(/-32\.5|-60\.9/g, "")), "número mágico de tiempo fuera de TIMEOUTS");
  assert.deepEqual(Object.keys(R.TIMEOUTS).sort(), ["esperaEventoMs", "esperaMaxMs", "esperaMinMs", "esperaPostSuscripcionMs", "limpiezaMs", "llamadaMs", "pollMs", "salidaForzadaMs", "suscripcionMs", "totalMs"]);
  assert.ok(Object.isFrozen(R.TIMEOUTS));
});
test("suscripciones idénticas a las del frontend y acciones R1–R6 completas", () => {
  assert.deepEqual(R.SUSCRIPCIONES.map((s) => `${s.tabla}:${s.evento}`), ["cargas:*", "mensajes_viaje:INSERT", "usuarios:UPDATE", "paradas_viaje:*"]);
  assert.deepEqual(R.ACCIONES.map((a) => `${a.id}:${a.tabla}/${a.tipo}`), ["R1:cargas/INSERT", "R2:cargas/UPDATE", "R3:mensajes_viaje/INSERT", "R4:cargas/UPDATE", "R5:usuarios/UPDATE", "R6:cargas/DELETE"]);
});
test("marcador y email por corrida: formato inequívoco", () => {
  assert.equal(R.marcadorDe("abcd1234"), "REALTIME-MARCADOR-abcd1234"); assert.equal(R.emailDe("abcd1234"), "realtime-abcd1234@tila-staging.invalid");
  assert.match(R.nuevoRunId(), /^[0-9a-f]{8}$/); assert.notEqual(R.nuevoRunId(), R.nuevoRunId());
});
test("los datos de la corrida llevan el marcador: detalles de la carga de R1, mensaje de R3, nombre/email del usuario", async () => {
  const be = new Backend(); let visto = { carga: null, mensaje: null, usuario: null };
  const orig = be.emitir.bind(be);
  be.emitir = (tabla, tipo, nueva, vieja) => { if (tipo === "INSERT") visto[tabla === "cargas" ? "carga" : tabla === "mensajes_viaje" ? "mensaje" : "usuario"] ??= nueva; return orig(tabla, tipo, nueva, vieja); };
  await correr(ARGS, { be });
  assert.equal(visto.carga.detalles, MARCA); assert.equal(visto.mensaje.mensaje, MARCA);
  const ins = be.llamadas.find((c) => c.op === "insert" && c.tabla === "usuarios"); assert.ok(ins);
});

// ═══════════════ 9. Pausa ÚNICA post-SUBSCRIBED antes de R1 (carrera del run 3460101e: R1 perdió el INSERT, aislada con pausa llegó a ~500 ms) ═══════════════
test("R1 no se dispara antes de cumplirse la pausa post-SUBSCRIBED: con la pausa retenida no hay NINGUNA llamada a la app", async () => {
  const be = new Backend();
  let liberar; const retenida = new Promise((r) => { liberar = r; });
  const visto = [];
  const dormir = (ms) => { visto.push({ ms, subs: be.tSub.length, app: be.appLlamadas.length }); return retenida; };
  const corrida = correr(ARGS, { be, extra: { dormir } });
  const t0 = Date.now(); while (visto.length === 0 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 5));
  assert.equal(visto.length, 1, "la pausa debe empezar");
  await new Promise((r) => setTimeout(r, 120)); // con la pausa retenida, NADA debe llegar a la app
  assert.deepEqual(be.appLlamadas, [], "R1 no debe dispararse mientras dure la pausa");
  assert.equal(visto[0].subs, 8, "la pausa empieza recién con las 8 suscripciones (4 tablas × anon/control) ya en SUBSCRIBED");
  assert.equal(visto[0].app, 0);
  liberar();
  const x = await corrida;
  assert.equal(be.appLlamadas[0], "POST /api/cargas/publicar", "la primera acción es R1 y sale recién al terminar la pausa");
  assert.equal(x.codigo, 0, x.texto);
});
test("la pausa ocurre UNA sola vez por corrida, con el valor configurado, y las clasificaciones de R2–R6 no cambian", async () => {
  const be = new Backend(); const llamadas = [];
  const x = await correr(ARGS, { be, timeouts: { ...T_RAPIDO, esperaPostSuscripcionMs: 7 }, extra: { dormir: (ms) => { llamadas.push(ms); return Promise.resolve(); } } });
  assert.deepEqual(llamadas, [7], "una sola pausa, no una por acción");
  assert.deepEqual(be.appLlamadas, ["POST /api/cargas/publicar", "POST /api/cargas/aceptar", "POST /api/chat/mensaje", "PATCH /api/cargas/gps"]);
  assert.equal((x.texto.match(/^pausa post-SUBSCRIBED/gm) ?? []).length, 1);
  assert.equal(x.codigo, 0, x.texto);
  for (const [id, clase] of [["R1", "ANON NO RECIBE"], ["R2", "ANON NO RECIBE"], ["R3", "ANON NO RECIBE"], ["R4", "ANON NO RECIBE"], ["R5", "INCONCLUSO"], ["R6", "ANON NO RECIBE"]]) assert.equal(accion(x, id).clase, clase, id);
});
test("con temporizadores reales: R1 sale ≥ pausa después del último SUBSCRIBED y R2–R6 NO reciben esperas artificiales", async () => {
  const PAUSA = 600, TOL = 15;
  const be = new Backend();
  const x = await correr(ARGS, { be, timeouts: { ...T_RAPIDO, esperaPostSuscripcionMs: PAUSA } });
  assert.equal(x.codigo, 0, x.texto);
  assert.equal(be.tSub.length, 8);
  const espera = be.tApp[0] - Math.max(...be.tSub);
  assert.ok(espera >= PAUSA - TOL, `R1 salió ${espera} ms después del último SUBSCRIBED (mínimo ${PAUSA - TOL})`);
  assert.equal(be.tApp.length, 4);
  for (let i = 1; i < be.tApp.length; i++) assert.ok(be.tApp[i] - be.tApp[i - 1] < PAUSA / 2, `entre las llamadas ${i} y ${i + 1} pasaron ${be.tApp[i] - be.tApp[i - 1]} ms: hay una espera artificial`);
  assert.ok(x.texto.indexOf("fin de la pausa post-SUBSCRIBED") < x.texto.indexOf("[R1]") && x.texto.indexOf("[R1]") < x.texto.indexOf("[R2]"));
});
test("un canal que no llega a SUBSCRIBED sigue bloqueando: control sin SUBSCRIBED → sin pausa ni acciones; anon sin SUBSCRIBED → R1 INCONCLUSO bloqueante", async () => {
  const b1 = new Backend(); b1.modoSub.service.cargas = "nunca"; const p1 = [];
  const x1 = await correr(ARGS, { be: b1, extra: { dormir: (ms) => { p1.push(ms); return Promise.resolve(); } } });
  assert.equal(x1.codigo, 3, x1.texto);
  assert.deepEqual(p1, [], "sin control suscripto no se espera ni se actúa");
  assert.deepEqual(b1.appLlamadas, []);
  for (const a of R.ACCIONES) assert.equal(accion(x1, a.id).clase, "INCONCLUSO", a.id);
  const b2 = new Backend(); b2.modoSub.anon.cargas = "nunca";
  const x2 = await correr(ARGS, { be: b2 });
  assert.equal(x2.codigo, 3, x2.texto);
  assert.equal(accion(x2, "R1").clase, "INCONCLUSO");
  assert.match(x2.texto, /anon: ERROR · control: LLEGÓ → INCONCLUSO \(bloquea\)/);
  const b3 = new Backend(); b3.modoSub.anon.cargas = "error";
  assert.equal((await correr(ARGS, { be: b3 })).codigo, 3);
});
test("diagnóstico: tiempos relativos de SUBSCRIBED, pausa, cada acción y cada evento correlacionado (anon y control)", async () => {
  const PAUSA = 40;
  const be = new Backend(); be.ve.anon = () => true;
  const x = await correr(ARGS, { be, timeouts: { ...T_RAPIDO, esperaPostSuscripcionMs: PAUSA } });
  const n = (re) => { const m = re.exec(x.texto); assert.ok(m, `no aparece ${re}\n${x.texto}`); return m.slice(1).map(Number); };
  const subs = [...x.texto.matchAll(/^suscripción .*resuelto anon \+(\d+) ms · control \+(\d+) ms$/gm)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(subs.length, 4);
  const [ini] = n(/^pausa post-SUBSCRIBED: \d+ ms \(una sola vez, antes de R1\) · desde \+(\d+) ms$/m);
  const [fin] = n(/^fin de la pausa post-SUBSCRIBED \+(\d+) ms$/m);
  for (const [a, c] of subs) assert.ok(a <= ini && c <= ini, "todas las suscripciones se resuelven antes de empezar la pausa");
  assert.ok(fin - ini >= PAUSA - 5, `pausa medida ${fin - ini} ms`);
  const acciones = [...x.texto.matchAll(/^     acción enviada \+(\d+) ms · respuesta \+(\d+) ms$/gm)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(acciones.length, 6, "una línea de tiempos por acción R1–R6");
  assert.ok(acciones[0][0] >= fin, "R1 se envía después de terminada la pausa");
  for (let i = 1; i < 6; i++) assert.ok(acciones[i][0] >= acciones[i - 1][1], "las acciones son secuenciales");
  const ev = [...x.texto.matchAll(/^     evento (control|anon) (INSERT|UPDATE|DELETE) id=(\S+) marcador=(sí|no|n\/d) \+(\d+) ms \((\+?-?\d+) ms tras la respuesta\)$/gm)];
  assert.ok(ev.some((m) => m[1] === "control" && m[2] === "INSERT" && m[4] === "sí" && Number(m[5]) >= acciones[0][0]), "evento de R1 en el control con su marcador");
  assert.ok(ev.some((m) => m[1] === "anon" && m[2] === "INSERT"), "también se registran los eventos de anon");
  assert.ok(ev.some((m) => m[2] === "DELETE" && m[4] === "n/d"), "el DELETE (solo PK) figura sin columna de marcador");
});
test("los eventos que no correlacionan con la acción se cuentan (no se pierden en silencio)", async () => {
  const be = new Backend();
  const orig = be.emitir.bind(be);
  be.emitir = (tabla, tipo, nueva, vieja) => { orig(tabla, tipo, nueva, vieja); if (tabla === "cargas" && tipo === "INSERT" && nueva.detalles === MARCA) orig("cargas", "INSERT", { id: 999999, detalles: "otra" }, {}); };
  const x = await correr(ARGS, { be });
  assert.match(x.texto, /cargas\/INSERT sin correlacionar con esta acción: anon 0 · control 1/);
});
test("los renglones nuevos tienen un formato cerrado (solo ms e ids) y no filtran claves", async () => {
  const be = new Backend(); be.ve.anon = () => true;
  const x = await correr(ARGS, { be });
  for (const s of [ANON, SVC]) assert.ok(!x.texto.includes(s));
  const nuevos = x.salida.filter((l) => /^(pausa post|fin de la pausa|     acción enviada|     evento )/.test(l));
  assert.ok(nuevos.length >= 10);
  const OK = /^(pausa post-SUBSCRIBED: \d+ ms \(una sola vez, antes de R1\) · desde \+\d+ ms|fin de la pausa post-SUBSCRIBED \+\d+ ms|     acción enviada \+\d+ ms · respuesta \+\d+ ms( \(NO aplicada\))?|     evento (control|anon) (INSERT|UPDATE|DELETE) id=\S+ marcador=(sí|no|n\/d) \+\d+ ms \(\+?-?\d+ ms tras la respuesta\))$/;
  for (const l of nuevos) assert.match(l, OK);
});
test("producción sigue protegida: con guarda rechazada no hay clientes, ni pausa, ni acciones", async () => {
  const prod = `https://${REF_PRODUCCION}.supabase.co`; const pausas = [];
  const be = new Backend();
  const x = await correr(ARGS, { be, env: envOk({ TILA_STAGING_SUPABASE_REF: REF_PRODUCCION, STAGING_SUPABASE_URL: prod }), extra: { dormir: (ms) => { pausas.push(ms); return Promise.resolve(); } } });
  assert.equal(x.codigo, 2); assert.equal(be.clientes, 0); assert.deepEqual(pausas, []); assert.deepEqual(be.appLlamadas, []);
  const y = await correr([`--base=https://${HOSTS_PRODUCCION[1]}`], { be: new Backend(), extra: { dormir: (ms) => { pausas.push(ms); return Promise.resolve(); } } });
  assert.equal(y.codigo, 2); assert.deepEqual(pausas, []);
});
test("las ventanas siguen igual (solo se agrega la pausa) y la pausa está en un único punto del código, antes de R1 y fuera de correr()", () => {
  assert.deepEqual({ ...R.TIMEOUTS }, { suscripcionMs: 8000, esperaEventoMs: 8000, esperaPostSuscripcionMs: 2000, esperaMinMs: 1000, esperaMaxMs: 60000, llamadaMs: 15000, limpiezaMs: 30000, totalMs: 180000, pollMs: 25, salidaForzadaMs: 2000 });
  const src = readFileSync(SCRIPT, "utf8");
  const codigo = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal((codigo.match(/await pausar\(/g) ?? []).length, 1);
  const iPausa = codigo.indexOf("await pausar("), iR1 = codigo.indexOf("await correr(R1"), iDef = codigo.indexOf("const correr = async"), iFinDef = codigo.indexOf("try {", iDef);
  assert.ok(iPausa > 0 && iPausa < iR1, "la pausa va antes de R1");
  assert.ok(iPausa < iDef || iPausa > iFinDef, "la pausa no está dentro de correr(): no se repite por acción");
  assert.match(R.textoPlan(), /Pausa post-SUBSCRIBED: 2000 ms, UNA sola vez/);
});
