import test from "node:test";
import assert from "node:assert/strict";
import {
  validarGpsAceptacion, validarRadioAceptacion, asignarChoferAtomico, RECHAZOS,
} from "./aceptarCarga.ts";

const GPS = { lat: -34.4727, lng: -58.5086 }; // San Isidro

/** Mock de fetch para geocode (coords de A) y Directions (legs) — mismo formato que Google. */
function mockGoogle({ coordsA, legs, falla = false }) {
  const original = global.fetch;
  let llamadasDirections = 0;
  global.fetch = async (url) => {
    if (falla) throw new Error("red caída");
    if (String(url).includes("/geocode/")) {
      return { json: async () => (coordsA ? { status: "OK", results: [{ geometry: { location: coordsA } }] } : { status: "ZERO_RESULTS", results: [] }) };
    }
    llamadasDirections++;
    return { json: async () => (legs ? { status: "OK", routes: [{ legs }] } : { status: "OVER_QUERY_LIMIT", routes: [] }) };
  };
  return { restore: () => { global.fetch = original; }, directions: () => llamadasDirections };
}
const leg = (km) => ({ distance: { value: km * 1000, text: `${km} km` }, duration: { value: 1800, text: "30 min" } });
const A_CERCA = { lat: -34.50, lng: -58.70 }; // < 50 km en línea recta: pasa el prefiltro, decide Directions

// ── A / B: GPS obligatorio y válido ──────────────────────────────────────────
test("A. aceptar sin lat/lng → rechazado sin_gps (400)", () => {
  const r = validarGpsAceptacion(undefined, undefined);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "sin_gps");
  assert.equal(r.status, 400);
});

test("B. lat/lng inválidos (string, NaN, Infinity, fuera de rango) → rechazado sin_gps", () => {
  for (const [lat, lng] of [["-34.4", "-58.5"], [NaN, -58], [Infinity, -58], [-91, -58], [91, -58], [-34, -181], [-34, 181], [null, null]]) {
    const r = validarGpsAceptacion(lat, lng);
    assert.equal(r.ok, false, `debería rechazar ${lat},${lng}`);
    assert.equal(r.codigo, "sin_gps");
  }
});

test("GPS válido (incluye bordes ±90/±180) → ok con la coordenada", () => {
  assert.deepEqual(validarGpsAceptacion(-34.4727, -58.5086), { ok: true, gps: { lat: -34.4727, lng: -58.5086 } });
  assert.equal(validarGpsAceptacion(90, 180).ok, true);
});

// ── C / D: radio vial 35 km ──────────────────────────────────────────────────
test("C. distancia vial >35 km (35,1) → rechazado fuera_de_radio (403)", async () => {
  const g = mockGoogle({ coordsA: A_CERCA, legs: [leg(35.1), leg(40)] });
  try {
    const r = await validarRadioAceptacion(GPS, ["A", "B"], "KEY", "acept-C");
    assert.deepEqual(r, RECHAZOS.fuera_de_radio);
    assert.equal(g.directions(), 1, "la decisión la toma Directions, no Haversine");
  } finally { g.restore(); }
});

test("D. distancia vial <=35 km (34,9 y 35,0) → ok, continúa el flujo", async () => {
  for (const [km, clave] of [[34.9, "acept-D1"], [35, "acept-D2"]]) {
    const g = mockGoogle({ coordsA: A_CERCA, legs: [leg(km), leg(40)] });
    try {
      assert.deepEqual(await validarRadioAceptacion(GPS, ["A", "B"], "KEY", clave), { ok: true });
    } finally { g.restore(); }
  }
});

test("Haversine NO es la validación final: A a <35 km en línea recta pero >35 km viales → rechazado", async () => {
  const g = mockGoogle({ coordsA: { lat: -34.47, lng: -58.52 }, legs: [leg(36), leg(10)] }); // ~1 km en línea recta
  try {
    assert.equal((await validarRadioAceptacion(GPS, ["A a 1 km", "B"], "KEY", "acept-hav")).codigo, "fuera_de_radio");
  } finally { g.restore(); }
});

