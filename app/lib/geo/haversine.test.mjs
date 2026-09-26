import test from "node:test";
import assert from "node:assert/strict";
import { distanciaHaversineKm } from "./haversine.ts";

test("mismo punto -> distancia 0", () => {
  const p = { lat: -34.6037, lng: -58.3816 };
  assert.equal(distanciaHaversineKm(p, p), 0);
});

test("1 grado de latitud ~ 111.19 km (radio terrestre 6371km, verificable a mano)", () => {
  const a = { lat: 0, lng: 0 };
  const b = { lat: 1, lng: 0 };
  const d = distanciaHaversineKm(a, b);
  assert.ok(Math.abs(d - 111.19) < 0.5, `esperado ~111.19km, obtuvo ${d}`);
});

test("simétrica: distancia(a,b) === distancia(b,a)", () => {
  const a = { lat: -34.6037, lng: -58.3816 };
  const b = { lat: -32.9468, lng: -60.6393 };
  assert.equal(distanciaHaversineKm(a, b), distanciaHaversineKm(b, a));
});

test("San Isidro a Parque Industrial Pilar: línea recta razonable (20-50km)", () => {
  const sanIsidro = { lat: -34.4727, lng: -58.5086 };
  const pilar     = { lat: -34.4360, lng: -58.9110 };
  const d = distanciaHaversineKm(sanIsidro, pilar);
  assert.ok(d > 20 && d < 50, `esperado entre 20 y 50km, obtuvo ${d}`);
});

test("Buenos Aires a Jujuy: claramente fuera de cualquier radio de cercanía (>1000km)", () => {
  const ba    = { lat: -34.6037, lng: -58.3816 };
  const jujuy = { lat: -24.1858, lng: -65.2995 };
  const d = distanciaHaversineKm(ba, jujuy);
  assert.ok(d > 1000, `esperado >1000km, obtuvo ${d}`);
});
