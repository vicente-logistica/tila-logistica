import test from "node:test";
import assert from "node:assert/strict";
import { validarRadioInicial } from "./calculoDistanciaCarga.ts";

const GPS = { lat: -34.4727, lng: -58.5086 }; // San Isidro

/** Mock de fetch: responde geocode con `coordsA` y directions con `legsGoogle`, según la
 *  URL solicitada (misma forma que usa calculoDistanciaCarga.ts). Se restaura siempre en
 *  el `finally` del test para no filtrar el mock entre tests. */
function mockFetch(coordsA, legsGoogle) {
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/geocode/")) {
      return {
        json: async () => coordsA
          ? { status: "OK", results: [{ geometry: { location: coordsA } }] }
          : { status: "ZERO_RESULTS", results: [] },
      };
    }
    if (String(url).includes("/directions/")) {
      return {
        json: async () => legsGoogle
          ? { status: "OK", routes: [{ legs: legsGoogle }] }
          : { status: "ZERO_RESULTS", routes: [] },
      };
    }
    throw new Error(`URL inesperada en el mock: ${url}`);
  };
  return () => { global.fetch = original; };
}

test("I. carga a >35km (real, vía Directions) → ok:false, motivo fuera_de_rango", async () => {
  const restore = mockFetch(
    { lat: -34.44, lng: -58.90 }, // A, coords cualquiera (Haversine < 50km para no cortar antes de Directions)
    [{ distance: { value: 42000, text: "42 km" }, duration: { value: 2400, text: "40 min" } }] // GPS→A = 42km
  );
  try {
    const r = await validarRadioInicial(GPS, ["Parque Industrial Pilar", "Rosario"], "FAKE_KEY", "test-I");
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "fuera_de_rango");
  } finally { restore(); }
});

test("J. carga a <=35km (34,9km real) → ok:true, mantiene flujo normal", async () => {
  const restore = mockFetch(
    { lat: -34.50, lng: -58.70 },
    [{ distance: { value: 34900, text: "34,9 km" }, duration: { value: 1800, text: "30 min" } }]
  );
  try {
    const r = await validarRadioInicial(GPS, ["Escobar", "Pilar"], "FAKE_KEY", "test-J");
    assert.equal(r.ok, true);
    assert.equal(r.hastaCargaKm, 34.9);
  } finally { restore(); }
});

test("exactamente en el límite 35,0km → ok:true (inclusive, misma regla que interpretarLegs)", async () => {
  const restore = mockFetch(
    { lat: -34.50, lng: -58.70 },
    [{ distance: { value: 35000, text: "35 km" }, duration: { value: 1800, text: "30 min" } }]
  );
  try {
    const r = await validarRadioInicial(GPS, ["Escobar", "Pilar"], "FAKE_KEY", "test-limite");
    assert.equal(r.ok, true);
  } finally { restore(); }
});

test("geocoding de A falla (ZERO_RESULTS) → ok:false, motivo sin_datos_a, NUNCA acepta por defecto", async () => {
  const restore = mockFetch(null, null);
  try {
    const r = await validarRadioInicial(GPS, ["Dirección inexistente 12345", "Rosario"], "FAKE_KEY", "test-sindatos");
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "sin_datos_a");
  } finally { restore(); }
});

test("Directions falla (ZERO_RESULTS) tras pasar el prefiltro → ok:false, motivo error_directions, NUNCA acepta por defecto", async () => {
  const restore = mockFetch({ lat: -34.50, lng: -58.70 }, null);
  try {
    const r = await validarRadioInicial(GPS, ["Escobar", "Rosario"], "FAKE_KEY", "test-errordirections");
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "error_directions");
  } finally { restore(); }
});

test("carga a >50km (prefiltro Haversine) → ok:false fuera_de_rango, SIN llamar a Directions", async () => {
  let llamoDirections = false;
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/geocode/")) {
      return { json: async () => ({ status: "OK", results: [{ geometry: { location: { lat: -24.1858, lng: -65.2995 } } }] }) }; // Jujuy
    }
    llamoDirections = true;
    throw new Error("no debería llamar a Directions si el prefiltro ya descartó por >50km");
  };
  try {
    const r = await validarRadioInicial(GPS, ["Jujuy capital", "Salta"], "FAKE_KEY", "test-prefiltro");
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "fuera_de_rango");
    assert.equal(llamoDirections, false);
  } finally { global.fetch = original; }
});

test("sin puntoA (puntosCarga vacío) → ok:false sin_datos_a, sin llamar a fetch", async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error("no debería llamar a fetch sin puntoA"); };
  try {
    const r = await validarRadioInicial(GPS, [], "FAKE_KEY", "test-vacio");
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "sin_datos_a");
  } finally { global.fetch = original; }
});
