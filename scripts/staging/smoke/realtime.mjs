// Smoke test de REALTIME contra el Supabase de STAGING (TILA-STAGING). ESTADO: PREPARADO Y VALIDADO SOLO EN LOCAL (tests con Supabase FALSO);
// NUNCA se ejecutó contra Supabase. Hasta la primera ejecución real quedan sin verificar: que Realtime acepte la clave sb_secret_ del control,
// qué eventos entrega Realtime a `anon` con RLS sin policy SELECT, y que las rutas de la app se comporten como en producción.
//
// QUÉ MIDE. Con la MISMA anon key y las MISMAS suscripciones que usa hoy el frontend (postgres_changes en `cargas` "*", `mensajes_viaje` INSERT,
// `usuarios` UPDATE, `paradas_viaje` "*"), ¿llegan los eventos cuando cambian los datos? NO se da por sentado qué recibirá anon: se MIDE.
//
//   R1 nueva carga (POST /api/cargas/publicar)      → cargas/INSERT
//   R2 cambio de estado (POST /api/cargas/aceptar)  → cargas/UPDATE
//   R3 mensaje de chat (POST /api/chat/mensaje)     → mensajes_viaje/INSERT
//   R4 posición GPS (PATCH /api/cargas/gps)         → cargas/UPDATE (lat/lng)
//   R5 latido (UPDATE usuarios.ultima_senal_at con el cliente supabase-js ANON, sobre un usuario ficticio marcado) → usuarios/UPDATE
//   R6 DELETE de una carga ficticia marcada, creada y borrada con la service_role (el frontend escucha DELETE de cargas) → cargas/DELETE
//
// CONTROL POSITIVO (obligatorio). Un segundo suscriptor con la service_role recibe los MISMOS eventos. Se usa SOLO para saber si Realtime
// funciona: jamás para inferir ni simular lo que "debería" ver anon (la service_role omite RLS y no representa a anon).
//   · control NO recibe el evento esperado      → INCONCLUSO: no se saca ninguna conclusión sobre anon/RLS para esa acción.
//   · control SÍ lo recibe, anon SÍ / anon NO   → recién ahí se interpreta: "ANON RECIBE" / "ANON NO RECIBE".
//
// CÓDIGOS DE SALIDA (precedencia: 2 → 1 por restos/errores internos → 3 → 1 por diferencia → 0):
//   0 = corrida VÁLIDA: el control funcionó y todas las acciones quedaron clasificadas (ANON RECIBE / ANON NO RECIBE / INCONCLUSO no bloqueante).
//   1 = FALLO REAL: la limpieza dejó restos, hubo un error interno, o (solo si se pasó --esperado-anon) algo difiere de lo declarado.
//   2 = configuración/argumentos inválidos o guardas anti-producción (no se abrió ninguna conexión).
//   3 = INCONCLUSO: no se pudo confiar en la medición (control sin suscribir o sin recibir eventos en tablas que deben estar publicadas,
//       suscripción de anon fallida, acción no aplicada, app inaccesible, timeout total o interrupción). No es un fallo de RLS: es "no medido".
//
// USO (solo variables de entorno para claves/URL; NADA sensible por argumentos):
//   TILA_ENTORNO=staging TILA_STAGING_SUPABASE_REF=<ref> STAGING_SUPABASE_URL=https://<ref>.supabase.co STAGING_ANON_KEY=… STAGING_SERVICE_ROLE_KEY=… \
//   [TILA_STAGING_APP_HOSTS=<host>]  node scripts/staging/smoke/realtime.mjs --base=<URL de la app de staging> [--espera=8000] [--esperado-anon=R1=NO_LLEGA,…]
//   node scripts/staging/smoke/realtime.mjs --plan                      (sin claves, sin red, sin acciones: solo lista lo previsto)
//   node scripts/staging/smoke/realtime.mjs --limpiar-run=<runId>       (recupera restos de UNA corrida anterior, solo filas con su marcador exacto)
import crypto from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { asegurarAppNoProduccion } from "../guardas.mjs";
import { validarConfig, redactar } from "./v3-anon.mjs";
import { iniciarSesion } from "./util.mjs";

// ── Tiempos: TODOS centralizados acá (no hay números mágicos en el resto del archivo) ─────────────────────────────────────
export const TIMEOUTS = Object.freeze({
  suscripcionMs: 8000,   // cada canal debe llegar a SUBSCRIBED en este tiempo; si no → TIMED_OUT (suscripción fallida)
  esperaEventoMs: 8000,  // ventana de observación por acción, tras aplicarla (lo que antes era --espera)
  esperaMinMs: 1000,     // límites aceptados para --espera
  esperaMaxMs: 60000,
  llamadaMs: 15000,      // cada llamada HTTP a la app o a PostgREST/cliente Supabase; si no responde → INCONCLUSO
  limpiezaMs: 30000,     // presupuesto de toda la limpieza + verificación
  totalMs: 180000,       // presupuesto de la corrida completa (sin limpieza): setup + suscripciones + 6 acciones
  esperaPostSuscripcionMs: 2000, // pausa ÚNICA por corrida, tras confirmar SUBSCRIBED y antes de la primera acción (R1): evita perder el primer evento por carrera
  pollMs: 25,            // intervalo de sondeo mientras se espera un evento
  salidaForzadaMs: 2000, // tras terminar, si un WebSocket mantiene vivo el proceso, se fuerza la salida con el mismo código
});

/** Tablas que el clon DEBE tener publicadas en supabase_realtime (docs/staging/sql/07-realtime.sql, verificado contra producción).
 *  Se usa SOLO para decidir si un control silencioso invalida la corrida (exit 3) o queda como dato ("probablemente no publicada"). */
