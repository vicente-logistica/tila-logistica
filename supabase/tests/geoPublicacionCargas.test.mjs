import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Tests estáticos de supabase/migrations/20261001_geo_publicacion_cargas.sql (no se ejecuta
// SQL: se verifica el texto de la migración).
const leer = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
// /\r?\n/: checkout de Windows con CRLF (ver programarPurgaCoordenadas.test.mjs).
const sinComentarios = (s) => s.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
const codigo = sinComentarios(leer("../migrations/20261001_geo_publicacion_cargas.sql"));

const check = (nombre) => {
  const m = codigo.match(new RegExp(`ADD CONSTRAINT ${nombre} CHECK \\(([\\s\\S]*?)\\)\\s*(NOT VALID)?;`));
  assert.ok(m, `existe el CHECK ${nombre}`);
  return { cuerpo: m[1].replace(/\s+/g, " ").trim(), notValid: !!m[2] };
};
const inicioFuncion = codigo.search(/CREATE OR REPLACE FUNCTION public\.purgar_coordenadas_google_vencidas/);
const finFuncion = codigo.indexOf("$$;", inicioFuncion);
const cuerpoFuncion = codigo.slice(inicioFuncion, finFuncion);
const fueraDeFuncion = codigo.slice(0, inicioFuncion) + codigo.slice(finFuncion);

test("paradas_viaje: par completo y rango válido, SIN exigir geo_obtenido_at (filas legacy con lat/lng y sin fecha siguen siendo actualizables)", () => {
  const { cuerpo, notValid } = check("paradas_viaje_coords_validas");
  assert.match(cuerpo, /\(lat IS NULL AND lng IS NULL\)/);
  assert.match(cuerpo, /lat IS NOT NULL AND lng IS NOT NULL/);
  assert.match(cuerpo, /lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180/);
  assert.doesNotMatch(cuerpo, /geo_obtenido_at/, "un CHECK se evalúa en cada UPDATE: exigir la fecha bloquearía las paradas legacy");
  assert.equal(notValid, true, "NOT VALID: no revalida filas históricas al crearse");
});

test("cargas: las coordenadas nuevas (origen_/destino_) siguen exigiendo par, rango y geo_obtenido_at", () => {
  for (const lado of ["origen", "destino"]) {
    const { cuerpo } = check(`cargas_${lado}_coords_validas`);
    assert.match(cuerpo, new RegExp(`\\(${lado}_lat IS NULL AND ${lado}_lng IS NULL\\)`));
    assert.match(cuerpo, new RegExp(`${lado}_lat BETWEEN -90 AND 90 AND ${lado}_lng BETWEEN -180 AND 180`));
    assert.match(cuerpo, /geo_obtenido_at IS NOT NULL/);
  }
});

test("sin backfill: fuera de la función de purga no hay UPDATE/INSERT/DELETE, ni se toca cargas.lat/lng", () => {
  assert.doesNotMatch(fueraDeFuncion, /\b(UPDATE|INSERT|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(fueraDeFuncion, /\b(DROP|ALTER|RENAME)\s+COLUMN\b/i);
  // En cargas sólo se agregan columnas con prefijo origen_/destino_ y geo_obtenido_at.
  const agregadas = [...codigo.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(agregadas, [
    "origen_place_id", "origen_lat", "origen_lng", "destino_place_id", "destino_lat", "destino_lng", "geo_obtenido_at",
    "place_id", "geo_obtenido_at",
  ]);
});

test("la purga sólo toca filas CON geo_obtenido_at vencido (las legacy sin fecha se ignoran) y nunca cargas.lat/lng", () => {
  const updates = [...cuerpoFuncion.matchAll(/UPDATE public\.(\w+)([\s\S]*?);/g)];
  assert.deepEqual(updates.map((u) => u[1]), ["cargas", "paradas_viaje"]);
  for (const [, , resto] of updates) {
    assert.match(resto, /WHERE geo_obtenido_at IS NOT NULL\s+AND geo_obtenido_at <= limite/);
  }
  const setCargas = updates[0][2].split(/\bWHERE\b/)[0];
  assert.doesNotMatch(setCargas, /(^|[^_])\blat\b|(^|[^_])\blng\b/, "no pisa el GPS del chofer (cargas.lat/lng)");
});
