// G. Los smoke que aceptan una carga mandan lat/lng coherentes con el punto A de SU carga.
// Ejecutar: node --test scripts/staging/smoke/gps-aceptar.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGEN_SMOKE, GPS_CHOFER_SMOKE } from "./util.mjs";
import { distanciaHaversineKm, esCoordenadaValida } from "../../../app/lib/geo/haversine.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const fuente = (f) => readFileSync(resolve(AQUI, f), "utf8");
// Coordenadas que Google devuelve para "Rosario, Santa Fe, Argentina" (centro de la ciudad).
const ROSARIO = { lat: -32.9442, lng: -60.6505 };

test("GPS_CHOFER_SMOKE es una coordenada válida y está en Rosario (el origen de la carga del smoke)", () => {
  assert.equal(ORIGEN_SMOKE, "Rosario, Santa Fe");
  assert.ok(esCoordenadaValida(GPS_CHOFER_SMOKE.lat, GPS_CHOFER_SMOKE.lng));
  // Línea recta < 5 km → la distancia vial queda holgadamente por debajo de 35 km; no
  // pasa "por casualidad" cerca del límite.
  const d = distanciaHaversineKm(GPS_CHOFER_SMOKE, ROSARIO);
  assert.ok(d < 5, `esperado < 5 km del centro de Rosario, obtuvo ${d}`);
});

for (const [archivo, llamadasEsperadas] of [["flujos.mjs", 2], ["realtime.mjs", 1]]) {
  test(`${archivo}: publica con origen ORIGEN_SMOKE y TODAS sus llamadas a /api/cargas/aceptar mandan GPS_CHOFER_SMOKE`, () => {
    const src = fuente(archivo);
    assert.match(src, /\/api\/cargas\/publicar", \{ origen: ORIGEN_SMOKE,/);
    const aceptar = src.match(/"\/api\/cargas\/aceptar", \{[^}]*\}/g) ?? [];
    assert.equal(aceptar.length, llamadasEsperadas);
    for (const a of aceptar) assert.match(a, /\.\.\.GPS_CHOFER_SMOKE/);
  });
}
