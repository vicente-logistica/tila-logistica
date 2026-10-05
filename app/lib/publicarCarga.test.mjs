import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { procesarPublicacion, BODY_JSON_INVALIDO } from "./publicarCargaServidor.ts";
import { interpretarRutaPublicacion } from "./geo/rutaPublicacion.ts";
import { cotizarCarga, camposEconomicosCarga } from "./cotizacion.ts";

// ─── Dobles ───────────────────────────────────────────────────────────────────

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const AHORA = new Date("2026-10-01T15:00:00.000Z");

/** Base falsa: usuarios, configuracion_plataforma, cargas (insert/delete) y paradas_viaje. */
function baseFalsa({ rol = "cliente", errorParadas = null, errorBorrado = null, errorCarga = null } = {}) {
  const estado = { cargas: [], paradas: [], borradas: [], insertsCargas: 0, insertsParadas: 0 };
  let siguienteId = 500;
  const db = {
    from(tabla) {
      if (tabla === "usuarios") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: CLIENTE, rol, eliminado: false, estado_aprobacion: "aprobado" }, error: null }) }) }) };
      }
      if (tabla === "configuracion_plataforma") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { comision_cliente_bp: 750, comision_chofer_bp: 750 }, error: null }) }) }) };
      }
      if (tabla === "cargas") {
        return {
          insert: (filas) => ({
            select: () => ({
              single: async () => {
                estado.insertsCargas++;
                if (errorCarga) return { data: null, error: errorCarga };
                const fila = { id: siguienteId++, ...filas[0] };
                estado.cargas.push(fila);
                return { data: fila, error: null };
              },
            }),
          }),
          delete: () => ({
            eq: async (col, valor) => {
              if (errorBorrado) return { error: errorBorrado };
              estado.borradas.push(valor);
              estado.cargas = estado.cargas.filter((c) => c[col] !== valor);
              return { error: null };
            },
          }),
        };
      }
      if (tabla === "paradas_viaje") {
        return {
          insert: async (filas) => {
            estado.insertsParadas++;
            if (errorParadas) return { error: errorParadas };
            estado.paradas.push(...filas);
            return { error: null };
          },
        };
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    },
  };
  return { db, estado };
}

// Respuestas de Directions con la forma real (pasan por el MISMO intérprete del helper).
const P = {
  Rosario:       { lat: -32.9468, lng: -60.6393, placeId: "PID_ROSARIO" },
  "San Lorenzo": { lat: -32.7456, lng: -60.7355, placeId: "PID_SAN_LORENZO" },
  Rafaela:       { lat: -31.2503, lng: -61.4867, placeId: "PID_RAFAELA" },
  Córdoba:       { lat: -31.4201, lng: -64.1888, placeId: "PID_CORDOBA" },
};
function respuestaDirections(direcciones, metrosPorTramo, { sinPlaceId = false } = {}) {
  const pts = direcciones.map((d) => P[d]);
  return {
    status: "OK",
    geocoded_waypoints: pts.map((p) => (sinPlaceId ? { geocoder_status: "OK" } : { geocoder_status: "OK", place_id: p.placeId })),
    routes: [{ legs: metrosPorTramo.map((m, i) => ({
      distance: { value: m },
      start_location: { lat: pts[i].lat, lng: pts[i].lng },
      end_location: { lat: pts[i + 1].lat, lng: pts[i + 1].lng },
    })) }],
  };
}
function rutaFalsa(metrosPorTramo, opciones) {
  const llamadas = [];
  const obtenerRuta = async (direcciones) => {
    llamadas.push(direcciones);
    return interpretarRutaPublicacion(respuestaDirections(direcciones, metrosPorTramo, opciones), direcciones.length);
  };
  return { obtenerRuta, llamadas };
}

const bodyBase = (extra = {}) => ({
  origen: "Rosario", destino: "Córdoba",
  tipo_vehiculo: "Furgón", tipo_carroceria: "Furgón", categoria_legal: "N1",
  peso: "500 kg", tipo_carga: "Carga común", detalles: "",
  km_estimados: 400, paradas_intermedias: [],
  ...extra,
});
const publicar = (deps, body, userId = CLIENTE) => procesarPublicacion({ ahora: () => AHORA, ...deps }, userId, body);

