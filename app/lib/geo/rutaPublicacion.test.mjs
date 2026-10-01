import test from "node:test";
import assert from "node:assert/strict";
import {
  validarPuntosRuta, construirUrlRutaPublicacion, interpretarRutaPublicacion,
  obtenerRutaPublicacion, coordenadasVigentes, puntosDesdeParametros, MAXIMO_PUNTOS_RUTA,
} from "./rutaPublicacion.ts";

// ─── Fixtures con la forma real de Directions (json) ─────────────────────────
const leg = (metros, desde, hasta) => ({
  distance: { value: metros, text: `${metros / 1000} km` },
  start_location: desde,
  end_location: hasta,
});
const wp = (placeId, status = "OK") => ({ geocoder_status: status, place_id: placeId });

const ROSARIO = { lat: -32.9468, lng: -60.6393 };
const SAN_LORENZO = { lat: -32.7456, lng: -60.7355 };
const CORDOBA = { lat: -31.4201, lng: -64.1888 };

const simple = {
  status: "OK",
  geocoded_waypoints: [wp("PID_ROSARIO"), wp("PID_CORDOBA")],
  routes: [{ legs: [leg(399_400, ROSARIO, CORDOBA)] }],
};
const multietapa = {
  status: "OK",
  geocoded_waypoints: [wp("PID_ROSARIO"), wp("PID_SAN_LORENZO"), wp("PID_CORDOBA")],
  routes: [{ legs: [leg(25_100, ROSARIO, SAN_LORENZO), leg(380_000, SAN_LORENZO, CORDOBA)] }],
};

// ─── validarPuntosRuta ───────────────────────────────────────────────────────

test("validarPuntosRuta: 2 puntos válidos → recortados", () => {
  assert.deepEqual(validarPuntosRuta(["  Rosario ", "Córdoba"]), ["Rosario", "Córdoba"]);
});

test("validarPuntosRuta: menos de 2, más del máximo, vacíos o no-string → null", () => {
  assert.equal(validarPuntosRuta(["Rosario"]), null);
  assert.equal(validarPuntosRuta(Array.from({ length: MAXIMO_PUNTOS_RUTA + 1 }, (_, i) => `P${i}`)), null);
  assert.equal(validarPuntosRuta(["Rosario", "  "]), null);
  assert.equal(validarPuntosRuta(["Rosario", 5]), null);
  assert.equal(validarPuntosRuta("Rosario|Córdoba"), null);
});

test("validarPuntosRuta: exactamente el máximo (origen + 4 paradas + destino) → válido", () => {
  assert.equal(validarPuntosRuta(Array.from({ length: MAXIMO_PUNTOS_RUTA }, (_, i) => `P${i}`)).length, MAXIMO_PUNTOS_RUTA);
});

// ─── puntosDesdeParametros (query de /api/distancia) ─────────────────────────

const qs = (s) => new URLSearchParams(s);

test("puntosDesdeParametros: ?punto= repetido → todos los puntos en orden", () => {
  assert.deepEqual(puntosDesdeParametros(qs("punto=Rosario&punto=San%20Lorenzo&punto=C%C3%B3rdoba")), ["Rosario", "San Lorenzo", "Córdoba"]);
});

test("puntosDesdeParametros: formato simple anterior ?origen=&destino= sigue funcionando", () => {
  assert.deepEqual(puntosDesdeParametros(qs("origen=Rosario&destino=C%C3%B3rdoba")), ["Rosario", "Córdoba"]);
});

test("puntosDesdeParametros: ?punto= tiene prioridad sobre origen/destino", () => {
  assert.deepEqual(puntosDesdeParametros(qs("punto=A&punto=B&origen=X&destino=Y")), ["A", "B"]);
});

test("puntosDesdeParametros: sin puntos, o formato simple incompleto → lista vacía (validarPuntosRuta la rechaza)", () => {
  assert.deepEqual(puntosDesdeParametros(qs("")), []);
  assert.deepEqual(puntosDesdeParametros(qs("origen=Rosario")), []);
  assert.equal(validarPuntosRuta(puntosDesdeParametros(qs("origen=Rosario"))), null);
});

// ─── construirUrlRutaPublicacion ─────────────────────────────────────────────

