import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  leerRadioMatching, guardarRadioMatching, textoARadioKm, esRadioMatchingValido, RADIO_MATCHING_KM_DEFECTO,
} from "./configuracionRadio.ts";
import { procesarGetRadio, procesarPutRadio } from "./adminRadio.ts";
import { validarRadioInicial, pasaPrefiltroRadio } from "./geo/calculoDistanciaCarga.ts";
import { validarRadioAceptacion, RECHAZOS, mensajeFueraDeRadio } from "./aceptarCarga.ts";
import { distanciaHaversineKm } from "./geo/haversine.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = resolve(AQUI, "..");
const RAIZ_REPO = resolve(RAIZ_APP, "..");
const silenciar = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

// ═══════════════ Base falsa de configuracion_plataforma + usuarios ═══════════════

function baseFalsa({ fila = { radio_matching_km: 35 }, errorLectura = null, errorEscritura = null, usuarios = {} } = {}) {
  const estado = { fila: fila ? { id: 1, ...fila } : null, upserts: [] };
  const db = {
    from(tabla) {
      if (tabla === "usuarios") {
        let id;
        const q = { select: () => q, eq: (_c, v) => { id = v; return q; }, maybeSingle: async () => ({ data: usuarios[id] ?? null, error: null }) };
        return q;
      }
      assert.equal(tabla, "configuracion_plataforma");
      let escritura = null;
      const q = {
        select: () => q,
        eq: (c, v) => { assert.deepEqual([c, v], ["id", 1]); return q; },
        upsert: (valores, opts) => { assert.deepEqual(opts, { onConflict: "id" }); escritura = valores; return q; },
        maybeSingle: async () => (errorLectura ? { data: null, error: errorLectura } : { data: estado.fila, error: null }),
        single: async () => {
          if (errorEscritura) return { data: null, error: errorEscritura };
          estado.upserts.push(escritura);
          estado.fila = { ...(estado.fila ?? {}), ...escritura };
          return { data: estado.fila, error: null };
        },
      };
      return q;
    },
  };
  return { db, estado };
}
const USUARIOS = { "a-1": { id: "a-1", rol: "admin", eliminado: false }, "c-1": { id: "c-1", rol: "cliente" }, "h-1": { id: "h-1", rol: "chofer" } };

// ═══════════════ Lectura con fallback ═══════════════

test("radio: fallback = 35 (columna/tabla inexistente, sin fila, excepción)", async () => {
  assert.equal(RADIO_MATCHING_KM_DEFECTO, 35);
  for (const opts of [
    { errorLectura: { code: "42703", message: "column configuracion_plataforma.radio_matching_km does not exist" } },
    { errorLectura: { code: "PGRST205", message: "Could not find the table 'public.configuracion_plataforma'" } },
    { fila: null },
  ]) {
    const r = await silenciar(() => leerRadioMatching(baseFalsa(opts).db));
    assert.deepEqual([r.radioKm, r.fuente], [35, "fallback"]);
    assert.ok(r.motivo);
  }
  const explota = { from: () => { throw new Error("red caída"); } };
  assert.equal((await silenciar(() => leerRadioMatching(explota))).radioKm, 35);
});

for (const km of [35, 65, 100, 1000]) {
  test(`radio: DB ${km} → usa ${km}`, async () => {
    assert.deepEqual(await leerRadioMatching(baseFalsa({ fila: { radio_matching_km: km } }).db), { radioKm: km, fuente: "db" });
  });
}

test("radio: valor inválido en la base → fallback 35", async () => {
  for (const malo of [0, -5, 7.5, "65", null, NaN]) {
    const r = await silenciar(() => leerRadioMatching(baseFalsa({ fila: { radio_matching_km: malo } }).db));
    assert.deepEqual([r.radioKm, r.fuente], [35, "fallback"], String(malo));
  }
});

test("radio: validación y texto del panel — entero ≥ 1, sin tope comercial", () => {
  for (const ok of [1, 20, 35, 50, 65, 100, 1000, 50000]) assert.equal(esRadioMatchingValido(ok), true, String(ok));
  for (const malo of [0, -1, 7.5, NaN, Infinity, "35", null]) assert.equal(esRadioMatchingValido(malo), false, String(malo));
  for (const [t, km] of [["35", 35], ["65", 65], [" 100 ", 100], ["1000", 1000], ["100 km", 100]]) assert.equal(textoARadioKm(t), km, t);
  for (const malo of ["", "0", "-5", "7,5", "7.5", "abc", "1e3", "35 millas"]) assert.equal(textoARadioKm(malo), null, malo);
});

