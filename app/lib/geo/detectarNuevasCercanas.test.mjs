import test from "node:test";
import assert from "node:assert/strict";
import { detectarNuevasCercanas } from "./detectarNuevasCercanas.ts";

test("cargas cercanas que ya existían al ponerse online (nada notificado todavía) → SÍ suenan", () => {
  const r = detectarNuevasCercanas(["1", "2"], new Set());
  assert.deepEqual(r.nuevas, ["1", "2"]);
  assert.deepEqual([...r.siguienteVistos].sort(), ["1", "2"]);
});

test("polling con las mismas cargas ya notificadas → NO repite", () => {
  const r = detectarNuevasCercanas(["1", "2"], new Set(["1", "2"]));
  assert.deepEqual(r.nuevas, []);
});

test("E. carga lejana nunca llega a esta función (no está en idsActuales) → no puede disparar alarma", () => {
  // Simula: cargasCercanas ya excluyó la carga lejana antes de llamar acá.
  const r = detectarNuevasCercanas(["1"], new Set(["1"]));
  assert.deepEqual(r.nuevas, []);
});

test("F. carga cercana NUEVA → SÍ dispara alarma, sólo por ella", () => {
  const r = detectarNuevasCercanas(["1", "2"], new Set(["1"]));
  assert.deepEqual(r.nuevas, ["2"]);
  assert.deepEqual([...r.siguienteVistos].sort(), ["1", "2"]);
});

test("una carga que sale del radio y no está en idsActuales no vuelve a sonar sola por eso", () => {
  const r = detectarNuevasCercanas(["1"], new Set(["1", "2"])); // "2" salió de rango
  assert.deepEqual(r.nuevas, []);
  assert.deepEqual([...r.siguienteVistos], ["1"]); // ya no se sigue rastreando "2"
});

test("sin GPS (idsActuales=[], cargasCercanas fail-closed) → nunca hay nuevas", () => {
  const r = detectarNuevasCercanas([], new Set(["1"]));
  assert.deepEqual(r.nuevas, []);
});