// ── E: Google falla → fail-closed ────────────────────────────────────────────
test("E. Directions falla → rechazado error_distancia (503), nunca acepta", async () => {
  const g = mockGoogle({ coordsA: A_CERCA, legs: null });
  try {
    assert.deepEqual(await validarRadioAceptacion(GPS, ["A", "B"], "KEY", "acept-E1"), RECHAZOS.error_distancia);
  } finally { g.restore(); }
});

test("E. geocoding de A falla → rechazado error_distancia", async () => {
  const g = mockGoogle({ coordsA: null, legs: [leg(10)] });
  try {
    assert.equal((await validarRadioAceptacion(GPS, ["A inexistente", "B"], "KEY", "acept-E2")).codigo, "error_distancia");
  } finally { g.restore(); }
});

test("E. red caída (fetch lanza) → rechazado error_distancia", async () => {
  const g = mockGoogle({ falla: true });
  try {
    assert.equal((await validarRadioAceptacion(GPS, ["A red caida", "B"], "KEY", "acept-E3")).codigo, "error_distancia");
  } finally { g.restore(); }
});

test("E. sin GOOGLE_SERVER_API_KEY → rechazado error_distancia, sin llamar a Google", async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error("no debería llamar a Google sin API key"); };
  try {
    assert.deepEqual(await validarRadioAceptacion(GPS, ["A", "B"], undefined, "acept-E4"), RECHAZOS.error_distancia);
  } finally { global.fetch = original; }
});

// ── F: anti-race ─────────────────────────────────────────────────────────────
/** Supabase falso con UNA fila de cargas: aplica los filtros eq/is del UPDATE de forma
 *  atómica (sin await entre leer y escribir, como la BD real con una sola sentencia). */
function dbFalsa(fila) {
  const filtrosUsados = [];
  const db = {
    from(tabla) {
      assert.equal(tabla, "cargas");
      const filtros = [];
      let valores = null;
      const q = {
        update(v) { valores = v; return q; },
        eq(c, v) { filtros.push(["eq", c, v]); return q; },
        is(c, v) { filtros.push(["is", c, v]); return q; },
        select() { return q; },
        async single() {
          await Promise.resolve(); // ambas requests "en vuelo" a la vez
          filtrosUsados.push(filtros);
          const coincide = filtros.every(([k, c, v]) => (k === "eq" ? String(fila[c]) === String(v) : fila[c] === v));
          if (!coincide) return { data: null, error: { code: "PGRST116" } };
          Object.assign(fila, valores);
          return { data: { id: fila.id }, error: null };
        },
      };
      return q;
    },
  };
  return { db, filtrosUsados };
}

test("F. dos choferes aceptan a la vez → exactamente uno gana, el otro recibe ya_tomado (409)", async () => {
  const fila = { id: 7, estado: "pendiente", chofer_id: null };
  const { db, filtrosUsados } = dbFalsa(fila);
  const [r1, r2] = await Promise.all([asignarChoferAtomico(db, 7, "chofer-1"), asignarChoferAtomico(db, 7, "chofer-2")]);
  const ganadores = [r1, r2].filter(r => r.ok);
  const perdedores = [r1, r2].filter(r => !r.ok);
  assert.equal(ganadores.length, 1);
  assert.deepEqual(perdedores, [RECHAZOS.ya_tomado]);
  assert.equal(fila.estado, "Chofer asignado");
  assert.equal(fila.chofer_id, r1.ok ? "chofer-1" : "chofer-2");
  // El UPDATE conserva el doble filtro estado=pendiente AND chofer_id IS NULL
  for (const f of filtrosUsados) {
    assert.deepEqual(f, [["eq", "id", 7], ["eq", "estado", "pendiente"], ["is", "chofer_id", null]]);
  }
});

test("F. carga que ya tiene chofer → ya_tomado, no se pisa el chofer", async () => {
  const fila = { id: 8, estado: "Chofer asignado", chofer_id: "otro" };
  const { db } = dbFalsa(fila);
  assert.deepEqual(await asignarChoferAtomico(db, 8, "chofer-1"), RECHAZOS.ya_tomado);
  assert.equal(fila.chofer_id, "otro");
});

test("los 4 rechazos son distinguibles por codigo y status", () => {
  const codigos = Object.values(RECHAZOS).map(r => `${r.codigo}:${r.status}`);
  assert.deepEqual(codigos, ["sin_gps:400", "fuera_de_radio:403", "error_distancia:503", "ya_tomado:409"]);
});