// ─── Publicación simple ───────────────────────────────────────────────────────

test("publicación simple: UNA ruta del servidor, km y tarifa del servidor, sin paradas_viaje", async () => {
  const { db, estado } = baseFalsa();
  const { obtenerRuta, llamadas } = rutaFalsa([399_400]); // 399,4 km → 400
  const r = await publicar({ db, obtenerRuta }, bodyBase());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(llamadas, [["Rosario", "Córdoba"]]);
  assert.equal(estado.cargas.length, 1);
  const c = estado.cargas[0];
  assert.equal(c.km_estimados, 400);
  const esperado = camposEconomicosCarga(cotizarCarga({ kmEstimados: 400, tipoVehiculo: "Furgón", tipoCarga: "Carga común", paradasIntermedias: [] }, { comisionClienteBp: 750, comisionChoferBp: 750 }));
  for (const campo of ["precio_base", "precio_cliente", "pago_chofer", "comision_plataforma"]) assert.equal(c[campo], esperado[campo]);
  assert.equal(c.estado, "pendiente");
  assert.equal(c.cliente_id, CLIENTE);
  assert.equal(estado.insertsParadas, 0); // simple: sin filas en paradas_viaje (igual que antes)
});

test("geografía guardada: place_id, lat/lng de origen y destino y geo_obtenido_at, todo de la ruta del servidor", async () => {
  const { db, estado } = baseFalsa();
  const { obtenerRuta } = rutaFalsa([399_400]);
  await publicar({ db, obtenerRuta }, bodyBase());
  const c = estado.cargas[0];
  assert.equal(c.origen_place_id, "PID_ROSARIO");
  assert.equal(c.origen_lat, P.Rosario.lat);
  assert.equal(c.origen_lng, P.Rosario.lng);
  assert.equal(c.destino_place_id, "PID_CORDOBA");
  assert.equal(c.destino_lat, P["Córdoba"].lat);
  assert.equal(c.destino_lng, P["Córdoba"].lng);
  assert.equal(c.geo_obtenido_at, AHORA.toISOString());
});

test("cargas.lat / cargas.lng (GPS del chofer) nunca se escriben al publicar", async () => {
  const { db, estado } = baseFalsa();
  const { obtenerRuta } = rutaFalsa([399_400]);
  await publicar({ db, obtenerRuta }, bodyBase({ lat: -10, lng: -20 })); // aunque el body los traiga
  const c = estado.cargas[0];
  assert.equal("lat" in c, false);
  assert.equal("lng" in c, false);
  // En el código: el INSERT de cargas no tiene ninguna clave lat:/lng: suelta (sólo origen_/destino_).
  const src = readFileSync(fileURLToPath(new URL("./publicarCargaServidor.ts", import.meta.url)), "utf8");
  const insertCargas = src.slice(src.indexOf('.from("cargas")'), src.indexOf(".select()"));
  assert.ok(insertCargas.includes("origen_lat:"));
  assert.doesNotMatch(insertCargas, /^\s*(lat|lng)\s*:/m); // claves del objeto (no comentarios)
});

test("place_id faltante (ruta válida según el helper) → se guarda NULL y la carga se crea igual", async () => {
  const { db, estado } = baseFalsa();
  const { obtenerRuta } = rutaFalsa([399_400], { sinPlaceId: true });
  const r = await publicar({ db, obtenerRuta }, bodyBase());
  assert.equal(r.status, 200);
  assert.equal(estado.cargas[0].origen_place_id, null);
  assert.equal(estado.cargas[0].destino_place_id, null);
  assert.equal(estado.cargas[0].origen_lat, P.Rosario.lat);
});

// ─── Publicación con paradas ──────────────────────────────────────────────────

