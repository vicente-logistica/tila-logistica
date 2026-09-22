// Aplica el seed de staging (datos.mjs) a un Supabase de STAGING o LOCAL. Idempotente (upsert por id),
// EXCEPTO consentimientos_legales: esa tabla es append-only (ver upConsentimientosInsertOnly más abajo) —
// ahí se compara e inserta solo lo faltante, nunca se hace upsert/UPDATE.
//
// Uso (por defecto es DRY-RUN: no escribe nada):
//   TILA_ENTORNO=staging TILA_STAGING_SUPABASE_REF=<ref> \
//   STAGING_SUPABASE_URL=https://<ref>.supabase.co STAGING_SERVICE_ROLE_KEY=... \
//   node scripts/staging/seed/aplicar.mjs [--aplicar --confirmar=<host>] [--reset] [--sin-storage]
//
//  · Las claves se leen de variables de entorno o de un archivo `.env.staging` (git-ignorado). NUNCA por argumento.
//  · Las guardas (guardas.mjs) abortan si el destino es producción o no está autorizado.
//  · --reset borra SOLO filas del seed (por ids / email @tila-staging.invalid) antes de insertar.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { asegurarNoProduccion, enmascarar } from "../guardas.mjs";
import { redactar } from "../smoke/v3-anon.mjs";
import { pngGris } from "./png.mjs";
import * as D from "./datos.mjs";
import { analizarSecuencias, lineasSecuenciasDryRun, lineasPasoSecuencias, maximosReales } from "./secuencias.mjs";

