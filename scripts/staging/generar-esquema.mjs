// Genera los SQL de STAGING (01..08) a partir del esquema REAL de producción (RESULTADO-ESQUEMA-PRODUCCION.json).
// No se conecta a ninguna base, no lee datos: solo lee el JSON de metadatos y escribe archivos .sql en docs/staging/sql/.
// Uso: node scripts/staging/generar-esquema.mjs --json <ruta/RESULTADO-ESQUEMA-PRODUCCION.json> [--out docs/staging/sql]
//
// Decisiones (ver docs/staging/INFORME-DIFERENCIAS-PRODUCCION.md):
//   · Se reproduce el comportamiento REAL de producción, INCLUIDAS sus policies/permisos abiertos. No se corrige nada.
//   · Se EXCLUYEN las tablas backup_* (snapshot de datos reales del 2026-06-14; el código no las usa).
//   · Se EXCLUYEN los componentes gestionados por Supabase (auth, storage.*, realtime.*, roles, extensiones base).
//   · Las definiciones de constraints/índices/funciones/triggers/policies se toman TEXTUALMENTE de lo que Postgres devolvió.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const EXCLUIR_TABLA = /^backup_/;
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };

const RESERVADAS = new Set(["user", "order", "group", "table", "select", "end", "check", "default", "column", "desc", "asc", "limit", "offset"]);
export const q = (id) => (/^[a-z_][a-z0-9_]*$/.test(id) && !RESERVADAS.has(id) ? id : `"${id.replace(/"/g, '""')}"`);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const TABLA_PRIV = ["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"];
const SEQ_PRIV = ["SELECT", "UPDATE", "USAGE"];

const GUARDA = (nombre) => `-- Los nombres sin esquema (usuarios, cargas, *_seq, set_updated_at) se resuelven en public, sin depender del search_path del rol.
set local search_path to public, extensions;

-- ── GUARDA ANTI-PRODUCCIÓN ─────────────────────────────────────────────────────────────────────────
-- Producción tiene las tablas backup_*_20260614; un proyecto de staging NO debe tenerlas. Si existen, esto NO es staging.
do $guarda$
begin
  if to_regclass('public.backup_usuarios_20260614') is not null
     or to_regclass('public.backup_cargas_20260614') is not null then
    raise exception 'ABORTADO (${nombre}): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. Estos archivos son SOLO para STAGING.';
  end if;
end
$guarda$;
`;

function cabecera(nro, titulo, j, extra = "") {
  return `-- =====================================================================================================================
-- ${nro} · ${titulo}                                                     [SOLO STAGING · NO EJECUTAR EN PRODUCCIÓN]
-- Generado por scripts/staging/generar-esquema.mjs desde RESULTADO-ESQUEMA-PRODUCCION.json (${j.generado_utc}, ${j.meta.version.split(",")[0]}).
-- NO EDITAR A MANO: se regenera. Reproduce producción TAL CUAL (incluidas policies/permisos abiertos): NO corrige vulnerabilidades.
-- No contiene datos. No toca tablas backup_*. Se ejecuta completo, en una sola corrida, dentro de una transacción.${extra}
-- =====================================================================================================================
`;
}

