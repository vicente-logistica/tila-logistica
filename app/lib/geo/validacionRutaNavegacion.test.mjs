import test from "node:test";
import assert from "node:assert/strict";
import { debeRechazarRutaDireccional } from "./validacionRutaNavegacion.ts";

// Caso del log malo: heading 235°, desplazamiento real 238°, primer tramo ~55° →
// opuesto a ambos, en movimiento, fix reciente.
const base = {
  bearingRuta: 55,
  headingAlPedir: 235,
  bearingDesplazamiento: 238,
  velocidadMps: 8,
  velocidadMinMps: 2.5,
  edadUltimoFixMs: 900,
  yaReintentada: false,
};

test("control: heading 235°, desplazamiento 238°, ruta ~55° (ambas >135°) → se rechaza", () => {
  assert.equal(debeRechazarRutaDireccional(base), true);
});

test("control: el mismo caso en el reintento → se instala (rechaza una sola vez)", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, yaReintentada: true }), false);
});

test("heading viejo 0°, desplazamiento 80°, ruta 160° (160° vs heading, 80° vs desplazamiento) → NO se rechaza", () => {
  assert.equal(debeRechazarRutaDireccional({
    ...base, headingAlPedir: 0, bearingDesplazamiento: 80, bearingRuta: 160,
  }), false);
});

test("ruta opuesta al desplazamiento pero no al heading → NO se rechaza", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, headingAlPedir: 120 }), false);
});

test("ruta alineada (log bueno: heading 238°, ruta 238°) → se instala", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, headingAlPedir: 238, bearingRuta: 238 }), false);
});

test("justo en el umbral (135° exactos) → se instala", () => {
  assert.equal(debeRechazarRutaDireccional({
    ...base, bearingRuta: 100, headingAlPedir: 235, bearingDesplazamiento: 235,
  }), false);
});

test("sin heading (pedido sin heading / reintento) → se instala", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, headingAlPedir: null }), false);
});

test("sin desplazamiento medible → se instala", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, bearingDesplazamiento: null }), false);
});

test("sin rumbo de ruta → se instala", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, bearingRuta: null }), false);
});

test("detenido o a paso de hombre (< velocidad mínima) → se instala", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, velocidadMps: 0 }), false);
  assert.equal(debeRechazarRutaDireccional({ ...base, velocidadMps: 2.4 }), false);
  assert.equal(debeRechazarRutaDireccional({ ...base, velocidadMps: null }), false);
});

test("justo en la velocidad mínima → sigue pudiendo rechazar", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, velocidadMps: 2.5 }), true);
});

test("último fix viejo (> 3000 ms) o desconocido → se instala", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, edadUltimoFixMs: 3001 }), false);
  assert.equal(debeRechazarRutaDireccional({ ...base, edadUltimoFixMs: null }), false);
  assert.equal(debeRechazarRutaDireccional({ ...base, edadUltimoFixMs: 3000 }), true);
});

test("cruce de 0°/360°: heading 355°, desplazamiento 5°, ruta 180° → se rechaza", () => {
  assert.equal(debeRechazarRutaDireccional({
    ...base, headingAlPedir: 355, bearingDesplazamiento: 5, bearingRuta: 180,
  }), true);
});

test("NaN en cualquier dato → se instala", () => {
  assert.equal(debeRechazarRutaDireccional({ ...base, headingAlPedir: NaN }), false);
  assert.equal(debeRechazarRutaDireccional({ ...base, bearingDesplazamiento: NaN }), false);
  assert.equal(debeRechazarRutaDireccional({ ...base, velocidadMps: NaN }), false);
});