test("URL simple: origin/destination con ', Argentina', sin waypoints", () => {
  const url = construirUrlRutaPublicacion(["Rosario", "Córdoba"], "KEY");
  const q = new URL(url).searchParams;
  assert.equal(q.get("origin"), "Rosario, Argentina");
  assert.equal(q.get("destination"), "Córdoba, Argentina");
  assert.equal(q.get("waypoints"), null);
  assert.equal(q.get("mode"), "driving");
  assert.equal(q.get("region"), "ar");
  assert.equal(q.get("key"), "KEY");
});

test("URL multietapa: paradas como waypoints en orden, separadas por |, sin optimize", () => {
  const url = construirUrlRutaPublicacion(["Rosario", "San Lorenzo", "Rafaela", "Córdoba"], "KEY");
  const q = new URL(url).searchParams;
  assert.equal(q.get("waypoints"), "San Lorenzo, Argentina|Rafaela, Argentina");
  assert.ok(!q.get("waypoints").includes("optimize"));
});

// ─── interpretarRutaPublicacion ──────────────────────────────────────────────

test("simple: km redondeado hacia arriba, place_id y coordenadas de origen y destino", () => {
  const r = interpretarRutaPublicacion(simple, 2);
  assert.equal(r.ok, true);
  assert.equal(r.kmTotal, 400); // 399,4 km → 400 (misma regla que la vista previa actual)
  assert.deepEqual(r.kmPorTramo, [400]);
  assert.deepEqual(r.puntos, [
    { ...ROSARIO, placeId: "PID_ROSARIO" },
    { ...CORDOBA, placeId: "PID_CORDOBA" },
  ]);
});

test("multietapa: cada tramo redondeado por separado y sumado; parada intermedia con sus coordenadas", () => {
  const r = interpretarRutaPublicacion(multietapa, 3);
  assert.equal(r.ok, true);
  assert.deepEqual(r.kmPorTramo, [26, 380]); // 25,1 → 26 ; 380,0 → 380
  assert.equal(r.kmTotal, 406);
  assert.deepEqual(r.puntos.map(p => p.placeId), ["PID_ROSARIO", "PID_SAN_LORENZO", "PID_CORDOBA"]);
  assert.deepEqual({ lat: r.puntos[1].lat, lng: r.puntos[1].lng }, SAN_LORENZO);
  assert.deepEqual({ lat: r.puntos[2].lat, lng: r.puntos[2].lng }, CORDOBA); // end_location del último tramo
});

test("status distinto de OK (NOT_FOUND / ZERO_RESULTS) → ok:false con motivo", () => {
  assert.deepEqual(interpretarRutaPublicacion({ status: "NOT_FOUND" }, 2), { ok: false, motivo: "directions_NOT_FOUND" });
  assert.deepEqual(interpretarRutaPublicacion({ status: "ZERO_RESULTS" }, 2), { ok: false, motivo: "directions_ZERO_RESULTS" });
  assert.equal(interpretarRutaPublicacion(null, 2).ok, false);
});

test("cantidad de tramos distinta de puntos − 1 → ok:false", () => {
  assert.deepEqual(interpretarRutaPublicacion(simple, 3), { ok: false, motivo: "tramos_inesperados" });
});

test("distancia faltante o negativa → ok:false; ruta de 0 km → ok:false", () => {
  const sinDistancia = { ...simple, routes: [{ legs: [{ start_location: ROSARIO, end_location: CORDOBA }] }] };
  assert.deepEqual(interpretarRutaPublicacion(sinDistancia, 2), { ok: false, motivo: "distancia_invalida" });
  const cero = { ...simple, routes: [{ legs: [leg(0, ROSARIO, ROSARIO)] }] };
  assert.deepEqual(interpretarRutaPublicacion(cero, 2), { ok: false, motivo: "distancia_cero" });
});

test("coordenadas faltantes o fuera de rango → ok:false (nunca se guardan coordenadas basura)", () => {
  const sinCoords = { ...simple, routes: [{ legs: [leg(1000, undefined, CORDOBA)] }] };
  assert.deepEqual(interpretarRutaPublicacion(sinCoords, 2), { ok: false, motivo: "coordenadas_invalidas" });
  const fueraDeRango = { ...simple, routes: [{ legs: [leg(1000, ROSARIO, { lat: 95, lng: 0 })] }] };
  assert.deepEqual(interpretarRutaPublicacion(fueraDeRango, 2), { ok: false, motivo: "coordenadas_invalidas" });
});

