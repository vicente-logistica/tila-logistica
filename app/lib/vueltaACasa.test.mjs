import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodificarPolyline, distanciaAlCorredorKm, evaluarOportunidadVuelta, debeBuscarVuelta, esCompatibleVehiculo,
} from "./geo/vueltaACasa.ts";
import { procesarOportunidadesVuelta } from "./vueltaACasaServidor.ts";
import { leerConfiguracionOperativa, textoAKmEntero } from "./configuracionOperativa.ts";
import { procesarGetOperativa, procesarPutOperativa } from "./adminOperativa.ts";
import { leerRadioMatching } from "./configuracionRadio.ts";
import { distanciaHaversineKm } from "./geo/haversine.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = resolve(AQUI, "..");
const RAIZ_REPO = resolve(RAIZ_APP, "..");
const leer = (p) => readFileSync(join(RAIZ_APP, p), "utf8");
const silenciar = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

const CIUDAD = {
  "Buenos Aires":        { lat: -34.6037, lng: -58.3816 },
  "Jujuy":               { lat: -24.1858, lng: -65.2995 },
  "Tucumán":             { lat: -26.8083, lng: -65.2176 },
  "Santiago del Estero": { lat: -27.7834, lng: -64.2642 },
  "Córdoba":             { lat: -31.4201, lng: -64.1888 },
  "Rosario":             { lat: -32.9468, lng: -60.6393 },
  "La Quiaca":           { lat: -22.1053, lng: -65.5933 },
  "Mendoza":             { lat: -32.8895, lng: -68.8458 },
};
const BA = CIUDAD["Buenos Aires"], JUJUY = CIUDAD.Jujuy;

/** Corredor de regreso Jujuy → Buenos Aires simulando la ruta real (pasa por Tucumán). */
function densificar(puntos, pasos = 20) {
  const out = [];
  for (let i = 0; i < puntos.length - 1; i++) for (let k = 0; k < pasos; k++) {
    const t = k / pasos;
    out.push({ lat: puntos[i].lat + t * (puntos[i + 1].lat - puntos[i].lat), lng: puntos[i].lng + t * (puntos[i + 1].lng - puntos[i].lng) });
  }
  out.push(puntos[puntos.length - 1]);
  return out;
}
const CORREDOR_JUJUY_BA = densificar(["Jujuy", "Tucumán", "Santiago del Estero", "Córdoba", "Rosario", "Buenos Aires"].map((c) => CIUDAD[c]));
/** GPS a `km` al sur de Jujuy (para simular "faltan N km"). */
const aKmDeJujuy = (km) => ({ lat: JUJUY.lat - km / 111.19, lng: JUJUY.lng });

// ═══════════════ Lógica pura ═══════════════

test("decodificarPolyline: ejemplo oficial de Google", () => {
  const p = decodificarPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(p, [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]);
});

test("corredor: Tucumán está SOBRE la ruta Jujuy→BA aunque esté a ~290 km de Jujuy (y a ~150 km de la línea recta)", () => {
  assert.ok(distanciaHaversineKm(JUJUY, CIUDAD["Tucumán"]) > 250);
  assert.ok(distanciaAlCorredorKm(CIUDAD["Tucumán"], CORREDOR_JUJUY_BA) < 1);
  const recta = [JUJUY, BA];
  assert.ok(distanciaAlCorredorKm(CIUDAD["Tucumán"], recta) > 100, "por eso el corredor tiene que ser la ruta real");
  assert.ok(distanciaAlCorredorKm(CIUDAD.Mendoza, CORREDOR_JUJUY_BA) > 300, "Mendoza queda fuera del corredor");
});

test("reglas: D tiene que acercar a casa", () => {
  assert.ok(evaluarOportunidadVuelta(BA, JUJUY, CIUDAD["Tucumán"], BA, CORREDOR_JUJUY_BA, 35));
  assert.ok(evaluarOportunidadVuelta(BA, JUJUY, CIUDAD["Tucumán"], CIUDAD["Córdoba"], CORREDOR_JUJUY_BA, 35));
  assert.equal(evaluarOportunidadVuelta(BA, JUJUY, CIUDAD["Tucumán"], CIUDAD["La Quiaca"], CORREDOR_JUJUY_BA, 35), null);
  assert.equal(evaluarOportunidadVuelta(BA, JUJUY, CIUDAD.Mendoza, BA, CORREDOR_JUJUY_BA, 35), null, "C fuera del corredor");
});

