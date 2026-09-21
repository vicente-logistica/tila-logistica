// Verificador ESTÁTICO de los SQL de staging (docs/staging/sql/01..08). No se conecta a ninguna base: solo lee texto.
// Uso: node scripts/staging/verificar-sql-staging.mjs --json <RESULTADO-ESQUEMA-PRODUCCION.json> [--evt docs/staging/RESULTADO-EVENT-TRIGGERS-PRODUCCION.json] [--dir docs/staging/sql] [--json-salida]
// Comprueba, parseando los .sql de forma independiente del generador:
//   A. SEGURIDAD: solo sentencias permitidas, sin datos (INSERT solo en storage.buckets), sin DROP/DELETE/UPDATE/TRUNCATE/COPY, sin claves ni hosts de producción,
//      cada archivo en transacción y con la guarda anti-producción.
//   B. FIDELIDAD: tablas, columnas (tipo/NOT NULL/default/identity), constraints, índices, policies, grants, secuencias, publicación Realtime, buckets y event trigger propio == producción
//      (menos lo excluido a propósito: backup_* y lo gestionado por Supabase).
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const ARCHIVOS = ["01-schema", "02-constraints", "03-indexes", "04-functions-triggers", "05-rls-policies", "06-grants", "07-realtime", "08-storage"];
const TABLA_PRIV = ["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"];
const SEQ_PRIV = ["SELECT", "UPDATE", "USAGE"];

/** Parte un script SQL en sentencias, respetando comentarios, 'literales' y bloques $tag$...$tag$. Devuelve [{texto, limpio}]. */
export function sentencias(sql) {
  const res = []; let buf = "", limpio = "", i = 0; const n = sql.length;
  const push = () => { if (limpio.trim()) res.push({ texto: buf.trim(), limpio: limpio.replace(/\s+/g, " ").trim() }); buf = ""; limpio = ""; };
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (c === "-" && d === "-") { while (i < n && sql[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { const f = sql.indexOf("*/", i + 2); i = f < 0 ? n : f + 2; continue; }
    if (c === "'") { let j = i + 1; while (j < n) { if (sql[j] === "'" && sql[j + 1] === "'") j += 2; else if (sql[j] === "'") { j++; break; } else j++; } buf += sql.slice(i, j); limpio += " '' "; i = j; continue; }
    if (c === "$") { const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 40)); if (m) { const f = sql.indexOf(m[0], i + m[0].length); const fin = f < 0 ? n : f + m[0].length; buf += sql.slice(i, fin); limpio += " $bloque$ "; i = fin; continue; } }
    if (c === '"') { let j = i + 1; while (j < n && sql[j] !== '"') j++; buf += sql.slice(i, j + 1); limpio += " ident "; i = j + 1; continue; }
    if (c === ";") { push(); i++; continue; }
    buf += c; limpio += c; i++;
  }
  push();
  return res;
}

