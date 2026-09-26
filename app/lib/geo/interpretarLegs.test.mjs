import test from "node:test";
import assert from "node:assert/strict";
import { interpretarLegs, formatearKm } from "./interpretarLegs.ts";

const RADIO_INICIAL = 35;
const RADIO_MAXIMO  = 50;
const leg = (km, texto, duracion = "20 min") => ({ distanciaMetros: km * 1000, distanciaTexto: texto, duracionTexto: duracion });

test("viaje simple (2 legs): suma GPS→A + A→B, hastaCarga = leg[0], recorrido = leg[1]", () => {
  const legs = [leg(20, "20 km", "25 min"), leg(37, "37 km", "40 min")];
  const r = interpretarLegs(legs, RADIO_INICIAL, RADIO_MAXIMO);
  assert.equal(r.hastaCargaKm, 20);
  assert.equal(r.recorridoCargaKm, 37);
  assert.equal(r.totalKm, 57);
  assert.equal(r.totalTexto, "57,0 km");
  assert.equal(r.duracionHastaCargaTexto, "25 min");
});

test("chofer dentro de 35km → dentroRadioInicial true", () => {
  const r = interpretarLegs([leg(34.9, "34,9 km")], RADIO_INICIAL, RADIO_MAXIMO);
  assert.equal(r.dentroRadioInicial, true);
  assert.equal(r.dentroRadioMaximo, true);
});

test("chofer fuera de 35km pero dentro de 50km → sólo dentroRadioMaximo", () => {
  const r = interpretarLegs([leg(42, "42 km")], RADIO_INICIAL, RADIO_MAXIMO);
  assert.equal(r.dentroRadioInicial, false);
  assert.equal(r.dentroRadioMaximo, true);
});

test("candidato fuera del máximo de 50km → ambos false", () => {
  const r = interpretarLegs([leg(51, "51 km")], RADIO_INICIAL, RADIO_MAXIMO);
  assert.equal(r.dentroRadioInicial, false);
  assert.equal(r.dentroRadioMaximo, false);
});

test("exactamente en el límite (35.0km) → dentro (inclusive)", () => {
  const r = interpretarLegs([leg(35, "35 km")], RADIO_INICIAL, RADIO_MAXIMO);
  assert.equal(r.dentroRadioInicial, true);
});

test("carga extremadamente lejana (500km) → fuera de todo radio, sin romper el cálculo", () => {
  const r = interpretarLegs([leg(500, "500 km"), leg(10, "10 km")], RADIO_INICIAL, RADIO_MAXIMO);
  assert.equal(r.dentroRadioInicial, false);
  assert.equal(r.dentroRadioMaximo, false);
  assert.equal(r.totalKm, 510);
});

test("viaje multietapa (4 legs = A,B,C,D con GPS al frente): total = suma de TODOS los legs", () => {
  // legs[0]=GPS→A, legs[1]=A→B, legs[2]=B→C, legs[3]=C→D
  const legs = [leg(15, "15 km"), leg(10, "10 km"), leg(8, "8 km"), leg(12, "12 km")];
  const r = interpretarLegs(legs, RADIO_INICIAL, RADIO_MAXIMO);
  assert.equal(r.hastaCargaKm, 15);
  assert.equal(r.recorridoCargaKm, 30); // 10+8+12
  assert.equal(r.totalKm, 45); // 15+10+8+12
});

test("sin legs (Directions no devolvió nada útil) → null, nunca un número inventado", () => {
  assert.equal(interpretarLegs([], RADIO_INICIAL, RADIO_MAXIMO), null);
});

test("formatearKm: menos de 1km se muestra en metros, no '0,x km'", () => {
  assert.equal(formatearKm(800), "800 m");
  assert.equal(formatearKm(1500), "1,5 km");
});