test("con paradas: una ruta con todos los puntos, km sumados y paradas creadas en el servidor con su geografía", async () => {
  const { db, estado } = baseFalsa();
  const { obtenerRuta, llamadas } = rutaFalsa([25_100, 230_000, 180_000]); // 26 + 230 + 180 = 436
  const r = await publicar({ db, obtenerRuta }, bodyBase({ km_estimados: 436, paradas_intermedias: [" San Lorenzo ", "", "Rafaela"] }));
  assert.equal(r.status, 200);
  assert.deepEqual(llamadas, [["Rosario", "San Lorenzo", "Rafaela", "Córdoba"]]);
  const c = estado.cargas[0];
  assert.equal(c.km_estimados, 436);
  const esperado = camposEconomicosCarga(cotizarCarga({ kmEstimados: 436, tipoVehiculo: "Furgón", tipoCarga: "Carga común", paradasIntermedias: ["San Lorenzo", "Rafaela"] }, { comisionClienteBp: 750, comisionChoferBp: 750 }));
  assert.equal(c.precio_cliente, esperado.precio_cliente);
  assert.deepEqual(estado.paradas.map((p) => [p.carga_id, p.orden, p.tipo, p.direccion, p.estado]), [
    [c.id, 0, "retiro",  "Rosario",     "pendiente"],
    [c.id, 1, "parada",  "San Lorenzo", "pendiente"],
    [c.id, 2, "parada",  "Rafaela",     "pendiente"],
    [c.id, 3, "entrega", "Córdoba",     "pendiente"],
  ]);
  assert.deepEqual(estado.paradas.map((p) => [p.lat, p.lng, p.place_id, p.geo_obtenido_at]), [
    [P.Rosario.lat, P.Rosario.lng, "PID_ROSARIO", AHORA.toISOString()],
    [P["San Lorenzo"].lat, P["San Lorenzo"].lng, "PID_SAN_LORENZO", AHORA.toISOString()],
    [P.Rafaela.lat, P.Rafaela.lng, "PID_RAFAELA", AHORA.toISOString()],
    [P["Córdoba"].lat, P["Córdoba"].lng, "PID_CORDOBA", AHORA.toISOString()],
  ]);
  assert.equal(estado.insertsParadas, 1); // un único INSERT con todas las filas
});

test("más de 4 paradas o paradas no-texto → 400, sin llamar a Google ni crear nada", async () => {
  const { db, estado } = baseFalsa();
  const { obtenerRuta, llamadas } = rutaFalsa([1000]);
  assert.equal((await publicar({ db, obtenerRuta }, bodyBase({ paradas_intermedias: ["a", "b", "c", "d", "e"] }))).status, 400);
  assert.equal((await publicar({ db, obtenerRuta }, bodyBase({ paradas_intermedias: "a|b" }))).status, 400);
  assert.equal((await publicar({ db, obtenerRuta }, bodyBase({ paradas_intermedias: [1] }))).status, 400);
  assert.equal(llamadas.length, 0);
  assert.equal(estado.insertsCargas, 0);
});

// ─── 409 por km desactualizados/manipulados ───────────────────────────────────

test("km del cliente ≠ km del servidor → 409 con km y cotización del servidor, y NINGUNA carga creada", async () => {
  const { db, estado } = baseFalsa();
  const { obtenerRuta } = rutaFalsa([399_400]); // servidor: 400
  const r = await publicar({ db, obtenerRuta }, bodyBase({ km_estimados: 120 })); // manipulado / viejo
  assert.equal(r.status, 409);
  assert.equal(r.body.codigo, "KM_DESACTUALIZADOS");
  assert.equal(r.body.km_enviados, 120);
  assert.equal(r.body.km_estimados, 400);
  const esperado = camposEconomicosCarga(cotizarCarga({ kmEstimados: 400, tipoVehiculo: "Furgón", tipoCarga: "Carga común", paradasIntermedias: [] }, { comisionClienteBp: 750, comisionChoferBp: 750 }));
  assert.deepEqual(r.body.cotizacion, esperado);
  assert.match(r.body.error, /400 km/);
  assert.equal(estado.insertsCargas, 0);
  assert.equal(estado.insertsParadas, 0);
});

test("tras el 409, reenviar con los km del servidor → se publica", async () => {
  const { db, estado } = baseFalsa();
  const { obtenerRuta } = rutaFalsa([399_400]);
  const primero = await publicar({ db, obtenerRuta }, bodyBase({ km_estimados: 399 }));
  assert.equal(primero.status, 409);
  const segundo = await publicar({ db, obtenerRuta }, bodyBase({ km_estimados: primero.body.km_estimados }));
  assert.equal(segundo.status, 200);
  assert.equal(estado.cargas.length, 1);
});

