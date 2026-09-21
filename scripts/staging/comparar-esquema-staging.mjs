// Compara el esquema REAL de producción con el esquema de un proyecto STAGING ya creado. No se conecta a ninguna base.
// Flujo: correr docs/staging/LEER-ESQUEMA-PRODUCCION.sql (100 % solo lectura) en el SQL Editor de STAGING, guardar la celda esquema_json
// como docs/staging/RESULTADO-ESQUEMA-STAGING.json y luego:
//   node scripts/staging/comparar-esquema-staging.mjs --prod <RESULTADO-ESQUEMA-PRODUCCION.json> --staging <RESULTADO-ESQUEMA-STAGING.json>
// Sale con 0 si NO hay diferencias en el alcance replicado; 1 si las hay. Las diferencias «esperadas» (gestionadas por Supabase, backup_*)
// se listan aparte como INFORMATIVAS y no hacen fallar.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const scope = (t) => !/^backup_/.test(t);
const norm = (s) => (s === null || s === undefined ? "∅" : String(s).replace(/\s+/g, " ").trim());
const ROLES_APP = new Set(["anon", "authenticated", "service_role", "PUBLIC"]);

/** Reduce un JSON de esquema a mapas comparables (clave → valor normalizado) SOLO del alcance que replican los SQL 01..08. */
export function normalizar(j) {
  const m = {};
  const tablas = j.tablas.filter((t) => scope(t.nombre) && "rpf".includes(t.tipo));
  const nombresT = new Set(tablas.map((t) => t.nombre));
  m.tablas = Object.fromEntries(tablas.map((t) => [t.nombre, `${t.tipo}|rls=${t.rls_habilitado}|force=${t.rls_forzado}|ri=${t.replica_identity}|dueno=${t.dueno}|persist=${t.persistencia}`]));
  m.columnas = Object.fromEntries(j.columnas.filter((c) => nombresT.has(c.tabla)).map((c) => [`${c.tabla}.${c.columna}`, `${c.tipo}|nn=${c.not_null}|def=${norm(c.default_expr)}|id=${c.identidad ?? "∅"}|gen=${c.generado ?? "∅"}`]));
  // el ORDEN de columnas también cuenta (mismo orden relativo)
  m.orden_columnas = Object.fromEntries(tablas.map((t) => [t.nombre, j.columnas.filter((c) => c.tabla === t.nombre).sort((a, b) => a.pos - b.pos).map((c) => c.columna).join(",")]));
  m.constraints = Object.fromEntries(j.constraints.filter((c) => nombresT.has(c.tabla)).map((c) => [`${c.tabla}.${c.nombre}`, `${c.tipo}|${norm(c.definicion)}|val=${c.validada}|def=${c.diferible}`]));
  m.indices = Object.fromEntries(j.indices.filter((i) => nombresT.has(i.tabla)).map((i) => [`${i.tabla}.${i.nombre}`, norm(i.definicion)]));
  m.secuencias = Object.fromEntries(j.secuencias.filter((s) => nombresT.has(s.columna_duena.split(".")[0])).map((s) => [s.nombre, [s.tipo, s.inicio, s.minimo, s.incremento, s.cache_tam, s.cicla, s.columna_duena].join("|")]));
  m.triggers = Object.fromEntries(j.triggers.filter((t) => t.esquema === "public").map((t) => [`${t.tabla}.${t.nombre}`, `${norm(t.definicion)}|hab=${t.habilitado}`]));
  m.funciones = Object.fromEntries(j.funciones.filter((f) => f.esquema === "public").map((f) => [`${f.nombre}(${f.argumentos})`, `${norm(f.definicion)}|secdef=${f.security_definer}|cfg=${JSON.stringify(f.config)}|dueno=${f.dueno}`]));
  m.policies = Object.fromEntries(j.policies.filter((p) => (p.esquema === "public" && nombresT.has(p.tabla)) || (p.esquema === "storage" && p.tabla === "objects" && /^Public /.test(p.nombre)))
    .map((p) => [`${p.esquema}.${p.tabla}.${p.nombre}`, `${p.permisiva}|${p.comando}|${[...p.roles].sort().join(",")}|using=${norm(p.using_expr)}|check=${norm(p.with_check_expr)}`]));
  const g = {};
  for (const x of j.grants_tablas) {
    const esSeq = x.tipo === "S"; const dueno = esSeq ? j.secuencias.find((s) => s.nombre === x.objeto)?.columna_duena.split(".")[0] : x.objeto;
    if (!nombresT.has(dueno) || !ROLES_APP.has(x.grantee)) continue;
    (g[`${esSeq ? "seq" : "tabla"}:${x.objeto}:${x.grantee}`] ??= []).push(x.privilegio + (x.con_grant_option ? "*" : ""));
  }
  for (const x of j.grants_funciones) if (ROLES_APP.has(x.grantee) && j.funciones.some((f) => f.esquema === "public" && f.nombre === x.funcion)) (g[`fn:${x.funcion}:${x.grantee}`] ??= []).push(x.privilegio);
  m.grants = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.sort().join(",")]));
  m.grants_columnas = Object.fromEntries(j.grants_columnas.filter((x) => nombresT.has(x.tabla)).map((x) => [`${x.tabla}.${x.columna}:${x.grantee}:${x.privilegio}`, "1"]));
  m.realtime = Object.fromEntries(j.publicaciones_tablas.filter((p) => p.pubname === "supabase_realtime" && p.schemaname === "public").map((p) => [p.tablename, `cols=${p.attnames.length}|filtro=${norm(p.rowfilter)}`]));
  m.buckets = Object.fromEntries(j.buckets_storage.map((b) => [b.id, `public=${b.public}|limit=${b.file_size_limit ?? "∅"}|mime=${JSON.stringify(b.allowed_mime_types)}`]));
  m.rls_storage_objects = Object.fromEntries(j.rls_storage_realtime.filter((r) => r.esquema === "storage" && r.tabla === "objects").map((r) => [r.tabla, `rls=${r.rls_habilitado}`]));
  return m;
}