test("activación: sólo cuando faltan ≤ inicio km y está habilitada", () => {
  assert.equal(debeBuscarVuelta(300, 150, true), false);
  assert.equal(debeBuscarVuelta(150, 150, true), true);
  assert.equal(debeBuscarVuelta(100, 150, true), true);
  assert.equal(debeBuscarVuelta(100, 150, false), false);
});

test("compatibilidad de vehículo: misma regla que el listado", () => {
  assert.equal(esCompatibleVehiculo({ tipo_vehiculo: "Camión tractor", categoria_legal: "N3" }, "Camión tractor", "N3"), true);
  assert.equal(esCompatibleVehiculo({ tipo_vehiculo: "Furgón" }, "Camión tractor", "N3"), false);
  assert.equal(esCompatibleVehiculo({ tipo_vehiculo: "Camión tractor" }, null, null), false);
});

// ═══════════════ Endpoint con base / geocoder / corredor falsos ═══════════════

function baseFalsa(tablas, { columnasFaltantes = [] } = {}) {
  const escrituras = [];
  const db = {
    from(tabla) {
      const filtros = []; let limite = Infinity, orden = null, columnas = "*", pendiente = null;
      const aplicar = () => {
        let filas = (tablas[tabla] ?? []).filter((f) => filtros.every(([op, c, v]) =>
          op === "eq" ? String(f[c]) === String(v) : op === "neq" ? String(f[c]) !== String(v)
          : op === "is" ? f[c] === v : op === "in" ? v.includes(f[c]) : true));
        if (orden) filas = [...filas].sort((a, b) => (a[orden.c] > b[orden.c] ? 1 : -1) * (orden.asc ? 1 : -1));
        return filas.slice(0, limite);
      };
      const falta = () => columnasFaltantes.find((c) => columnas.includes(c));
      const resultado = (unico) => {
        const f = falta();
        if (f) return { data: null, error: { code: "42703", message: `column ${tabla}.${f} does not exist` } };
        const filas = aplicar();
        return { data: unico ? filas[0] ?? null : filas, error: null };
      };
      const prohibido = (op) => () => { throw new Error(`ESCRITURA PROHIBIDA: ${op} sobre ${tabla}`); };
      const q = {
        select: (c) => { if (c) columnas = c; return q; },
        eq: (c, v) => { filtros.push(["eq", c, v]); return q; },
        neq: (c, v) => { filtros.push(["neq", c, v]); return q; },
        is: (c, v) => { filtros.push(["is", c, v]); return q; },
        in: (c, v) => { filtros.push(["in", c, v]); return q; },
        order: (c, o) => { orden = { c, asc: o?.ascending !== false }; return q; },
        limit: (n) => { limite = n; return q; },
        maybeSingle: async () => resultado(true),
        single: async () => {
          if (pendiente) { escrituras.push({ tabla, ...pendiente }); tablas[tabla][0] = { ...(tablas[tabla][0] ?? {}), ...pendiente.valores }; return { data: tablas[tabla][0], error: null }; }
          return resultado(true);
        },
        then: (res, rej) => Promise.resolve(resultado(false)).then(res, rej),
        upsert: tabla === "configuracion_plataforma" ? (valores) => { pendiente = { valores }; return q; } : prohibido("upsert"),
        update: prohibido("update"), insert: prohibido("insert"), delete: prohibido("delete"),
      };
      return q;
    },
    rpc: () => { throw new Error("ESCRITURA PROHIBIDA: rpc"); },
  };
  return { db, escrituras };
}

const CHOFER = "ch-1";
const tablasBase = ({ config = {}, cargasExtra = [] } = {}) => ({
  usuarios: [
    { id: CHOFER, rol: "chofer", eliminado: false, categoria_legal: "N3", vehiculo_activo_id: 6 },
    { id: "cl-1", rol: "cliente" },
    { id: "ad-1", rol: "admin", eliminado: false },
  ],
  vehiculos: [{ id: 6, tipo_vehiculo: "Camión tractor" }],
  paradas_viaje: [],
  configuracion_plataforma: [{ id: 1, radio_matching_km: 35, vuelta_casa_habilitada: true, vuelta_casa_inicio_km: 150, ...config }],
  cargas: [
    { id: 190, chofer_id: CHOFER, estado: "En ruta", origen: "Buenos Aires", destino: "Jujuy", lat: null, lng: null, created_at: "2026-09-29T10:00:00Z" },
    ...cargasExtra,
  ],
});
const carga = (id, origen, destino, extra = {}) =>
  ({ id, chofer_id: null, estado: "pendiente", origen, destino, tipo_vehiculo: "Camión tractor", categoria_legal: "N3", pago_chofer: 100000, km_estimados: 0, created_at: `2026-09-29T0${id % 10}:00:00Z`, ...extra });

