// Prueba que el verificador estático DETECTA desvíos (mutaciones) y acepta los SQL reales.
// Ejecutar: TILA_ESQUEMA_JSON=<ruta/RESULTADO-ESQUEMA-PRODUCCION.json> node --test scripts/staging/verificar-sql-staging.test.mjs
// (sin la variable, los tests se omiten: el JSON de producción no está en el repo)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { verificar, sentencias } from "./verificar-sql-staging.mjs";
import { generar } from "./generar-esquema.mjs";

const RUTA = process.env.TILA_ESQUEMA_JSON;
const DIR = new URL("../../docs/staging/sql/", import.meta.url);
const hay = RUTA && existsSync(RUTA);
const J = () => JSON.parse(readFileSync(RUTA, "utf8"));
const EVT = () => JSON.parse(readFileSync(new URL("../../docs/staging/RESULTADO-EVENT-TRIGGERS-PRODUCCION.json", import.meta.url), "utf8"));
const leerReal = (f) => readFileSync(new URL(f, DIR), "utf8");
const conCambio = (archivo, fn) => (f) => (f === archivo ? fn(leerReal(f)) : leerReal(f));
const fallan = (checks) => checks.filter((c) => !c.ok).map((c) => c.id.split(":")[0].split(" ").slice(0, 2).join(" "));

test("sentencias(): respeta $$, literales y comentarios", () => {
  const s = sentencias("select 'a;b'; -- x;y\n do $q$ begin perform 1; end $q$; select 2;");
  assert.equal(s.length, 3);
  assert.equal(s[1].limpio, "do $bloque$");
});

test("los SQL reales pasan todas las verificaciones", { skip: !hay }, () => {
  const c = verificar(J(), leerReal, EVT());
  assert.deepEqual(fallan(c), []);
  assert.ok(c.length >= 80);
});

const muta = (nombre, archivo, fn, esperado) => test(`detecta: ${nombre}`, { skip: !hay }, () => {
  assert.notEqual(fn(leerReal(archivo)), leerReal(archivo), "la mutación no modificó el texto (patrón desactualizado)");
  const f = fallan(verificar(J(), conCambio(archivo, fn), EVT()));
  assert.ok(f.some((x) => x.startsWith(esperado)), `esperaba fallo ${esperado}, obtuve: ${f.join(", ") || "(nada)"}`);
});

muta("un default distinto", "01-schema.sql", (s) => s.replace("default false", "default true"), "B2");
muta("una columna con otro tipo", "01-schema.sql", (s) => s.replace("velocidad                   double precision", "velocidad                   numeric"), "B2");
muta("una columna faltante", "01-schema.sql", (s) => s.replace(/\n  navegador_preferido[^\n]*,/, ""), "B2");
muta("crear tabla backup_*", "01-schema.sql", (s) => s.replace("commit;", "create table public.backup_x (id int);\ncommit;"), "A6");
muta("una FK inventada (endurecer)", "02-constraints.sql", (s) => s.replace("commit;", "alter table public.cargas add constraint cargas_cliente_fk FOREIGN KEY (cliente_id) REFERENCES usuarios(id);\ncommit;"), "B4");
muta("un UNIQUE en billetera_chofer.viaje_id (endurecer)", "02-constraints.sql", (s) => s.replace("commit;", "alter table public.billetera_chofer add constraint billetera_viaje_unique UNIQUE (viaje_id);\ncommit;"), "B4");
muta("un índice de más", "03-indexes.sql", (s) => s.replace("commit;", "create index idx_extra on public.cargas using btree (estado);\ncommit;"), "B5");
muta("crear idx_usuarios_vehiculo_activo_id (no existe en producción)", "03-indexes.sql", (s) => s.replace("commit;", "create index idx_usuarios_vehiculo_activo_id on public.usuarios using btree (vehiculo_activo_id);\ncommit;"), "B5");
muta("cerrar anon_select_usuarios (endurecer)", "05-rls-policies.sql", (s) => s.replace(/(create policy "anon_select_usuarios"[^;]*?)to anon/, "$1to authenticated"), "B8");
muta("quitar una policy abierta", "05-rls-policies.sql", (s) => s.replace(/create policy "permitir leer paradas anon y authenticated"[\s\S]*?using \(true\);\n/, ""), "B8");
muta("policy nueva (cargas)", "05-rls-policies.sql", (s) => s.replace("commit;", 'create policy "x" on public.cargas\n  as permissive\n  for select\n  to anon\n  using (true);\ncommit;'), "B8");
muta("deshabilitar RLS", "05-rls-policies.sql", (s) => s.replace("alter table public.cargas enable row level security", "alter table public.cargas disable row level security"), "A3");
muta("revocar TRUNCATE a anon en usuarios", "06-grants.sql", (s) => s.replace("grant all on table public.usuarios to anon;", "grant select, insert, update, delete on table public.usuarios to anon;"), "B10");
muta("publicar usuarios en Realtime", "07-realtime.sql", (s) => s.replace("array['cargas', 'mensajes_viaje']", "array['cargas', 'mensajes_viaje', 'usuarios']"), "B11");
muta("bucket privado", "08-storage.sql", (s) => s.replace("('vehiculos', 'vehiculos', true", "('vehiculos', 'vehiculos', false"), "B12");
muta("quitar policy de upload de storage", "08-storage.sql", (s) => s.replace(/create policy "Public uploads vehiculos"[\s\S]*?\)\);\n/, ""), "B8");
muta("un INSERT de datos", "04-functions-triggers.sql", (s) => s.replace("commit;", "insert into public.usuarios (email) values ('x');\ncommit;"), "A3");
muta("un DELETE", "05-rls-policies.sql", (s) => s.replace("commit;", "delete from public.usuarios;\ncommit;"), "A3");
muta("el ref de producción filtrado en un comentario", "01-schema.sql", (s) => s.replace("begin;", "begin;\n-- proyecto imbtepvdscdtpxkleihi"), "A4");
muta("sin guarda anti-producción", "03-indexes.sql", (s) => s.replace(/to_regclass\('public\.backup_usuarios_20260614'\)/, "to_regclass('public.otra')"), "A2");
muta("sin COMMIT", "07-realtime.sql", (s) => s.replace(/commit;\s*$/, ""), "A1");


