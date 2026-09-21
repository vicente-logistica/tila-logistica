// Auditor mecánico de "solo lectura" para un archivo SQL. No se conecta a ninguna base: solo analiza texto.
// Uso: node scripts/staging/auditar-sql-solo-lectura.mjs <archivo.sql> [--json]
// Sale con código 0 si el archivo cumple TODAS las reglas y 1 si viola alguna.
//
// Enfoque de LISTA BLANCA (más estricto que una lista negra):
//   R1  Una sola sentencia (un único ';' al final), que empieza con WITH o SELECT.
//   R2  Ninguna palabra clave de escritura/DDL/DCL/control (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, GRANT, SET, INTO, COPY, DO, ...).
//   R3  Sin FOR UPDATE / FOR SHARE (bloqueos de fila).
//   R4  Cada relación leída (FROM/JOIN) es un CTE del propio archivo o un catálogo de la lista blanca. Nunca tablas de public/auth ni storage.objects.
//   R5  Cada función invocada está en la lista blanca (introspección/formato/JSON/agregación). Sin nextval, set_config, pg_sleep, lo_*, dblink...
//   R6  Sin joins con coma (FROM a, b) que esquiven el control de relaciones.
// Antes de analizar se eliminan comentarios, literales de texto, identificadores entre comillas y bloques $$...$$.
import { readFileSync } from "node:fs";

export const CATALOGOS_PERMITIDOS = new Set([
  "pg_class", "pg_namespace", "pg_depend", "pg_attribute", "pg_attrdef", "pg_type", "pg_enum", "pg_constraint", "pg_indexes",
  "pg_sequence", "pg_trigger", "pg_proc", "pg_language", "pg_policies", "pg_publication", "pg_publication_tables", "pg_extension",
  "pg_roles", "pg_settings", "pg_default_acl", "storage.buckets",
]);

export const FUNCIONES_PERMITIDAS = new Set([
  // introspección de catálogo (todas de solo lectura)
  "format_type", "pg_get_userbyid", "obj_description", "col_description", "pg_get_expr", "pg_get_constraintdef", "pg_get_triggerdef",
  "pg_get_function_identity_arguments", "pg_get_function_result", "pg_get_functiondef", "pg_get_viewdef", "aclexplode",
  // JSON / texto / agregación / utilidades puras
  "to_jsonb", "jsonb_build_object", "jsonb_agg", "jsonb_object_agg", "coalesce", "nullif", "count", "to_char", "now", "version",
  "current_database", "regexp_matches", "regexp_replace", "exists", "cast",
]);

// Palabras que en SQL pueden ir seguidas de "(" sin ser una llamada a función.
const NO_SON_FUNCIONES = new Set([
  "as", "in", "on", "from", "and", "or", "not", "where", "select", "join", "by", "over", "when", "then", "else", "case", "end",
  "with", "using", "having", "lateral", "distinct", "all", "any", "some", "between", "like", "ilike", "is", "null", "true", "false",
  "union", "intersect", "except", "limit", "offset", "filter", "within", "order", "group", "left", "right", "inner", "outer", "cross",
]);

export const PALABRAS_PROHIBIDAS = [
  "insert", "update", "delete", "merge", "upsert", "truncate", "create", "alter", "drop", "grant", "revoke", "comment", "copy",
  "do", "call", "execute", "into", "lock", "vacuum", "analyze", "reindex", "cluster", "refresh", "set", "reset", "begin", "start",
  "commit", "rollback", "savepoint", "release", "prepare", "deallocate", "listen", "notify", "unlisten", "declare", "fetch", "move",
  "close", "load", "import", "discard", "checkpoint", "security", "reassign", "abort", "end_transaction", "show", "explain",
];

/** Elimina comentarios y neutraliza literales para analizar solo la estructura. Devuelve el texto "desnudo". */
export function desnudar(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (c === "-" && d === "-") { while (i < n && sql[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      let nivel = 1; i += 2;
      while (i < n && nivel > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { nivel++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { nivel--; i += 2; }
        else i++;
      }
      out += " "; continue;
    }
    if (c === "'") {
      i++;
      while (i < n) { if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; } if (sql[i] === "'") { i++; break; } i++; }
      out += " '' "; continue;
    }
    if (c === '"') {
      i++;
      while (i < n) { if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue; } if (sql[i] === '"') { i++; break; } i++; }
      out += " ident_entre_comillas "; continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (m) {
        const cierre = sql.indexOf(m[0], i + m[0].length);
        if (cierre === -1) { out += " $ "; i = n; continue; }
        out += " '' "; i = cierre + m[0].length; continue;
      }
    }
    out += c; i++;
  }
  return out;
}

const norm = (s) => s.toLowerCase();

