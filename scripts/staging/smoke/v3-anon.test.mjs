// Tests LOCALES de v3-anon.mjs. No usan red, ni base, ni claves reales, ni .env.staging: todo corre contra un Supabase FALSO en memoria
// que reproduce las policies de producción (RLS + grants abiertos) y permite cambiarlas para comprobar que cada prueba DETECTA el desvío.
// Ejecutar: node --test scripts/staging/smoke/v3-anon.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as V3 from "./v3-anon.mjs";
import * as D from "../seed/datos.mjs";
import { REF_PRODUCCION, HOSTS_PRODUCCION } from "../guardas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(AQUI, "v3-anon.mjs");
const ANON_FALSA = "sb_publishable_TEST0123456789abcdefABCDEF";
const SVC_FALSA = "sb_secret_TEST0123456789abcdefABCDEF";
const HASH_FALSO = "$2b$10$FAKEHASHFAKEHASHFAKEHASHFAKEHASHFAKEHASHFAKEHASHFAKE";
const REF = "abcdefghij0123456789";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

// ═══════════════ Supabase FALSO en memoria ═══════════════
const POLITICA_PROD = () => ({
  selectAnon: new Set(["usuarios", "vehiculos", "documentacion_chofer", "paradas_viaje", "viaje_evidencias"]),
  insertAnon: { usuarios: (r) => ["cliente", "chofer"].includes(r.rol), paradas_viaje: () => true, viaje_evidencias: () => true },
  updateAnon: new Set(["usuarios", "paradas_viaje"]),
  deleteAnon: new Set(),
  storage: { listar: true, subir: true, actualizar: true, borrar: false },
});
const TABLAS_UUID = ["documentacion_chofer", "mensajes_viaje", "billetera_chofer", "usuarios", "tarifas_config"];