export const TABLAS_PUBLICADAS_ESPERADAS = Object.freeze(["cargas", "mensajes_viaje"]);
export const PREFIJO_MARCADOR = "REALTIME-MARCADOR-";
export const DOMINIO_EMAIL = "@tila-staging.invalid";
const GPS = Object.freeze({ lat: -32.5, lng: -60.9, velocidad: 60 });
const RUN_ID_RE = /^[0-9a-f]{8}$/;

// Suscripciones: idénticas a las del frontend (evento por tabla).
export const SUSCRIPCIONES = Object.freeze([
  Object.freeze({ tabla: "cargas", evento: "*" }),
  Object.freeze({ tabla: "mensajes_viaje", evento: "INSERT" }),
  Object.freeze({ tabla: "usuarios", evento: "UPDATE" }),
  Object.freeze({ tabla: "paradas_viaje", evento: "*" }),
]);

export const ACCIONES = Object.freeze([
  Object.freeze({ id: "R1", titulo: "nueva carga", como: "app: POST /api/cargas/publicar (detalles = marcador)", tabla: "cargas", tipo: "INSERT" }),
  Object.freeze({ id: "R2", titulo: "cambio de estado (aceptar)", como: "app: POST /api/cargas/aceptar sobre la carga de R1", tabla: "cargas", tipo: "UPDATE" }),
  Object.freeze({ id: "R3", titulo: "mensaje de chat", como: "app: POST /api/chat/mensaje (mensaje = marcador)", tabla: "mensajes_viaje", tipo: "INSERT" }),
  Object.freeze({ id: "R4", titulo: "posición GPS simulada", como: "app: PATCH /api/cargas/gps sobre la carga de R1", tabla: "cargas", tipo: "UPDATE" }),
  Object.freeze({ id: "R5", titulo: "latido del chofer (ultima_senal_at)", como: "cliente supabase-js ANON: UPDATE usuarios sobre un usuario ficticio marcado", tabla: "usuarios", tipo: "UPDATE" }),
  Object.freeze({ id: "R6", titulo: "DELETE de carga ficticia marcada", como: "service_role (control autorizado): DELETE de una carga creada solo para este test", tabla: "cargas", tipo: "DELETE" }),
]);

export const ESTADOS_OBS = Object.freeze({ LLEGO: "LLEGÓ", NO_LLEGO: "NO LLEGÓ", ERROR: "ERROR" });
export const CLASES = Object.freeze({ RECIBE: "ANON RECIBE", NO_RECIBE: "ANON NO RECIBE", INCONCLUSO: "INCONCLUSO" });

class Inconcluso extends Error {} // fallo de infraestructura de la prueba (no de RLS): termina con exit 3

// ── Argumentos: NUNCA claves ni datos de conexión ───────────────────────────────────────────────────────────────────────
export function parsearArgs(argv) {
  const r = { listar: false, ayuda: false, base: null, espera: null, esperado: {}, limpiarRun: null, errores: [] };
  for (const a of argv) {
    if (/^--(anon|key|clave|service|service-role|secret|token|password|apikey|url|ref|env|supabase)\b/i.test(a) || /eyJ|sb_(secret|publishable)_/.test(a)) {
      r.errores.push("Las claves y datos de conexión de Supabase NO se aceptan por argumentos: solo por variables de entorno.");
    } else if (a === "--plan" || a === "--listar") r.listar = true;
    else if (a === "--ayuda" || a === "--help" || a === "-h") r.ayuda = true;
    else if (a.startsWith("--base=")) r.base = a.slice(7);
    else if (a.startsWith("--espera=")) {
      const n = Number(a.slice(9));
      if (!Number.isInteger(n) || n < TIMEOUTS.esperaMinMs || n > TIMEOUTS.esperaMaxMs) r.errores.push(`--espera debe ser un entero entre ${TIMEOUTS.esperaMinMs} y ${TIMEOUTS.esperaMaxMs} ms.`);
      else r.espera = n;
    } else if (a.startsWith("--esperado-anon=")) {
      for (const par of a.slice(16).split(",").filter(Boolean)) {
        const m = /^(R[1-6])=(LLEGA|NO_LLEGA)$/.exec(par.trim());
        if (!m) r.errores.push("--esperado-anon: formato Rn=LLEGA|NO_LLEGA (n = 1..6), separados por comas.");
        else r.esperado[m[1]] = m[2];
      }
    } else if (a.startsWith("--limpiar-run=")) {
      const id = a.slice(14);
      if (!RUN_ID_RE.test(id)) r.errores.push("--limpiar-run debe ser el runId de 8 caracteres hexadecimales que imprimió la corrida.");
      else r.limpiarRun = id;
    } else r.errores.push("Argumento no reconocido (el valor no se muestra). Usá --ayuda.");
  }
  if (r.limpiarRun && (r.base || r.espera || Object.keys(r.esperado).length)) r.errores.push("--limpiar-run no se combina con otras opciones.");
  return r;
}

