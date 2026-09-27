import test from "node:test";
import assert from "node:assert/strict";
import { derivarEstadoCercanas, aplicarRespuestaCercanas } from "./estadoCalculoCercanas.ts";
import { pasoAlarmaCercanas } from "./detectarNuevasCercanas.ts";
import { crearCoordinadorCalculo } from "./coordinadorCalculo.ts";
import { filtrarCercanas } from "./filtrarCercanas.ts";

// ═══════════════ CARRERA 1 — baseline con la lista inicial real ═══════════════

/** Simula el efecto de alarma de panel-chofer a lo largo de varios renders. */
function simuladorAlarma() {
  let vistos = new Set();
  let baselineHecho = false;
  const sonadas = [];
  return {
    render({ estado, idsCercanas }) {
      const paso = pasoAlarmaCercanas({ online: true, estado, idsActuales: idsCercanas, vistos, baselineHecho });
      if (!paso) return;
      vistos = paso.vistos;
      baselineHecho = paso.baselineHecho;
      sonadas.push(...paso.nuevas);
    },
    get sonadas() { return sonadas; },
    get baselineHecho() { return baselineHecho; },
  };
}

test("CARRERA 1: GPS llega primero, después la lista inicial con cargas cercanas → NO suena", () => {
  const alarma = simuladorAlarma();

  // t1: GPS ok, cargarCargas() todavía no respondió (cargas = [], listaCargada = false).
  // Antes del fix el hook marcaba primeraRespuestaLlegada=true → "listo" con [] → baseline vacío.
  const e1 = derivarEstadoCercanas("ok", false, false, /*primeraRespuesta*/ true, /*listaCargada*/ false);
  assert.equal(e1, "calculando", "sin lista inicial nunca se llega a 'listo', aunque haya respuesta previa");
  alarma.render({ estado: e1, idsCercanas: [] });
  assert.equal(alarma.baselineHecho, false, "no se arma el baseline con una lista que todavía no llegó");

  // t2: llega la lista inicial [1, 2] — cálculo de distancias en curso.
  const e2 = derivarEstadoCercanas("ok", false, true, false, true);
  assert.equal(e2, "calculando");
  alarma.render({ estado: e2, idsCercanas: [] });

  // t3: llega el cálculo: 1 y 2 están dentro de 35 km → primera resolución real = baseline.
  const s = aplicarRespuestaCercanas({ ok: true, resultados: { 1: { estado: "ok", dentroRadioInicial: true }, 2: { estado: "ok", dentroRadioInicial: true } } });
  const e3 = derivarEstadoCercanas("ok", s.errorCalculo, false, true, true);
  assert.equal(e3, "listo");
  alarma.render({ estado: e3, idsCercanas: filtrarCercanas([{ id: 1 }, { id: 2 }], true, s.distancias).map(c => String(c.id)) });

  assert.deepEqual(alarma.sonadas, [], "las cargas que ya existían NO suenan");
  assert.equal(alarma.baselineHecho, true);
});

test("CARRERA 1: después del baseline, una carga NUEVA cercana SÍ suena (y una lejana no)", () => {
  const alarma = simuladorAlarma();
  alarma.render({ estado: "listo", idsCercanas: ["1", "2"] }); // baseline
  // Llega la 3 (lejana → filtrarCercanas la excluye) y la 4 (cercana).
  const s = aplicarRespuestaCercanas({ ok: true, resultados: {
    1: { estado: "ok", dentroRadioInicial: true }, 2: { estado: "ok", dentroRadioInicial: true },
    3: { estado: "ok", dentroRadioInicial: false }, 4: { estado: "ok", dentroRadioInicial: true },
  } });
  const ids = filtrarCercanas([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], true, s.distancias).map(c => String(c.id));
  alarma.render({ estado: "listo", idsCercanas: ids });
  assert.deepEqual(alarma.sonadas, ["4"]);
});

test("CARRERA 1: la lista inicial cargada y realmente vacía sí resuelve (baseline vacío), y la primera carga nueva suena", () => {
  const alarma = simuladorAlarma();
  const e = derivarEstadoCercanas("ok", false, false, true, true);
  assert.equal(e, "listo");
  alarma.render({ estado: e, idsCercanas: [] });
  assert.equal(alarma.baselineHecho, true);
  alarma.render({ estado: "listo", idsCercanas: ["9"] });
  assert.deepEqual(alarma.sonadas, ["9"]);
});

