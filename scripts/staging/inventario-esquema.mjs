// Inventario ESTÁTICO de qué tablas/columnas usa el código de TILA (solo lee archivos del repo; no se conecta a nada).
// Heurístico: extrae de cada `.from("tabla")` los argumentos de select/eq/in/is/neq/gt/lt/order/or/insert/update/upsert,
// más los payloads armados en variables (payload / upd / updateData). Debe VALIDARSE contra un dump real del esquema.
// Uso: node scripts/staging/inventario-esquema.mjs [--json]
import fs from "node:fs";
import path from "node:path";

const RAIZ = "app";
const archivos = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !p.includes(path.join("lib", "legal"))) archivos.push(p);
  }
})(RAIZ);

/** Texto entre los paréntesis balanceados que empiezan en `abre` (índice del "("). */
function args(src, abre) {
  let d = 0, comilla = null;
  for (let i = abre; i < src.length; i++) {
    const c = src[i];
    if (comilla) { if (c === "\\") i++; else if (c === comilla) comilla = null; continue; }
    if (c === '"' || c === "'" || c === "`") { comilla = c; continue; }
    if (c === "(") d++;
    else if (c === ")") { d--; if (d === 0) return src.slice(abre + 1, i); }
  }
  return "";
}
const strings = (t) => [...t.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
const limpiaCol = (c) => c.trim().replace(/\s+/g, "").split(":").pop().replace(/[!(].*$/, "");
const ID = /^[A-Za-z_]\w*$/;

/** Claves de primer nivel de cada literal de objeto en `t` (profundidad medida solo con llaves). */
function clavesObjeto(t) {
  t = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1"); // sin comentarios
  const out = new Set();
  let d = 0, buf = "", comilla = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comilla) { buf += c; if (c === "\\") buf += t[++i] ?? ""; else if (c === comilla) comilla = null; continue; }
    if (c === '"' || c === "'" || c === "`") { comilla = c; buf += c; continue; }
    if (c === "{") { d++; if (d === 1) buf = ""; continue; }
    if (c === "}") { d--; buf = ""; continue; }
    if (d !== 1) continue;
    if (c === ",") { const k = buf.trim().replace(/^\.\.\./, ""); if (ID.test(k)) out.add(k); buf = ""; continue; }
    if (c === ":") {
      const k = buf.trim().replace(/^["']|["']$/g, "");
      if (ID.test(k)) out.add(k);
      buf = "";
      // saltar el valor hasta la coma de primer nivel
      let p = 0;
      for (i++; i < t.length; i++) {
        const v = t[i];
        if (v === "{" || v === "(" || v === "[") p++;
        else if (v === "}" || v === ")" || v === "]") { if (p === 0) { i--; break; } p--; }
        else if (v === "," && p === 0) break;
      }
      continue;
    }
    buf += c;
  }
  const resto = buf.trim();
  if (ID.test(resto)) out.add(resto);
  return out;
}

const tablas = {};
const nueva = () => ({ leidas: {}, filtradas: {}, escritas: {}, archivos: new Set() });
const uso = (t, tipo, col, f) => {
  if (!col || !/^[a-z_][a-z0-9_]*$/.test(col)) return;
  tablas[t] ??= nueva();
  (tablas[t][tipo][col] ??= new Set()).add(f);
  tablas[t].archivos.add(f);
};

for (const f of archivos) {
  const src = fs.readFileSync(f, "utf8");
  const rel = f.split(path.sep).join("/");
  const froms = [...src.matchAll(/\.from\(\s*"([a-z_]+)"\s*\)/g)].filter((m) => !/storage\s*$/.test(src.slice(Math.max(0, m.index - 12), m.index)));
  // payloads armados en variables del archivo (const payload = {...}; upd.campo = ...)
  const payloads = new Set();
  for (const v of src.matchAll(/(?:const|let)\s+(?:payload|upd\w*|updData|updateData)\b[^=]*=\s*\{/g)) {
    const a = src.indexOf("{", v.index + v[0].length - 1);
    let d = 0, j = a;
    for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (d === 0) break; } }
    for (const k of clavesObjeto(src.slice(a, j + 1))) payloads.add(k);
  }
  for (const v of src.matchAll(/\b(?:upd|updData|updateData|payload)\.([a-z_]+)\s*=/g)) payloads.add(v[1]);

  froms.forEach((m, idx) => {
    const t = m[1];
    const ini = m.index + m[0].length;
    const fin = idx + 1 < froms.length ? froms[idx + 1].index : ini + 1600;
    const seg = src.slice(ini, Math.min(fin, ini + 1600));
    tablas[t] ??= nueva();
    tablas[t].archivos.add(rel);
    let escribe = false;
    for (const c of seg.matchAll(/\.(select|eq|neq|in|is|gt|gte|lt|lte|order|or|insert|update|upsert|delete|not|ilike|like)\s*\(/g)) {
      const op = c[1];
      const a = args(seg, c.index + c[0].length - 1);
      if (op === "select") {
        for (const s of strings(a)) for (const col of s.split(",")) { const k = limpiaCol(col); if (k !== "*") uso(t, "leidas", k, rel); else (tablas[t].leidas["*"] ??= new Set()).add(rel); }
      } else if (op === "order") uso(t, "filtradas", strings(a)[0], rel);
      else if (["eq", "neq", "in", "is", "gt", "gte", "lt", "lte", "not", "ilike", "like"].includes(op)) uso(t, "filtradas", strings(a)[0], rel);
      else if (op === "or") { for (const s of strings(a)) for (const p of s.split(",")) uso(t, "filtradas", p.split(".")[0], rel); }
      else if (["insert", "update", "upsert"].includes(op)) { escribe = true; for (const k of clavesObjeto(a)) uso(t, "escritas", k, rel); }
    }
    // el payload de variable se atribuye a esta tabla solo si el segmento escribe (update/insert/upsert)
    if (escribe) for (const k of payloads) uso(t, "escritas", k, rel);
  });
}

// ── Canales Realtime, buckets y RPC ─────────────────────────────────────────
const realtime = [];
const buckets = new Set();
const rpcs = [];
for (const f of archivos) {
  const src = fs.readFileSync(f, "utf8");
  const rel = f.split(path.sep).join("/");
  for (const m of src.matchAll(/\.channel\(\s*([`"'][^`"']*[`"'])/g)) realtime.push({ archivo: rel, canal: m[1].replace(/[`"']/g, "") });
  for (const m of src.matchAll(/postgres_changes",\s*\{([^}]*)\}/g)) {
    realtime.push({
      archivo: rel,
      tabla: /table:\s*"([a-z_]+)"/.exec(m[1])?.[1],
      evento: /event:\s*"([^"]+)"/.exec(m[1])?.[1],
      filtro: /filter:\s*[`"]([^`"]+)[`"]/.exec(m[1])?.[1] ?? null,
    });
  }
  for (const m of src.matchAll(/storage\s*\.from\(\s*(?:"([^"]+)"|(\w+))/g)) buckets.add(m[1] ?? `variable:${m[2]}`);
  for (const m of src.matchAll(/\.rpc\(\s*"([^"]+)"/g)) rpcs.push({ archivo: rel, rpc: m[1] });
}

const salida = {
  tablas: Object.fromEntries(Object.entries(tablas).sort().map(([t, v]) => [t, {
    archivos: [...v.archivos].sort(),
    columnas_leidas: Object.keys(v.leidas).filter((c) => c !== "*").sort(),
    columnas_filtradas: Object.keys(v.filtradas).sort(),
    columnas_escritas: Object.keys(v.escritas).sort(),
    union: [...new Set([...Object.keys(v.leidas), ...Object.keys(v.filtradas), ...Object.keys(v.escritas)])].filter((c) => c !== "*").sort(),
    select_asterisco_en: v.leidas["*"] ? [...v.leidas["*"]].sort() : [],
  }])),
  realtime,
  buckets_storage: [...buckets].sort(),
  rpc: rpcs,
};
if (process.argv.includes("--json")) console.log(JSON.stringify(salida, null, 2));
else {
  for (const [t, v] of Object.entries(salida.tablas)) {
    console.log(`\n## ${t}  (${v.archivos.length} archivos)`);
    console.log(`  leídas    : ${v.columnas_leidas.join(", ") || "-"}${v.select_asterisco_en.length ? `  [select(*) en ${v.select_asterisco_en.length} archivo(s)]` : ""}`);
    console.log(`  filtradas : ${v.columnas_filtradas.join(", ") || "-"}`);
    console.log(`  escritas  : ${v.columnas_escritas.join(", ") || "-"}`);
  }
  console.log(`\n## Storage buckets: ${salida.buckets_storage.join(", ")}`);
  console.log(`## RPC: ${salida.rpc.length ? JSON.stringify(salida.rpc) : "ninguna"}`);
  console.log(`## Realtime (suscripciones postgres_changes): ${salida.realtime.filter((c) => c.tabla).length}`);
}
