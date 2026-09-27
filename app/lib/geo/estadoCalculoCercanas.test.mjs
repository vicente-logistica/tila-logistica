import test from "node:test";
import assert from "node:assert/strict";
import { aplicarRespuestaCercanas, derivarEstadoCercanas } from "./estadoCalculoCercanas.ts";
import { filtrarCercanas } from "./filtrarCercanas.ts";

const cargas = [{ id: 1 }, { id: 2 }, { id: 3 }];

test("A. primera llamada falla (!res.ok / red) → distancias vacías, 0 visibles, estado error_calculo", () => {
  const s = aplicarRespuestaCercanas({ ok: false });
  assert.deepEqual(s.distancias, {});
  assert.equal(s.errorCalculo, true);
  assert.deepEqual(filtrarCercanas(cargas, true, s.distancias), []);
  assert.equal(derivarEstadoCercanas("ok", s.errorCalculo, false, true), "error_calculo");
});

test("B. había distancias válidas y la siguiente llamada falla → se descartan las viejas, 0 visibles", () => {
  const previo = aplicarRespuestaCercanas({
    ok: true,
    resultados: { 1: { estado: "ok", dentroRadioInicial: true }, 2: { estado: "ok", dentroRadioInicial: true } },
  });
  assert.deepEqual(filtrarCercanas(cargas, true, previo.distancias).map(c => c.id), [1, 2]);

  const s = aplicarRespuestaCercanas({ ok: false });
  assert.deepEqual(s.distancias, {});
  assert.equal(s.errorCalculo, true);
  assert.deepEqual(filtrarCercanas(cargas, true, s.distancias), []);
  assert.equal(derivarEstadoCercanas("ok", s.errorCalculo, false, true), "error_calculo");
});

test("C. después de un error, una llamada exitosa recupera sólo las cargas dentro del radio", () => {
  const error = aplicarRespuestaCercanas({ ok: false });
  assert.equal(error.errorCalculo, true);

  const s = aplicarRespuestaCercanas({
    ok: true,
    resultados: {
      1: { estado: "ok", dentroRadioInicial: true },
      2: { estado: "ok", dentroRadioInicial: false },
      3: { estado: "error_directions", dentroRadioInicial: false },
    },
  });
  assert.equal(s.errorCalculo, false);
  assert.deepEqual(filtrarCercanas(cargas, true, s.distancias).map(c => c.id), [1]);
  assert.equal(derivarEstadoCercanas("ok", s.errorCalculo, false, true), "listo");
});

test("respuesta ok pero sin `resultados` (body malformado) → tratada como error, nunca como 'todo vacío OK'", () => {
  const s = aplicarRespuestaCercanas({ ok: true, resultados: undefined });
  assert.equal(s.errorCalculo, true);
  assert.deepEqual(s.distancias, {});
});

test("derivarEstadoCercanas: errores de GPS tienen prioridad sobre error_calculo", () => {
  assert.equal(derivarEstadoCercanas("error", true, false, true), "gps_error");
  assert.equal(derivarEstadoCercanas("buscando", true, false, true), "sin_gps");
});

test("derivarEstadoCercanas: durante un reintento sigue en error_calculo hasta que llegue un éxito", () => {
  assert.equal(derivarEstadoCercanas("ok", true, true, true), "error_calculo");
});