function leerEnvArchivo(ruta = ".env.staging") {
  if (!fs.existsSync(ruta)) return {};
  return Object.fromEntries(fs.readFileSync(ruta, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
}
const env = { ...leerEnvArchivo(), ...process.env };
const args = new Set(process.argv.slice(2));
const flag = (n) => process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const aplicar = args.has("--aplicar");
const reset = args.has("--reset");
const sinStorage = args.has("--sin-storage");

const url = env.STAGING_SUPABASE_URL;
const clave = env.STAGING_SERVICE_ROLE_KEY;
if (!url || !clave) { console.error("Faltan STAGING_SUPABASE_URL y/o STAGING_SERVICE_ROLE_KEY (variables de entorno o .env.staging)."); process.exit(2); }

let host, local;
try { ({ host, local } = asegurarNoProduccion(url, { etiqueta: "STAGING_SUPABASE_URL", env })); }
catch (e) { console.error(e.message); process.exit(2); }
if (aplicar && !local && flag("confirmar") !== host) {
  console.error(`[guarda] para escribir en ${host} agregá --confirmar=${host}. Abortado.`); process.exit(2);
}
// ── Errores: nada sensible sale por pantalla; se muestra name, message y la cadena de causas (code/message) ─────────────────────
const SECRETOS = [clave, ...Object.values(D.CLAVES)];
const limpio = (t) => redactar(t, SECRETOS).replace(/((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|apikey)["']?\s*[:=]\s*)[^\n]*/gi, "$1[REDACTADO]").slice(0, 400);
const PISTA_TLS = /^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT(_LOCALLY)?|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_[A-Z_]+|ERR_TLS_CERT_ALTNAME_INVALID)$/;
const hijoDe = (e) => (e && typeof e === "object" ? (e.cause ?? e.originalError) : undefined); // supabase-js / storage-js envuelven el fallo de red en originalError
function lineasError(e) {
  const L = [`[error] name: ${limpio(e?.name ?? typeof e)}`, `[error] message: ${limpio(e?.message ?? e)}`];
  if (typeof e?.code === "string" && e.code) L.push(`[error] code: ${limpio(e.code)}`);
  let c = hijoDe(e), pre = "cause", tls = false;
  for (let n = 0; c && n < 4; n++, c = hijoDe(c), pre += ".cause") {
    if (typeof c !== "object") { L.push(`[error] ${pre}: ${limpio(c)}`); break; }
    if (c.name) L.push(`[error] ${pre}.name: ${limpio(c.name)}`);
    if (typeof c.code === "string" && c.code) { L.push(`[error] ${pre}.code: ${limpio(c.code)}`); if (PISTA_TLS.test(c.code)) tls = true; }
    if (c.message) L.push(`[error] ${pre}.message: ${limpio(c.message)}`);
  }
  if (tls) L.push("[error] pista: Node no confía en el certificado del destino; con certificados del sistema, ejecutar Node con --use-system-ca (NO desactivar TLS).");
  return L;
}
const conCausa = (contexto, err) => Object.assign(new Error(`[${contexto}] ${err?.message ?? err}`), { cause: err });

console.log(`destino: ${host}${local ? " (local)" : ""} | clave: ${enmascarar(clave)} | modo: ${aplicar ? "APLICAR" : "DRY-RUN (no escribe)"}${reset ? " + RESET del seed" : ""}`);

const ahora = new Date().toISOString();
const base = url.replace(/\/$/, "");
const hash = (k) => bcrypt.hashSync(D.CLAVES[k], 10);
const usuarios = D.usuarios(ahora).map((u) => { const k = Object.keys(D.ID).find((x) => D.ID[x] === u.id); return { ...u, password: hash(k), vehiculo_activo_id: null }; });
const vehiculos = D.vehiculos(base);
const { filas: docs, archivos } = D.documentacion(base);
const cargas = D.cargas(ahora), paradas = D.paradas(), mensajes = D.mensajes(), billetera = D.billetera(), evidencias = D.evidencias(base), consent = D.consentimientos();
const idsCargas = cargas.map((c) => c.id);
const idsUsuarios = Object.values(D.ID);

const plan = [["usuarios", usuarios.length], ["vehiculos", vehiculos.length], ["documentacion_chofer", docs.length], ["cargas", cargas.length], ["paradas_viaje", paradas.length],
  ["mensajes_viaje", mensajes.length], ["billetera_chofer", billetera.length], ["viaje_evidencias", evidencias.length], ["consentimientos_legales", consent.length]];
for (const [t, n] of plan) console.log(`  ${t.padEnd(24)} ${String(n).padStart(3)} filas`);
console.log(`  storage: ${sinStorage ? "omitido" : archivos.length + " imágenes ficticias en buckets documentacion-choferes / vehiculos"}`);
console.log("  usuarios de prueba:"); for (const k of Object.keys(D.ID)) console.log(`    ${D.ROL[k].padEnd(8)} ${D.EMAIL(k).padEnd(38)} clave: ${D.CLAVES[k]}`);
for (const l of lineasSecuenciasDryRun(analizarSecuencias(D, base))) console.log(l);
if (!aplicar) { console.log("\nDRY-RUN: no se escribió nada. Agregá --aplicar (y --confirmar=<host> si no es local)."); process.exit(0); }


const sb = createClient(url, clave, { auth: { persistSession: false } });
const ok = (r, t) => { if (r.error) throw conCausa(t, r.error); };
const up = async (t, filas, onConflict = "id") => { ok(await sb.from(t).upsert(filas, { onConflict }), t); console.log(`  ✔ ${t}: ${filas.length}`); };
const codigoCausa = (e) => { let c = hijoDe(e); for (let n = 0; c && n < 4; n++, c = hijoDe(c)) if (typeof c?.code === "string" && c.code) return c.code; return null; };

// consentimientos_legales es append-only (migración 20260922_inmutabilidad_consentimientos_legales.sql):
// un UPDATE, aunque no cambie ningún valor, dispara el trigger BEFORE UPDATE y aborta la transacción. up()
// (upsert genérico, usado por todas las demás tablas) NO sirve acá: PostgREST traduce upsert() en
// INSERT ... ON CONFLICT (id) DO UPDATE SET ..., que SIEMPRE ejecuta el UPDATE sobre cada fila que ya
// existe — sin importar si los valores entrantes son idénticos a los guardados.
// Columnas que el seed realmente controla (las únicas que compara; decision/fecha_decision/
// documento_legal_id/hash_documento/plataforma/tipo_evento/idempotency_key los completa la base con sus
// defaults o quedan NULL — el fixture de datos.mjs nunca los define, así que no hay nada "esperado" contra
// qué compararlos).
const CAMPOS_SEED_CONSENTIMIENTOS = ["usuario_id", "tipo_documento", "version_documento", "fecha_hora", "ip_address", "user_agent", "metodo"];
// fecha_hora vuelve de la base en un formato de texto distinto al que genera t() en datos.mjs
// (ej. "...+00:00" vs "...Z"): comparar por valor temporal, no por string literal, para no marcar como
// "diferente" una fila que en realidad es idéntica.
const igualCampoConsentimiento = (campo, a, b) => campo === "fecha_hora" ? new Date(a).getTime() === new Date(b).getTime() : String(a) === String(b);

/**
 * INSERT-only para consentimientos_legales — nunca UPDATE, nunca DELETE, nunca toca el trigger:
 *   - id no existe todavía          → se inserta.
 *   - existe e idéntica (los 7 campos de arriba) → no se hace nada (el seed ya está aplicado para esa fila).
 *   - existe pero AL MENOS UN campo difiere → error explícito; no se inserta ni modifica NADA de este
 *     bloque (ni siquiera las filas legítimamente faltantes) — mismo criterio "todo o nada ante algo
 *     inesperado" que ya usa el resto de este script y que usa registrarConsentimiento() en la app.
 */
async function upConsentimientosInsertOnly(filas) {
  const ids = filas.map((f) => f.id);
  const previas = await sb.from("consentimientos_legales").select(`id,${CAMPOS_SEED_CONSENTIMIENTOS.join(",")}`).in("id", ids);
  ok(previas, "consentimientos_legales(select previo)");

  const porId = new Map(previas.data.map((f) => [f.id, f]));
  const faltantes = [];
  const diferencias = [];
  for (const fila of filas) {
    const previa = porId.get(fila.id);
    if (!previa) { faltantes.push(fila); continue; }
    const camposDistintos = CAMPOS_SEED_CONSENTIMIENTOS.filter((c) => !igualCampoConsentimiento(c, previa[c], fila[c]));
    if (camposDistintos.length > 0) diferencias.push({ id: fila.id, campos: camposDistintos });
  }

  if (diferencias.length > 0) {
    const detalle = diferencias.map((d) => `id=${d.id} campos=[${d.campos.join(",")}]`).join(" · ");
    throw conCausa("consentimientos_legales", new Error(
      `${diferencias.length} fila(s) existente(s) difieren del seed esperado (${detalle}). consentimientos_legales ` +
      `es append-only: no se corrige con UPDATE. Revisar manualmente — no se insertó ni modificó nada en este bloque.`
    ));
  }

  if (faltantes.length > 0) ok(await sb.from("consentimientos_legales").insert(faltantes), "consentimientos_legales");
  console.log(`  ✔ consentimientos_legales: ${filas.length} (nuevas: ${faltantes.length} · ya existían idénticas: ${filas.length - faltantes.length}; append-only, sin UPDATE)`);
}

try {
  if (reset) {
    console.log("reset del seed…");
    ok(await sb.from("consentimientos_legales").delete().in("usuario_id", idsUsuarios), "consentimientos_legales");
    ok(await sb.from("mensajes_viaje").delete().in("viaje_id", idsCargas), "mensajes_viaje");
    ok(await sb.from("viaje_evidencias").delete().in("carga_id", idsCargas), "viaje_evidencias");
    ok(await sb.from("billetera_chofer").delete().in("chofer_id", idsUsuarios), "billetera_chofer");
    ok(await sb.from("paradas_viaje").delete().in("carga_id", idsCargas), "paradas_viaje");
    ok(await sb.from("documentacion_chofer").delete().in("chofer_id", idsUsuarios), "documentacion_chofer");
    ok(await sb.from("usuarios").update({ vehiculo_activo_id: null }).in("id", idsUsuarios), "usuarios(vehiculo_activo_id)");
    ok(await sb.from("vehiculos").delete().in("chofer_id", idsUsuarios), "vehiculos");
    ok(await sb.from("cargas").delete().in("id", idsCargas), "cargas");
    ok(await sb.from("usuarios").delete().in("id", idsUsuarios), "usuarios");
  }

  if (!sinStorage) {
    for (const b of ["documentacion-choferes", "vehiculos"]) {
      const r = await sb.storage.createBucket(b, { public: true });
      console.log(`  bucket ${b}: ${r.error ? `(${limpio(r.error.message)}${codigoCausa(r.error) ? `; causa: ${limpio(codigoCausa(r.error))}` : ""})` : "creado"}`);
    }
    const png = pngGris();
    let subidos = 0;
    for (const a of archivos) { const r = await sb.storage.from(a.bucket).upload(a.ruta, png, { upsert: true, contentType: "image/png" }); if (r.error) throw conCausa(`storage ${a.bucket}/${a.ruta}`, r.error); subidos++; }
    const ev = await sb.storage.from("documentacion-choferes").upload("evidencias/103/carga_1.png", png, { upsert: true, contentType: "image/png" });
    if (ev.error) throw conCausa("storage documentacion-choferes/evidencias/103/carga_1.png", ev.error);
    console.log(`  ✔ storage: ${subidos + 1} imágenes ficticias`);
  }

  await up("usuarios", usuarios);
  await up("vehiculos", vehiculos);
  for (const k of ["chofer1", "chofer2", "chofer3"]) ok(await sb.from("usuarios").update({ vehiculo_activo_id: D.VEHICULO_ID[k] }).eq("id", D.ID[k]), "usuarios(vehiculo_activo_id)");
  console.log("  ✔ usuarios.vehiculo_activo_id asignado");
  await up("documentacion_chofer", docs, "chofer_id,tipo");
  await up("cargas", cargas);
  await up("paradas_viaje", paradas);
  await up("mensajes_viaje", mensajes);
  await up("billetera_chofer", billetera);
  await up("viaje_evidencias", evidencias);
  await upConsentimientosInsertOnly(consent);
  // El seed inserta ids explícitos y NO avanza las secuencias: se informa el MAX(id) real y el paso manual (el ajuste lo hace el SQL 09; este script no puede).
  {
    const an = analizarSecuencias(D, base);
    for (const l of lineasPasoSecuencias(an, await maximosReales(sb, an.afectadas.map((a) => a.tabla)))) console.log(l);
  }
  console.log("\nSEED APLICADO (falta el paso manual de secuencias: ver arriba).");
} catch (e) {
  for (const l of lineasError(e)) console.error(l);
  console.error("[error] El seed NO terminó. Nada se reintenta ni se limpia automáticamente.");
  process.exitCode = 1; // no process.exit(): con sockets de fetch abiertos, en Windows cierra libuv de forma abrupta (0xC0000409) y pierde el exit 1
}