function crearMundo(mod = (p) => p) {
  const P0 = POLITICA_PROD();
  const P = mod(P0) ?? P0; // los mutadores de los tests modifican la política en el lugar y no devuelven nada
  const T = Object.fromEntries(["usuarios", "vehiculos", "documentacion_chofer", "cargas", "paradas_viaje", "viaje_evidencias", "mensajes_viaje", "billetera_chofer", "consentimientos_legales", "tarifas_config"].map((t) => [t, []]));
  const almacen = { "documentacion-choferes": new Map(), vehiculos: new Map() };
  const m = { P, T, almacen, bitacora: [], seq: 1000 };

  class Q {
    constructor(rol, tabla) { this.rol = rol; this.tabla = tabla; this.f = []; this.op = "select"; this.cols = "*"; this.dev = false; this.lim = null; }
    select(cols = "*") { if (this.op === "select") this.cols = cols; else { this.dev = true; this.colsRet = cols; } return this; }
    insert(v) { this.op = "insert"; this.v = v; return this; }
    update(v) { this.op = "update"; this.v = v; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c, v) { this.f.push({ t: "eq", c, v }); return this; }
    in(c, vs) { this.f.push({ t: "in", c, vs }); return this; }
    like(c, p) { this.f.push({ t: "like", c, p }); return this; }
    limit(n) { this.lim = n; return this; }
    then(res, rej) { return this.ejecutar().then(res, rej); }
    coincide(r) {
      return this.f.every((x) => x.t === "eq" ? String(r[x.c]) === String(x.v) : x.t === "in" ? x.vs.some((v) => String(v) === String(r[x.c]))
        : new RegExp("^" + x.p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$").test(String(r[x.c] ?? "")));
    }
    proy(r, cols) { if (cols === "*") return { ...r }; const o = {}; for (const c of cols.split(",").map((s) => s.trim())) o[c] = r[c]; return o; }
    async ejecutar() {
      const { rol, tabla } = this; const anon = rol === "anon";
      if (!T[tabla]) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${tabla}' in the schema cache` }, status: 404 };
      m.bitacora.push({ rol, op: this.op, tabla, filtros: this.f.map((x) => ({ ...x })) });
      const filas = T[tabla];
      const visibles = anon && !P.selectAnon.has(tabla) ? [] : filas;
      if (this.op === "select") { let r = visibles.filter((x) => this.coincide(x)); if (this.lim) r = r.slice(0, this.lim); return { data: r.map((x) => this.proy(x, this.cols)), error: null, status: 200 }; }
      if (this.op === "insert") {
        const rows = Array.isArray(this.v) ? this.v : [this.v];
        if (anon) { const chk = P.insertAnon[tabla]; if (!chk || !rows.every(chk)) return { data: null, error: { code: "42501", message: `new row violates row-level security policy for table "${tabla}"` }, status: 403 }; }
        const nuevos = [];
        for (const r of rows) {
          const fila = { ...r };
          if (fila.id === undefined) fila.id = TABLAS_UUID.includes(tabla) ? crypto.randomUUID() : ++m.seq;
          if (tabla === "usuarios" && filas.some((x) => x.email === fila.email)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" }, status: 409 };
          const fk = { paradas_viaje: ["carga_id", "cargas"], vehiculos: ["chofer_id", "usuarios"], documentacion_chofer: ["chofer_id", "usuarios"], consentimientos_legales: ["usuario_id", "usuarios"] }[tabla];
          if (fk && !T[fk[1]].some((x) => String(x.id) === String(fila[fk[0]]))) return { data: null, error: { code: "23503", message: "violates foreign key constraint" }, status: 409 };
          filas.push(fila); nuevos.push(fila);
        }
        return { data: this.dev ? nuevos.map((x) => this.proy(x, this.colsRet)) : null, error: null, status: 201 };
      }
      const permitido = !anon || (this.op === "update" ? P.updateAnon.has(tabla) : P.deleteAnon.has(tabla));
      const afectadas = permitido ? visibles.filter((x) => this.coincide(x)) : [];
      if (this.op === "update") for (const x of afectadas) Object.assign(x, this.v); else for (const x of afectadas) filas.splice(filas.indexOf(x), 1);
      return { data: this.dev ? afectadas.map((x) => this.proy(x, this.colsRet)) : null, error: null, status: this.dev ? 200 : 204 };
    }
  }
  const almac = (rol, b) => {
    const mapa = almacen[b];
    return {
      async list(pref) { if (rol === "anon" && !P.storage.listar) return { data: [], error: null }; return { data: [...mapa.keys()].filter((r) => r.startsWith(pref + "/") && !r.slice(pref.length + 1).includes("/")).map((r) => ({ name: r.slice(pref.length + 1) })), error: null }; },
      async upload(ruta, cuerpo, o = {}) {
        const existe = mapa.has(ruta);
        if (rol === "anon" && (existe ? !P.storage.actualizar : !P.storage.subir)) return { data: null, error: { message: "new row violates row-level security policy", statusCode: "403" } };
        if (existe && !o.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
        mapa.set(ruta, { bytes: Buffer.from(cuerpo), tipo: o.contentType }); return { data: { path: ruta }, error: null };
      },
      async download(ruta) { const x = mapa.get(ruta); if (!x) return { data: null, error: { message: "Object not found" } }; return { data: { arrayBuffer: async () => x.bytes.buffer.slice(x.bytes.byteOffset, x.bytes.byteOffset + x.bytes.byteLength) }, error: null }; },
      async remove(rutas) { if (rol === "anon" && !P.storage.borrar) return { data: [], error: null }; const b2 = []; for (const r of rutas) if (mapa.delete(r)) b2.push({ name: r }); return { data: b2, error: null }; },
      getPublicUrl(ruta) { return { data: { publicUrl: `https://fake.invalid/storage/v1/object/public/${b}/${ruta}` } }; },
    };
  };
  m.cliente = (rol) => ({ from: (t) => new Q(rol, t), storage: { from: (b) => almac(rol, b) } });
  m.fetchFn = async (url) => {
    const mm = /public\/([^/]+)\/(.+)$/.exec(url); const x = mm && almacen[mm[1]]?.get(mm[2]);
    return x ? { status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => new ArrayBuffer(1) } : { status: 404, headers: { get: () => "application/json" }, arrayBuffer: async () => new ArrayBuffer(1) };
  };
  return m;
}

function sembrar(m) {
  const ahora = new Date().toISOString();
  for (const u of D.usuarios(ahora)) m.T.usuarios.push({ ...u, password: HASH_FALSO });
  m.T.vehiculos.push(...D.vehiculos("https://fake.invalid"));
  for (const d of D.documentacion("https://fake.invalid").filas) m.T.documentacion_chofer.push({ ...d, id: crypto.randomUUID() });
  m.T.cargas.push(...D.cargas(ahora)); m.T.paradas_viaje.push(...D.paradas()); m.T.viaje_evidencias.push(...D.evidencias("https://fake.invalid"));
  for (const x of D.mensajes()) m.T.mensajes_viaje.push({ ...x, id: crypto.randomUUID() });
  for (const x of D.billetera()) m.T.billetera_chofer.push({ ...x, id: crypto.randomUUID() });
  m.T.consentimientos_legales.push(...D.consentimientos());
  for (const a of D.documentacion("https://fake.invalid").archivos) m.almacen[a.bucket].set(a.ruta, { bytes: PNG, tipo: "image/png" });
  return m;
}

async function correr(m, ids, { log = () => {} } = {}) {
  const svc = m.cliente("service");
  const semilla = await V3.detectarSemilla(svc, D);
  const c = { anon: m.cliente("anon"), svc, D, semilla, runId: "abc123", fetchFn: m.fetchFn, reg: V3.nuevoRegistro(), est: { storage: [] } };
  const sel = V3.seleccionar(ids);
  const resultados = await V3.ejecutarPruebas(c, sel.ids, log);
  return { c, resultados, por: Object.fromEntries(resultados.map((r) => [r.id, r])) };
}
const TODAS = null;
const estados = (por, ...ids) => ids.map((i) => `${i}:${por[i].estado}`).join(" ");

// ═══════════════ Catálogo ═══════════════
test("el catálogo tiene EXACTAMENTE A1–A15 y B1–B16, con metadatos completos", () => {
  const esperados = [...Array.from({ length: 15 }, (_, i) => `A${i + 1}`), ...Array.from({ length: 16 }, (_, i) => `B${i + 1}`)];
  assert.deepEqual(V3.PRUEBAS.map((p) => p.id), esperados);
  for (const p of V3.PRUEBAS) {
    for (const k of ["titulo", "metodo", "endpoint", "esperado", "diferencia"]) assert.ok(typeof p[k] === "string" && p[k].trim().length >= 2, `${p.id}.${k}`);
    assert.equal(typeof p.ejecutar, "function", p.id);
    assert.equal(p.escribe, p.grupo === "B", `${p.id}: solo las B escriben`);
  }
  assert.deepEqual(V3.PRUEBAS.filter((p) => !p.obligatoria).map((p) => p.id), ["A12"], "solo A12 no es obligatoria");
});
test("listado legible: contiene todas las pruebas y aclara que no se conecta", () => {
  const t = V3.formatearListado();
  for (const p of V3.PRUEBAS) assert.ok(t.includes(p.id + " "), p.id);
  assert.match(t, /NO se conecta a Supabase/);
});
test("--solo: grupos, ids y dependencias automáticas", () => {
  assert.equal(V3.seleccionar(["A"]).ids.length, 15);
  assert.deepEqual(V3.seleccionar(["B4"]).ids, ["B1", "B4"]);
  assert.deepEqual(V3.seleccionar(["B9", "A1"]).ids, ["A1", "B8", "B9"]);
  assert.deepEqual(V3.seleccionar(["B16"]).ids, ["B14", "B16"]);
  assert.ok(V3.seleccionar(["Z9"]).errores.length === 1);
});

// ═══════════════ Configuración y guardas ═══════════════
const ENV_OK = () => ({ TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: REF, STAGING_SUPABASE_URL: `https://${REF}.supabase.co`, STAGING_ANON_KEY: ANON_FALSA, STAGING_SERVICE_ROLE_KEY: SVC_FALSA });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(p)}.firmafalsafirmafalsa`;
const debeFallar = (nombre, mod, patron) => test(`config rechaza: ${nombre}`, () => {
  const env = ENV_OK(); mod(env);
  const r = V3.validarConfig(env);
  assert.equal(r.ok, false, "debía rechazar");
  assert.equal(r.cfg, undefined);
  if (patron) assert.ok(r.errores.some((e) => patron.test(e)), `esperaba ${patron}; hubo: ${r.errores.join(" | ")}`);
});
test("config válida: entorno staging, https://<ref>.supabase.co y claves de formato correcto", () => {
  const r = V3.validarConfig(ENV_OK());
  assert.deepEqual(r.errores, []); assert.equal(r.ok, true); assert.equal(r.cfg.url, `https://${REF}.supabase.co`);
  assert.equal(V3.validarConfig({ ...ENV_OK(), STAGING_SUPABASE_URL: `https://${REF}.supabase.co/` }).ok, true, "barra final tolerada");
  assert.equal(V3.validarConfig({ ...ENV_OK(), STAGING_ANON_KEY: jwt({ role: "anon", ref: REF }), STAGING_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: REF }) }).ok, true, "claves JWT clásicas coherentes");
});
debeFallar("TILA_ENTORNO=local", (e) => { e.TILA_ENTORNO = "local"; }, /staging/);
debeFallar("TILA_ENTORNO ausente", (e) => { delete e.TILA_ENTORNO; }, /staging/);
debeFallar("ref con comas (lista)", (e) => { e.TILA_STAGING_SUPABASE_REF = `${REF},otro123456`; }, /UN solo ref/);
debeFallar("ref con mayúsculas", (e) => { e.TILA_STAGING_SUPABASE_REF = REF.toUpperCase(); }, /UN solo ref/);
debeFallar("ref = ref de producción", (e) => { e.TILA_STAGING_SUPABASE_REF = REF_PRODUCCION; e.STAGING_SUPABASE_URL = `https://${REF_PRODUCCION}.supabase.co`; }, /PRODUCCI/);
debeFallar("URL que apunta a producción", (e) => { e.STAGING_SUPABASE_URL = `https://${REF_PRODUCCION}.supabase.co`; }, /PRODUCCI/);
debeFallar("URL con host de producción (app)", (e) => { e.STAGING_SUPABASE_URL = `https://${HOSTS_PRODUCCION[1]}`; }, /PRODUCCI/);
debeFallar("ref de la URL distinto del declarado", (e) => { e.STAGING_SUPABASE_URL = "https://zzzzzzzzzzzzzzzzzzzz.supabase.co"; }, /no coincide EXACTAMENTE/);
debeFallar("URL con http", (e) => { e.STAGING_SUPABASE_URL = `http://${REF}.supabase.co`; }, /https/);
debeFallar("URL con ruta", (e) => { e.STAGING_SUPABASE_URL = `https://${REF}.supabase.co/rest/v1`; }, /sin ruta/);
debeFallar("URL con puerto", (e) => { e.STAGING_SUPABASE_URL = `https://${REF}.supabase.co:8443`; }, /puerto/);
debeFallar("URL con credenciales", (e) => { e.STAGING_SUPABASE_URL = `https://u:p@${REF}.supabase.co`; }, /usuario/);
debeFallar("URL de otro dominio", (e) => { e.STAGING_SUPABASE_URL = `https://${REF}.evil.example`; }, /no coincide/);
debeFallar("URL ausente", (e) => { delete e.STAGING_SUPABASE_URL; }, /Falta STAGING_SUPABASE_URL/);
debeFallar("anon con formato de clave secreta", (e) => { e.STAGING_ANON_KEY = SVC_FALSA; }, /SECRETA|iguales/);
debeFallar("service con formato de clave pública", (e) => { e.STAGING_SERVICE_ROLE_KEY = ANON_FALSA; }, /PÚBLICA/);
debeFallar("anon == service", (e) => { e.STAGING_SERVICE_ROLE_KEY = e.STAGING_ANON_KEY; }, /iguales|PÚBLICA/);
debeFallar("JWT de anon con rol service_role", (e) => { e.STAGING_ANON_KEY = jwt({ role: "service_role", ref: REF }); }, /rol distinto de anon/);
debeFallar("JWT de service con rol anon", (e) => { e.STAGING_SERVICE_ROLE_KEY = jwt({ role: "anon", ref: REF }); }, /rol distinto de service_role/);
debeFallar("JWT de OTRO proyecto (claim ref)", (e) => { e.STAGING_ANON_KEY = jwt({ role: "anon", ref: "zzzzzzzzzzzzzzzzzzzz" }); }, /otro proyecto/);
debeFallar("JWT con el ref de PRODUCCIÓN en el claim", (e) => { e.STAGING_ANON_KEY = jwt({ role: "anon", ref: REF_PRODUCCION }); }, /otro proyecto|PRODUCCI/);
debeFallar("clave con formato irreconocible", (e) => { e.STAGING_ANON_KEY = "cualquier-cosa"; }, /formato reconocible/);
debeFallar("falta la anon", (e) => { delete e.STAGING_ANON_KEY; }, /Falta STAGING_ANON_KEY/);
debeFallar("falta la service_role", (e) => { delete e.STAGING_SERVICE_ROLE_KEY; }, /Falta STAGING_SERVICE_ROLE_KEY/);
debeFallar("TLS desactivado", (e) => { e.NODE_TLS_REJECT_UNAUTHORIZED = "0"; }, /TLS/);
test("config nunca devuelve las claves en los mensajes de error", () => {
  const env = ENV_OK(); env.STAGING_SUPABASE_URL = `https://${REF_PRODUCCION}.supabase.co`;
  const r = V3.validarConfig(env);
  assert.ok(!r.errores.join(" ").includes(ANON_FALSA) && !r.errores.join(" ").includes(SVC_FALSA));
});