// ═══════════════ Admin GET / PUT ═══════════════

test("admin radio GET: devuelve el radio vigente (y el fallback marcado)", async () => {
  const r = await procesarGetRadio(baseFalsa({ fila: { radio_matching_km: 65 }, usuarios: USUARIOS }).db, "a-1");
  assert.deepEqual([r.status, r.body.radio_matching_km, r.body.fuente], [200, 65, "db"]);
  const f = await silenciar(() => procesarGetRadio(baseFalsa({ errorLectura: { code: "42703", message: "x" }, usuarios: USUARIOS }).db, "a-1"));
  assert.deepEqual([f.status, f.body.radio_matching_km, f.body.fuente], [200, 35, "fallback"]);
});

test("admin radio PUT: guarda enteros ≥ 1 (65, 100, 1000) con updated_by", async () => {
  for (const km of [1, 65, 100, 1000]) {
    const { db, estado } = baseFalsa({ usuarios: USUARIOS });
    const r = await procesarPutRadio(db, "a-1", { radio_matching_km: km });
    assert.deepEqual([r.status, r.body.radio_matching_km], [200, km]);
    assert.deepEqual([estado.upserts[0].id, estado.upserts[0].radio_matching_km, estado.upserts[0].updated_by], [1, km, "a-1"]);
  }
});

test("admin radio PUT: rechaza 0, negativos, decimales y texto — sin escribir nada", async () => {
  const { db, estado } = baseFalsa({ usuarios: USUARIOS });
  for (const malo of [0, -10, 7.5, 65.2, "65", "abc", null, undefined]) {
    assert.equal((await procesarPutRadio(db, "a-1", { radio_matching_km: malo })).status, 400, String(malo));
  }
  assert.equal(estado.upserts.length, 0);
});

test("admin radio GET/PUT: sin identidad → 401; no admin → 403", async () => {
  const { db, estado } = baseFalsa({ usuarios: USUARIOS });
  assert.equal((await procesarGetRadio(db, null)).status, 401);
  for (const id of ["c-1", "h-1"]) {
    assert.equal((await procesarGetRadio(db, id)).status, 403);
    assert.equal((await procesarPutRadio(db, id, { radio_matching_km: 100 })).status, 403);
  }
  assert.equal(estado.upserts.length, 0);
});