export function generar(j, evt) {
  const enScope = (t) => !EXCLUIR_TABLA.test(t);
  const tablas = j.tablas.filter((t) => enScope(t.nombre) && "rpf".includes(t.tipo)).sort((a, b) => a.nombre.localeCompare(b.nombre, "en"));
  const nombresT = tablas.map((t) => t.nombre);
  const cols = (t) => j.columnas.filter((c) => c.tabla === t).sort((a, b) => a.pos - b.pos);
  const seqs = j.secuencias.filter((s) => nombresT.includes(s.columna_duena.split(".")[0]));
  const archivos = {};

  // ── 01-schema.sql ────────────────────────────────────────────────────────────────────────────────────────────────
  {
    let s = cabecera("01-schema.sql", "TABLAS, COLUMNAS, TIPOS, DEFAULTS, IDENTITY Y SECUENCIAS", j,
      `\n-- Orden interno: extensiones → secuencias → tablas (${tablas.length}) → propiedad de secuencias.\n-- El RLS se habilita en 05-rls-policies.sql (si el proyecto trae el event trigger de RLS automático, ya vendrá habilitado: es idempotente).`);
    s += "\nbegin;\n\n" + GUARDA("01-schema") + `
do $existe$
begin
  if to_regclass('public.usuarios') is not null or to_regclass('public.cargas') is not null then
    raise exception 'ABORTADO (01-schema): public.usuarios/public.cargas ya existen. Usar rollback-staging.sql antes de reintentar.';
  end if;
end
$existe$;

-- Extensiones que producción tiene instaladas (ninguna es requerida por el esquema: gen_random_uuid() es nativo de PG13+).
create extension if not exists pgcrypto  with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
`;
    s += "\n-- Secuencias estilo serial (las columnas tienen DEFAULT nextval(...)). cargas.id es IDENTITY y crea la suya sola.\n";
    for (const sq of seqs) {
      const esIdentity = j.columnas.find((c) => c.tabla === sq.columna_duena.split(".")[0] && c.columna === sq.columna_duena.split(".")[1])?.identidad;
      if (esIdentity) continue;
      s += `create sequence public.${q(sq.nombre)} as ${sq.tipo} increment by ${sq.incremento} minvalue ${sq.minimo} maxvalue 9223372036854775807 start with ${sq.inicio} cache ${sq.cache_tam} no cycle;\n`;
    }
    for (const t of tablas) {
      s += `\n-- ${t.nombre}${t.comentario ? " — " + t.comentario : ""}\ncreate table public.${q(t.nombre)} (\n`;
      const lineas = cols(t.nombre).map((c) => {
        let l = `  ${q(c.columna).padEnd(28)}${c.tipo}`;
        if (c.identidad) l += ` generated ${c.identidad === "a" ? "always" : "by default"} as identity`;
        else {
          if (c.not_null) l += " not null";
          if (c.default_expr) l += ` default ${c.default_expr}`;
        }
        if (c.generado) throw new Error(`columna generada no soportada: ${t.nombre}.${c.columna}`);
        return l;
      });
      s += lineas.join(",\n") + "\n);\n";
    }
    s += "\n-- Propiedad de las secuencias (equivale al bigserial de producción).\n";
    for (const sq of seqs) {
      const [tb, cl] = sq.columna_duena.split(".");
      const esIdentity = j.columnas.find((c) => c.tabla === tb && c.columna === cl)?.identidad;
      if (!esIdentity) s += `alter sequence public.${q(sq.nombre)} owned by public.${q(tb)}.${q(cl)};\n`;
    }
    s += "\ncommit;\n";
    archivos["01-schema.sql"] = s;
  }

  // ── 02-constraints.sql ───────────────────────────────────────────────────────────────────────────────────────────
  const cons = j.constraints.filter((c) => enScope(c.tabla));
  {
    const orden = { p: 0, u: 1, c: 2, x: 3, f: 4 };
    let s = cabecera("02-constraints.sql", `CONSTRAINTS (${cons.length}): PK, UNIQUE, CHECK y FOREIGN KEY`, j,
      "\n-- Van DESPUÉS de crear todas las tablas porque hay una referencia circular (usuarios.vehiculo_activo_id → vehiculos, vehiculos.chofer_id → usuarios).\n-- Los índices de PK/UNIQUE los crea el propio constraint (12 de los 26 índices de producción).");
    s += "\nbegin;\n\n" + GUARDA("02-constraints");
    const tipoTxt = { p: "PRIMARY KEY", u: "UNIQUE", c: "CHECK", f: "FOREIGN KEY", x: "EXCLUDE" };
    let actual = "";
    for (const c of [...cons].sort((a, b) => orden[a.tipo] - orden[b.tipo] || a.tabla.localeCompare(b.tabla, "en") || a.nombre.localeCompare(b.nombre, "en"))) {
      if (!c.validada || c.diferible || c.diferida) throw new Error(`constraint con opciones no soportadas: ${c.nombre}`);
      if (actual !== c.tipo) { actual = c.tipo; s += `\n-- ${tipoTxt[c.tipo]}\n`; }
      s += `alter table public.${q(c.tabla)} add constraint ${q(c.nombre)} ${c.definicion};\n`;
    }
    s += "\ncommit;\n";
    archivos["02-constraints.sql"] = s;
  }

  // ── 03-indexes.sql ───────────────────────────────────────────────────────────────────────────────────────────────
  const idxAll = j.indices.filter((i) => enScope(i.tabla));
  const respaldados = new Set(cons.filter((c) => c.tipo === "p" || c.tipo === "u").map((c) => c.nombre));
  const idxSueltos = idxAll.filter((i) => !respaldados.has(i.nombre));
  {
    let s = cabecera("03-indexes.sql", `ÍNDICES (${idxSueltos.length} independientes; +${idxAll.length - idxSueltos.length} creados por 02-constraints)`, j,
      "\n-- Incluye los índices redundantes que existen en producción (prefijos de otros índices): se replican a propósito.\n-- Nota: idx_usuarios_vehiculo_activo_id (de la migración 20250606) NO existe en producción y por eso NO se crea.");
    s += "\nbegin;\n\n" + GUARDA("03-indexes") + "\n";
    for (const i of [...idxSueltos].sort((a, b) => a.tabla.localeCompare(b.tabla, "en") || a.nombre.localeCompare(b.nombre, "en"))) s += `${i.definicion};\n`;
    s += "\ncommit;\n";
    archivos["03-indexes.sql"] = s;
  }

  // ── 04-functions-triggers.sql ────────────────────────────────────────────────────────────────────────────────────
  const funcsPub = j.funciones.filter((f) => f.esquema === "public").sort((a, b) => a.nombre.localeCompare(b.nombre, "en"));
  const trgPub = j.triggers.filter((t) => t.esquema === "public");
  {
    let s = cabecera("04-functions-triggers.sql", `FUNCIONES (${funcsPub.length}) Y TRIGGERS (${trgPub.length}) DE public`, j,
      "\n-- Las 4 funciones/triggers de storage.* y realtime.* (enforce_bucket_name_length, protect_delete, update_updated_at_column,\n-- subscription_check_filters) los gestiona Supabase: NO se replican acá (ver PLAN-EJECUCION-STAGING.md, «Diferencias inevitables»).");
    s += "\nbegin;\n\n" + GUARDA("04-functions-triggers") + "\n";
    for (const f of funcsPub) s += `-- ${f.esquema}.${f.nombre}(${f.argumentos}) · dueño ${f.dueno} · security_definer=${f.security_definer} · config=${JSON.stringify(f.config)}\n${f.definicion.trim()};\n\n`;
    for (const t of trgPub) s += `-- trigger ${t.nombre} → ${t.funcion}\n${t.definicion};\n\n`;
    // Event triggers: los datos salen de RESULTADO-EVENT-TRIGGERS-PRODUCCION.json (leído en producción con pg_event_trigger).
    const propios = evt.event_triggers.filter((e) => evt.propios_del_proyecto.includes(e.nombre));
    const gestionados = evt.event_triggers.filter((e) => !evt.propios_del_proyecto.includes(e.nombre));
    for (const e of propios) {
      const [esqF, nomF] = e.funcion.split(".");
      if (e.evento !== "ddl_command_end" || !Array.isArray(e.tags) || !e.tags.length || e.habilitado !== "O") throw new Error("forma de event trigger no soportada: " + e.nombre);
      if (!funcsPub.some((f) => f.esquema === esqF && f.nombre === nomF)) throw new Error("la función " + e.funcion + " del event trigger " + e.nombre + " no está entre las funciones replicadas");
      const lst = [...e.tags].sort().map(lit).join(", ");
      s += "-- ── EVENT TRIGGER " + e.nombre + " (propio del proyecto; leído de producción con pg_event_trigger) ──────────────────────────────────\n" +
"--   Producción: evento " + e.evento + " · tags [" + [...e.tags].sort().join(", ") + "] · habilitado (" + e.habilitado + ") · dueño " + e.dueno + " · ejecuta " + e.funcion + "() (SECURITY DEFINER=" + e.funcion_security_definer + ").\n" +
"--   Se crea DESPUÉS de la función (arriba). GUARDA anti-duplicado: si el proyecto ya tiene un event trigger llamado " + e.nombre + ":\n" +
"--     · idéntico (evento, tags, función, habilitado) → NO se recrea (queda un NOTICE);\n" +
"--     · distinto                                     → se ABORTA sin modificar nada (revisar a mano).\n" +
"--   NO se recrean los otros " + gestionados.length + " event triggers de producción (" + gestionados.map((g) => g.nombre).join(", ") + "):\n" +
"--   son de supabase_admin (Supabase / PostgREST / extensiones) y los trae el proyecto.\n" +
"--   Si crear el event trigger fallara con «permission denied», este archivo (04 completo) se revierte; ver PLAN-EJECUCION-STAGING.md.\n" +
"do $evt$\ndeclare\n  v_existe boolean;\n  v_igual  boolean;\nbegin\n" +
"  select true,\n         (e.evtevent = " + lit(e.evento) + "\n          and n.nspname = " + lit(esqF) + " and p.proname = " + lit(nomF) + "\n          and e.evtenabled = " + lit(e.habilitado) + "\n" +
"          and (select array_agg(t order by t collate \"C\") from unnest(e.evttags) t) = array[" + lst + "])\n    into v_existe, v_igual\n" +
"  from pg_event_trigger e\n  join pg_proc p on p.oid = e.evtfoid\n  join pg_namespace n on n.oid = p.pronamespace\n  where e.evtname = " + lit(e.nombre) + ";\n\n" +
"  if v_existe is null then\n    create event trigger " + e.nombre + " on " + e.evento + " when tag in (" + lst + ") execute function " + e.funcion + "();\n" +
"  elsif v_igual then\n    raise notice 'event trigger " + e.nombre + " ya existe y coincide con producción: no se recrea.';\n" +
"  else\n    raise exception 'ABORTADO (04): ya existe el event trigger " + e.nombre + " pero NO coincide con producción (evento/tags/función/habilitado). No se modificó nada; revisar a mano.';\n  end if;\nend\n$evt$;\n";
    }
    s += "\ncommit;\n";
    archivos["04-functions-triggers.sql"] = s;
  }

  // ── 05-rls-policies.sql ──────────────────────────────────────────────────────────────────────────────────────────
  const polSql = (p) => {
    let s = `create policy "${p.nombre.replace(/"/g, '""')}" on ${p.esquema}.${q(p.tabla)}\n  as ${p.permisiva.toLowerCase()}\n  for ${p.comando.toLowerCase()}\n  to ${p.roles.join(", ")}`;
    if (p.using_expr !== null && p.using_expr !== undefined) s += `\n  using (${p.using_expr})`;
    if (p.with_check_expr !== null && p.with_check_expr !== undefined) s += `\n  with check (${p.with_check_expr})`;
    return s + ";\n";
  };
  const polPublic = j.policies.filter((p) => p.esquema === "public" && enScope(p.tabla));
  const polStorage = j.policies.filter((p) => p.esquema === "storage");
  {
    let s = cabecera("05-rls-policies.sql", `RLS HABILITADO EN ${tablas.length} TABLAS + ${polPublic.length} POLICIES DE public`, j,
      "\n-- ⚠ Estas policies REPRODUCEN las de producción, incluidas las abiertas (anon_select_usuarios, anon_update_usuarios_permisivo, etc.).\n-- Tablas con RLS habilitado y SIN policies (deniegan todo a anon/authenticated): " +
      nombresT.filter((n) => !polPublic.some((p) => p.tabla === n)).join(", ") + ".\n-- Las policies de storage.objects están en 08-storage.sql.");
    s += "\nbegin;\n\n" + GUARDA("05-rls-policies") + "\n";
    for (const t of tablas) {
      s += `alter table public.${q(t.nombre)} ${t.rls_habilitado ? "enable" : "disable"} row level security;\n`;
      if (t.rls_forzado) s += `alter table public.${q(t.nombre)} force row level security;\n`;
    }
    for (const t of tablas) {
      const ps = polPublic.filter((p) => p.tabla === t.nombre);
      if (!ps.length) continue;
      s += `\n-- ${t.nombre}\n`;
      for (const p of ps.sort((a, b) => a.nombre.localeCompare(b.nombre, "en"))) s += polSql(p) + "\n";
    }
    s += "commit;\n";
    archivos["05-rls-policies.sql"] = s.replace(/\n{3,}/g, "\n\n");
  }

  // ── 06-grants.sql ────────────────────────────────────────────────────────────────────────────────────────────────
  const grantsOb = (nombre, tipos) => {
    const m = {};
    for (const g of j.grants_tablas.filter((x) => x.objeto === nombre && tipos.includes(x.tipo))) (m[g.grantee] ??= new Set()).add(g.privilegio);
    return m;
  };
  {
    let s = cabecera("06-grants.sql", "GRANTs EFECTIVOS DE TABLAS, SECUENCIAS Y FUNCIONES DE public", j,
      "\n-- En producción TODOS estos permisos provienen de los privilegios por defecto de Supabase (postgres/supabase_admin → anon, authenticated,\n-- service_role). Se escriben explícitos para que staging no dependa de los defaults de su proyecto. Incluyen TRUNCATE/TRIGGER/REFERENCES a anon (igual que producción).\n-- NO se replican: GRANTs de esquemas (public/storage/realtime), default privileges y roles → los gestiona Supabase. El dueño (postgres) conserva todo.");
    s += "\nbegin;\n\n" + GUARDA("06-grants") + "\n";
    const RA = "anon, authenticated, service_role";
    for (const t of tablas) {
      const m = grantsOb(t.nombre, ["r", "p", "v", "m", "f"]);
      s += `revoke all on table public.${q(t.nombre)} from ${RA};\n`;
      for (const gr of Object.keys(m).filter((g) => g !== "postgres").sort()) {
        const p = [...m[gr]].sort();
        const todo = TABLA_PRIV.every((x) => m[gr].has(x)) && p.length === TABLA_PRIV.length;
        s += `grant ${todo ? "all" : p.join(", ").toLowerCase()} on table public.${q(t.nombre)} to ${gr};\n`;
      }
    }
    s += "\n-- Secuencias\n";
    for (const sq of seqs) {
      const m = grantsOb(sq.nombre, ["S"]);
      s += `revoke all on sequence public.${q(sq.nombre)} from ${RA};\n`;
      for (const gr of Object.keys(m).filter((g) => g !== "postgres").sort()) {
        const p = [...m[gr]].sort();
        const todo = SEQ_PRIV.every((x) => m[gr].has(x)) && p.length === SEQ_PRIV.length;
        s += `grant ${todo ? "all" : p.join(", ").toLowerCase()} on sequence public.${q(sq.nombre)} to ${gr};\n`;
      }
    }
    s += "\n-- Funciones (EXECUTE). PUBLIC = todos los roles.\n";
    for (const f of funcsPub) {
      const gs = j.grants_funciones.filter((g) => g.funcion === f.nombre && g.argumentos === f.argumentos && g.privilegio === "EXECUTE").map((g) => g.grantee).filter((g) => g !== "postgres");
      const firma = `public.${q(f.nombre)}(${f.argumentos})`;
      s += `revoke all on function ${firma} from public, anon, authenticated, service_role;\n`;
      if (gs.length) s += `grant execute on function ${firma} to ${gs.sort((a, b) => (a === "PUBLIC" ? -1 : b === "PUBLIC" ? 1 : a.localeCompare(b))).map((g) => (g === "PUBLIC" ? "public" : g)).join(", ")};\n`;
    }
    s += "\ncommit;\n";
    archivos["06-grants.sql"] = s;
  }

  // ── 07-realtime.sql ──────────────────────────────────────────────────────────────────────────────────────────────
  const pubT = j.publicaciones_tablas.filter((p) => p.pubname === "supabase_realtime" && p.schemaname === "public").map((p) => p.tablename).sort();
  {
    let s = cabecera("07-realtime.sql", `PUBLICACIÓN supabase_realtime: ${pubT.join(" + ")}`, j,
      "\n-- Producción publica SOLO estas tablas. `usuarios` y `paradas_viaje` NO están publicadas aunque el frontend se suscribe a ellas\n-- (PLAN-STAGING.md §2.2 decía 4 tablas: era una suposición; el dato real son 2). REPLICA IDENTITY: default en todas (no se modifica).\n-- supabase_realtime_messages_publication y las particiones realtime.messages_* las gestiona Supabase.");
    s += "\nbegin;\n\n" + GUARDA("07-realtime") + `
do $rt$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array[${pubT.map(lit).join(", ")}] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$rt$;

commit;
`;
    archivos["07-realtime.sql"] = s;
  }

  // ── 08-storage.sql ───────────────────────────────────────────────────────────────────────────────────────────────
  {
    let s = cabecera("08-storage.sql", `BUCKETS (${j.buckets_storage.length}) Y POLICIES DE storage.objects (${polStorage.length})`, j,
      "\n-- Ambos buckets son PÚBLICOS, sin límite de tamaño ni de tipo MIME, y storage.objects permite a anon/authenticated leer, subir y ACTUALIZAR\n-- (no hay policy de DELETE). Se reproduce tal cual. RLS en storage.objects lo habilita Supabase (no se toca).\n-- Los buckets se crean por SQL (storage.buckets); alternativa equivalente: crearlos desde el panel de Storage marcándolos públicos.");
    s += "\nbegin;\n\n" + GUARDA("08-storage") + "\n";
    s += "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values\n";
    s += j.buckets_storage.map((b) => `  (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${b.file_size_limit ?? "null"}, ${b.allowed_mime_types ? `array[${b.allowed_mime_types.map(lit).join(",")}]` : "null"})`).join(",\n");
    s += "\non conflict (id) do update set name = excluded.name, public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;\n\n";
    for (const p of polStorage.sort((a, b) => a.nombre.localeCompare(b.nombre, "en"))) s += polSql(p) + "\n";
    s += "commit;\n";
    archivos["08-storage.sql"] = s.replace(/\n{3,}/g, "\n\n");
  }
  return { archivos, resumen: { tablas: nombresT, columnas: tablas.reduce((n, t) => n + cols(t.nombre).length, 0), constraints: cons.length, indicesTotales: idxAll.length, indicesIndependientes: idxSueltos.length, policiesPublic: polPublic.length, policiesStorage: polStorage.length, secuencias: seqs.length, publicadas: pubT, buckets: j.buckets_storage.length } };
}