// ═══════════════ Argumentos: nunca claves ═══════════════
test("argumentos: las claves/URL/ref por línea de comandos se RECHAZAN sin mostrarlas", () => {
  for (const a of ["--anon=" + ANON_FALSA, "--key=x", "--service-role=" + SVC_FALSA, "--token=abc", "--url=https://x.supabase.co", "--ref=abc", "--password=p", ANON_FALSA, "--env=.env.staging", "eyJabc.def.ghi"]) {
    const r = V3.parsearArgs([a]);
    assert.ok(r.errores.length >= 1, a);
    assert.ok(!r.errores.join(" ").includes("TEST0123"), "el error no debe repetir el valor");
  }
  assert.deepEqual(V3.parsearArgs(["--listar", "--solo=a,b4", "--limpiar"]), { listar: true, ayuda: false, limpiar: true, solo: ["A", "B4"], errores: [] });
  assert.equal(V3.parsearArgs(["--plan"]).listar, true);
  assert.ok(V3.parsearArgs(["--raro"]).errores.length === 1);
});

// ═══════════════ Redacción ═══════════════
test("redactar: quita claves, JWT, Bearer y apikey; y los secretos exactos", () => {
  const t = `x ${ANON_FALSA} y ${SVC_FALSA} Bearer abcdef123456789 apikey: qwertyuiop123456 ${jwt({ role: "anon" })} secreto-exacto-12345`;
  const r = V3.redactar(t, ["secreto-exacto-12345"]);
  for (const s of [ANON_FALSA, SVC_FALSA, "abcdef123456789", "qwertyuiop123456", "secreto-exacto-12345", "eyJ"]) assert.ok(!r.includes(s), s);
  assert.ok(r.includes("[REDACTADO]"));
});
test("inspeccionarClave: reconoce formatos sin mostrar el valor", () => {
  assert.equal(V3.inspeccionarClave(ANON_FALSA).formato, "publishable");
  assert.equal(V3.inspeccionarClave(SVC_FALSA).formato, "secret");
  assert.deepEqual(V3.inspeccionarClave(jwt({ role: "anon", ref: "r1" })), { formato: "jwt", rol: "anon", ref: "r1" });
  assert.equal(V3.inspeccionarClave("nada").formato, "desconocido");
  assert.equal(V3.inspeccionarClave("").formato, "ausente");
});

