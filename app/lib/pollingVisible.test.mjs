import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { iniciarPollingVisible, EVENTOS_ACTIVIDAD } from "./pollingVisible.ts";

const S = 1000, MIN = 60 * S;
const INTERVALO = 30 * S, INACTIVIDAD = 10 * MIN;

// ── Entorno falso: reloj, timers, document/window con listeners ─────────────────────────────
function entorno({ hidden = false } = {}) {
  let t = 0, sig = 1;
  const timers = new Map();
  const setT = (fn, ms) => { const id = sig++; timers.set(id, { at: t + ms, fn }); return id; };
  const clearT = (id) => { timers.delete(id); };
  const objetivo = () => {
    const m = new Map();
    return {
      m,
      addEventListener: (tipo, fn) => { if (!m.has(tipo)) m.set(tipo, new Set()); m.get(tipo).add(fn); },
      removeEventListener: (tipo, fn) => { m.get(tipo)?.delete(fn); },
    };
  };
  const doc = Object.assign(objetivo(), { hidden });
  const win = objetivo();
  const vaciar = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  const avanzar = async (ms) => {
    const fin = t + ms;
    for (;;) {
      const [prox] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at);
      if (!prox || prox[1].at > fin) break;
      t = prox[1].at;
      timers.delete(prox[0]);
      prox[1].fn();
      await vaciar();
    }
    t = fin;
    await vaciar();
  };
  const emitir = async (obj, tipo) => { for (const fn of [...(obj.m.get(tipo) ?? [])]) fn(); await vaciar(); };
  const listeners = () => [...doc.m.values(), ...win.m.values()].reduce((n, s) => n + s.size, 0);
  return { doc, win, setT, clearT, avanzar, emitir, vaciar, timers, listeners, ahora: () => t };
}

/** Tanda que cuenta llamadas y concurrencia; `duracionMs` la hace tardar (con el reloj falso). */
function tandaFalsa(env, { duracionMs = 0, falla = false } = {}) {
  const r = { llamadas: 0, enVuelo: 0, maxEnVuelo: 0, tiempos: [] };
  r.fn = () => {
    r.llamadas++; r.enVuelo++; r.maxEnVuelo = Math.max(r.maxEnVuelo, r.enVuelo); r.tiempos.push(env.ahora());
    const fin = () => { r.enVuelo--; };
    if (!duracionMs) { fin(); return falla ? Promise.reject(new Error("falla")) : Promise.resolve(); }
    return new Promise((res) => env.setT(() => { fin(); res(); }, duracionMs));
  };
  return r;
}

const iniciar = (env, tanda, extra = {}) => iniciarPollingVisible({
  tanda: tanda.fn, intervaloMs: INTERVALO, inactividadMs: INACTIVIDAD,
  doc: env.doc, win: env.win, ahora: env.ahora, setTimeoutFn: env.setT, clearTimeoutFn: env.clearT,
  alFallar: () => {}, ...extra,
});

test("visible y activo → una tanda cada 30 s (nada antes de los 30 s)", async () => {
  const env = entorno(); const tanda = tandaFalsa(env);
  iniciar(env, tanda);
  await env.avanzar(30 * S - 1);
  assert.equal(tanda.llamadas, 0);
  await env.avanzar(1);
  assert.equal(tanda.llamadas, 1);
  await env.avanzar(4 * MIN + 30 * S);
  assert.equal(tanda.llamadas, 10);
  assert.deepEqual(tanda.tiempos, [30, 60, 90, 120, 150, 180, 210, 240, 270, 300].map((s) => s * S));
});

test("pestaña oculta → cero polling periódico (desde el inicio o al ocultarse)", async () => {
  const oculto = entorno({ hidden: true }); const t1 = tandaFalsa(oculto);
  iniciar(oculto, t1);
  await oculto.avanzar(60 * MIN);
  assert.equal(t1.llamadas, 0);
  assert.equal(oculto.timers.size, 0, "no queda ningún timer programado");

  const env = entorno(); const t2 = tandaFalsa(env);
  iniciar(env, t2);
  await env.avanzar(45 * S);
  assert.equal(t2.llamadas, 1);
  env.doc.hidden = true; await env.emitir(env.doc, "visibilitychange");
  await env.avanzar(60 * MIN);
  assert.equal(t2.llamadas, 1, "oculta: ninguna tanda más");
  assert.equal(env.timers.size, 0);
});