test("place_id faltante o con geocoder_status no OK → placeId null, la ruta sigue siendo válida", () => {
  const r = interpretarRutaPublicacion({ ...simple, geocoded_waypoints: [wp("PID_ROSARIO", "ZERO_RESULTS"), {}] }, 2);
  assert.equal(r.ok, true);
  assert.deepEqual(r.puntos.map(p => p.placeId), [null, null]);
  const sinWaypoints = interpretarRutaPublicacion({ status: "OK", routes: simple.routes }, 2);
  assert.equal(sinWaypoints.ok, true);
  assert.deepEqual(sinWaypoints.puntos.map(p => p.placeId), [null, null]);
});

// ─── obtenerRutaPublicacion (fetch inyectado, sin red) ───────────────────────

test("obtenerRutaPublicacion: UNA sola llamada con todos los puntos y devuelve la ruta interpretada", async () => {
  const urls = [];
  const fetchFalso = async (url) => { urls.push(url); return { json: async () => multietapa }; };
  const r = await obtenerRutaPublicacion(["Rosario", "San Lorenzo", "Córdoba"], "KEY", fetchFalso);
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0]).searchParams.get("waypoints"), "San Lorenzo, Argentina");
  assert.equal(r.ok, true);
  assert.equal(r.kmTotal, 406);
});

test("obtenerRutaPublicacion: puntos inválidos → no llama a Google", async () => {
  let llamadas = 0;
  const r = await obtenerRutaPublicacion(["Rosario"], "KEY", async () => { llamadas++; return { json: async () => simple }; });
  assert.deepEqual(r, { ok: false, motivo: "puntos_invalidos" });
  assert.equal(llamadas, 0);
});

test("obtenerRutaPublicacion: error de red o JSON inválido → ok:false, nunca lanza", async () => {
  assert.deepEqual(
    await obtenerRutaPublicacion(["Rosario", "Córdoba"], "KEY", async () => { throw new Error("ECONNRESET"); }),
    { ok: false, motivo: "error_red" },
  );
  assert.deepEqual(
    await obtenerRutaPublicacion(["Rosario", "Córdoba"], "KEY", async () => ({ json: async () => { throw new SyntaxError("bad"); } })),
    { ok: false, motivo: "error_red" },
  );
});

// ─── coordenadasVigentes ─────────────────────────────────────────────────────

const AHORA = new Date("2026-10-01T12:00:00Z");
const hace = (ms) => new Date(AHORA.getTime() - ms).toISOString();
const DIA = 24 * 60 * 60 * 1000;

test("coordenadasVigentes: obtenidas hace 1 día → vigentes (string ISO o Date)", () => {
  assert.equal(coordenadasVigentes(-32.9, -60.6, hace(DIA), AHORA), true);
  assert.equal(coordenadasVigentes(-32.9, -60.6, new Date(AHORA.getTime() - DIA), AHORA), true);
});

test("coordenadasVigentes: menos de 30 días → vigentes; 30 días exactos o más → vencidas", () => {
  assert.equal(coordenadasVigentes(-32.9, -60.6, hace(30 * DIA - 1), AHORA), true);
  assert.equal(coordenadasVigentes(-32.9, -60.6, hace(30 * DIA), AHORA), false);
  assert.equal(coordenadasVigentes(-32.9, -60.6, hace(45 * DIA), AHORA), false);
});

test("coordenadasVigentes: sin fecha, fecha inválida o coordenadas inválidas/null → no vigentes", () => {
  assert.equal(coordenadasVigentes(-32.9, -60.6, null, AHORA), false);
  assert.equal(coordenadasVigentes(-32.9, -60.6, undefined, AHORA), false);
  assert.equal(coordenadasVigentes(-32.9, -60.6, "no-es-fecha", AHORA), false);
  assert.equal(coordenadasVigentes(null, null, hace(DIA), AHORA), false);
  assert.equal(coordenadasVigentes(-95, -60.6, hace(DIA), AHORA), false);
  assert.equal(coordenadasVigentes("-32.9", "-60.6", hace(DIA), AHORA), false);
});

test("coordenadasVigentes: reloj levemente adelantado (≤5 min) se tolera; fecha muy futura → no vigente", () => {
  assert.equal(coordenadasVigentes(-32.9, -60.6, hace(-4 * 60 * 1000), AHORA), true);
  assert.equal(coordenadasVigentes(-32.9, -60.6, hace(-DIA), AHORA), false);
});