// ═══════════════ Modo --listar: sin claves, sin red, sin escribir ═══════════════
test("--listar corre SIN variables de entorno de staging y bajo `node --permission` (sin escritura ni procesos)", () => {
  const env = { ...process.env }; for (const k of ["TILA_ENTORNO", "TILA_STAGING_SUPABASE_REF", "STAGING_SUPABASE_URL", "STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY"]) delete env[k];
  const r = spawnSync(process.execPath, ["--permission", `--allow-fs-read=${resolve(AQUI, "..")}`, SCRIPT, "--listar"], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  for (const p of V3.PRUEBAS) assert.ok(r.stdout.includes(p.id + " "), p.id);
  assert.match(r.stdout, /NO se conecta a Supabase/);
  assert.equal(r.stderr.trim(), "");
});
test("una clave pasada como argumento aborta con exit 2 y NO se imprime", () => {
  const r = spawnSync(process.execPath, [SCRIPT, `--anon=${ANON_FALSA}`], { encoding: "utf8", env: { ...process.env } });
  assert.equal(r.status, 2);
  assert.ok(!(r.stdout + r.stderr).includes("TEST0123"));
});
test("sin configuración válida NO se abre ninguna conexión: exit 2 y mensaje claro", () => {
  const env = { ...process.env, TILA_ENTORNO: "local" }; for (const k of ["TILA_STAGING_SUPABASE_REF", "STAGING_SUPABASE_URL", "STAGING_ANON_KEY", "STAGING_SERVICE_ROLE_KEY"]) delete env[k];
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env });
  assert.equal(r.status, 2); assert.match(r.stdout, /CONFIGURACIÓN INVÁLIDA — no se abrió ninguna conexión/);
});