function deps(tablas, opciones) {
  const llamadas = { geocode: 0, corredor: 0 };
  const { db, escrituras } = baseFalsa(tablas, opciones);
  return {
    llamadas, escrituras,
    d: {
      db,
      geocodificar: async (dir) => { llamadas.geocode++; return CIUDAD[dir] ?? null; },
      obtenerCorredor: async () => { llamadas.corredor++; return CORREDOR_JUJUY_BA; },
    },
  };
}
const consultar = (d, gps) => silenciar(() => procesarOportunidadesVuelta(d, CHOFER, { cargaId: "190", lat: gps.lat, lng: gps.lng }));

test("CASO 1: Buenos Aires → Jujuy, faltan 300 km, inicio 150 → NO mostrar todavía", async () => {
  const { d, llamadas } = deps(tablasBase({ cargasExtra: [carga(1, "Jujuy", "Buenos Aires")] }));
  const r = await consultar(d, aKmDeJujuy(300));
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.activo, r.body.motivo, r.body.oportunidades], [false, "lejos_del_destino", []]);
  assert.ok(Math.abs(r.body.km_restantes_hasta_destino - 300) <= 2);
  assert.equal(llamadas.corredor, 0, "no consulta el corredor hasta que falte poco");
});

test("CASO 2: faltan 100 km, carga Jujuy → Buenos Aires → se muestra", async () => {
  const { d } = deps(tablasBase({ cargasExtra: [carga(1, "Jujuy", "Buenos Aires")] }));
  const r = await consultar(d, aKmDeJujuy(100));
  assert.equal(r.body.activo, true);
  assert.equal(r.body.destino_regreso, "Buenos Aires");
  assert.deepEqual(r.body.oportunidades.map((o) => [o.carga_id, o.estado]), [[1, "OPORTUNIDAD DE VUELTA"]]);
});

test("CASO 3 (Jujuy → Tucumán → Buenos Aires): sin carga en Jujuy, Tucumán → BA sobre el corredor → se muestra aunque esté a >35 km de Jujuy", async () => {
  const { d } = deps(tablasBase({ cargasExtra: [carga(2, "Tucumán", "Buenos Aires")] }));
  const r = await consultar(d, aKmDeJujuy(100));
  const [o] = r.body.oportunidades;
  assert.equal(o.carga_id, 2);
  assert.ok(o.km_hasta_retiro > 35, "más lejos que el radio normal desde Jujuy");
  assert.equal(o.km_restantes_a_casa, 0);
  assert.deepEqual(Object.keys(o).sort(), ["carga_id", "destino", "estado", "km_acerca_a_casa", "km_hasta_retiro", "km_nuevo_viaje", "km_restantes_a_casa", "pago_chofer", "retiro"]);
});

test("CASO 4: cerca del corredor pero el destino aleja de Buenos Aires → NO se muestra", async () => {
  const { d } = deps(tablasBase({ cargasExtra: [carga(3, "Tucumán", "La Quiaca"), carga(4, "Mendoza", "Buenos Aires")] }));
  const r = await consultar(d, aKmDeJujuy(100));
  assert.deepEqual(r.body.oportunidades, []);
});

test("CASO 5: Vuelta a Casa desactivada desde Admin → no busca (ni geocode ni corredor) ni muestra", async () => {
  const { d, llamadas } = deps(tablasBase({ config: { vuelta_casa_habilitada: false }, cargasExtra: [carga(1, "Jujuy", "Buenos Aires")] }));
  const r = await consultar(d, aKmDeJujuy(10));
  assert.deepEqual([r.body.activo, r.body.motivo, r.body.oportunidades], [false, "deshabilitada", []]);
  assert.deepEqual(llamadas, { geocode: 0, corredor: 0 });
});