test("admin radio: la ruta usa la MISMA autenticación estricta que comisiones", () => {
  const src = readFileSync(join(RAIZ_APP, "api/admin/configuracion/radio/route.ts"), "utf8");
  assert.match(src, /identidadAdminComisiones\(req\)/);
  assert.match(src, /rechazoSinSesion\(auth\.motivo\)/);
  assert.doesNotMatch(src, /resolverUsuario\(|x-user-id"\)/);
});

// ═══════════════ Matching y aceptación con el radio configurado ═══════════════

const GPS = { lat: -34.4727, lng: -58.5086 }; // San Isidro
/** Punto a `km` en línea recta al norte del GPS. */
const alNorte = (km) => ({ lat: GPS.lat + km / 111.19, lng: GPS.lng });

function mockGoogle(coordsA, kmRuta) {
  const original = global.fetch;
  let directions = 0;
  global.fetch = async (url) => {
    if (String(url).includes("/geocode/")) return { json: async () => ({ status: "OK", results: [{ geometry: { location: coordsA } }] }) };
    directions++;
    return { json: async () => ({ status: "OK", routes: [{ legs: [
      { distance: { value: kmRuta * 1000, text: `${kmRuta} km` }, duration: { value: 3600, text: "1 h" } },
      { distance: { value: 10000, text: "10 km" }, duration: { value: 600, text: "10 min" } },
    ] }] }) };
  };
  return { restore: () => { global.fetch = original; }, directions: () => directions };
}
let n = 0;
const validar = async (kmRecta, kmRuta, radio) => {
  n++;
  const g = mockGoogle(alNorte(kmRecta), kmRuta);
  try { return { r: await validarRadioInicial(GPS, [`Retiro test ${n}`, "Destino"], "KEY", `radio-test-${n}`, radio), directions: g.directions() }; }
  finally { g.restore(); }
};

test("prefiltro: usa el radio configurado (y nunca descarta lo que la ruta aceptaría)", () => {
  const a60 = alNorte(60);
  assert.ok(Math.abs(distanciaHaversineKm(GPS, a60) - 60) < 0.5);
  assert.equal(pasaPrefiltroRadio(GPS, a60, 35), false);
  assert.equal(pasaPrefiltroRadio(GPS, a60, 50), false);
  assert.equal(pasaPrefiltroRadio(GPS, a60, 65), true);
  assert.equal(pasaPrefiltroRadio(GPS, alNorte(900), 1000), true);
});

test("65 km ya no queda bloqueado por el antiguo máximo 50: recta 60 / ruta 64 → dentro con radio 65", async () => {
  const conRadio65 = await validar(60, 64, 65);
  assert.equal(conRadio65.r.ok, true);
  assert.equal(conRadio65.directions, 1, "la ruta real decide");
  const conRadio35 = await validar(60, 64, 35);
  assert.deepEqual([conRadio35.r.ok, conRadio35.r.motivo, conRadio35.directions], [false, "fuera_de_rango", 0], "35: se descarta en el prefiltro");
});

test("la distancia por RUTA decide: recta 60 pero ruta 70 → fuera con radio 65", async () => {
  const { r, directions } = await validar(60, 70, 65);
  assert.deepEqual([r.ok, r.motivo, directions], [false, "fuera_de_rango", 1]);
});

test("radio 100 → ruta 99 dentro, ruta 101 fuera", async () => {
  assert.equal((await validar(90, 99, 100)).r.ok, true);
  assert.equal((await validar(90, 101, 100)).r.ok, false);
});

test("radio 1000 → ruta 990 dentro (recta 900), ruta 1001 fuera", async () => {
  assert.equal((await validar(900, 990, 1000)).r.ok, true);
  assert.equal((await validar(900, 1001, 1000)).r.ok, false);
});

test("sin radio explícito sigue siendo 35 (mismo comportamiento que antes)", async () => {
  n++;
  const g = mockGoogle(alNorte(20), 34.9);
  try { assert.equal((await validarRadioInicial(GPS, [`Retiro test ${n}`, "D"], "KEY", `radio-test-${n}`)).ok, true); } finally { g.restore(); }
  n++;
  const g2 = mockGoogle(alNorte(20), 35.1);
  try { assert.equal((await validarRadioInicial(GPS, [`Retiro test ${n}`, "D"], "KEY", `radio-test-${n}`)).ok, false); } finally { g2.restore(); }
});

test("aceptar usa el MISMO radio y el mensaje muestra el radio real", async () => {
  n++;
  const g = mockGoogle(alNorte(60), 64);
  try {
    assert.deepEqual(await validarRadioAceptacion(GPS, [`Retiro test ${n}`, "D"], "KEY", `radio-test-${n}`, 65), { ok: true });
  } finally { g.restore(); }
  n++;
  const g2 = mockGoogle(alNorte(60), 70);
  try {
    const r = await validarRadioAceptacion(GPS, [`Retiro test ${n}`, "D"], "KEY", `radio-test-${n}`, 65);
    assert.deepEqual([r.ok, r.status, r.codigo], [false, 403, "fuera_de_radio"]);
    assert.equal(r.error, mensajeFueraDeRadio(65));
    assert.match(r.error, /\(65 km hasta el punto de retiro\)/);
  } finally { g2.restore(); }
  assert.equal(RECHAZOS.fuera_de_radio.error, mensajeFueraDeRadio(35), "el rechazo por defecto sigue diciendo 35 km");
});

test("rutas: distancias-cercanas y aceptar leen el MISMO radio vigente; no queda tope activo de 50", () => {
  const cercanas = readFileSync(join(RAIZ_APP, "api/chofer/distancias-cercanas/route.ts"), "utf8");
  assert.match(cercanas, /const \{ radioKm \} = await leerRadioMatching\(supabaseAdmin\);/);
  assert.match(cercanas, /pasaPrefiltroRadio\(gpsChofer, coordsA, radioKm\)/);
  assert.match(cercanas, /interpretarLegs\(legs, radioKm, radioKm\)/);
  assert.doesNotMatch(cercanas, /RADIO_MAXIMO_KM|RADIO_INICIAL_KM|distanciaHaversineKm/);

  const aceptar = readFileSync(join(RAIZ_APP, "api/cargas/aceptar/route.ts"), "utf8");
  assert.match(aceptar, /const \{ radioKm \} = await leerRadioMatching\(supabaseAdmin\);/);
  assert.match(aceptar, /validarRadioAceptacion\([\s\S]*?radioKm,\s*\)/);

  const calculo = readFileSync(join(RAIZ_APP, "lib/geo/calculoDistanciaCarga.ts"), "utf8");
  assert.doesNotMatch(calculo, /RADIO_MAXIMO_KM/);
  assert.match(calculo, /interpretarLegs\(legs, radioKm, radioKm\)/);
});

function archivosTs(dir) {
  return readdirSync(dir).flatMap((x) => {
    const p = join(dir, x);
    if (statSync(p).isDirectory()) return archivosTs(p);
    return /\.(ts|tsx)$/.test(x) && !/\.test\./.test(x) ? [p] : [];
  });
}

test("el radio sólo se usa para ofrecer y aceptar — ningún viaje ya aceptado se recalcula", () => {
  const usan = archivosTs(RAIZ_APP)
    .filter((f) => /leerRadioMatching\(/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(RAIZ_APP.length + 1).replace(/\\/g, "/")).sort();
  // configuracionOperativa.ts lo lee para el panel admin y como ancho del corredor de
  // "Vuelta a Casa" (sólo lectura: nunca asigna ni recalcula viajes).
  assert.deepEqual(usan, ["api/cargas/aceptar/route.ts", "api/chofer/distancias-cercanas/route.ts", "lib/adminRadio.ts", "lib/configuracionOperativa.ts", "lib/configuracionRadio.ts"]);
  assert.doesNotMatch(readFileSync(join(RAIZ_APP, "lib/configuracionOperativa.ts"), "utf8"), /from\("cargas"\)/, "no toca cargas");
  // distancias-cercanas sólo lee cargas pendientes sin chofer; aceptar asigna con el UPDATE
  // atómico (estado=pendiente AND chofer_id IS NULL) — un viaje ya aceptado nunca entra.
  const cercanas = readFileSync(join(RAIZ_APP, "api/chofer/distancias-cercanas/route.ts"), "utf8");
  assert.match(cercanas, /\.eq\("estado", "pendiente"\)\s*\.is\("chofer_id", null\)/);
});

test("frontend del chofer sin números nuevos: sigue usando dentroRadioInicial del servidor", () => {
  const filtrar = readFileSync(join(RAIZ_APP, "lib/geo/filtrarCercanas.ts"), "utf8");
  assert.match(filtrar, /d\?\.estado === "ok" && d\.dentroRadioInicial === true/);
  for (const f of ["panel-chofer/page.tsx", "hooks/useCargasCercanas.ts", "lib/geo/filtrarCercanas.ts"]) {
    assert.doesNotMatch(readFileSync(join(RAIZ_APP, f), "utf8"), /radio_matching_km|leerRadioMatching|RADIO_INICIAL_KM/, f);
  }
});

test("comisiones intactas: su lectura y su ruta no dependen del radio", () => {
  const cfg = readFileSync(join(RAIZ_APP, "lib/configuracionComisiones.ts"), "utf8");
  assert.match(cfg, /\.select\("comision_cliente_bp, comision_chofer_bp"\)/);
  assert.doesNotMatch(cfg, /radio/i);
  assert.doesNotMatch(readFileSync(join(RAIZ_APP, "api/admin/configuracion/comisiones/route.ts"), "utf8"), /radio/i);
});

// ═══════════════ Migración ═══════════════

test("migración: agrega radio_matching_km integer NOT NULL DEFAULT 35 con CHECK >= 1, nada más", () => {
  const sql = readFileSync(join(RAIZ_REPO, "supabase/migrations/20260929_radio_matching_configurable.sql"), "utf8");
  const s = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(s, /ADD COLUMN IF NOT EXISTS radio_matching_km integer NOT NULL DEFAULT 35;/);
  assert.match(s, /CHECK \(radio_matching_km >= 1\)/);
  assert.doesNotMatch(s, /comision|GRANT|POLICY|cargas/i);
});