test("volver a la pestaña → una tanda inmediata y después cada 30 s", async () => {
  const env = entorno(); const tanda = tandaFalsa(env);
  iniciar(env, tanda);
  env.doc.hidden = true; await env.emitir(env.doc, "visibilitychange");
  await env.avanzar(20 * MIN);
  assert.equal(tanda.llamadas, 0);
  env.doc.hidden = false; await env.emitir(env.doc, "visibilitychange");
  assert.equal(tanda.llamadas, 1, "una actualización inmediata");
  await env.avanzar(30 * S - 1);
  assert.equal(tanda.llamadas, 1, "una sola, no una ráfaga");
  await env.avanzar(1);
  assert.equal(tanda.llamadas, 2, "reanuda a los 30 s");
});

test("10 min sin actividad → el polling se detiene", async () => {
  const env = entorno(); const tanda = tandaFalsa(env);
  iniciar(env, tanda);
  await env.avanzar(INACTIVIDAD);
  assert.equal(tanda.llamadas, 19, "30 s … 9 min 30 s; a los 10 min ya no");
  await env.avanzar(2 * 60 * MIN);
  assert.equal(tanda.llamadas, 19);
  assert.equal(env.timers.size, 0, "no queda ningún timer programado");
});

test("con actividad del usuario el polling NO se detiene a los 10 min", async () => {
  const env = entorno(); const tanda = tandaFalsa(env);
  iniciar(env, tanda);
  for (let i = 0; i < 6; i++) { await env.avanzar(5 * MIN); await env.emitir(env.win, "pointermove"); }
  assert.equal(tanda.llamadas, 60, "30 min a 1 tanda cada 30 s");
});

test("nueva actividad tras la pausa por inactividad → una tanda inmediata y reanuda (cualquier evento de actividad)", async () => {
  for (const ev of EVENTOS_ACTIVIDAD) {
    const env = entorno(); const tanda = tandaFalsa(env);
    iniciar(env, tanda);
    await env.avanzar(30 * MIN);
    assert.equal(tanda.llamadas, 19);
    await env.emitir(env.win, ev);
    assert.equal(tanda.llamadas, 20, `${ev}: actualización inmediata`);
    await env.emitir(env.win, ev);
    assert.equal(tanda.llamadas, 20, `${ev}: más actividad no dispara más tandas inmediatas`);
    await env.avanzar(30 * S);
    assert.equal(tanda.llamadas, 21, `${ev}: reanuda a los 30 s`);
  }
});

test("volver a la pestaña Y volver de inactividad a la vez → exactamente UNA actualización, en cualquier orden de eventos", async () => {
  for (const orden of ["actividad-primero", "visibilidad-primero"]) {
    for (const duracionMs of [0, 5 * S]) { // tanda instantánea (el caso límite) y tanda lenta
      const env = entorno(); const tanda = tandaFalsa(env, { duracionMs });
      iniciar(env, tanda);
      await env.avanzar(30 * MIN);                         // pausado por inactividad (19 tandas)…
      env.doc.hidden = true; await env.emitir(env.doc, "visibilitychange"); // …y además oculto
      await env.avanzar(10 * MIN);
      const antes = tanda.llamadas;
      env.doc.hidden = false;                              // la pestaña ya se ve
      if (orden === "actividad-primero") {                 // el mouse llega antes que visibilitychange
        await env.emitir(env.win, "pointermove");
        await env.avanzar(duracionMs);
        await env.emitir(env.doc, "visibilitychange");
      } else {
        await env.emitir(env.doc, "visibilitychange");
        await env.avanzar(duracionMs);
        await env.emitir(env.win, "pointermove");
      }
      await env.emitir(env.win, "keydown");
      assert.equal(tanda.llamadas - antes, 1, `${orden}, tanda de ${duracionMs} ms: una sola actualización`);
      await env.avanzar(30 * S);
      assert.equal(tanda.llamadas - antes, 2, `${orden}: después, polling normal a los 30 s`);
      assert.equal(tanda.maxEnVuelo, 1);
    }
  }
});

test("pausa solo por pestaña oculta: si el mouse llega antes que visibilitychange, igual hay UNA sola actualización", async () => {
  const env = entorno(); const tanda = tandaFalsa(env);
  iniciar(env, tanda);
  await env.avanzar(45 * S);
  env.doc.hidden = true; await env.emitir(env.doc, "visibilitychange");
  await env.avanzar(5 * MIN);
  env.doc.hidden = false;
  await env.emitir(env.win, "pointermove");
  await env.emitir(env.doc, "visibilitychange");
  assert.equal(tanda.llamadas, 2, "1 tanda a los 30 s + 1 sola al volver");
  await env.avanzar(30 * S - 1);
  assert.equal(tanda.llamadas, 2);
  await env.avanzar(1);
  assert.equal(tanda.llamadas, 3);
});

