import test from "node:test";
import assert from "node:assert/strict";
import { derivarEstadoCercanas, aplicarRespuestaCercanas } from "./estadoCalculoCercanas.ts";
import { pasoAlarmaCercanas } from "./detectarNuevasCercanas.ts";
import { crearCoordinadorCalculo } from "./coordinadorCalculo.ts";
import { filtrarCercanas } from "./filtrarCercanas.ts";

// ═══════════════ ALARMA — cada carga cercana suena UNA vez por sesión online ═══════════════

/** Simula el efecto de alarma de panel-chofer a lo largo de varios renders. */
function simuladorAlarma() {
  let vistos = new Set();
  const sonadas = [];
  return {
    render({ estado, idsCercanas }) {
      const paso = pasoAlarmaCercanas({ online: true, estado, idsActuales: idsCercanas, vistos });
      if (!paso) return;
      vistos = paso.vistos;
      sonadas.push(...paso.nuevas);
    },
    get sonadas() { return sonadas; },
  };
}

const resolver = (mapa) => aplicarRespuestaCercanas({ ok: true, resultados: Object.fromEntries(
  Object.entries(mapa).map(([id, dentro]) => [id, { estado: "ok", dentroRadioInicial: dentro }])) });
const cercanas = (ids, distancias) => filtrarCercanas(ids.map(id => ({ id })), true, distancias).map(c => String(c.id));

test("ALARMA: carga cercana que ya existía al ponerse ONLINE → suena UNA vez, recién con el cálculo listo", () => {
  const alarma = simuladorAlarma();

  // t1: GPS ok, cargarCargas() todavía no respondió (listaCargada = false) → no se evalúa.
  const e1 = derivarEstadoCercanas("ok", false, false, /*primeraRespuesta*/ true, /*listaCargada*/ false);
  assert.equal(e1, "calculando", "sin lista inicial nunca se llega a 'listo'");
  alarma.render({ estado: e1, idsCercanas: [] });

  // t2: llega la lista inicial [1, 2] — cálculo de distancias en curso → todavía no suena.
  const e2 = derivarEstadoCercanas("ok", false, true, false, true);
  assert.equal(e2, "calculando");
  alarma.render({ estado: e2, idsCercanas: [] });
  assert.deepEqual(alarma.sonadas, []);

  // t3: llega el cálculo: 1 está dentro de 35 km, 2 está lejos.
  const s = resolver({ 1: true, 2: false });
  const e3 = derivarEstadoCercanas("ok", s.errorCalculo, false, true, true);
  assert.equal(e3, "listo");
  alarma.render({ estado: e3, idsCercanas: cercanas([1, 2], s.distancias) });
  assert.deepEqual(alarma.sonadas, ["1"], "la cercana existente suena; la lejana no");
});

test("ALARMA: el polling con las mismas cargas NO repite la alarma", () => {
  const alarma = simuladorAlarma();
  alarma.render({ estado: "listo", idsCercanas: ["1"] });
  for (let i = 0; i < 5; i++) alarma.render({ estado: "listo", idsCercanas: ["1"] });
  assert.deepEqual(alarma.sonadas, ["1"]);
});

test("ALARMA: una carga NUEVA cercana suena una vez; una nueva lejana nunca", () => {
  const alarma = simuladorAlarma();
  alarma.render({ estado: "listo", idsCercanas: ["1"] });
  const s = resolver({ 1: true, 3: false, 4: true });
  alarma.render({ estado: "listo", idsCercanas: cercanas([1, 3, 4], s.distancias) });
  alarma.render({ estado: "listo", idsCercanas: cercanas([1, 3, 4], s.distancias) }); // siguiente poll
  assert.deepEqual(alarma.sonadas, ["1", "4"]);
});

test("ALARMA: un error de cálculo intermedio no hace repetir la alarma al recuperarse", () => {
  const alarma = simuladorAlarma();
  alarma.render({ estado: "listo", idsCercanas: ["1"] });
  alarma.render({ estado: "error_calculo", idsCercanas: [] });
  alarma.render({ estado: "listo", idsCercanas: ["1"] });
  assert.deepEqual(alarma.sonadas, ["1"]);
});

test("pasoAlarmaCercanas: offline o estado distinto de 'listo' → no evalúa nada", () => {
  for (const estado of ["sin_gps", "gps_error", "error_calculo", "calculando"]) {
    assert.equal(pasoAlarmaCercanas({ online: true, estado, idsActuales: ["1"], vistos: new Set() }), null);
  }
  assert.equal(pasoAlarmaCercanas({ online: false, estado: "listo", idsActuales: ["1"], vistos: new Set() }), null);
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