export function comparar(prod, stg) {
  const a = normalizar(prod), b = normalizar(stg);
  const dif = [];
  for (const seccion of Object.keys(a)) {
    const ka = new Set(Object.keys(a[seccion])), kb = new Set(Object.keys(b[seccion]));
    for (const k of [...ka].sort()) { if (!kb.has(k)) dif.push({ seccion, clave: k, tipo: "FALTA_EN_STAGING", prod: a[seccion][k] }); else if (a[seccion][k] !== b[seccion][k]) dif.push({ seccion, clave: k, tipo: "DISTINTO", prod: a[seccion][k], staging: b[seccion][k] }); }
    for (const k of [...kb].sort()) if (!ka.has(k)) dif.push({ seccion, clave: k, tipo: "SOBRA_EN_STAGING", staging: b[seccion][k] });
  }
  // Informativo (no falla): componentes gestionados por Supabase / decisiones documentadas
  const info = [];
  const bk = stg.tablas.filter((t) => !scope(t.nombre)).map((t) => t.nombre);
  info.push(`tablas backup_* en staging: ${bk.length ? bk.join(", ") + "  ← NO deberían existir (contendrían datos reales)" : "ninguna (correcto)"}`);
  info.push(`PostgreSQL: producción «${prod.meta.version.split(",")[0]}» vs staging «${stg.meta.version.split(",")[0]}»`);
  const ext = (j) => (j.extensiones ?? []).map((e) => `${e.nombre}@${e.version}`).sort().join(", ");
  info.push(`extensiones: prod [${ext(prod)}] · staging [${ext(stg)}]`);
  const fp = (j) => j.funciones.filter((f) => f.esquema !== "public").map((f) => `${f.esquema}.${f.nombre}`).sort().join(", ");
  info.push(`funciones gestionadas (storage/realtime) prod [${fp(prod)}] · staging [${fp(stg)}]`);
  return { dif, info };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("comparar-esquema-staging.mjs")) {
  const rp = arg("--prod"), rs = arg("--staging");
  if (!rp || !rs) { console.error("Uso: node scripts/staging/comparar-esquema-staging.mjs --prod <prod.json> --staging <staging.json>"); process.exit(2); }
  const prod = JSON.parse(readFileSync(rp, "utf8")), stg = JSON.parse(readFileSync(rs, "utf8"));
  if (JSON.stringify(prod.meta) === JSON.stringify(stg.meta) && prod.generado_utc === stg.generado_utc) { console.error("Los dos archivos parecen ser el MISMO resultado. Debe compararse producción contra staging."); process.exit(2); }
  const { dif, info } = comparar(prod, stg);
  const n = normalizar(prod);
  console.log(`Alcance comparado (producción sin backup_*): ${Object.keys(n.tablas).length} tablas · ${Object.keys(n.columnas).length} columnas · ${Object.keys(n.constraints).length} constraints · ${Object.keys(n.indices).length} índices · ${Object.keys(n.policies).length} policies · ${Object.keys(n.grants).length} grants (objeto×rol) · ${Object.keys(n.realtime).length} tablas Realtime · ${Object.keys(n.buckets).length} buckets`);
  for (const d of dif) console.log(`✗ [${d.seccion}] ${d.tipo} ${d.clave}${d.prod ? "\n     prod:    " + d.prod : ""}${d.staging ? "\n     staging: " + d.staging : ""}`);
  console.log("\nInformativo:"); for (const i of info) console.log("  · " + i);
  console.log(dif.length ? `\n${dif.length} DIFERENCIA(S) en el alcance replicado.` : "\nSIN DIFERENCIAS en el alcance replicado: staging == producción (sin backup_* ni componentes gestionados).");
  process.exit(dif.length ? 1 : 0);
}