/** Analiza el SQL y devuelve { ok, errores[], secciones[] }. */
export function auditar(sqlOriginal) {
  const errores = [];
  const desnudo = norm(desnudar(sqlOriginal));
  const compacto = desnudo.replace(/\s+/g, " ").trim();

  // R1 ─ una sola sentencia
  const puntoycoma = [...compacto].filter((ch) => ch === ";").length;
  if (puntoycoma !== 1 || !compacto.endsWith(";")) errores.push(`R1: debe haber exactamente UN ';' y al final (hay ${puntoycoma}).`);
  if (!/^(with|select)\b/.test(compacto)) errores.push("R1: la sentencia debe empezar con WITH o SELECT.");

  // R2 ─ palabras prohibidas
  for (const p of PALABRAS_PROHIBIDAS) {
    const re = new RegExp(`(^|[^a-z0-9_.])${p}(?![a-z0-9_])`, "g");
    let m;
    while ((m = re.exec(compacto))) errores.push(`R2: palabra prohibida "${p.toUpperCase()}" cerca de: …${compacto.slice(Math.max(0, m.index - 30), m.index + 40)}…`);
  }

  // R3 ─ bloqueos de fila
  if (/\bfor\s+(no\s+key\s+update|key\s+share|update|share)\b/.test(compacto)) errores.push("R3: FOR UPDATE/SHARE presente.");

  // CTEs declarados
  const ctes = new Set();
  for (const m of compacto.matchAll(/(?:^|with|,)\s*([a-z_]\w*)\s+as\s*\(/g)) ctes.add(m[1]);

  // R4 ─ relaciones leídas
  const relaciones = [];
  for (const m of compacto.matchAll(/\b(from|join)\s+([a-z_][\w.]*)(\s*\()?/g)) {
    const nombre = m[2];
    if (m[3]) continue; // es una función (se valida en R5)
    if (nombre === "lateral") continue;
    relaciones.push(nombre);
    if (ctes.has(nombre)) continue;
    if (!CATALOGOS_PERMITIDOS.has(nombre)) errores.push(`R4: relación no permitida "${nombre}".`);
  }
  // R6 ─ join con coma: FROM a [alias], b
  for (const m of compacto.matchAll(/\bfrom\s+[a-z_][\w.]*(?:\s+(?!where|join|left|right|inner|cross|group|order|limit|on|as\b)[a-z_]\w*)?\s*,/g)) errores.push(`R6: posible join con coma: …${m[0]}`);

  // R5 ─ funciones invocadas
  const funciones = new Set();
  for (const m of compacto.matchAll(/([a-z_][\w.]*)\s*\(/g)) {
    const f = m[1];
    if (NO_SON_FUNCIONES.has(f)) continue;
    if (ctes.has(f)) continue;
    funciones.add(f);
    if (!FUNCIONES_PERMITIDAS.has(f)) errores.push(`R5: función no permitida "${f}(".`);
  }
  // funciones con nombre sin paréntesis que también son peligrosas (defensa extra)
  for (const f of ["nextval", "setval", "set_config", "pg_sleep", "dblink", "lo_import", "lo_export", "pg_read_file", "pg_ls_dir", "pg_terminate_backend"]) {
    if (compacto.includes(f)) errores.push(`R5: aparece la función peligrosa "${f}".`);
  }

  // Referencias explícitas a datos de negocio / secretos (defensa adicional aunque R4 ya las bloquea)
  for (const patron of [/\bpublic\.[a-z_]+/g, /\bauth\.[a-z_]+/g, /\bstorage\.objects\b/g, /\bpg_authid\b/g, /\bpg_shadow\b/g, /\bvault\./g, /\bsupabase_migrations\b/g, /\bcron\./g]) {
    for (const m of compacto.matchAll(patron)) errores.push(`R4: referencia prohibida a "${m[0]}".`);
  }

  // Informe por sección (CTE): qué relaciones y funciones usa cada una
  const secciones = [];
  const cuerpoCtes = extraerCtes(compacto, ctes);
  for (const [nombre, cuerpo] of cuerpoCtes) {
    const rels = new Set(), fns = new Set();
    for (const m of cuerpo.matchAll(/\b(from|join)\s+([a-z_][\w.]*)(\s*\()?/g)) if (!m[3] && m[2] !== "lateral") rels.add(m[2]);
    for (const m of cuerpo.matchAll(/([a-z_][\w.]*)\s*\(/g)) if (!NO_SON_FUNCIONES.has(m[1]) && !ctes.has(m[1])) fns.add(m[1]);
    secciones.push({ nombre, relaciones: [...rels], funciones: [...fns] });
  }
  return { ok: errores.length === 0, errores: [...new Set(errores)], secciones, ctes: [...ctes], relaciones: [...new Set(relaciones)], funciones: [...funciones] };
}

/** Parte el texto compacto en cuerpos de CTE balanceando paréntesis. */
function extraerCtes(compacto, ctes) {
  const res = [];
  for (const nombre of ctes) {
    const m = new RegExp(`(?:^|with|,)\\s*${nombre}\\s+as\\s*\\(`).exec(compacto);
    if (!m) continue;
    let i = m.index + m[0].length, nivel = 1;
    const ini = i;
    while (i < compacto.length && nivel > 0) { if (compacto[i] === "(") nivel++; else if (compacto[i] === ")") nivel--; i++; }
    res.push([nombre, compacto.slice(ini, i - 1)]);
  }
  return res;
}

// CLI
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("auditar-sql-solo-lectura.mjs")) {
  const archivo = process.argv[2];
  if (!archivo) { console.error("Uso: node scripts/staging/auditar-sql-solo-lectura.mjs <archivo.sql> [--json]"); process.exit(2); }
  const r = auditar(readFileSync(archivo, "utf8"));
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`Archivo: ${archivo}`);
    console.log(`Secciones (CTE): ${r.ctes.length}`);
    for (const s of r.secciones) console.log(`  ${s.nombre.padEnd(10)} lee: ${s.relaciones.join(", ") || "(ninguna: solo agrega/formatea)"}  |  funciones: ${s.funciones.join(", ") || "-"}`);
    console.log(`Catálogos/relaciones leídos (sin CTEs): ${r.relaciones.filter((x) => !r.ctes.includes(x)).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`);
    console.log(`Funciones invocadas: ${r.funciones.join(", ")}`);
    if (r.ok) console.log("\nRESULTADO: OK — cumple todas las reglas de solo lectura (R1–R6).");
    else { console.log("\nRESULTADO: FALLA"); for (const e of r.errores) console.log("  ✗ " + e); }
  }
  process.exit(r.ok ? 0 : 1);
}