// ── Plan (texto estático: no lee env, ni red, ni disco) ────────────────────────────────────────────────────────────────
export function textoPlan() {
  const L = [];
  L.push("TILA · smoke REALTIME — PLAN (modo --plan: no lee claves, no abre red, no se suscribe, no ejecuta acciones, no limpia nada)");
  L.push("");
  L.push("Suscripciones (idénticas al frontend), en DOS clientes: anon (lo que se mide) y service_role (CONTROL POSITIVO, solo comprueba que Realtime funciona):");
  for (const s of SUSCRIPCIONES) L.push(`  ${s.tabla.padEnd(15)} evento ${s.evento}`);
  L.push("");
  L.push("Acciones previstas (cada una se observa en anon y en el control durante la ventana de espera):");
  for (const a of ACCIONES) L.push(`  ${a.id}  ${a.titulo.padEnd(38)} espera ${a.tabla}/${a.tipo}\n      cómo: ${a.como}`);
  L.push("");
  L.push("Clasificación por acción (nunca se asume el resultado de anon):");
  L.push("  control NO llegó / control sin suscribir / acción no aplicada → INCONCLUSO (sin conclusión sobre anon)");
  L.push("  control llegó y anon llegó                                   → ANON RECIBE");
  L.push("  control llegó y anon no llegó                                → ANON NO RECIBE");
  L.push(`  Tablas que deben estar publicadas: ${TABLAS_PUBLICADAS_ESPERADAS.join(", ")} (un control silencioso ahí invalida la corrida; en las demás es solo un dato).`);
  L.push("");
  L.push("Códigos de salida: 0 válida y clasificada · 1 fallo real (restos de limpieza / error interno / diferencia con --esperado-anon) · 2 configuración o guarda · 3 INCONCLUSO");
  L.push("");
  L.push(`Pausa post-SUBSCRIBED: ${TIMEOUTS.esperaPostSuscripcionMs} ms, UNA sola vez por corrida, después de resolver todas las suscripciones y antes de R1 (no antes de R2–R6).`);
  L.push(`Tiempos (centralizados en TIMEOUTS): suscripción ${TIMEOUTS.suscripcionMs} ms · espera por evento ${TIMEOUTS.esperaEventoMs} ms (--espera ${TIMEOUTS.esperaMinMs}-${TIMEOUTS.esperaMaxMs}) · llamada ${TIMEOUTS.llamadaMs} ms · limpieza ${TIMEOUTS.limpiezaMs} ms · total ${TIMEOUTS.totalMs} ms`);
  L.push("");
  L.push(`Datos de prueba (todos ficticios y marcados con ${PREFIJO_MARCADOR}<runId>): carga de R1 (detalles), mensaje de R3, usuario de R5 (nombre + email ...${DOMINIO_EMAIL}), carga de R6 (detalles).`);
  L.push("Limpieza: SOLO filas con el marcador exacto de esta corrida (nunca TRUNCATE, nunca DELETE sin filtro, nunca sobre el seed ni sobre producción), con service_role;");
  L.push("  después se verifica por marcador que no quedó nada (restos → exit 1). Recuperación de una corrida cortada: --limpiar-run=<runId>.");
  L.push("Variables (solo nombres): TILA_ENTORNO=staging, TILA_STAGING_SUPABASE_REF, STAGING_SUPABASE_URL, STAGING_ANON_KEY, STAGING_SERVICE_ROLE_KEY; opcional TILA_STAGING_APP_HOSTS. La URL de la app va en --base= (no es sensible).");
  L.push("Requiere el seed aplicado (usuarios cliente1 y chofer2 para las acciones vía app). Los secretos nunca se imprimen.");
  return L.join("\n");
}

// ── Clasificación (PURA) ───────────────────────────────────────────────────────────────────────────────────────────────
/** Combina lo observado en anon y en el control. `aplicada` = la acción realmente ocurrió. No conoce ningún resultado "esperado" de anon. */
export function clasificarAccion({ aplicada, anon, control, tabla }) {
  const publicadaEsperada = TABLAS_PUBLICADAS_ESPERADAS.includes(tabla);
  if (!aplicada) return { clase: CLASES.INCONCLUSO, motivo: "la acción no se aplicó: no hay evento que medir", bloquea: true };
  if (control !== ESTADOS_OBS.LLEGO) {
    const motivo = control === ESTADOS_OBS.ERROR
      ? "el control positivo no pudo suscribirse: sin conclusión sobre anon"
      : `el control positivo NO recibió el evento: sin conclusión sobre anon${publicadaEsperada ? "" : " (coherente con una tabla no publicada en supabase_realtime; confirmarlo en el panel)"}`;
    return { clase: CLASES.INCONCLUSO, motivo, bloquea: publicadaEsperada };
  }
  if (anon === ESTADOS_OBS.ERROR) return { clase: CLASES.INCONCLUSO, motivo: "anon no pudo suscribirse (el control sí): no se puede medir a anon", bloquea: true };
  return anon === ESTADOS_OBS.LLEGO
    ? { clase: CLASES.RECIBE, motivo: "control y anon recibieron el evento", bloquea: false }
    : { clase: CLASES.NO_RECIBE, motivo: "el control recibió el evento y anon no", bloquea: false };
}

/** Resume resultados y decide el código de salida (ver la cabecera para la precedencia). */
export function resumir({ acciones, limpieza, errorInterno = null, esperado = {}, interrupcionInconcluso = null }) {
  const cuenta = { RECIBE: 0, NO_RECIBE: 0, INCONCLUSO: 0, bloqueantes: 0 };
  const diferencias = [];
  for (const a of acciones) {
    if (a.clase === CLASES.RECIBE) cuenta.RECIBE++; else if (a.clase === CLASES.NO_RECIBE) cuenta.NO_RECIBE++; else cuenta.INCONCLUSO++;
    if (a.bloquea) cuenta.bloqueantes++;
    const exp = esperado[a.id];
    if (exp && a.clase !== CLASES.INCONCLUSO) {
      const real = a.clase === CLASES.RECIBE ? "LLEGA" : "NO_LLEGA";
      if (real !== exp) diferencias.push(`${a.id}: esperado ${exp}, medido ${real}`);
    }
  }
  const restos = !limpieza || limpieza.ok !== true;
  const inconcluso = cuenta.bloqueantes > 0 || !!interrupcionInconcluso;
  let codigo = 0;
  let veredicto = "VÁLIDA";
  if (restos || errorInterno) { codigo = 1; veredicto = "FALLO"; }
  else if (inconcluso) { codigo = 3; veredicto = "INCONCLUSO"; }
  else if (diferencias.length) { codigo = 1; veredicto = "DIFERENCIA"; }
  return { codigo, veredicto, cuenta, diferencias, restos };
}