const PERMITIDAS = [
  /^begin$/i, /^commit$/i, /^set local search_path to public, extensions$/i, /^do \$bloque\$$/i,
  /^create extension if not exists \S+ +with schema extensions$/i, /^create extension if not exists ident +with schema extensions$/i,
  /^create sequence public\.\w+ as bigint /i, /^create table public\.\w+ \(/i, /^alter sequence public\.\w+ owned by public\.\w+\.\w+$/i,
  /^alter table public\.\w+ add constraint \w+ (primary key|unique|check|foreign key)/i,
  /^alter table public\.\w+ enable row level security$/i,
  /^create (unique )?index \w+ on public\.\w+ using btree/i,
  /^create or replace function public\.\w+\(\)/i, /^create trigger \w+ before update on \w+ for each row execute function \w+\(\)$/i,
  /^create policy ident on (public|storage)\.\w+ as permissive for (select|insert|update|delete) to /i,
  /^revoke all on (table|sequence|function) public\./i, /^grant (all|execute|[a-z, ]+) on (table|sequence|function) public\./i,
  /^insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\) values/i,
];
const PROHIBIDO_TEXTO = [/imbtepvdscdtpxkleihi/i, /supabase\.co/i, /eyJ[A-Za-z0-9_-]{8,}\./, /sb_(secret|publishable)_/i, /service_role_key/i, /password\s*=\s*'/i];

const norm = (s) => s.replace(/\s+/g, " ").trim();
const setDe = (a) => new Set(a);
const difSets = (a, b) => ({ soloA: [...a].filter((x) => !b.has(x)).sort(), soloB: [...b].filter((x) => !a.has(x)).sort() });

export function verificar(j, leer, evt) {
  const checks = []; // {id, ok, detalle}
  const chk = (id, ok, detalle = "") => checks.push({ id, ok: !!ok, detalle });
  const sql = Object.fromEntries(ARCHIVOS.map((a) => [a, leer(a + ".sql")]));
  const sents = Object.fromEntries(ARCHIVOS.map((a) => [a, sentencias(sql[a])]));

  // ── A. SEGURIDAD ──────────────────────────────────────────────────────────────────────────────────────────────────
  for (const a of ARCHIVOS) {
    const ss = sents[a];
    chk(`A1 ${a}: empieza con BEGIN y termina con COMMIT`, /^begin$/i.test(ss[0]?.limpio) && /^commit$/i.test(ss.at(-1)?.limpio));
    chk(`A2 ${a}: contiene la guarda anti-producción`, /to_regclass\('public\.backup_usuarios_20260614'\)/.test(sql[a]) && /esto parece PRODUCCI/.test(sql[a]));
    const malas = ss.filter((s) => !PERMITIDAS.some((re) => re.test(s.limpio)));
    chk(`A3 ${a}: solo sentencias permitidas (${ss.length} sentencias)`, malas.length === 0, malas.slice(0, 3).map((m) => m.limpio.slice(0, 90)).join(" | "));
    const hit = PROHIBIDO_TEXTO.filter((re) => re.test(sql[a]));
    chk(`A4 ${a}: sin host/clave/ref de producción ni credenciales`, hit.length === 0, hit.join(","));
    const inserts = ss.filter((s) => /^insert /i.test(s.limpio) && !/^insert into storage\.buckets/i.test(s.limpio));
    chk(`A5 ${a}: sin INSERT de datos (solo storage.buckets en 08)`, inserts.length === 0);
    chk(`A6 ${a}: sin backup_* ni documentos_legales`, !/create table public\.(backup_|documentos_legales|tipos_documento_legal)/i.test(sql[a]) && !/documentos_legales/.test(sql[a].replace(/--.*$/gm, "")));
    // DO solo con guarda/existe/rt
    const dos = ss.filter((s) => /^do /i.test(s.limpio) && !/^do \$bloque\$$/.test(s.limpio));
    chk(`A7 ${a}: bloques DO acotados`, dos.length === 0);
  }
  const doTexto = (a) => sents[a].filter((s) => /^do /i.test(s.limpio)).map((s) => s.texto);
  chk("A8 solo 07-realtime usa EXECUTE dinámico", ARCHIVOS.every((a) => (a === "07-realtime") === doTexto(a).some((t) => /execute format\(/i.test(t))));

  // ── B. FIDELIDAD ──────────────────────────────────────────────────────────────────────────────────────────────────
  const scope = (t) => !/^backup_/.test(t);
  const tablasJ = j.tablas.filter((t) => scope(t.nombre) && "rpf".includes(t.tipo)).map((t) => t.nombre);

  // Tablas y columnas
  const tablasSQL = {};
  for (const s of sents["01-schema"]) {
    const m = /^create table public\.(\w+) \(/.exec(s.limpio); if (!m) continue;
    const cuerpo = s.texto.slice(s.texto.indexOf("(") + 1, s.texto.lastIndexOf(")"));
    tablasSQL[m[1]] = cuerpo.split(/,\s*\n/).map((l) => norm(l)).filter(Boolean).map((l) => {
      const mm = /^("?[\w]+"?) (.+)$/.exec(l); const nombre = mm[1].replace(/"/g, ""); let r = mm[2];
      let identidad = null; const im = / generated (by default|always) as identity/i.exec(r); if (im) { identidad = /always/i.test(im[1]) ? "a" : "d"; r = r.replace(im[0], ""); }
      let def = null; const dm = / default (.+)$/i.exec(r); if (dm) { def = dm[1]; r = r.slice(0, dm.index); }
      let nn = false; if (/ not null$/i.test(r)) { nn = true; r = r.replace(/ not null$/i, ""); }
      return { columna: nombre, tipo: r.trim(), not_null: nn, default_expr: def, identidad };
    });
  }
  const dt = difSets(setDe(Object.keys(tablasSQL)), setDe(tablasJ));
  chk(`B1 tablas creadas == producción sin backup_* (${tablasJ.length})`, !dt.soloA.length && !dt.soloB.length, JSON.stringify(dt));
  let totalCols = 0, colErr = [];
  for (const t of tablasJ) {
    const real = j.columnas.filter((c) => c.tabla === t).sort((a, b) => a.pos - b.pos);
    const sqlc = tablasSQL[t] ?? []; totalCols += sqlc.length;
    if (real.length !== sqlc.length) { colErr.push(`${t}: ${sqlc.length} cols en SQL vs ${real.length} reales`); continue; }
    real.forEach((r, i) => {
      const s = sqlc[i];
      const nnEsperado = r.identidad ? false : r.not_null; // identity implica NOT NULL y no se repite
      const defEsperado = r.identidad ? null : r.default_expr;
      if (s.columna !== r.columna || s.tipo !== r.tipo || s.not_null !== nnEsperado || (s.default_expr ?? null) !== (defEsperado ?? null) || (s.identidad ?? null) !== (r.identidad ?? null))
        colErr.push(`${t}.${r.columna}: SQL=${JSON.stringify(s)} real=${JSON.stringify({ tipo: r.tipo, nn: r.not_null, def: r.default_expr, id: r.identidad })}`);
      if (r.identidad && !r.not_null) colErr.push(`${t}.${r.columna}: identity debería ser NOT NULL`);
    });
  }
  const totalReal = j.columnas.filter((c) => scope(c.tabla)).length;
  chk(`B2 columnas: nombre, orden, tipo, NOT NULL, default e identity idénticos (${totalCols}/${totalReal})`, !colErr.length && totalCols === totalReal, colErr.slice(0, 4).join(" | "));

  // Secuencias
  const seqSQL = {}; for (const s of sents["01-schema"]) { const m = /^create sequence public\.(\w+) as (\w+) increment by (-?\d+) minvalue (\d+) maxvalue (\d+) start with (\d+) cache (\d+) no cycle$/i.exec(s.limpio); if (m) seqSQL[m[1]] = m.slice(2).join("|"); }
  const owned = {}; for (const s of sents["01-schema"]) { const m = /^alter sequence public\.(\w+) owned by public\.(\w+)\.(\w+)$/i.exec(s.limpio); if (m) owned[m[1]] = `${m[2]}.${m[3]}`; }
  const seqEsp = {}; const seqOwn = {};
  for (const sq of j.secuencias.filter((s) => scope(s.columna_duena.split(".")[0]))) {
    const [tb, cl] = sq.columna_duena.split("."); const id = j.columnas.find((c) => c.tabla === tb && c.columna === cl)?.identidad;
    if (id) continue; seqEsp[sq.nombre] = [sq.tipo, sq.incremento, sq.minimo, "9223372036854775807", sq.inicio, sq.cache_tam].join("|"); seqOwn[sq.nombre] = sq.columna_duena;
  }
  chk("B3 secuencias serial (4) con parámetros y columna dueña idénticos; cargas.id es IDENTITY (secuencia implícita)", JSON.stringify(seqSQL) === JSON.stringify(seqEsp) && JSON.stringify(owned) === JSON.stringify(seqOwn) && j.secuencias.length === 5,
    JSON.stringify({ seqSQL, seqEsp }));

  // Constraints
  const consSQL = new Map();
  for (const s of sents["02-constraints"]) { const m = /^alter table public\.(\w+) add constraint (\w+) (.+)$/i.exec(s.limpio); if (m) consSQL.set(`${m[1]}.${m[2]}`, norm(m[3])); }
  // (limpio reemplaza literales; para comparar definiciones se usa el texto original)
  const consTxt = new Map();
  for (const s of sents["02-constraints"]) { const m = /^alter table public\.(\w+) add constraint (\w+) ([\s\S]+)$/i.exec(s.texto); if (m) consTxt.set(`${m[1]}.${m[2]}`, norm(m[3])); }
  const consJ = new Map(j.constraints.filter((c) => scope(c.tabla)).map((c) => [`${c.tabla}.${c.nombre}`, norm(c.definicion)]));
  const dc = difSets(setDe(consTxt.keys()), setDe(consJ.keys()));
  const defDif = [...consJ].filter(([k, v]) => consTxt.get(k) !== v).map(([k]) => k);
  chk(`B4 constraints: ${consJ.size} nombres y definiciones idénticos (PK/FK/UNIQUE/CHECK)`, !dc.soloA.length && !dc.soloB.length && !defDif.length && consJ.size === 22, JSON.stringify({ dc, defDif }));
  const nFK = [...consTxt.values()].filter((v) => /^FOREIGN KEY/.test(v)).length;
  chk("B4b FKs: 5, y NO hay FK en cargas, mensajes_viaje, viaje_evidencias ni billetera_chofer (igual que producción)", nFK === 5 && ![...consTxt.keys()].some((k) => /^(cargas|mensajes_viaje|viaje_evidencias|billetera_chofer)\./.test(k) && /FOREIGN KEY|UNIQUE/.test(consTxt.get(k))));

  // Índices
  const idxSQL = new Map();
  for (const s of sents["03-indexes"]) { const m = /^create (?:unique )?index (\w+) on /i.exec(s.limpio); if (m) idxSQL.set(m[1], norm(s.texto)); }
  const respaldados = new Set(j.constraints.filter((c) => scope(c.tabla) && (c.tipo === "p" || c.tipo === "u")).map((c) => c.nombre));
  const idxJ = j.indices.filter((i) => scope(i.tabla));
  const idxSueltosJ = new Map(idxJ.filter((i) => !respaldados.has(i.nombre)).map((i) => [i.nombre, norm(i.definicion)]));
  const di = difSets(setDe(idxSQL.keys()), setDe(idxSueltosJ.keys()));
  const idxDefDif = [...idxSueltosJ].filter(([k, v]) => idxSQL.get(k) !== v).map(([k]) => k);
  chk(`B5 índices: ${idxSueltosJ.size} independientes idénticos + ${respaldados.size} creados por constraints = ${idxJ.length} (producción: 26 con backup_ excluidos → ${idxJ.length})`,
    !di.soloA.length && !di.soloB.length && !idxDefDif.length && idxSueltosJ.size + respaldados.size === idxJ.length && !idxSQL.has("idx_usuarios_vehiculo_activo_id"), JSON.stringify({ di, idxDefDif }));
  const idxRespaldadosOk = idxJ.filter((i) => respaldados.has(i.nombre)).every((i) => /^CREATE UNIQUE INDEX/.test(i.definicion));
  chk("B5b los índices de PK/UNIQUE de producción son UNIQUE btree (los crea el constraint)", idxRespaldadosOk);

  // Funciones y triggers (texto verbatim)
  const funcsJ = j.funciones.filter((f) => f.esquema === "public");
  const s04 = sql["04-functions-triggers"];
  chk(`B6 funciones de public (${funcsJ.length}): definición idéntica a producción`, funcsJ.every((f) => s04.includes(f.definicion.trim())), funcsJ.filter((f) => !s04.includes(f.definicion.trim())).map((f) => f.nombre).join(","));
  const trgJ = j.triggers.filter((t) => t.esquema === "public");
  chk(`B7 triggers de public (${trgJ.length}): definición idéntica`, trgJ.every((t) => s04.includes(t.definicion)));
  chk("B7b no se replican funciones/triggers de storage.* ni realtime.* (gestionados)", !/CREATE (OR REPLACE )?FUNCTION (storage|realtime)\./i.test(s04) && !/create trigger [^;]* on (storage|realtime)\./i.test(s04));
  // Event triggers: datos leídos en producción con pg_event_trigger (RESULTADO-EVENT-TRIGGERS-PRODUCCION.json).
  if (!evt) chk("B7c datos de event triggers de producción disponibles (--evt)", false, "falta RESULTADO-EVENT-TRIGGERS-PRODUCCION.json");
  else {
    const propios = evt.event_triggers.filter((e) => evt.propios_del_proyecto.includes(e.nombre));
    const gest = evt.event_triggers.filter((e) => !evt.propios_del_proyecto.includes(e.nombre));
    const s04 = sents["04-functions-triggers"], t04 = s04.map((s) => s.texto).join("\n");
    const cuantas = (a) => (sents[a].map((s) => s.texto).join("\n").match(/create event trigger/gi) ?? []).length;
    chk(`B7c event trigger propio (${propios.map((e) => e.nombre)}): se crea UNA vez, solo en 04, con evento, tags y función idénticos a producción`,
      propios.length === 1 && cuantas("04-functions-triggers") === 1 && ARCHIVOS.filter((a) => a !== "04-functions-triggers").every((a) => cuantas(a) === 0) &&
      propios.every((e) => { const lst = [...e.tags].sort().map((t) => `'${t}'`).join(", "); return norm(t04).toLowerCase().includes(norm(`create event trigger ${e.nombre} on ${e.evento} when tag in (${lst}) execute function ${e.funcion}()`).toLowerCase()); }),
      `creaciones por archivo: ${ARCHIVOS.map((a) => a.slice(0, 2) + "=" + cuantas(a)).join(" ")}`);
    const iDo = s04.findIndex((s) => /^do /i.test(s.limpio) && /create event trigger/i.test(s.texto));
    const doTxt = iDo >= 0 ? norm(s04[iDo].texto) : "";
    chk("B7d guarda anti-duplicado: lee pg_event_trigger por nombre, compara evento/tags/función/habilitado, no recrea si es idéntico y ABORTA si difiere (sin DROP/ALTER)",
      iDo >= 0 && propios.every((e) => { const lst = [...e.tags].sort().map((t) => `'${t}'`).join(", "); const [ef, nf] = e.funcion.split(".");
        return doTxt.includes("from pg_event_trigger e") && doTxt.includes(`where e.evtname = '${e.nombre}'`) && doTxt.includes(`e.evtevent = '${e.evento}'`) && doTxt.includes(`n.nspname = '${ef}' and p.proname = '${nf}'`) &&
          doTxt.includes(`e.evtenabled = '${e.habilitado}'`) && doTxt.includes(`= array[${lst}]`) && doTxt.includes("if v_existe is null then") && doTxt.includes("elsif v_igual then") && /else raise exception 'ABORTADO \(04\)/.test(doTxt); }) &&
      !/(drop|alter) event trigger|disable trigger/i.test(t04), iDo < 0 ? "no hay bloque DO con create event trigger" : "");
    const iFn = s04.findIndex((s) => /^create or replace function public\.rls_auto_enable\(\)/i.test(s.limpio));
    chk("B7e orden: public.rls_auto_enable() se crea ANTES que el event trigger", iFn >= 0 && iDo > iFn, `función en sentencia ${iFn}, event trigger en ${iDo}`);
    const todo = ARCHIVOS.map((a) => sents[a].map((s) => s.texto).join("\n")).join("\n");
    const cola = gest.filter((g) => todo.includes(g.nombre) || todo.includes(g.funcion));
    chk(`B7f los ${gest.length} event triggers gestionados por Supabase (${gest.map((g) => g.nombre).join(", ")}) NO se recrean`, gest.length === 6 && cola.length === 0, cola.map((g) => g.nombre).join(","));
    chk("B7g la función del event trigger está entre las funciones replicadas de public", propios.every((e) => funcsJ.some((f) => `public.${f.nombre}` === e.funcion)));
  }

  // Policies
  const parsePol = (s) => {
    const m = /^create policy "([^"]+)" on (\w+)\.(\w+)\s+as (\w+)\s+for (\w+)\s+to ([^\n]+?)\s*(?:\n\s*using \(([\s\S]*?)\))?(?:\n\s*with check \(([\s\S]*)\))?$/i.exec(s.texto.replace(/\r/g, ""));
    if (!m) return null;
    return { esquema: m[2], tabla: m[3], nombre: m[1], permisiva: m[4].toUpperCase(), comando: m[5].toUpperCase(), roles: m[6].split(",").map((x) => x.trim()).sort().join(","), using: m[7] === undefined ? null : norm(m[7]), check: m[8] === undefined ? null : norm(m[8]) };
  };
  const polSQL = [...sents["05-rls-policies"], ...sents["08-storage"]].filter((s) => /^create policy/i.test(s.limpio)).map(parsePol);
  chk("B8a todas las policies se pudieron parsear", polSQL.every(Boolean) && polSQL.length > 0);
  const kp = (p) => JSON.stringify([p.esquema, p.tabla, p.nombre, p.permisiva, p.comando, p.roles, p.using, p.check]);
  const polJ = j.policies.filter((p) => (p.esquema === "public" && scope(p.tabla)) || p.esquema === "storage")
    .map((p) => ({ esquema: p.esquema, tabla: p.tabla, nombre: p.nombre, permisiva: p.permisiva, comando: p.comando, roles: [...p.roles].sort().join(","), using: p.using_expr === null ? null : norm(p.using_expr), check: p.with_check_expr === null ? null : norm(p.with_check_expr) }));
  const dp = difSets(setDe(polSQL.filter(Boolean).map(kp)), setDe(polJ.map(kp)));
  chk(`B8 policies: ${polJ.length} idénticas (nombre, tabla, comando, roles, USING, WITH CHECK). public=${polJ.filter((p) => p.esquema === "public").length}, storage.objects=${polJ.filter((p) => p.esquema === "storage").length}`, !dp.soloA.length && !dp.soloB.length && polSQL.length === polJ.length, JSON.stringify(dp).slice(0, 400));
  const rlsSQL = new Set(sents["05-rls-policies"].map((s) => /^alter table public\.(\w+) enable row level security$/i.exec(s.limpio)?.[1]).filter(Boolean));
  chk("B9 RLS habilitado en todas las tablas (igual que producción; ninguna FORCE)", tablasJ.every((t) => rlsSQL.has(t)) && j.tablas.filter((t) => scope(t.nombre)).every((t) => t.rls_habilitado && !t.rls_forzado) && !/force row level/i.test(sql["05-rls-policies"]));

  // Grants
  const efec = new Map(); // "tipo|objeto|grantee" -> Set(priv)
  for (const s of sents["06-grants"]) {
    let m = /^grant (all|[a-z, ]+) on (table|sequence) public\.(\w+) to (\w+)$/i.exec(s.limpio);
    if (m) { const privs = m[1].toLowerCase() === "all" ? (m[2] === "table" ? TABLA_PRIV : SEQ_PRIV) : m[1].toUpperCase().split(",").map((x) => x.trim()); const k = `${m[2]}|${m[3]}|${m[4]}`; (efec.get(k) ?? efec.set(k, new Set()).get(k)); privs.forEach((p) => efec.get(k).add(p)); continue; }
    m = /^grant execute on function public\.(\w+)\(\) to (.+)$/i.exec(s.limpio);
    if (m) for (const g of m[2].split(",").map((x) => x.trim())) efec.set(`function|${m[1]}|${g.toLowerCase()}`, new Set(["EXECUTE"]));
  }
  const esp = new Map();
  for (const g of j.grants_tablas) {
    const esSeq = g.tipo === "S"; const dueno = j.secuencias.find((x) => x.nombre === g.objeto);
    if (esSeq ? !scope(dueno?.columna_duena.split(".")[0] ?? "backup_") : !scope(g.objeto)) continue;
    if (g.grantee === "postgres") continue;
    const k = `${esSeq ? "sequence" : "table"}|${g.objeto}|${g.grantee}`; (esp.get(k) ?? esp.set(k, new Set()).get(k)).add(g.privilegio);
  }
  for (const g of j.grants_funciones) if (g.grantee !== "postgres") esp.set(`function|${g.funcion}|${g.grantee.toLowerCase()}`, new Set([g.privilegio]));
  const serial = (m) => [...m].map(([k, v]) => k + "=" + [...v].sort().join(",")).sort();
  const dg = difSets(setDe(serial(efec)), setDe(serial(esp)));
  chk(`B10 GRANTs efectivos (tablas, secuencias, funciones; anon/authenticated/service_role) == producción (${esp.size} combinaciones objeto×rol)`, !dg.soloA.length && !dg.soloB.length, JSON.stringify(dg).slice(0, 300));
  chk("B10b anon conserva los 8 privilegios en usuarios (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN), como producción", (efec.get("table|usuarios|anon")?.size ?? 0) === 8);
  chk("B10c no hay GRANT por columna (producción: 0)", j.grants_columnas.length === 0 && !/grant [^;]*\([a-z_, ]+\) on/i.test(sql["06-grants"]));

  // Realtime
  const pubJ = j.publicaciones_tablas.filter((p) => p.pubname === "supabase_realtime" && p.schemaname === "public").map((p) => p.tablename).sort();
  const m07 = /array\[([^\]]+)\] loop/.exec(sql["07-realtime"]); const pubSQL = m07 ? m07[1].split(",").map((x) => x.trim().replace(/'/g, "")).sort() : [];
  chk(`B11 Realtime: supabase_realtime publica exactamente [${pubJ}] (NO usuarios ni paradas_viaje)`, JSON.stringify(pubSQL) === JSON.stringify(pubJ) && !pubSQL.includes("usuarios") && !pubSQL.includes("paradas_viaje"), JSON.stringify({ pubSQL, pubJ }));

  // Buckets
  const bJ = j.buckets_storage.map((b) => `${b.id}|${b.name}|${b.public}|${b.file_size_limit ?? "null"}|${b.allowed_mime_types ?? "null"}`).sort();
  const ins = sents["08-storage"].find((s) => /^insert into storage\.buckets/i.test(s.limpio));
  const bSQL = ins ? [...ins.texto.matchAll(/\('([^']+)', '([^']+)', (true|false), (null|\d+), (null|array\[[^\]]*\])\)/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}|${m[4]}|${m[5]}`).sort() : [];
  chk(`B12 buckets (${bJ.length}): id, público, límite de tamaño y MIME idénticos`, JSON.stringify(bSQL) === JSON.stringify(bJ), JSON.stringify({ bSQL, bJ }));
  return checks;
}

// CLI
if (process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("verificar-sql-staging.mjs")) {
  const rutaJson = arg("--json"); const dir = arg("--dir", "docs/staging/sql"); const rutaEvt = arg("--evt", "docs/staging/RESULTADO-EVENT-TRIGGERS-PRODUCCION.json");
  if (!rutaJson || !existsSync(rutaJson)) { console.error("Uso: node scripts/staging/verificar-sql-staging.mjs --json <RESULTADO-ESQUEMA-PRODUCCION.json> [--dir docs/staging/sql]"); process.exit(2); }
  const j = JSON.parse(readFileSync(rutaJson, "utf8"));
  const evt = existsSync(rutaEvt) ? JSON.parse(readFileSync(rutaEvt, "utf8")) : null;
  const checks = verificar(j, (f) => readFileSync(resolve(dir, f), "utf8"), evt);
  if (process.argv.includes("--json-salida")) console.log(JSON.stringify(checks, null, 2));
  else { for (const c of checks) console.log(`${c.ok ? "✔" : "✗"} ${c.id}${c.ok || !c.detalle ? "" : "\n     → " + c.detalle}`); }
  const fallos = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - fallos}/${checks.length} verificaciones OK` + (fallos ? ` · ${fallos} FALLAN` : " · TODO OK"));
  process.exit(fallos ? 1 : 0);
}
