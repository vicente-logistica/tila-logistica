// Ejecutar: TILA_ESQUEMA_JSON=<ruta/RESULTADO-ESQUEMA-PRODUCCION.json> node --test scripts/staging/comparar-esquema-staging.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { comparar } from "./comparar-esquema-staging.mjs";

const RUTA = process.env.TILA_ESQUEMA_JSON;
const hay = RUTA && existsSync(RUTA);
const J = () => JSON.parse(readFileSync(RUTA, "utf8"));
const skip = { skip: !hay };

// «Staging ideal»: producción sin backup_*, con otra versión/fecha y en otro orden de filas (lo que Postgres podría devolver distinto).
const stagingIdeal = () => {
  const j = J();
  const nb = (t) => !/^backup_/.test(t);
  j.tablas = j.tablas.filter((t) => nb(t.nombre)); j.columnas = j.columnas.filter((c) => nb(c.tabla));
  j.constraints = j.constraints.filter((c) => nb(c.tabla)); j.indices = j.indices.filter((i) => nb(i.tabla));
  j.grants_tablas = j.grants_tablas.filter((g) => nb(g.objeto));
  j.policies = j.policies.filter((p) => nb(p.tabla));
  j.policies.forEach((p) => p.roles.reverse());              // el orden del array de roles puede variar (OID de roles)
  j.columnas.forEach((c) => { c.pos += 100; });              // attnum distinto (en prod hay columnas eliminadas)
  j.meta.version = "PostgreSQL 17.9 on x86_64"; j.generado_utc = "2026-12-01T00:00:00Z";
  j.funciones = j.funciones.filter((f) => f.esquema === "public");   // staging puede traer otras funciones gestionadas
  return j;
};

test("staging ideal (sin backup_*, otros attnum/orden de roles/versión) => 0 diferencias", skip, () => {
  const { dif } = comparar(J(), stagingIdeal());
  assert.deepEqual(dif, []);
});

const debeDetectar = (nombre, mut, seccion, tipo) => test(`detecta: ${nombre}`, skip, () => {
  const s = stagingIdeal(); mut(s);
  const { dif } = comparar(J(), s);
  assert.ok(dif.some((d) => d.seccion === seccion && (!tipo || d.tipo === tipo)), `esperaba [${seccion}] ${tipo ?? ""}; obtuve ${JSON.stringify(dif.map((d) => d.seccion + ":" + d.tipo))}`);
});

debeDetectar("falta una tabla", (s) => { s.tablas = s.tablas.filter((t) => t.nombre !== "tarifas_config"); }, "tablas", "FALTA_EN_STAGING");
debeDetectar("una columna con otro tipo", (s) => { s.columnas.find((c) => c.tabla === "cargas" && c.columna === "lat").tipo = "numeric"; }, "columnas", "DISTINTO");
debeDetectar("columnas en otro orden", (s) => { const a = s.columnas.find((c) => c.tabla === "cargas" && c.columna === "origen"), b = s.columnas.find((c) => c.tabla === "cargas" && c.columna === "destino"); [a.pos, b.pos] = [b.pos, a.pos]; }, "orden_columnas", "DISTINTO");
debeDetectar("se endureció anon_select_usuarios", (s) => { s.policies.find((p) => p.nombre === "anon_select_usuarios").using_expr = "false"; }, "policies", "DISTINTO");
debeDetectar("falta una policy de storage", (s) => { s.policies = s.policies.filter((p) => p.nombre !== "Public updates vehiculos"); }, "policies", "FALTA_EN_STAGING");
debeDetectar("sobra una policy", (s) => { s.policies.push({ esquema: "public", tabla: "cargas", nombre: "extra", permisiva: "PERMISSIVE", roles: ["anon"], comando: "SELECT", using_expr: "true", with_check_expr: null }); }, "policies", "SOBRA_EN_STAGING");
debeDetectar("se publicó usuarios en Realtime", (s) => { s.publicaciones_tablas.push({ pubname: "supabase_realtime", schemaname: "public", tablename: "usuarios", attnames: ["id"], rowfilter: null }); }, "realtime", "SOBRA_EN_STAGING");
debeDetectar("se quitó cargas de Realtime", (s) => { s.publicaciones_tablas = s.publicaciones_tablas.filter((p) => p.tablename !== "cargas"); }, "realtime", "FALTA_EN_STAGING");
debeDetectar("bucket privado", (s) => { s.buckets_storage.find((b) => b.id === "vehiculos").public = false; }, "buckets", "DISTINTO");
debeDetectar("se revocó un GRANT a anon", (s) => { s.grants_tablas = s.grants_tablas.filter((g) => !(g.objeto === "usuarios" && g.grantee === "anon" && g.privilegio === "TRUNCATE")); }, "grants", "DISTINTO");
debeDetectar("falta una FK", (s) => { s.constraints = s.constraints.filter((c) => c.nombre !== "paradas_viaje_carga_id_fkey"); }, "constraints", "FALTA_EN_STAGING");
debeDetectar("un índice de más", (s) => { s.indices.push({ tabla: "cargas", nombre: "idx_x", definicion: "CREATE INDEX idx_x ON public.cargas USING btree (estado)" }); }, "indices", "SOBRA_EN_STAGING");
debeDetectar("función modificada", (s) => { s.funciones.find((f) => f.nombre === "set_updated_at").definicion += " -- x"; }, "funciones", "DISTINTO");
debeDetectar("RLS deshabilitado en una tabla", (s) => { s.tablas.find((t) => t.nombre === "cargas").rls_habilitado = false; }, "tablas", "DISTINTO");

test("informa si staging trae tablas backup_*", skip, () => {
  const s = stagingIdeal(); s.tablas.push({ nombre: "backup_x_1", tipo: "r" });
  assert.ok(comparar(J(), s).info.some((i) => /backup_x_1/.test(i) && /NO deberían/.test(i)));
});