// ═══════════════ Ejecución completa contra el Supabase FALSO (policies de producción) ═══════════════
test("con las policies de producción, TODAS las pruebas obligatorias dan PASS y solo A12 da SKIP (no obligatoria)", async () => {
  const m = sembrar(crearMundo());
  const { resultados, por } = await correr(m, TODAS);
  const fallos = resultados.filter((r) => r.estado === "FAIL");
  assert.deepEqual(fallos.map((r) => `${r.id}: ${r.observado}`), []);
  assert.equal(resultados.length, 31);
  assert.equal(por.A12.estado, "SKIP"); assert.match(por.A12.observado, /semilla incompleta/);
  const s = V3.resumir(resultados);
  assert.equal(s.codigo, 0); assert.equal(s.cuenta.A.PASS, 14); assert.equal(s.cuenta.B.PASS, 16); assert.equal(s.skipsObl.length, 0);
});
test("la salida NO contiene datos sensibles (hash, DNI, teléfono, CUIT, alias) ni claves", async () => {
  const m = sembrar(crearMundo()); const logs = [];
  await correr(m, TODAS, { log: (...p) => logs.push(p.join(" ")) });
  const todo = logs.join("\n");
  for (const s of [HASH_FALSO, "$2b$10$", "00000021", "+54 11 0000 0021", "20-00000021-0", "alias.staging.chofer1", "Titular Ficticio", ANON_FALSA, SVC_FALSA, "Staging-Chofer1-1234"]) assert.ok(!todo.includes(s), `salió: ${s}`);
  assert.match(todo, /contraseñas legibles/); assert.match(todo, /NO se imprimen|NO impresos/);
});
test("una excepción que contiene una clave sale REDACTADA", async () => {
  V3.definirSecretos([SVC_FALSA]);
  const m = sembrar(crearMundo()); const svc = m.cliente("service"); const logs = [];
  const roto = { ...m.cliente("anon"), from: () => { throw new Error(`boom ${SVC_FALSA} Bearer abcdef123456789xyz`); } };
  const c = { anon: roto, svc, D, semilla: await V3.detectarSemilla(svc, D), runId: "abc123", fetchFn: m.fetchFn, reg: V3.nuevoRegistro(), est: { storage: [] } };
  const r = await V3.ejecutarPruebas(c, ["A1"], (...p) => logs.push(p.join(" ")));
  V3.definirSecretos([]);
  assert.equal(r[0].estado, "FAIL"); assert.ok(!r[0].observado.includes(SVC_FALSA) && !r[0].observado.includes("abcdef123456789xyz"));
});
test("todo lo que crea V3 lleva marcador inequívoco", async () => {
  const m = sembrar(crearMundo()); const antes = m.T.usuarios.length;
  await correr(m, TODAS);
  const nuevos = m.T.usuarios.slice(antes);
  assert.equal(nuevos.length, 2);
  for (const u of nuevos) assert.match(u.email, /^v3-[0-9a-z]+-(cliente|chofer)@tila-staging\.invalid$/);
  assert.ok(m.T.paradas_viaje.filter((p) => p.direccion === V3.MARCADOR).length === 1);
  assert.ok(m.T.viaje_evidencias.filter((p) => p.observacion === V3.MARCADOR).length === 1);
  for (const b of Object.values(m.almacen)) for (const ruta of b.keys()) if (ruta.includes("abc123")) assert.ok(ruta.startsWith(V3.PREFIJO_STORAGE));
  for (const t of ["cargas", "mensajes_viaje", "billetera_chofer", "consentimientos_legales", "tarifas_config"]) assert.ok(!m.T[t].some((r) => JSON.stringify(r).includes(V3.MARCADOR)), `${t} no debe tener filas de V3`);
});
test("la service_role NUNCA produce el comportamiento probado: no inserta/actualiza/borra durante las pruebas (solo lee)", async () => {
  const m = sembrar(crearMundo()); await correr(m, TODAS);
  const escrituras = m.bitacora.filter((b) => b.rol === "service" && b.op !== "select");
  assert.deepEqual(escrituras, [], "sin --limpiar la service_role solo puede leer");
});

