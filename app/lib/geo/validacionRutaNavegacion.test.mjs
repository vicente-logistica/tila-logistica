import test from "node:test";
import assert from "node:assert/strict";
import { debeRechazarRutaDireccional } from "./validacionRutaNavegacion.ts";

test("diferencia 174° con heading confiable y sin reintento → se rechaza", () => {
  assert.equal(debeRechazarRutaDireccional(174, false), true);
});

test("diferencia 0° (log bueno) o justo en el umbral → se instala", () => {
  assert.equal(debeRechazarRutaDireccional(0, false), false);
  assert.equal(debeRechazarRutaDireccional(135, false), false);
});

test("sin heading (diferencia null) → nunca se rechaza", () => {
  assert.equal(debeRechazarRutaDireccional(null, false), false);
});

test("ya reintentada → se instala aunque siga opuesta (un único reintento)", () => {
  assert.equal(debeRechazarRutaDireccional(174, true), false);
});
