import test from "node:test";
import assert from "node:assert/strict";
import { filtrarCercanas } from "./filtrarCercanas.ts";

const cargas = [{ id: 1 }, { id: 2 }, { id: 3 }];

test("A. GPS pendiente (gpsListo=false) → cargas visibles = 0, aunque haya distancias calculadas", () => {
  const distancias = { 1: { estado: "ok", dentroRadioInicial: true } };
  assert.deepEqual(filtrarCercanas(cargas, false, distancias), []);
});

test("B. GPS error (gpsListo=false) → cargas visibles = 0", () => {
  assert.deepEqual(filtrarCercanas(cargas, false, {}), []);
});

test("C. carga vial a 34,9 km (dentroRadioInicial=true, estado ok) → visible", () => {
  const distancias = { 1: { estado: "ok", dentroRadioInicial: true, hastaCargaKm: 34.9 } };
  const r = filtrarCercanas(cargas, true, distancias);
  assert.deepEqual(r.map(c => c.id), [1]);
});

test("D. carga vial a 35,1 km (dentroRadioInicial=false) → NO visible", () => {
  const distancias = { 1: { estado: "ok", dentroRadioInicial: false, hastaCargaKm: 35.1 } };
  assert.deepEqual(filtrarCercanas(cargas, true, distancias), []);
});

test("carga sin resultado todavía en `distancias` (aunque gpsListo=true) → excluida, nunca se asume cercana", () => {
  const distancias = { 2: { estado: "ok", dentroRadioInicial: true } };
  const r = filtrarCercanas(cargas, true, distancias);
  assert.deepEqual(r.map(c => c.id), [2]);
});

test("carga con estado sin_datos_a/error_directions → excluida aunque dentroRadioInicial viniera true por error", () => {
  const distancias = { 1: { estado: "sin_datos_a", dentroRadioInicial: false } };
  assert.deepEqual(filtrarCercanas(cargas, true, distancias), []);
});