// ── Mutaciones de policy: cada prueba debe DETECTAR el desvío ──
const muta = (nombre, mod, ids, esperadoFail, extra) => test(`detecta: ${nombre}`, async () => {
  const m = sembrar(crearMundo(mod)); const { por, c } = await correr(m, ids);
  for (const id of esperadoFail) assert.equal(por[id].estado, "FAIL", `${id} debía dar FAIL (dio ${por[id].estado}: ${por[id].observado})`);
  if (extra) await extra({ m, por, c });
});
muta("se cerró la lectura de usuarios", (p) => { p.selectAnon.delete("usuarios"); }, ["A1", "A2", "A3"], ["A1", "A2", "A3"]);
muta("se cerró la lectura de vehiculos / documentacion / paradas / evidencias", (p) => { for (const t of ["vehiculos", "documentacion_chofer", "paradas_viaje", "viaje_evidencias"]) p.selectAnon.delete(t); }, ["A4", "A5", "A6", "A7"], ["A4", "A5", "A6", "A7"]);
muta("se abrió la lectura de cargas / mensajes / billetera / consentimientos", (p) => { for (const t of ["cargas", "mensajes_viaje", "billetera_chofer", "consentimientos_legales"]) p.selectAnon.add(t); }, ["A8", "A9", "A10", "A11"], ["A8", "A9", "A10", "A11"]);
muta("Storage: anon ya no puede listar", (p) => { p.storage.listar = false; }, ["A13"], ["A13"]);
muta("se cerró el INSERT de clientes (endurecimiento)", (p) => { p.insertAnon.usuarios = () => false; }, ["B1", "B4", "B5"], ["B1"], ({ por }) => { assert.equal(por.B4.estado, "SKIP"); assert.equal(por.B5.estado, "SKIP"); });
muta("se permitió crear usuarios admin", (p) => { p.insertAnon.usuarios = () => true; }, ["B2"], ["B2"], ({ c }) => assert.equal(c.reg.usuarios.length, 1));
muta("se cerró el PATCH de usuarios (endurecimiento)", (p) => { p.updateAnon.delete("usuarios"); }, ["B4"], ["B4"]);
muta("se permitió el DELETE de usuarios", (p) => { p.deleteAnon.add("usuarios"); }, ["B5"], ["B5"]);
muta("se permitió el INSERT de vehiculos", (p) => { p.insertAnon.vehiculos = () => true; }, ["B3", "B6"], ["B6"]);
muta("se permitió el UPDATE de vehiculos", (p) => { p.updateAnon.add("vehiculos"); }, ["B7"], ["B7"], ({ c }) => assert.ok(c.reg.restauraciones.some((x) => x.tabla === "vehiculos" && x.tipo === "columna")));
muta("se cerró el INSERT de paradas", (p) => { p.insertAnon.paradas_viaje = () => false; }, ["B8", "B9"], ["B8"], ({ por }) => assert.equal(por.B9.estado, "SKIP"));
muta("se permitió el DELETE de paradas", (p) => { p.deleteAnon.add("paradas_viaje"); }, ["B9"], ["B9"]);
muta("se cerró el INSERT de evidencias", (p) => { delete p.insertAnon.viaje_evidencias; }, ["B10", "B11"], ["B10"]);
muta("se permitió el UPDATE de evidencias", (p) => { p.updateAnon.add("viaje_evidencias"); }, ["B10", "B11"], ["B11"]);
muta("se permitió el INSERT de cargas", (p) => { p.insertAnon.cargas = () => true; }, ["B12"], ["B12"], ({ c }) => assert.ok(c.reg.inesperados.some((x) => x.tabla === "cargas")));
muta("se permitió el INSERT de consentimientos_legales (con B3 previo existe el FK: la fila se crea)", (p) => { p.insertAnon.consentimientos_legales = () => true; }, ["B3", "B12"], ["B12"], ({ c }) => assert.ok(c.reg.inesperados.some((x) => x.tabla === "consentimientos_legales")));
muta("se permitió el INSERT de consentimientos_legales SIN chofer previo (RLS permite; falla luego por FK, y se detecta igual)", (p) => { p.insertAnon.consentimientos_legales = () => true; }, ["B12"], ["B12"], ({ por }) => assert.match(por.B12.observado, /RLS PERMITIÓ el INSERT/));
muta("se permitió el UPDATE de cargas", (p) => { p.updateAnon.add("cargas"); p.selectAnon.add("cargas"); }, ["B13"], ["B13"], ({ c }) => assert.ok(c.reg.restauraciones.some((x) => x.tabla === "cargas" && x.tipo === "columna")));
muta("se permitió el DELETE de cargas", (p) => { p.deleteAnon.add("cargas"); p.selectAnon.add("cargas"); }, ["B13"], ["B13"], ({ c }) => assert.ok(c.reg.restauraciones.some((x) => x.tabla === "cargas" && x.tipo === "reinsertar")));
muta("Storage: anon ya no puede subir", (p) => { p.storage.subir = false; }, ["B14", "B15", "B16"], ["B14"], ({ por }) => { assert.equal(por.B15.estado, "SKIP"); assert.equal(por.B16.estado, "SKIP"); });
muta("Storage: anon ya no puede reemplazar", (p) => { p.storage.actualizar = false; }, ["B14", "B15"], ["B15"]);
muta("Storage: anon PUEDE borrar", (p) => { p.storage.borrar = true; }, ["B14", "B16"], ["B16"]);
test("sin semilla aplicada: las pruebas que la necesitan dan SKIP con motivo claro y el exit code NO es 0", async () => {
  const m = crearMundo(); const { por, resultados } = await correr(m, ["A1", "A4", "A8", "B7", "B13"]);
  assert.equal(estados(por, "A1", "A4", "A8", "B7", "B13"), "A1:SKIP A4:SKIP A8:SKIP B7:SKIP B13:SKIP");
  assert.match(por.A1.observado, /aplicar el seed ficticio ANTES de V3/);
  assert.equal(V3.resumir(resultados).codigo, 3);
});
test("una tabla de backup presente en staging con filas sería un FAIL de A15; ausente es PASS (diferencia esperada)", async () => {
  const m = sembrar(crearMundo());
  assert.equal((await correr(m, ["A15"])).por.A15.estado, "PASS");
  m.T.backup_usuarios_20260614 = [{ id: 1 }]; m.P.selectAnon.add("backup_usuarios_20260614");
  assert.equal((await correr(m, ["A15"])).por.A15.estado, "FAIL");
});
test("el exit code: 1 si hay FAIL, 3 si solo hay SKIP obligatorio, 0 si todo pasa", () => {
  const r = (estado, obligatoria = true) => ({ id: "A1", grupo: "A", estado, obligatoria });
  assert.equal(V3.resumir([r("PASS")]).codigo, 0);
  assert.equal(V3.resumir([r("PASS"), r("SKIP", false)]).codigo, 0);
  assert.equal(V3.resumir([r("PASS"), r("SKIP")]).codigo, 3);
  assert.equal(V3.resumir([r("SKIP"), r("FAIL")]).codigo, 1);
});