// ── Event trigger ensure_rls (04) ────────────────────────────────────────────────────────────────────────────────────
const CREA = "create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') execute function public.rls_auto_enable();";
const RE_DO_EVT = /do \$evt\$[\s\S]*?\$evt\$;/;
muta("event trigger sin el tag SELECT INTO", "04-functions-triggers.sql", (s) => s.replace("when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') execute", "when tag in ('CREATE TABLE', 'CREATE TABLE AS') execute"), "B7c");
muta("event trigger con otro evento (sql_drop)", "04-functions-triggers.sql", (s) => s.replace("create event trigger ensure_rls on ddl_command_end", "create event trigger ensure_rls on sql_drop"), "B7c");
muta("event trigger que ejecuta otra función", "04-functions-triggers.sql", (s) => s.replace("execute function public.rls_auto_enable();\n  elsif", "execute function public.set_updated_at();\n  elsif"), "B7c");
muta("event trigger creado también en otro archivo", "05-rls-policies.sql", (s) => s.replace("commit;", CREA + "\ncommit;"), "B7c");
muta("event trigger SIN guarda (creación directa)", "04-functions-triggers.sql", (s) => s.replace(RE_DO_EVT, CREA), "B7d");
muta("guarda que no aborta si difiere (raise notice)", "04-functions-triggers.sql", (s) => s.replace("raise exception 'ABORTADO (04): ya existe el event trigger", "raise notice 'ABORTADO (04): ya existe el event trigger"), "B7d");
muta("guarda que ya no compara los tags", "04-functions-triggers.sql", (s) => s.replace(/\n\s+and \(select array_agg\(t order by t collate "C"\) from unnest\(e\.evttags\) t\) = array\[[^\]]*\]\)/, ")"), "B7d");
muta("DROP EVENT TRIGGER agregado", "04-functions-triggers.sql", (s) => s.replace("do $evt$", "drop event trigger if exists ensure_rls;\ndo $evt$"), "B7d");
muta("event trigger creado ANTES que la función", "04-functions-triggers.sql", (s) => {
  const m = /do \$evt\$[\s\S]*?\$evt\$;\n/.exec(s);
  return s.replace(m[0], "").replace("-- public.rls_auto_enable()", m[0] + "\n-- public.rls_auto_enable()");
}, "B7e");
muta("se recrea un event trigger gestionado por Supabase", "04-functions-triggers.sql", (s) => s.replace("commit;", "create event trigger issue_pg_net_access on ddl_command_end when tag in ('CREATE EXTENSION') execute function extensions.grant_pg_net_access();\ncommit;"), "B7f");

test("sin los datos de event triggers el verificador lo informa como fallo (no lo omite)", { skip: !hay }, () => {
  assert.ok(fallan(verificar(J(), leerReal, null)).includes("B7c datos"));
});

// ── Reproducibilidad: los 8 SQL en disco son EXACTAMENTE lo que produce el generador ─────────────────────────────────
test("los 8 SQL son reproducibles desde el generador (byte a byte)", { skip: !hay }, () => {
  const { archivos } = generar(J(), EVT());
  assert.deepEqual(Object.keys(archivos).sort(), ["01-schema.sql", "02-constraints.sql", "03-indexes.sql", "04-functions-triggers.sql", "05-rls-policies.sql", "06-grants.sql", "07-realtime.sql", "08-storage.sql"]);
  for (const [n, c] of Object.entries(archivos)) assert.equal(leerReal(n), c, n + " difiere de lo que genera el generador");
});

test("detecta una discrepancia en el JSON de producción (columna cambiada)", { skip: !hay }, () => {
  const j = J(); j.columnas.find((c) => c.tabla === "cargas" && c.columna === "estado").tipo = "integer";
  assert.ok(fallan(verificar(j, leerReal, EVT())).includes("B2 columnas"));
});