test("actividad normal (sin pausa) no dispara actualizaciones extra", async () => {
  const env = entorno(); const tanda = tandaFalsa(env);
  iniciar(env, tanda);
  for (let i = 0; i < 20; i++) { await env.avanzar(1 * S); await env.emitir(env.win, "pointermove"); }
  assert.equal(tanda.llamadas, 0, "en los primeros 20 s con actividad: ninguna tanda");
  await env.avanzar(10 * S);
  assert.equal(tanda.llamadas, 1);
});

test("actividad con la pestaña oculta no dispara tandas", async () => {
  const env = entorno(); const tanda = tandaFalsa(env);
  iniciar(env, tanda);
  await env.avanzar(30 * MIN);
  env.doc.hidden = true; await env.emitir(env.doc, "visibilitychange");
  await env.emitir(env.win, "keydown");
  assert.equal(tanda.llamadas, 19);
});

test("nunca hay dos tandas simultáneas (tandas lentas, eventos durante una tanda, carga inicial en curso)", async () => {
  // Tanda de 45 s: el intervalo se cuenta desde que termina → 30, 105, 180, …
  const env = entorno(); const tanda = tandaFalsa(env, { duracionMs: 45 * S });
  iniciar(env, tanda);
  await env.avanzar(31 * S);
  assert.equal(tanda.enVuelo, 1);
  env.doc.hidden = true; await env.emitir(env.doc, "visibilitychange");
  env.doc.hidden = false; await env.emitir(env.doc, "visibilitychange");
  await env.emitir(env.win, "pointerdown");
  assert.equal(tanda.llamadas, 1, "volver a la pestaña durante una tanda no lanza otra");
  await env.avanzar(5 * MIN);
  assert.equal(tanda.maxEnVuelo, 1);
  assert.deepEqual(tanda.tiempos.slice(0, 3), [30 * S, 105 * S, 180 * S]);

  // Carga inicial de 50 s: el primer tick (30 s) la espera en lugar de lanzar una tanda.
  const env2 = entorno(); const t2 = tandaFalsa(env2);
  let resolverInicial;
  const inicial = new Promise((r) => { resolverInicial = r; });
  env2.setT(() => resolverInicial(), 50 * S);
  iniciar(env2, t2, { enCursoInicial: inicial });
  await env2.avanzar(50 * S);
  assert.equal(t2.llamadas, 0, "sin tanda mientras corre la carga inicial");
  await env2.avanzar(30 * S);
  assert.equal(t2.llamadas, 1);
  assert.deepEqual(t2.tiempos, [80 * S]);
});

test("una tanda que falla no detiene el polling", async () => {
  const env = entorno(); const tanda = tandaFalsa(env, { falla: true });
  iniciar(env, tanda);
  await env.avanzar(2 * MIN);
  assert.equal(tanda.llamadas, 4);
});

test("detener() limpia timer y todos los listeners; nada corre después (ni al terminar una tanda en vuelo)", async () => {
  const env = entorno(); const tanda = tandaFalsa(env, { duracionMs: 10 * S });
  const p = iniciar(env, tanda);
  assert.equal(env.listeners(), 1 + EVENTOS_ACTIVIDAD.length, "visibilitychange + eventos de actividad");
  await env.avanzar(35 * S);
  assert.equal(tanda.enVuelo, 1);
  p.detener();
  assert.equal(env.listeners(), 0);
  await env.avanzar(60 * MIN);
  assert.equal(tanda.llamadas, 1);
  assert.equal(env.timers.size, 0, "tras la tanda en vuelo no se programa otra");
  await env.emitir(env.doc, "visibilitychange");
  await env.emitir(env.win, "pointerdown");
  assert.equal(tanda.llamadas, 1);
});

// ── Panel admin: integración (verificación estática del componente) ─────────────────────────
const admin = readFileSync(fileURLToPath(new URL("../admin/page.tsx", import.meta.url)), "utf8");
const inicioEfecto = admin.indexOf("// ── Canal principal: cargas/usuarios/paradas/resumen mensajes");
const efecto = admin.slice(inicioEfecto, admin.indexOf("}, [cargarViajes, cargarUsuarios, cargarResumenMensajes]);", inicioEfecto));