test("filtros: asignadas, vehículo incompatible y la propia carga se descartan; ancho del corredor = radio configurado", async () => {
  const extra = [
    carga(5, "Tucumán", "Buenos Aires", { chofer_id: "otro", estado: "Chofer asignado" }),
    carga(6, "Tucumán", "Buenos Aires", { tipo_vehiculo: "Furgón", categoria_legal: "N1" }),
    carga(7, "Santiago del Estero", "Rosario"),
  ];
  const { d } = deps(tablasBase({ cargasExtra: extra }));
  const r = await consultar(d, aKmDeJujuy(100));
  assert.deepEqual(r.body.oportunidades.map((o) => o.carga_id), [7]);
});

test("sin identidad → 401; no chofer → 403; viaje de otro → 403", async () => {
  const { d } = deps(tablasBase());
  assert.equal((await procesarOportunidadesVuelta(d, null, { cargaId: "190" })).status, 401);
  assert.equal((await procesarOportunidadesVuelta(d, "cl-1", { cargaId: "190" })).status, 403);
  const t = tablasBase(); t.usuarios.push({ id: "ch-2", rol: "chofer", eliminado: false });
  assert.equal((await procesarOportunidadesVuelta(deps(t).d, "ch-2", { cargaId: "190" })).status, 403);
});

test("usa el último GPS guardado del viaje si el request no trae GPS", async () => {
  const t = tablasBase({ cargasExtra: [carga(1, "Jujuy", "Buenos Aires")] });
  t.cargas[0] = { ...t.cargas[0], ...aKmDeJujuy(50) };
  const r = await silenciar(() => procesarOportunidadesVuelta(deps(t).d, CHOFER, { cargaId: "190" }));
  assert.equal(r.body.activo, true);
});

