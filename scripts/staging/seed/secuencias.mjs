// Secuencias del seed: el seed inserta ids EXPLÍCITOS en tablas cuya columna `id` toma su valor de una secuencia (serial/identity). Un INSERT con id explícito
// NO avanza la secuencia: después del seed la secuencia queda en 1 mientras MAX(id) es mayor → el primer INSERT sin id de la app / de V3 / de flujos.mjs
// choca con una fila del seed (23505 duplicate key) o lo hará más adelante.
//
// Este módulo es PURO respecto de la base: NO ejecuta SQL ni setval (PostgREST/supabase-js no pueden hacerlo; ver docs). Sirve para:
//   · derivar del propio seed qué tablas están afectadas (ids numéricos explícitos) → sin lista escrita a mano;
//   · leer el MAX(id) REAL de cada tabla (solo lectura, por REST) para informar el mínimo que debe tener cada secuencia;
//   · imprimir el paso manual (docs/staging/sql/09-secuencias-seed.sql), que SÍ hace setval calculado desde MAX(id) en la propia base;
//   · exponer `calcularSetval` como implementación de referencia de esa regla (la que replica el SQL) para poder probarla localmente.

/** Tablas del seed con ids NUMÉRICOS explícitos → { tabla: { n, min, max } }. Las tablas con ids uuid no aparecen (no usan secuencia). */
export function idsNumericosDelSeed(D, base) {
  const seed = {
    usuarios: D.usuarios(), vehiculos: D.vehiculos(base), documentacion_chofer: D.documentacion(base).filas, cargas: D.cargas(), paradas_viaje: D.paradas(),
    mensajes_viaje: D.mensajes(), billetera_chofer: D.billetera(), viaje_evidencias: D.evidencias(base), consentimientos_legales: D.consentimientos(),
  };
  const numericas = {}; const uuid = []; const sinId = [];
  for (const [tabla, filas] of Object.entries(seed)) {
    const ids = filas.map((f) => f.id);
    if (ids.length === 0 || ids.some((i) => i === undefined)) { sinId.push(tabla); continue; }
    if (ids.every((i) => typeof i === "number" && Number.isInteger(i))) numericas[tabla] = { n: ids.length, min: Math.min(...ids), max: Math.max(...ids) };
    else uuid.push(tabla);
  }
  return { numericas, uuid, sinId };
}

/** Parsea 01-schema.sql: tablas cuya columna id tiene DEFAULT nextval(...) (serial) o GENERATED … AS IDENTITY. Devuelve { tabla: { tipo, mecanismo, secuencia } }. */
export function secuenciasEnEsquema(sql01) {
  const r = {};
  for (const m of sql01.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    const [, tabla, cuerpo] = m;
    const l = cuerpo.split("\n").find((x) => /^\s*id\s/.test(x));
    if (!l) continue;
    const tipo = /^\s*id\s+(\w+)/.exec(l)[1];
    const serial = /default nextval\('(\w+)'::regclass\)/i.exec(l);
    if (serial) r[tabla] = { tipo, mecanismo: "serial", secuencia: serial[1] };
    else if (/generated (?:by default|always) as identity/i.test(l)) r[tabla] = { tipo, mecanismo: "identity", secuencia: `${tabla}_id_seq` }; // nombre implícito de PostgreSQL para identity
  }
  return r;
}

/**
 * Análisis completo (SIN base): por cada tabla afectada → columna, tipo, secuencia, ids que inserta el seed y el mínimo que debe tener la secuencia después del seed.
 * Lanza si el seed inserta ids numéricos en una tabla SIN secuencia (inconsistencia) o si una tabla con secuencia no aparece en el seed.
 */
export function analizarSecuencias(D, base, sql01 = null) {
  const { numericas, uuid, sinId } = idsNumericosDelSeed(D, base);
  const esquema = sql01 ? secuenciasEnEsquema(sql01) : null; // sin esquema (uso en aplicar.mjs): se asume la convención <tabla>_id_seq; los tests la comprueban contra 01-schema.sql
  const afectadas = Object.entries(numericas).map(([tabla, s]) => {
    const e = esquema ? esquema[tabla] : { tipo: "?", mecanismo: "serial|identity", secuencia: `${tabla}_id_seq` };
    if (!e) throw new Error(`el seed inserta ids numéricos en ${tabla}, pero el esquema no le asocia secuencia`);
    return { tabla, columna: "id", tipo: e.tipo, mecanismo: e.mecanismo, secuencia: e.secuencia, idsSeed: s, minimoTrasSeed: s.max };
  });
  const sinSeed = esquema ? Object.keys(esquema).filter((t) => !(t in numericas)) : [];
  return { afectadas, uuid, sinId, conSecuenciaSinIdsEnSeed: sinSeed };
}

/** Regla de referencia (la que implementa el SQL 09): nunca retrocede; solo avanza a MAX(id) real. increment = 1 (verificado en el esquema). */
export function calcularSetval({ maxId, lastValue, isCalled }) {
  const efectivo = isCalled ? lastValue : lastValue - 1; // último valor ya entregado (0 si la secuencia es nueva)
  const max = maxId ?? 0;
  return max > efectivo ? { accion: "setval", objetivo: max, siguiente: max + 1 } : { accion: "nada", objetivo: efectivo, siguiente: efectivo + 1 };
}

/** MAX(id) REAL de cada tabla, SOLO LECTURA por REST (select id order desc limit 1). */
export async function maximosReales(sb, tablas) {
  const out = {};
  for (const t of tablas) {
    const r = await sb.from(t).select("id").order("id", { ascending: false }).limit(1);
    out[t] = r.error ? { error: String(r.error.message ?? "error") } : { max: r.data?.[0]?.id ?? null };
  }
  return out;
}

/** Líneas informativas para el dry-run (sin base): qué tablas/secuencias quedan por debajo y qué mínimo necesitan. */
export function lineasSecuenciasDryRun(analisis) {
  const L = ["  secuencias (el seed inserta ids explícitos y NO las avanza):"];
  for (const a of analisis.afectadas) L.push(`    ${a.tabla.padEnd(24)} ${a.secuencia.padEnd(32)} ids seed ${a.idsSeed.min}…${a.idsSeed.max} → la secuencia debe quedar ≥ ${a.minimoTrasSeed}`);
  L.push(`    tablas con id uuid (sin secuencia, no requieren nada): ${analisis.uuid.join(", ")}`);
  return L;
}

/** Líneas para después de aplicar: MAX(id) real por tabla + el paso manual obligatorio. */
export function lineasPasoSecuencias(analisis, maximos, rutaSql = "docs/staging/sql/09-secuencias-seed.sql") {
  const L = ["", "SECUENCIAS — PASO MANUAL OBLIGATORIO (este script no puede ejecutar setval: PostgREST no lo expone):"];
  for (const a of analisis.afectadas) {
    const m = maximos[a.tabla];
    const txt = m?.error ? `no se pudo leer MAX(id) (${m.error})` : `MAX(id) real = ${m?.max ?? "(vacía)"} → la secuencia debe quedar ≥ ${Math.max(a.minimoTrasSeed, m?.max ?? 0)}`;
    L.push(`  ${a.tabla.padEnd(24)} ${a.secuencia.padEnd(32)} ${txt}`);
  }
  L.push(`  Ejecutá en el SQL Editor de STAGING (una sola vez por aplicación del seed; idempotente): ${rutaSql}`);
  L.push("  Sin ese paso, el primer INSERT sin id en paradas_viaje / viaje_evidencias / consentimientos_legales choca con el seed (23505); V3 B8/B10 y flujos.mjs darían FAIL por eso.");
  return L;
}