test("admin: conserva la carga inicial (los 3 loaders, con setCargando) y la pasa como tanda en curso", () => {
  assert.ok(inicioEfecto > 0 && efecto.length > 0);
  assert.match(efecto, /setCargando\(true\);\s*try \{ await Promise\.all\(\[cargarViajes\(\), cargarUsuarios\(\), cargarResumenMensajes\(\)\]\); \}/);
  assert.match(efecto, /finally \{ if \(montadoRef\.current\) setCargando\(false\); \}/);
  assert.match(efecto, /const cargaInicial = iniciar\(\);/);
  assert.match(efecto, /enCursoInicial: cargaInicial/);
});

test("admin: Realtime intacto (mismo canal, mismas 4 tablas y callbacks) y se cierra al desmontar", () => {
  assert.match(efecto, /supabase\.channel\("admin-realtime"\)/);
  const suscripciones = [...efecto.matchAll(/table: "(\w+)" \},\s*\(\) => (\w+)\(\)\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(suscripciones, [
    ["cargas", "cargarViajes"], ["usuarios", "cargarUsuarios"], ["paradas_viaje", "cargarViajes"], ["mensajes_viaje", "cargarResumenMensajes"],
  ]);
  assert.match(efecto, /\.subscribe\(\);/);
  const cleanup = efecto.slice(efecto.lastIndexOf("return () => {"));
  assert.match(cleanup, /supabase\.removeChannel\(channel\);/);
  assert.match(cleanup, /polling\.detener\(\);/);
});

// Cuerpo de un loader del panel: desde `const <nombre> = useCallback(async () => {` hasta su `}, []);`.
const loader = (nombre) => {
  const i = admin.indexOf(`const ${nombre} = useCallback(async () => {`);
  assert.ok(i > 0, `existe ${nombre}`);
  return admin.slice(i, admin.indexOf("\n  }, []);", i));
};

test("admin: tras el unmount ninguna respuesta en vuelo actualiza estado (cada setState posterior a un await está protegido)", () => {
  for (const nombre of ["cargarResumenMensajes", "cargarViajes", "cargarUsuarios"]) {
    let protegido = true, setters = 0;
    for (const linea of loader(nombre).split(/\r?\n/)) {
      if (/\bawait\b/.test(linea)) protegido = false;
      if (/if \(!montadoRef\.current\) return;/.test(linea)) protegido = true;
      for (const m of linea.matchAll(/\b(set[A-Z]\w*)\(/g)) {
        if (m[1] === "setTimeout") continue;
        setters++;
        assert.ok(protegido, `${nombre}: ${m[1]} se llama después de un await sin chequear montadoRef`);
      }
    }
    assert.ok(setters > 0, `${nombre} actualiza estado`);
  }
});

test("admin: el efecto marca montado/desmontado, protege setCargando y limpia el timer de la alerta", () => {
  assert.match(admin, /const montadoRef = useRef\(true\);/);
  assert.match(efecto, /useEffect\(\(\) => \{\s*montadoRef\.current = true;/);
  assert.match(efecto, /finally \{ if \(montadoRef\.current\) setCargando\(false\); \}/);
  const cleanup = efecto.slice(efecto.lastIndexOf("return () => {"));
  assert.match(cleanup, /^return \(\) => \{\s*montadoRef\.current = false;/, "lo primero del cleanup es marcar desmontado");
  assert.match(cleanup, /if \(alertaAdminTimerRef\.current\) clearTimeout\(alertaAdminTimerRef\.current\);/);
});

test("admin: polling 30 s / inactividad 10 min con pollingVisible; ya no hay setInterval de 5 s", () => {
  assert.match(admin, /const INTERVALO_POLLING_ADMIN_MS = 30 \* 1000;/);
  assert.match(admin, /const INACTIVIDAD_POLLING_ADMIN_MS = 10 \* 60 \* 1000;/);
  assert.match(efecto, /iniciarPollingVisible\(\{[\s\S]*tanda: \(\) => Promise\.all\(\[cargarViajes\(\), cargarUsuarios\(\), cargarResumenMensajes\(\)\]\)/);
  assert.match(efecto, /doc: document,\s*win: window,/);
  assert.doesNotMatch(efecto, /setInterval|5000/);
  assert.doesNotMatch(admin, /setInterval\(/, "el panel admin no usa ningún setInterval");
});

test("admin: las recargas explícitas tras acciones administrativas siguen igual", () => {
  assert.equal((admin.match(/await cargarUsuarios\(\);/g) ?? []).length, 5);
  assert.equal((admin.match(/await cargarViajes\(\);/g) ?? []).length, 2);
  assert.match(admin, /onRecargar=\{cargarViajes\}/);
});
