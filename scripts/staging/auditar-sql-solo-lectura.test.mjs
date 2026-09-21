// Prueba que el auditor RECHAZA SQL peligroso y ACEPTA el archivo real. Ejecutar: node --test scripts/staging/auditar-sql-solo-lectura.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditar, desnudar } from "./auditar-sql-solo-lectura.mjs";

const SQL_REAL = new URL("../../docs/staging/LEER-ESQUEMA-PRODUCCION.sql", import.meta.url);
const debeFallar = (nombre, sql, regla) => test(`rechaza: ${nombre}`, () => {
  const r = auditar(sql);
  assert.equal(r.ok, false, `debía fallar y pasó: ${sql}`);
  if (regla) assert.ok(r.errores.some((e) => e.startsWith(regla)), `esperaba ${regla}, obtuve: ${r.errores.join(" | ")}`);
});
const debePasar = (nombre, sql) => test(`acepta: ${nombre}`, () => {
  const r = auditar(sql);
  assert.equal(r.ok, true, r.errores.join(" | "));
});

test("el archivo real cumple R1–R6", () => {
  const r = auditar(readFileSync(SQL_REAL, "utf8"));
  assert.equal(r.ok, true, r.errores.join(" | "));
  assert.ok(r.ctes.length >= 25);
});

// ── Escrituras / DDL / DCL ────────────────────────────────────────────────────────────────────────
debeFallar("DELETE", "delete from usuarios;", "R2");
debeFallar("UPDATE", "update usuarios set rol='admin';", "R2");
debeFallar("INSERT", "insert into usuarios(id) values (1);", "R2");
debeFallar("DROP TABLE", "drop table usuarios;", "R2");
debeFallar("ALTER", "alter table usuarios disable row level security;", "R2");
debeFallar("CREATE", "create table x(a int);", "R2");
debeFallar("GRANT", "grant all on usuarios to anon;", "R2");
debeFallar("TRUNCATE", "truncate usuarios;", "R2");
debeFallar("COPY", "copy usuarios to '/tmp/x';", "R2");
debeFallar("DO $$", "do $$ begin perform 1; end $$;", "R2");
debeFallar("SET", "set role postgres;", "R2");
debeFallar("SELECT INTO (crea tabla)", "select 1 into nueva;", "R2");
debeFallar("CTE que escribe", "with x as (delete from usuarios returning *) select * from x;", "R2");
debeFallar("CTE con UPDATE", "with x as (update usuarios set a=1 returning 1) select * from x;", "R2");
debeFallar("FOR UPDATE", "select 1 from pg_class for update;", "R3");
debeFallar("dos sentencias", "select 1 from pg_class; select 2 from pg_class;", "R1");
debeFallar("sin punto y coma final", "select 1 from pg_class", "R1");
debeFallar("empieza con BEGIN", "begin; select 1; commit;", "R1");
debeFallar("EXPLAIN ANALYZE", "explain analyze select 1;", "R1");

// ── Lectura de datos de negocio / secretos ───────────────────────────────────────────────────────
debeFallar("SELECT * de usuarios", "select * from usuarios;", "R4");
debeFallar("SELECT de public.usuarios", "select * from public.usuarios;", "R4");
debeFallar("cargas", "select id from cargas;", "R4");
debeFallar("storage.objects (lista archivos)", "select name from storage.objects;", "R4");
debeFallar("auth.users", "select email from auth.users;", "R4");
debeFallar("pg_authid (hashes de roles)", "select rolpassword from pg_authid;", "R4");
debeFallar("pg_shadow", "select passwd from pg_shadow;", "R4");
debeFallar("join con tabla de negocio", "select 1 from pg_class c join usuarios u on true;", "R4");
debeFallar("join con coma", "select 1 from pg_class c, usuarios u;", "R6");
debeFallar("subconsulta con tabla de negocio", "select (select count(*) from mensajes_viaje) from pg_class;", "R4");
debeFallar("vault", "select * from vault.secrets;", "R4");

// ── Funciones con efectos ────────────────────────────────────────────────────────────────────────
debeFallar("nextval", "select nextval('x') from pg_class;", "R5");
debeFallar("setval", "select setval('x', 1) from pg_class;", "R5");
debeFallar("set_config", "select set_config('a','b',false) from pg_class;", "R5");
debeFallar("pg_sleep", "select pg_sleep(10) from pg_class;", "R5");
debeFallar("lo_import", "select lo_import('/etc/passwd') from pg_class;", "R5");
debeFallar("pg_read_file", "select pg_read_file('/etc/passwd') from pg_class;", "R5");
debeFallar("función desconocida", "select mi_funcion_rara(1) from pg_class;", "R5");
debeFallar("pg_terminate_backend", "select pg_terminate_backend(1) from pg_class;", "R5");

// ── Trucos de ofuscación: no deben engañar al auditor ────────────────────────────────────────────
debeFallar("DELETE oculto tras comentario de bloque anidado", "select 1 from pg_class; /* x */ delete from usuarios;", "R1");
debeFallar("DROP en mayúsculas", "DROP TABLE usuarios;", "R2");
debeFallar("DELETE con saltos de línea", "with x as (\n  delete\n  from usuarios returning 1\n) select 1 from x;", "R2");

// ── Falsos positivos que NO deben ocurrir ────────────────────────────────────────────────────────
debePasar("comentarios con palabras peligrosas", "-- DROP TABLE x; DELETE FROM y\n/* UPDATE z */\nselect 1 from pg_class;");
debePasar("literal con palabras peligrosas", "select 'delete from usuarios; drop table x' as texto from pg_class;");
debePasar("dollar-quote con palabras peligrosas", "select $$delete from usuarios$$ as t from pg_class;");
debePasar("columnas llamadas *update*/*delete*/*create*", "select pubupdate, pubdelete, rolcreaterole from pg_publication, pg_roles;".replace("pg_publication, pg_roles", "pg_publication"));
debePasar("alias con set/update dentro de otra palabra", "select relname as reloptions_set from pg_class;");

test("desnudar elimina comentarios y literales", () => {
  const s = desnudar("select 'a''b' /* c */ from x -- z\n");
  assert.ok(!s.includes("a'b") && !s.includes("c ") && !s.includes("z"));
});