// ── Utilidades ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
function conTimeout(promesa, ms, etiqueta) {
  let t;
  const limite = new Promise((_, rej) => { t = setTimeout(() => rej(new Inconcluso(`${etiqueta}: sin respuesta en ${ms} ms`)), ms); });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(t));
}
const mismoId = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
const CAMPOS_EVENTO = ["id", "detalles", "mensaje", "chofer_id", "lat", "lng", "ultima_senal_at", "viaje_id", "nombre"];
const resumirFila = (f) => (f && typeof f === "object" ? Object.fromEntries(CAMPOS_EVENTO.filter((k) => k in f).map((k) => [k, f[k]])) : {});
export const nuevoRunId = () => crypto.randomBytes(4).toString("hex");
export const marcadorDe = (runId) => `${PREFIJO_MARCADOR}${runId}`;
export const emailDe = (runId) => `realtime-${runId}${DOMINIO_EMAIL}`;

// ── Suscripción con timeout ─────────────────────────────────────────────────────────────────────────────────────────────
function suscribir(cliente, quien, s, buffer, T, runId, redact) {
  return new Promise((resolver) => {
    let cerrado = false; let timer;
    const fin = (estado, detalle) => { if (cerrado) return; cerrado = true; clearTimeout(timer); resolver({ estado, detalle: detalle ? redact(String(detalle)).slice(0, 120) : undefined, ms: Date.now() }); };
    timer = setTimeout(() => fin("TIMED_OUT", `sin SUBSCRIBED en ${T.suscripcionMs} ms`), T.suscripcionMs);
    try {
      cliente.channel(`rt-${quien}-${s.tabla}-${runId}`)
        .on("postgres_changes", { event: s.evento, schema: "public", table: s.tabla }, (p) => {
          buffer.push({ tabla: s.tabla, tipo: p?.eventType, fila: resumirFila(p?.new), viejo: resumirFila(p?.old), ms: Date.now() });
        })
        .subscribe((estado, err) => {
          if (estado === "SUBSCRIBED") fin("SUBSCRIBED");
          else if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED") fin(estado, err?.message ?? estado);
        });
    } catch (e) { fin("CHANNEL_ERROR", e?.message ?? "error al suscribir"); }
  });
}

// ── Limpieza: SOLO filas con el marcador exacto ─────────────────────────────────────────────────────────────────────────
/** DELETE con filtros obligatorios. Rechaza (sin tocar la base) cualquier borrado que no incluya el marcador exacto. Nunca TRUNCATE. */
export async function borrarConMarcador(svc, tabla, filtros, marca) {
  const valido = Array.isArray(filtros) && filtros.length >= 1 && typeof marca?.valor === "string" && marca.valor.startsWith(PREFIJO_MARCADOR)
    && RUN_ID_RE.test(marca.valor.slice(PREFIJO_MARCADOR.length)) && filtros.some(([c, v]) => c === marca.col && v === marca.valor);
  if (!valido) throw new Error("borrado rechazado: falta el filtro con el marcador exacto de la corrida");
  let q = svc.from(tabla).delete({ count: "exact" });
  for (const [c, v] of filtros) q = q.eq(c, v);
  return q;
}

/**
 * Borra los objetos creados por ESTA corrida (por marcador exacto; no depende de ids recordados) y verifica que no queden.
 * Orden: mensajes → cargas (las paradas caen por ON DELETE CASCADE) → usuario marcado. service_role solo para esto.
 */
export async function limpiarPorMarcador(svc, runId, { log = () => {}, redact = (x) => x } = {}) {
  const marcador = marcadorDe(runId), email = emailDe(runId);
  const rep = { ok: false, borrados: { mensajes: 0, cargas: 0, usuarios: 0 }, omitidos: [], errores: [], restos: [] };
  const err = (que, r) => rep.errores.push(`${que}: ${redact(String(r?.error?.code ?? "")).slice(0, 20)} ${redact(String(r?.error?.message ?? "sin detalle")).slice(0, 100)}`.trim());
  try {
    // mensajes (sin FK)
    const m = await borrarConMarcador(svc, "mensajes_viaje", [["mensaje", marcador]], { col: "mensaje", valor: marcador });
    if (m.error) err("mensajes_viaje", m); else rep.borrados.mensajes = m.count ?? 0;
    // cargas: se listan por marcador exacto y se borra cada una por (id + marcador)
    const c = await svc.from("cargas").select("id, detalles").eq("detalles", marcador);
    if (c.error) err("cargas (búsqueda)", c);
    else for (const f of c.data ?? []) {
      if (f.detalles !== marcador) { rep.omitidos.push(`carga ${f.id}: sin marcador exacto`); continue; }
      const d = await borrarConMarcador(svc, "cargas", [["id", f.id], ["detalles", marcador]], { col: "detalles", valor: marcador });
      if (d.error) err(`carga ${f.id}`, d); else rep.borrados.cargas += d.count ?? 0;
    }
    // usuario marcado: nombre = marcador Y email del run
    const u = await svc.from("usuarios").select("id, nombre, email").eq("nombre", marcador);
    if (u.error) err("usuarios (búsqueda)", u);
    else for (const f of u.data ?? []) {
      if (f.nombre !== marcador || f.email !== email) { rep.omitidos.push(`usuario ${f.id}: sin marcador/email exactos`); continue; }
      const d = await borrarConMarcador(svc, "usuarios", [["id", f.id], ["nombre", marcador]], { col: "nombre", valor: marcador });
      if (d.error) err(`usuario ${f.id}`, d); else rep.borrados.usuarios += d.count ?? 0;
    }
    // verificación: nada con el marcador
    for (const [tabla, col, etiqueta] of [["cargas", "detalles", "cargas"], ["mensajes_viaje", "mensaje", "mensajes_viaje"], ["usuarios", "nombre", "usuarios"]]) {
      const v = await svc.from(tabla).select("id").eq(col, marcador);
      if (v.error) { err(`verificación ${etiqueta}`, v); continue; }
      for (const f of v.data ?? []) rep.restos.push(`${etiqueta}:${f.id}`);
    }
  } catch (e) { rep.errores.push(redact(String(e?.message ?? e)).slice(0, 120)); }
  rep.ok = rep.errores.length === 0 && rep.restos.length === 0;
  log(`limpieza (${marcador}): borrados ${JSON.stringify(rep.borrados)} · omitidos ${rep.omitidos.length} · restos ${rep.restos.length} · errores ${rep.errores.length} → ${rep.ok ? "OK" : "INCOMPLETA"}`);
  for (const o of rep.omitidos) log(`  omitido: ${o}`);
  for (const r of rep.restos) log(`  RESTO (borrar a mano por marcador o con --limpiar-run=${runId}): ${r}`);
  for (const e of rep.errores) log(`  error: ${e}`);
  return rep;
}