test("SÓLO LECTURA: ningún update/insert/upsert/delete/rpc — la base falsa explota si se intenta", async () => {
  const { d, escrituras } = deps(tablasBase({ cargasExtra: [carga(1, "Jujuy", "Buenos Aires")] }));
  await consultar(d, aKmDeJujuy(100));
  assert.equal(escrituras.length, 0);
  for (const f of ["lib/vueltaACasaServidor.ts", "lib/geo/vueltaACasa.ts", "lib/geo/corredorRuta.ts", "api/chofer/oportunidades-vuelta/route.ts", "components/VueltaACasaPanel.tsx"]) {
    assert.doesNotMatch(leer(f), /\.(update|insert|upsert|delete|rpc)\s*\(/, f);
  }
  const panel = leer("components/VueltaACasaPanel.tsx");
  assert.doesNotMatch(panel, /method:\s*"(POST|PUT|PATCH|DELETE)"/, "sólo GET");
  assert.doesNotMatch(panel, />\s*[^<]*(ACEPTAR|RESERVAR|ASIGNAR)[^<]*</, "ningún botón/texto visible de aceptar, reservar o asignar");
});

// ═══════════════ Configuración operativa ═══════════════

test("fallback: sin configuración → radio 35, habilitada, inicio 150", async () => {
  const r = await silenciar(() => leerConfiguracionOperativa(baseFalsa({ configuracion_plataforma: [] }).db));
  assert.deepEqual([r.radioKm, r.vuelta.habilitada, r.vuelta.inicioKm], [35, true, 150]);
});

test("columnas de vuelta aún sin migrar → el radio configurado (65) se respeta igual", async () => {
  const { db } = baseFalsa({ configuracion_plataforma: [{ id: 1, radio_matching_km: 65 }] }, { columnasFaltantes: ["vuelta_casa_habilitada"] });
  const r = await silenciar(() => leerConfiguracionOperativa(db));
  assert.deepEqual([r.radioKm, r.radioFuente, r.vuelta.fuente, r.vuelta.inicioKm], [65, "db", "fallback", 150]);
});

test("CASO 6: Admin cambia el radio de 35 a 65 → el matching normal (leerRadioMatching) usa 65 sin deploy", async () => {
  const t = tablasBase();
  const { db } = baseFalsa(t);
  const put = await procesarPutOperativa(db, "ad-1", { radio_matching_km: 65, vuelta_casa_habilitada: true, vuelta_casa_inicio_km: 150 });
  assert.equal(put.status, 200);
  assert.equal((await leerRadioMatching(db)).radioKm, 65, "misma columna que leen listado, alarma y aceptación");
  for (const f of ["api/chofer/distancias-cercanas/route.ts", "api/cargas/aceptar/route.ts"]) {
    assert.match(leer(f), /const \{ radioKm \} = await leerRadioMatching\(supabaseAdmin\);/, f);
  }
});

test("admin operativa: GET devuelve los tres valores; PUT valida (0, negativos, decimales, texto, no booleano) sin escribir", async () => {
  const t = tablasBase({ config: { radio_matching_km: 65, vuelta_casa_inicio_km: 300 } });
  const { db, escrituras } = baseFalsa(t);
  const g = await procesarGetOperativa(db, "ad-1");
  assert.deepEqual([g.status, g.body.radio_matching_km, g.body.vuelta_casa_habilitada, g.body.vuelta_casa_inicio_km], [200, 65, true, 300]);
  for (const malo of [
    { radio_matching_km: 0, vuelta_casa_habilitada: true, vuelta_casa_inicio_km: 150 },
    { radio_matching_km: -5, vuelta_casa_habilitada: true, vuelta_casa_inicio_km: 150 },
    { radio_matching_km: 35, vuelta_casa_habilitada: true, vuelta_casa_inicio_km: 12.5 },
    { radio_matching_km: "35", vuelta_casa_habilitada: true, vuelta_casa_inicio_km: 150 },
    { radio_matching_km: 35, vuelta_casa_habilitada: "si", vuelta_casa_inicio_km: 150 },
    { radio_matching_km: 35, vuelta_casa_habilitada: true, vuelta_casa_inicio_km: 0 },
  ]) assert.equal((await procesarPutOperativa(db, "ad-1", malo)).status, 400, JSON.stringify(malo));
  assert.equal(escrituras.length, 0);
  assert.equal((await procesarGetOperativa(db, "cl-1")).status, 403);
  assert.equal((await procesarGetOperativa(db, null)).status, 401);
  for (const [t2, km] of [["150", 150], ["65 km", 65], ["1000", 1000]]) assert.equal(textoAKmEntero(t2), km);
  for (const m of ["0", "-1", "7,5", "abc", ""]) assert.equal(textoAKmEntero(m), null);
});

test("la ruta admin operativa usa la MISMA autenticación estricta", () => {
  const src = leer("api/admin/configuracion/operativa/route.ts");
  assert.match(src, /identidadAdminComisiones\(req\)/);
  assert.doesNotMatch(src, /resolverUsuario\(|x-user-id"\)/);
});

// ═══════════════ CASO 7: viaje activo intacto ═══════════════

test("CASO 7: viaje activo, mapa, GPS, estados y evidencias sin cambios — sólo un acceso y un panel aislado", () => {
  const pagina = leer("viaje-activo/page.tsx");
  assert.match(pagina, /import VueltaACasaPanel from "\.\.\/components\/VueltaACasaPanel";/);
  assert.match(pagina, /onClick=\{\(\) => \{ setMostrarDetalles\(false\); setMostrarVueltaCasa\(true\); \}\}/);
  assert.match(pagina, /\{mostrarVueltaCasa && \(\s*<VueltaACasaPanel/);
  assert.match(pagina, /const obtenerGpsVueltaCasa = useCallback\(\(\) => ultimoGpsFrescoRef\.current, \[\]\);/, "sólo LEE el GPS");
  const panel = leer("components/VueltaACasaPanel.tsx");
  assert.match(panel, /class AislarErrores extends Component/);
  assert.doesNotMatch(panel, /geolocation|watchPosition|MapaTILA|\/api\/cargas\/(estado|gps|evidencia|aceptar)|setViaje/);
});

test("migración: agrega vuelta_casa_habilitada y vuelta_casa_inicio_km (+ radio idempotente) con CHECK > 0, nada más", () => {
  const sql = readFileSync(join(RAIZ_REPO, "supabase/migrations/20260930_vuelta_a_casa_configuracion.sql"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS vuelta_casa_habilitada boolean NOT NULL DEFAULT true;/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS vuelta_casa_inicio_km integer NOT NULL DEFAULT 150;/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS radio_matching_km integer NOT NULL DEFAULT 35;/);
  assert.match(sql, /CHECK \(radio_matching_km > 0\)/);
  assert.match(sql, /CHECK \(vuelta_casa_inicio_km > 0\)/);
  assert.doesNotMatch(sql, /comision|cargas|GRANT|POLICY/i);
});
