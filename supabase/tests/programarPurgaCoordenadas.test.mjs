import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Tests estáticos de supabase/migrations/20261002_programar_purga_coordenadas.sql (no se
// ejecuta SQL: se verifica el texto de la migración).
const leer = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const sql = leer("../migrations/20261002_programar_purga_coordenadas.sql");
const sqlFuncion = leer("../migrations/20261001_geo_publicacion_cargas.sql");

// Sin comentarios "--" (los comentarios mencionan anon/authenticated/PUBLIC a propósito).
// /\r?\n/: en un checkout de Windows (core.autocrlf) el SQL llega con CRLF, y con split("\n")
// cada línea terminaría en "\r" — que `.` no consume — y los comentarios no se quitarían.
const sinComentarios = (s) => s.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
const codigo = sinComentarios(sql);

test("programa un único job con nombre fijo 'purgar-coordenadas-google', una vez por día a las 06:00 UTC", () => {
  const llamadas = [...codigo.matchAll(/cron\.schedule\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\s*\)/g)];
  assert.equal(llamadas.length, 1, "exactamente una llamada a cron.schedule");
  const [, nombre, frecuencia, comando] = llamadas[0];
  assert.equal(nombre, "purgar-coordenadas-google");
  assert.equal(frecuencia, "0 6 * * *");
  assert.equal(comando, "SELECT public.purgar_coordenadas_google_vencidas();");
});

test("el job ejecuta sólo la función de purga (nada más en el comando)", () => {
  const comandos = [...codigo.matchAll(/cron\.schedule\(\s*'[^']+',\s*'[^']+',\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(comandos, ["SELECT public.purgar_coordenadas_google_vencidas();"]);
  // Sólo en la verificación (to_regprocedure), en su mensaje de error y en el comando del job.
  assert.equal((codigo.match(/purgar_coordenadas_google_vencidas/g) ?? []).length, 3);
  assert.doesNotMatch(codigo, /cron\.schedule_in_database|net\.http|http_(get|post)/i);
});

test("idempotente: da de baja el job previo con el mismo nombre antes de crearlo", () => {
  const baja = codigo.search(/FROM cron\.job WHERE jobname = 'purgar-coordenadas-google'/);
  const unschedule = codigo.search(/cron\.unschedule\(/);
  const alta = codigo.search(/cron\.schedule\(/);
  assert.ok(baja >= 0 && unschedule > baja, "busca el job previo por nombre y lo da de baja");
  assert.ok(alta > unschedule, "recién después lo vuelve a programar");
  assert.match(codigo, /CREATE EXTENSION IF NOT EXISTS pg_cron/);
});

test("verifica que la función exista ANTES de habilitar pg_cron y programar el job", () => {
  const verificacion = codigo.search(/to_regprocedure\('public\.purgar_coordenadas_google_vencidas\(\)'\) IS NULL/);
  const abortar = codigo.search(/RAISE EXCEPTION/);
  assert.ok(verificacion >= 0 && abortar > verificacion, "aborta si la función no existe");
  assert.ok(verificacion < codigo.search(/CREATE EXTENSION/), "antes de crear la extensión");
  assert.ok(verificacion < codigo.search(/cron\.schedule\(/), "antes de programar");
});

test("pg_cron se habilita como indica Supabase: esquema pg_catalog", () => {
  assert.match(codigo, /CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;/);
});

test("no otorga permisos nuevos: ningún GRANT, ni a anon, authenticated o PUBLIC", () => {
  assert.doesNotMatch(codigo, /\bGRANT\b/i);
  assert.doesNotMatch(codigo, /\b(anon|authenticated)\b/i);
  assert.doesNotMatch(codigo, /\bTO\s+PUBLIC\b/i);
  assert.doesNotMatch(codigo, /SECURITY\s+DEFINER/i);
  assert.doesNotMatch(codigo, /ALTER\s+DEFAULT\s+PRIVILEGES/i);
});

test("la función programada sigue cerrada a anon/authenticated/PUBLIC (definida en 20261001)", () => {
  const codigoFuncion = sinComentarios(sqlFuncion);
  assert.match(codigoFuncion, /REVOKE ALL ON FUNCTION public\.purgar_coordenadas_google_vencidas\(\) FROM PUBLIC, anon, authenticated;/);
  assert.match(codigoFuncion, /GRANT EXECUTE ON FUNCTION public\.purgar_coordenadas_google_vencidas\(\) TO service_role;/);
  assert.doesNotMatch(codigoFuncion, /GRANT[^;]*purgar_coordenadas_google_vencidas[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
});

test("la migración de programación no modifica tablas, datos ni la función", () => {
  assert.doesNotMatch(codigo, /\b(ALTER TABLE|CREATE TABLE|DROP|UPDATE|DELETE|INSERT|TRUNCATE|CREATE OR REPLACE FUNCTION)\b/i);
});