// ─── Fallos ───────────────────────────────────────────────────────────────────

test("fallo de Google (ruta no válida) → 503 y no se crea la carga", async () => {
  const { db, estado } = baseFalsa();
  const obtenerRuta = async () => ({ ok: false, motivo: "directions_NOT_FOUND" });
  const r = await publicar({ db, obtenerRuta }, bodyBase());
  assert.equal(r.status, 503);
  assert.equal(r.body.motivo, "directions_NOT_FOUND");
  assert.equal(estado.insertsCargas, 0);
});

test("fallo al insertar paradas → se borra la carga recién creada (no queda publicación parcial) y 500", async () => {
  const { db, estado } = baseFalsa({ errorParadas: { message: "violates check constraint" } });
  const { obtenerRuta } = rutaFalsa([25_100, 380_000]);
  const r = await publicar({ db, obtenerRuta }, bodyBase({ km_estimados: 406, paradas_intermedias: ["San Lorenzo"] }));
  assert.equal(r.status, 500);
  assert.equal(estado.insertsCargas, 1);
  assert.equal(estado.borradas.length, 1);
  assert.equal(estado.cargas.length, 0); // la carga se compensó
  assert.equal(estado.paradas.length, 0);
});

test("si además falla la compensación → igual 500 (nunca se informa éxito con una carga incompleta)", async () => {
  const { db, estado } = baseFalsa({ errorParadas: { message: "x" }, errorBorrado: { message: "y" } });
  const { obtenerRuta } = rutaFalsa([25_100, 380_000]);
  const r = await publicar({ db, obtenerRuta }, bodyBase({ km_estimados: 406, paradas_intermedias: ["San Lorenzo"] }));
  assert.equal(r.status, 500);
  assert.notEqual(r.body.ok, true);
  assert.equal(estado.cargas.length, 1); // queda registrada en el log como COMPENSACION_FALLIDA
});

test("fallo al insertar la carga → 500, sin intentar paradas", async () => {
  const { db, estado } = baseFalsa({ errorCarga: { message: "column does not exist" } });
  const { obtenerRuta } = rutaFalsa([25_100, 380_000]);
  const r = await publicar({ db, obtenerRuta }, bodyBase({ km_estimados: 406, paradas_intermedias: ["San Lorenzo"] }));
  assert.equal(r.status, 500);
  assert.equal(estado.insertsParadas, 0);
});

// ─── Validaciones previas (sin llamar a Google) ───────────────────────────────

test("sin usuario, rol no cliente, body inválido o campos faltantes → error sin llamar a Google", async () => {
  const { obtenerRuta, llamadas } = rutaFalsa([399_400]);
  assert.equal((await publicar({ db: baseFalsa().db, obtenerRuta }, bodyBase(), null)).status, 401);
  assert.equal((await publicar({ db: baseFalsa({ rol: "chofer" }).db, obtenerRuta }, bodyBase())).status, 403);
  assert.deepEqual(await publicar({ db: baseFalsa().db, obtenerRuta }, BODY_JSON_INVALIDO), { status: 400, body: { error: "Body JSON inválido" } });
  assert.equal((await publicar({ db: baseFalsa().db, obtenerRuta }, bodyBase({ origen: "  " }))).status, 400);
  assert.equal((await publicar({ db: baseFalsa().db, obtenerRuta }, bodyBase({ tipo_vehiculo: "Avión" }))).status, 400);
  assert.equal((await publicar({ db: baseFalsa().db, obtenerRuta }, bodyBase({ km_estimados: 0 }))).status, 400);
  assert.equal(llamadas.length, 0);
});

// ─── Handler ──────────────────────────────────────────────────────────────────

test("el handler sólo conecta: helper de ruta del servidor + procesarPublicacion, sin INSERT propio", () => {
  const src = readFileSync(fileURLToPath(new URL("../api/cargas/publicar/route.ts", import.meta.url)), "utf8");
  assert.match(src, /obtenerRutaPublicacion\(direcciones, apiKey\)/);
  assert.match(src, /procesarPublicacion\(/);
  assert.doesNotMatch(src, /\.insert\(|\.from\("cargas"\)/);
});