// CLI
if (process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("generar-esquema.mjs")) {
  const ruta = arg("--json");
  if (!ruta) { console.error("Uso: node scripts/staging/generar-esquema.mjs --json <RESULTADO-ESQUEMA-PRODUCCION.json> --evt <RESULTADO-EVENT-TRIGGERS-PRODUCCION.json> [--out docs/staging/sql]"); process.exit(2); }
  const j = JSON.parse(readFileSync(ruta, "utf8"));
  if (j.formato !== "tila-esquema-produccion/1") { console.error("Formato de JSON desconocido: " + j.formato); process.exit(2); }
  const out = arg("--out", "docs/staging/sql");
  mkdirSync(out, { recursive: true });
  const rutaEvt = arg("--evt");
  if (!rutaEvt) { console.error("Falta --evt <RESULTADO-EVENT-TRIGGERS-PRODUCCION.json>"); process.exit(2); }
  const evt = JSON.parse(readFileSync(rutaEvt, "utf8"));
  if (evt.formato !== "tila-event-triggers-produccion/1") { console.error("Formato de event triggers desconocido"); process.exit(2); }
  const { archivos, resumen } = generar(j, evt);
  for (const [n, c] of Object.entries(archivos)) writeFileSync(resolve(out, n), c, "utf8");
  console.log(`Escritos ${Object.keys(archivos).length} archivos en ${out}`);
  console.log(JSON.stringify(resumen, null, 2));
}