// ── Corrida ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const OPC_CLIENTE = { auth: { persistSession: false, autoRefreshToken: false } };

export async function ejecutar(deps, cfg, opts = {}) {
  const T = { ...TIMEOUTS, ...(deps.timeouts ?? {}), ...(opts.espera ? { esperaEventoMs: opts.espera } : {}) };
  const runId = deps.runId ?? nuevoRunId();
  const marcador = marcadorDe(runId);
  const redact = (t) => redactar(t, [cfg.anon, cfg.service]);
  const log = (...p) => deps.out(redact(p.join(" ")));
  const t0 = Date.now();
  const rel = (ms) => `+${ms - t0} ms`; // tiempo relativo al inicio de la corrida (solo milisegundos: nada sensible)
  const pausar = deps.dormir ?? dormir; // inyectable para los tests; solo se usa en la pausa post-SUBSCRIBED
  const restante = () => T.totalMs - (Date.now() - t0);
  let abortado = false;
  const alSenal = () => { abortado = true; };
  const senales = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];
  for (const s of senales) deps.proceso?.on?.(s, alSenal);
  const paso = (que) => { if (abortado) throw new Inconcluso(`interrumpido antes de: ${que}`); if (restante() <= 0) throw new Inconcluso(`timeout total (${T.totalMs} ms) antes de: ${que}`); };
  const llamada = (p, que) => conTimeout(p, Math.min(T.llamadaMs, Math.max(restante(), 1)), que);

  const anon = deps.crearCliente(cfg.url, cfg.anon, OPC_CLIENTE);
  const ctl = deps.crearCliente(cfg.url, cfg.service, OPC_CLIENTE); // SOLO Realtime de control
  const svc = deps.crearCliente(cfg.url, cfg.service, OPC_CLIENTE); // SOLO fixtures / DELETE de R6 / limpieza
  const eventos = { anon: [], control: [] };
  const suscripciones = { anon: {}, control: {} };
  const acciones = [];
  let errorInterno = null; let inconcluso = null; let limpieza = null;
  const ctx = { cargaId: null, cargaDeleteId: null, usuarioId: null, choferId: null, enviadoMs: null };

  log(`REALTIME · run ${runId} · marcador ${marcador} · Supabase ${new URL(cfg.url).host}`);
  log("  claves: [CONFIGURADA] (anon y service_role; jamás se imprimen)");

  const delTipo = (quien, a, desde) => eventos[quien].slice(desde[quien]).filter((e) => e.tabla === a.tabla && e.tipo === a.tipo);
  const observar = (quien, a, pred, desde) => {
    const est = suscripciones[quien][a.tabla]?.estado;
    if (est !== "SUBSCRIBED") return { estado: ESTADOS_OBS.ERROR, n: 0 };
    const n = delTipo(quien, a, desde).filter(pred).length;
    return { estado: n > 0 ? ESTADOS_OBS.LLEGO : ESTADOS_OBS.NO_LLEGO, n };
  };
  /** ¿la fila del evento lleva el marcador de la corrida? "n/d" si el evento no trae ninguna columna donde iría (p. ej. DELETE, que solo trae la PK). */
  const conMarcador = (e) => {
    const vals = [e.fila.detalles, e.fila.mensaje, e.fila.nombre].filter((x) => x !== undefined);
    return vals.length === 0 ? "n/d" : vals.includes(marcador) ? "sí" : "no";
  };
  const registrar = (a, aplicada, motivoAplicacion, pred, desde = { anon: 0, control: 0 }, marcas = null) => {
    const oa = pred ? observar("anon", a, pred, desde) : { estado: ESTADOS_OBS.NO_LLEGO, n: 0 };
    const oc = pred ? observar("control", a, pred, desde) : { estado: ESTADOS_OBS.NO_LLEGO, n: 0 };
    const c = clasificarAccion({ aplicada, anon: oa.estado, control: oc.estado, tabla: a.tabla });
    const r = { id: a.id, titulo: a.titulo, tabla: a.tabla, tipo: a.tipo, aplicada, anon: oa.estado, control: oc.estado, n: { anon: oa.n, control: oc.n }, ...c, detalle: aplicada ? `eventos correlacionados: anon ${oa.n} · control ${oc.n}` : motivoAplicacion };
    acciones.push(r);
    log(`[${a.id}] ${a.titulo} → espera ${a.tabla}/${a.tipo}`);
    if (marcas) log(`     acción enviada ${rel(marcas.ini)} · respuesta ${rel(marcas.fin)}${aplicada ? "" : " (NO aplicada)"}`);
    log(`     anon: ${r.anon} · control: ${r.control} → ${r.clase}${r.bloquea ? " (bloquea)" : ""}`);
    log(`     ${r.motivo}${r.detalle ? " · " + r.detalle : ""}`);
    if (pred && marcas) {
      for (const quien of ["control", "anon"]) {
        for (const e of delTipo(quien, a, desde).filter(pred)) log(`     evento ${quien} ${e.tipo} id=${e.fila.id ?? e.viejo.id ?? "?"} marcador=${conMarcador(e)} ${rel(e.ms)} (${e.ms - marcas.fin >= 0 ? "+" : ""}${e.ms - marcas.fin} ms tras la respuesta)`);
      }
      const otros = { anon: delTipo("anon", a, desde).length - oa.n, control: delTipo("control", a, desde).length - oc.n };
      if (otros.anon > 0 || otros.control > 0) log(`     ${a.tabla}/${a.tipo} sin correlacionar con esta acción: anon ${otros.anon} · control ${otros.control}`);
    }
    return r;
  };
  /** Aplica la acción y observa durante la ventana; se corta antes si ambos ya recibieron. */
  const correr = async (a, aplicarFn, predFn) => {
    paso(a.id);
    let ap;
    const n0 = { anon: eventos.anon.length, control: eventos.control.length };
    const marcas = { ini: Date.now(), fin: 0 };
    try { ap = await aplicarFn(); } catch (e) { if (e instanceof Inconcluso) throw e; ap = { ok: false, motivo: `error al aplicar: ${redact(String(e?.message ?? e)).slice(0, 100)}` }; }
    marcas.fin = Date.now();
    if (!ap.ok) return registrar(a, false, ap.motivo, null, undefined, marcas);
    const pred = predFn();
    const ventana = Math.min(T.esperaEventoMs, Math.max(restante(), 0));
    const limite = Date.now() + ventana;
    const tiene = (q) => eventos[q].slice(n0[q]).some((e) => e.tabla === a.tabla && e.tipo === a.tipo && pred(e));
    while (Date.now() < limite && !abortado && !(tiene("anon") && tiene("control"))) await dormir(T.pollMs);
    // Una ventana cortada (señal o presupuesto total agotado) NO permite afirmar "no llegó": queda INCONCLUSO
    if (abortado) throw new Inconcluso(`interrumpido durante la ventana de ${a.id}`);
    if (ventana < T.esperaEventoMs && !(tiene("anon") && tiene("control"))) throw new Inconcluso(`timeout total durante la ventana de ${a.id}`);
    // La observación se restringe a lo llegado desde el inicio de la ventana de ESTA acción
    return registrar(a, true, undefined, pred, n0, marcas);
  };

  try {
    // ── 1) sesiones de la app (usuarios del seed) ───────────────────────────────────────────────────────────────────────
    paso("login");
    let cli, cho;
    try {
      cli = await llamada(deps.iniciarSesion(opts.base, "cliente1"), "login cliente1");
      cho = await llamada(deps.iniciarSesion(opts.base, "chofer2"), "login chofer2");
    } catch (e) { throw new Inconcluso(`no se pudo iniciar sesión en la app de staging (${redact(String(e?.message ?? e)).slice(0, 100)}): ¿está levantada y con el seed aplicado?`); }
    ctx.choferId = cho.id;

    // ── 2) fixtures ficticios y marcados (service_role; ANTES de suscribirse para no generar ruido) ─────────────────────────
    paso("fixtures");
    ctx.usuarioId = crypto.randomUUID();
    const iu = await llamada(svc.from("usuarios").insert({ id: ctx.usuarioId, nombre: marcador, email: emailDe(runId), rol: "chofer", eliminado: false, online: false }), "crear usuario marcado");
    if (iu.error) throw new Inconcluso(`no se pudo crear el usuario ficticio marcado (${redact(String(iu.error.message ?? "")).slice(0, 80)})`);
    const ic = await llamada(svc.from("cargas").insert({ detalles: marcador, estado: "pendiente", origen: "REALTIME-FICTICIO", destino: "REALTIME-FICTICIO" }).select("id").single(), "crear carga marcada");
    if (ic.error || !ic.data?.id) throw new Inconcluso(`no se pudo crear la carga ficticia marcada para R6 (${redact(String(ic.error?.message ?? "sin id")).slice(0, 80)})`);
    ctx.cargaDeleteId = ic.data.id;

    // ── 3) suscripciones: anon y control, en paralelo ───────────────────────────────────────────────────────────────────────
    paso("suscripciones");
    const pares = [];
    for (const s of SUSCRIPCIONES) {
      pares.push(suscribir(anon, "anon", s, eventos.anon, T, runId, redact).then((r) => { suscripciones.anon[s.tabla] = r; }));
      pares.push(suscribir(ctl, "control", s, eventos.control, T, runId, redact).then((r) => { suscripciones.control[s.tabla] = r; }));
    }
    await Promise.all(pares);
    for (const s of SUSCRIPCIONES) {
      const a = suscripciones.anon[s.tabla], c = suscripciones.control[s.tabla];
      log(`suscripción ${s.tabla.padEnd(15)} anon: ${a.estado}${a.detalle ? ` (${a.detalle})` : ""} · control: ${c.estado}${c.detalle ? ` (${c.detalle})` : ""} · resuelto anon ${rel(a.ms)} · control ${rel(c.ms)}`);
    }
    const controlListo = TABLAS_PUBLICADAS_ESPERADAS.every((t) => suscripciones.control[t]?.estado === "SUBSCRIBED");
    if (!controlListo) {
      log("⚠ el CONTROL POSITIVO no logró suscribirse a las tablas que deben estar publicadas: no se aplican acciones y no se saca ninguna conclusión sobre anon.");
      log("  (Causas posibles a revisar, sin asumir ninguna: Realtime deshabilitado, tabla fuera de la publicación, o la clave secret no aceptada por Realtime.)");
      for (const a of ACCIONES) registrar(a, false, "control positivo sin suscripción: la acción no se aplicó para no crear datos sin poder medirlos", null);
    } else {
      // ── 3b) pausa ÚNICA post-SUBSCRIBED ─────────────────────────────────────────────────────────────────────────────────────
      // Todas las suscripciones ya se resolvieron (Promise.all). El run 3460101e perdió el INSERT de R1 —la primera acción, aplicada apenas
      // después del SUBSCRIBED— mientras que R2–R6 sí llegaron; aislada con esta pausa, R1 llegó a los ~500 ms. Se espera UNA sola vez,
      // acá, antes de R1: R2–R6 no reciben esperas artificiales.
      log(`pausa post-SUBSCRIBED: ${T.esperaPostSuscripcionMs} ms (una sola vez, antes de R1) · desde ${rel(Date.now())}`);
      await pausar(T.esperaPostSuscripcionMs);
      log(`fin de la pausa post-SUBSCRIBED ${rel(Date.now())}`);
      // ── 4) acciones ──────────────────────────────────────────────────────────────────────────────────────────────────────────
      const ok2xx = (r) => r?.status >= 200 && r?.status < 300;
      const [R1, R2, R3, R4, R5, R6] = ACCIONES;
      await correr(R1, async () => {
        const r = await llamada(cli.api("POST", "/api/cargas/publicar", { origen: "Rosario, Santa Fe", destino: "Córdoba, Córdoba", tipo_vehiculo: "Utilitario", tipo_carroceria: "Furgón", categoria_legal: "N1", peso: "1 t", tipo_carga: "Carga común", detalles: marcador, km_estimados: 400, paradas_intermedias: [] }), "R1 publicar");
        ctx.cargaId = r.json?.carga?.id ?? null;
        return ok2xx(r) && ctx.cargaId != null ? { ok: true } : { ok: false, motivo: `la app respondió HTTP ${r.status ?? "?"} sin crear la carga` };
      }, () => (e) => mismoId(e.fila.id, ctx.cargaId) || e.fila.detalles === marcador);
      if (ctx.cargaId == null) {
        for (const a of [R2, R3, R4]) registrar(a, false, "depende de R1 (no se creó la carga marcada)", null);
      } else {
        await correr(R2, async () => { const r = await llamada(cho.api("POST", "/api/cargas/aceptar", { carga_id: ctx.cargaId }), "R2 aceptar"); return ok2xx(r) ? { ok: true } : { ok: false, motivo: `la app respondió HTTP ${r.status ?? "?"}` }; },
          () => (e) => mismoId(e.fila.id, ctx.cargaId) && mismoId(e.fila.chofer_id, ctx.choferId));
        await correr(R3, async () => { const r = await llamada(cli.api("POST", "/api/chat/mensaje", { viaje_id: ctx.cargaId, tipo_chat: "viaje", mensaje: marcador }), "R3 mensaje"); return ok2xx(r) ? { ok: true } : { ok: false, motivo: `la app respondió HTTP ${r.status ?? "?"}` }; },
          () => (e) => e.fila.mensaje === marcador);
        await correr(R4, async () => { const r = await llamada(cho.api("PATCH", "/api/cargas/gps", { carga_id: ctx.cargaId, ...GPS }), "R4 gps"); return ok2xx(r) ? { ok: true } : { ok: false, motivo: `la app respondió HTTP ${r.status ?? "?"}` }; },
          () => (e) => mismoId(e.fila.id, ctx.cargaId) && Number(e.fila.lat) === GPS.lat && Number(e.fila.lng) === GPS.lng);
      }
      // R5: por el CLIENTE supabase-js ANON (él arma apikey/Authorization según el tipo de clave); nada de headers manuales
      await correr(R5, async () => {
        ctx.enviadoMs = Date.now();
        const r = await llamada(anon.from("usuarios").update({ ultima_senal_at: new Date(ctx.enviadoMs).toISOString() }, { count: "exact" }).eq("id", ctx.usuarioId), "R5 latido");
        if (r.error) return { ok: false, motivo: `anon no pudo aplicar el UPDATE (${redact(String(r.error.code ?? "")).slice(0, 20)} ${redact(String(r.error.message ?? "")).slice(0, 80)})` };
        return r.count === 1 ? { ok: true } : { ok: false, motivo: `el UPDATE de anon afectó ${r.count ?? "?"} fila(s): no se aplicó` };
      }, () => (e) => mismoId(e.fila.id, ctx.usuarioId) && new Date(e.fila.ultima_senal_at).getTime() === ctx.enviadoMs);
      // R6: DELETE de la carga marcada por el control autorizado (service_role); se observa qué reciben anon y el control
      await correr(R6, async () => {
        const r = await llamada(borrarConMarcador(svc, "cargas", [["id", ctx.cargaDeleteId], ["detalles", marcador]], { col: "detalles", valor: marcador }), "R6 delete");
        if (r.error) return { ok: false, motivo: `no se pudo borrar la carga marcada (${redact(String(r.error.message ?? "")).slice(0, 80)})` };
        return r.count === 1 ? { ok: true } : { ok: false, motivo: `el DELETE afectó ${r.count ?? "?"} fila(s)` };
      }, () => (e) => mismoId(e.viejo.id, ctx.cargaDeleteId) || mismoId(e.fila.id, ctx.cargaDeleteId));
    }
  } catch (e) {
    if (e instanceof Inconcluso) { inconcluso = e.message; log(`INCONCLUSO: ${e.message}`); }
    else { errorInterno = redact(String(e?.message ?? e)).slice(0, 160); log(`ERROR INTERNO: ${errorInterno}`); }
  } finally {
    for (const s of senales) deps.proceso?.off?.(s, alSenal);
    // cerrar canales ANTES de limpiar (la limpieza no debe generar eventos observados)
    for (const c of [anon, ctl]) {
      try { await conTimeout(Promise.resolve(c.removeAllChannels?.()), T.llamadaMs, "cerrar canales"); } catch { /* ignorar */ }
      try { c.realtime?.disconnect?.(); } catch { /* ignorar */ }
    }
    try { limpieza = await conTimeout(limpiarPorMarcador(svc, runId, { log, redact }), T.limpiezaMs, "limpieza"); }
    catch (e) { limpieza = { ok: false, borrados: {}, omitidos: [], errores: [redact(String(e?.message ?? e)).slice(0, 100)], restos: ["desconocido (la limpieza no terminó: revisar con --limpiar-run=" + runId + ")"] }; log(`limpieza: ${limpieza.errores[0]}`); }
  }

  if (inconcluso || errorInterno) {
    for (const a of ACCIONES) if (!acciones.some((x) => x.id === a.id)) registrar(a, false, `no se ejecutó: ${inconcluso ?? "error interno"}`, null);
  }
  const res = resumir({ acciones, limpieza, errorInterno, esperado: opts.esperado ?? {}, interrupcionInconcluso: inconcluso });
  const controlValido = TABLAS_PUBLICADAS_ESPERADAS.every((t) => suscripciones.control[t]?.estado === "SUBSCRIBED")
    && acciones.filter((a) => TABLAS_PUBLICADAS_ESPERADAS.includes(a.tabla)).every((a) => a.control === ESTADOS_OBS.LLEGO);
  log("");
  log(`RESUMEN REALTIME (run ${runId})`);
  log(`  control positivo: ${controlValido ? "VÁLIDO (recibió los eventos de las tablas publicadas)" : "NO VÁLIDO o sin evidencia: nada de lo medido en anon es concluyente donde el control no recibió"}`);
  for (const a of acciones) log(`  ${a.id} ${a.titulo.padEnd(38)} anon: ${a.anon.padEnd(8)} control: ${a.control.padEnd(8)} → ${a.clase}`);
  log(`  acciones: ${acciones.length} · ANON RECIBE ${res.cuenta.RECIBE} · ANON NO RECIBE ${res.cuenta.NO_RECIBE} · INCONCLUSO ${res.cuenta.INCONCLUSO} (bloqueantes ${res.cuenta.bloqueantes})`);
  if (inconcluso) log(`  motivo de interrupción: ${inconcluso}`);
  if (errorInterno) log(`  error interno: ${errorInterno}`);
  for (const d of res.diferencias) log(`  DIFERENCIA con --esperado-anon → ${d}`);
  log(`  limpieza: ${limpieza?.ok ? "OK (0 restos)" : "INCOMPLETA (ver arriba)"}`);
  log(`  resultado: ${res.veredicto} → exit ${res.codigo}`);
  return { codigo: res.codigo, veredicto: res.veredicto, acciones, limpieza, runId };
}