test("pasoAlarmaCercanas: offline o estado distinto de 'listo' → no evalúa nada", () => {
  for (const estado of ["sin_gps", "gps_error", "error_calculo", "calculando"]) {
    assert.equal(pasoAlarmaCercanas({ online: true, estado, idsActuales: ["1"], vistos: new Set(), baselineHecho: true }), null);
  }
  assert.equal(pasoAlarmaCercanas({ online: false, estado: "listo", idsActuales: ["1"], vistos: new Set(), baselineHecho: true }), null);
});

// ═══════════════ CARRERA 2 — recálculo pendiente, sin requests paralelos ═══════════════

function diferido() {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
}

test("CARRERA 2: request A en curso, entra B → queda pendiente, termina A, se recalcula y B queda visible", async () => {
  let cargasActuales = [{ id: 1 }];          // lo que el hook tiene en cargasRef
  const pedidos = [];                         // ids con que se llamó al endpoint
  const respuestas = [];                      // diferidos, uno por request
  let enVueloAhora = 0, maxEnVuelo = 0;
  let distancias = {};

  const coord = crearCoordinadorCalculo(async () => {
    const ids = cargasActuales.map(c => c.id); // se leen AL CORRER, no al pedir
    enVueloAhora++; maxEnVuelo = Math.max(maxEnVuelo, enVueloAhora);
    pedidos.push(ids);
    const d = diferido(); respuestas.push(d);
    const resultados = await d.promesa;
    enVueloAhora--;
    distancias = aplicarRespuestaCercanas({ ok: true, resultados }).distancias;
  });

  // A: arranca el request con [1]
  const ciclo = coord.solicitar();
  assert.equal(coord.enVuelo, true);
  assert.deepEqual(pedidos, [[1]]);

  // Entra la carga B (id 2) mientras A sigue en vuelo → queda pendiente, sin request nuevo
  cargasActuales = [{ id: 1 }, { id: 2 }];
  await coord.solicitar();
  assert.equal(coord.recalculoPendiente, true, "B queda marcada pendiente");
  assert.equal(pedidos.length, 1, "no se lanzó un request paralelo");

  // Termina A (sólo conoce la carga 1)
  respuestas[0].resolver({ 1: { estado: "ok", dentroRadioInicial: true } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(pedidos, [[1], [1, 2]], "al terminar A se ejecuta el recálculo con el conjunto más reciente");
  assert.equal(coord.recalculoPendiente, false);

  // Termina el recálculo: B está a <=35 km
  respuestas[1].resolver({ 1: { estado: "ok", dentroRadioInicial: true }, 2: { estado: "ok", dentroRadioInicial: true } });
  await ciclo;
  assert.equal(coord.enVuelo, false);
  assert.equal(maxEnVuelo, 1, "nunca hubo dos requests en paralelo");
  assert.deepEqual(filtrarCercanas(cargasActuales, true, distancias).map(c => c.id), [1, 2], "B evaluada y visible");
});

test("CARRERA 2: varios cambios durante el vuelo → UN solo recálculo extra, con el último conjunto", async () => {
  let ids = [1];
  const pedidos = [];
  const respuestas = [];
  const coord = crearCoordinadorCalculo(async () => {
    pedidos.push([...ids]);
    const d = diferido(); respuestas.push(d);
    await d.promesa;
  });
  const ciclo = coord.solicitar();
  ids = [1, 2]; await coord.solicitar();
  ids = [1, 2, 3]; await coord.solicitar();
  respuestas[0].resolver();
  await new Promise((r) => setImmediate(r));
  respuestas[1].resolver();
  await ciclo;
  assert.deepEqual(pedidos, [[1], [1, 2, 3]]);
});

test("CARRERA 2: si el cálculo lanza, el coordinador no queda trabado y el pendiente igual corre", async () => {
  let n = 0;
  const pedidos = [];
  let d0;
  const coord = crearCoordinadorCalculo(async () => {
    n++; pedidos.push(n);
    if (n === 1) { d0 = diferido(); await d0.promesa; throw new Error("boom"); }
  });
  const ciclo = coord.solicitar();
  await coord.solicitar(); // pendiente
  d0.resolver();
  await ciclo;
  assert.deepEqual(pedidos, [1, 2]);
  assert.equal(coord.enVuelo, false);
  await coord.solicitar();
  assert.deepEqual(pedidos, [1, 2, 3], "después de un error se pueden seguir pidiendo cálculos");
});

test("CARRERA 2: sin vuelo en curso, pedir no deja nada pendiente", async () => {
  const coord = crearCoordinadorCalculo(async () => {});
  await coord.solicitar();
  assert.equal(coord.recalculoPendiente, false);
  assert.equal(coord.enVuelo, false);
});
