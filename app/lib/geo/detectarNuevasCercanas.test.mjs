import test from "node:test";
import assert from "node:assert/strict";
import { detectarNuevasCercanas } from "./detectarNuevasCercanas.ts";

test("baseline (primera resolución): no dispara alarma aunque ya haya cargas cercanas", () => {
  const r = detectarNuevasCercanas(["1", "2"], new Set(), true);
  assert.deepEqual(r.nuevas, []);
  assert.deepEqual([...r.siguienteVistos].sort(), ["1", "2"]);
});

test("E. carga lejana nunca llega a esta función (no está en idsActuales) → no puede disparar alarma", () => {
  // Simula: cargasCercanas ya excluyó la carga lejana antes de llamar acá.
  const r = detectarNuevasCercanas(["1"], new Set(["1"]), false);
  assert.deepEqual(r.nuevas, []); // "1" ya estaba visto, y la lejana ni apareció en idsActuales
});

test("F. carga cercana NUEVA después del baseline → SÍ dispara alarma", () => {
  const vistos = new Set(["1"]); // baseline ya establecido con la carga 1
  const r = detectarNuevasCercanas(["1", "2"], vistos, false); // aparece la carga 2, cercana y nueva
  assert.deepEqual(r.nuevas, ["2"]);
  assert.deepEqual([...r.siguienteVistos].sort(), ["1", "2"]);
});

test("una carga que sale del radio y no está en idsActuales no vuelve a sonar sola por eso", () => {
  const vistos = new Set(["1", "2"]);
  const r = detectarNuevasCercanas(["1"], vistos, false); // "2" salió de rango
  assert.deepEqual(r.nuevas, []);
  assert.deepEqual([...r.siguienteVistos], ["1"]); // ya no se sigue rastreando "2"
});

test("sin GPS (idsActuales=[], cargasCercanas fail-closed) → nunca hay nuevas", () => {
  const r = detectarNuevasCercanas([], new Set(["1"]), false);
  assert.deepEqual(r.nuevas, []);
});