// ── Punto de entrada (dependencias inyectadas) ──────────────────────────────────────────────────────────────────────────
export async function main(argv, deps) {
  const out = deps.out ?? console.log, err = deps.err ?? console.error;
  const a = parsearArgs(argv);
  if (a.errores.length) { for (const e of a.errores) err(`[uso] ${e}`); return 2; }
  if (a.ayuda || a.listar) { out(textoPlan()); return 0; } // ← nada más: ni env, ni red, ni suscripciones, ni limpieza

  const env = deps.env ?? {};
  const v = validarConfig(env);
  const errores = [...v.errores];
  if (!a.limpiarRun) {
    if (!a.base) errores.push("Falta --base=<URL de la app de staging> (las acciones R1–R4 pasan por la app).");
    else {
      try {
        const u = new URL(a.base);
        if (!/^https?:$/.test(u.protocol) || u.username || u.password) errores.push("--base debe ser una URL http(s) sin credenciales.");
        asegurarAppNoProduccion(a.base, { etiqueta: "--base", env: { TILA_ENTORNO: env.TILA_ENTORNO, TILA_STAGING_APP_HOSTS: env.TILA_STAGING_APP_HOSTS } });
      } catch (e) { errores.push(String(e.message)); }
    }
  }
  const secretos = [env.STAGING_ANON_KEY, env.STAGING_SERVICE_ROLE_KEY].filter((x) => typeof x === "string");
  if (errores.length) {
    err("[realtime] CONFIGURACIÓN RECHAZADA (no se abrió ninguna conexión):");
    for (const e of errores) err("  ✖ " + redactar(e, secretos));
    return 2;
  }
  const cfg = v.cfg;
  if (a.limpiarRun) {
    const svc = deps.crearCliente(cfg.url, cfg.service, OPC_CLIENTE);
    const T = { ...TIMEOUTS, ...(deps.timeouts ?? {}) };
    const log = (...p) => out(redactar(p.join(" "), secretos));
    log(`REALTIME · recuperación de la corrida ${a.limpiarRun} · Supabase ${new URL(cfg.url).host} · solo filas con ${marcadorDe(a.limpiarRun)}`);
    let rep;
    try { rep = await conTimeout(limpiarPorMarcador(svc, a.limpiarRun, { log, redact: (t) => redactar(t, secretos) }), T.limpiezaMs, "limpieza"); }
    catch (e) { err(`[realtime] ${redactar(String(e?.message ?? e), secretos)}`); return 1; }
    return rep.ok ? 0 : 1;
  }
  try {
    const r = await ejecutar(deps, cfg, { base: a.base, espera: a.espera, esperado: a.esperado });
    return r.codigo;
  } catch (e) { err(`[realtime] error inesperado: ${redactar(String(e?.message ?? e), secretos)}`); return 1; }
}

export function depsReales() {
  return { env: process.env, out: (l) => console.log(l), err: (l) => console.error(l), crearCliente: createClient, iniciarSesion, proceso: process };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("realtime.mjs")) {
  main(process.argv.slice(2), depsReales()).then((c) => { process.exitCode = c; setTimeout(() => process.exit(c), TIMEOUTS.salidaForzadaMs).unref(); }, // respaldo si un WebSocket queda abierto
   (e) => { console.error("[realtime] error inesperado:", redactar(e?.message ?? e)); process.exitCode = 1; });
}