// ═══════════════ Limpieza EXACTA ═══════════════
test("limpiarMarcadores borra SOLO lo que creó V3 (id registrado + marcador) y nada del seed", async () => {
  const m = sembrar(crearMundo()); const { c } = await correr(m, TODAS);
  const seed = { usuarios: 6, paradas: 5, evid: 3 };
  assert.equal(m.T.usuarios.length, seed.usuarios + 2);
  const n0 = m.bitacora.length; const logs = [];
  const informe = await V3.limpiarMarcadores(c.svc, c.reg, (...p) => logs.push(p.join(" ")));
  assert.equal(m.T.usuarios.length, seed.usuarios); assert.equal(m.T.paradas_viaje.length, seed.paradas); assert.equal(m.T.viaje_evidencias.length, seed.evid);
  for (const b of Object.values(m.almacen)) for (const ruta of b.keys()) assert.ok(!ruta.startsWith(V3.PREFIJO_STORAGE), `quedó ${ruta}`);
  assert.equal(m.T.cargas.length, 7); assert.equal(m.T.mensajes_viaje.length, 8);
  assert.ok(informe.length >= 4);
  const ops = m.bitacora.slice(n0).filter((b) => b.op === "delete");
  assert.ok(ops.length >= 3);
  for (const o of ops) {
    assert.equal(o.rol, "service"); assert.ok(["usuarios", "paradas_viaje", "viaje_evidencias"].includes(o.tabla), o.tabla);
    assert.ok(o.filtros.some((f) => f.t === "in" && f.c === "id"), "debe filtrar por ids registrados");
    assert.ok(o.filtros.some((f) => f.t === "like" || (f.t === "eq" && ["direccion", "observacion"].includes(f.c))), "debe filtrar por marcador");
    assert.ok(o.filtros.length >= 2, "nunca un DELETE sin filtros");
  }
});
test("limpiarMarcadores NO borra una fila del seed aunque su id esté en el registro (el marcador no coincide)", async () => {
  const m = sembrar(crearMundo()); const svc = m.cliente("service");
  const reg = V3.nuevoRegistro();
  reg.usuarios.push(D.ID.admin, D.ID.cliente1); reg.paradas.push(1, 2); reg.evidencias.push(1);
  reg.storage.push({ bucket: "vehiculos", ruta: `${D.ID.chofer1}/foto_frente.png` }, { bucket: "vehiculos", ruta: "otra/cosa.png" });
  await V3.limpiarMarcadores(svc, reg, () => {});
  assert.equal(m.T.usuarios.length, 6); assert.equal(m.T.paradas_viaje.length, 5); assert.equal(m.T.viaje_evidencias.length, 3);
  assert.ok(m.almacen.vehiculos.has(`${D.ID.chofer1}/foto_frente.png`), "un objeto del seed no se toca");
});
test("--limpiar restaura exactamente una fila del seed alterada/borrada por una prueba fallida", async () => {
  const m = sembrar(crearMundo((p) => { p.updateAnon.add("cargas"); p.selectAnon.add("cargas"); p.deleteAnon.add("cargas"); }));
  const orig = { ...m.T.cargas.find((x) => x.id === 105) };
  const { por, c } = await correr(m, ["B13"]);
  assert.equal(por.B13.estado, "FAIL");
  assert.ok(!m.T.cargas.some((x) => x.id === 105), "la prueba fallida borró la fila (simulado)");
  await V3.limpiarMarcadores(c.svc, c.reg, () => {});
  const vuelta = m.T.cargas.find((x) => x.id === 105);
  assert.ok(vuelta, "fila reinsertada"); assert.deepEqual(vuelta, orig, "idéntica a la original");
});
test("sin --limpiar quedan listados los objetos V3 (para el elemento 4 / limpieza manual)", async () => {
  const m = sembrar(crearMundo()); const { c } = await correr(m, TODAS);
  const restos = V3.listarRestos(c.reg).join("\n");
  assert.match(restos, /usuarios/); assert.match(restos, /paradas_viaje/); assert.match(restos, /viaje_evidencias/); assert.match(restos, /v3-marcador\//);
});

// ═══════════════ Auditoría estática del propio archivo ═══════════════
test("auditoría estática: sin ref/host/clave de producción hardcodeados, sin leer archivos, sin TRUNCATE, una sola vía de salida", () => {
  const src = readFileSync(SCRIPT, "utf8"), tst = readFileSync(fileURLToPath(import.meta.url), "utf8");
  for (const [n, s] of [["script", src], ["test", tst]]) {
    assert.ok(!s.includes(REF_PRODUCCION), `${n}: contiene el ref de producción`);
    for (const h of HOSTS_PRODUCCION) assert.ok(!s.includes(h), `${n}: contiene el host ${h}`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\./.test(s), `${n}: parece contener un JWT real`);
    assert.ok(!/sb_(secret|publishable)_[A-Za-z0-9]{30,}/.test(s.replace(/TEST0123456789abcdefABCDEF/g, "")), `${n}: parece contener una clave real`);
  }
  assert.ok(!/from\s+["']node:fs["']|require\(["']node:fs/.test(src), "el script no importa node:fs (no lee .env.staging ni nada)");
  assert.ok(!/readFile|writeFile|appendFile|createWriteStream/.test(src), "sin lectura/escritura de archivos");
  assert.ok(!/child_process|execSync|spawn\(/.test(src), "sin procesos hijos");
  assert.ok(!/truncate/i.test(src.replace(/\/\/.*$/gm, "").replace(/"[^"\n]*"/g, "")), "sin TRUNCATE en el código");
  assert.equal((src.match(/console\.(log|error|warn|info)/g) ?? []).length, 1, "una sola vía de salida (salida())");
  assert.ok(!/salida\([^)]*[Aa]uthorization/.test(src), "no se imprime ningún header Authorization");
  assert.ok(!/\.delete\(\)\s*(;|\)|$)/m.test(src), "ningún delete() queda sin filtros encadenados");
  assert.equal((src.match(/process\.env/g) ?? []).length, 1, "solo se lee process.env una vez (en el punto de entrada)");
});
