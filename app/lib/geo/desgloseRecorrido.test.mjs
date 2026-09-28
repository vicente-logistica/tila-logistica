import test from "node:test";
import assert from "node:assert/strict";
import { paradasPendientes, armarDesgloseRecorrido, DESDE_CHOFER } from "./desgloseRecorrido.ts";

const leg = (km, seg) => ({ distanciaMetros: km * 1000, distanciaTexto: `${km} km`, duracionTexto: "", duracionSegundos: seg });
const parada = (orden, direccion, tipo, estado = "pendiente") => ({ orden, direccion, tipo, estado });

test("1. viaje simple (sin filas en paradas_viaje): GPS → A → B", () => {
  const pend = paradasPendientes([], { origen: "Escobar", destino: "Pilar", estado: "En camino" });
  assert.deepEqual(pend.map(p => [p.etiqueta, p.direccion]), [["A", "Escobar"], ["B", "Pilar"]]);
  const d = armarDesgloseRecorrido(pend, [leg(24.2, 26 * 60), leg(41.7, 39 * 60)]);
  assert.deepEqual(d.tramos.map(t => `${t.desde} → ${t.hasta}: ${t.distanciaTexto} · ${t.duracionTexto}`), [
    `${DESDE_CHOFER} → A: 24,2 km · 26 min`,
    "A → B: 41,7 km · 39 min",
  ]);
  assert.equal(d.totalTexto, "65,9 km");
  assert.equal(d.totalDuracionTexto, "1 h 5 min");
});

test("2. multiparada: GPS → A → B → C → D", () => {
  const paradas = [parada(0, "A dir", "retiro"), parada(1, "B dir", "parada"), parada(2, "C dir", "parada"), parada(3, "D dir", "entrega")];
  const pend = paradasPendientes(paradas, { origen: "x", destino: "y", estado: "En camino" });
  assert.deepEqual(pend.map(p => p.etiqueta), ["A", "B", "C", "D"]);
  const d = armarDesgloseRecorrido(pend, [leg(5, 600), leg(10, 900), leg(8, 720), leg(12, 1080)]);
  assert.deepEqual(d.tramos.map(t => `${t.desde}→${t.hasta}`), [`${DESDE_CHOFER}→A`, "A→B", "B→C", "C→D"]);
  assert.equal(d.tramos[3].hastaDireccion, "D dir");
});

test("3. paradas completadas: GPS → siguiente pendiente → … → final, con las letras ORIGINALES", () => {
  const paradas = [
    parada(0, "A dir", "retiro", "completada"),
    parada(1, "B dir", "parada", "completada"),
    parada(2, "C dir", "parada"),
    parada(3, "D dir", "entrega"),
  ];
  const pend = paradasPendientes(paradas, { estado: "En ruta" });
  assert.deepEqual(pend.map(p => p.etiqueta), ["C", "D"]);
  const d = armarDesgloseRecorrido(pend, [leg(3, 300), leg(7, 600)]);
  assert.deepEqual(d.tramos.map(t => `${t.desde}→${t.hasta}`), [`${DESDE_CHOFER}→C`, "C→D"]);
});

test("3b. viaje simple con carga ya retirada: sólo GPS → B", () => {
  const pend = paradasPendientes(null, { origen: "Escobar", destino: "Pilar", estado: "Carga retirada" });
  assert.deepEqual(pend.map(p => p.etiqueta), ["B"]);
  const d = armarDesgloseRecorrido(pend, [leg(30, 1800)]);
  assert.deepEqual(d.tramos.map(t => `${t.desde}→${t.hasta}`), [`${DESDE_CHOFER}→B`]);
});

test("paradas desordenadas en la entrada → se respeta `orden`", () => {
  const paradas = [parada(2, "C dir", "entrega"), parada(0, "A dir", "retiro"), parada(1, "B dir", "parada")];
  assert.deepEqual(paradasPendientes(paradas, {}).map(p => `${p.etiqueta}:${p.direccion}`), ["A:A dir", "B:B dir", "C:C dir"]);
});

test("4 y 5. total km y tiempo total = suma de TODOS los legs", () => {
  const pend = paradasPendientes([], { origen: "o", destino: "d", estado: "Chofer asignado" });
  const d = armarDesgloseRecorrido(pend, [leg(12.3, 1000), leg(45.6, 2000)]);
  assert.equal(d.totalTexto, "57,9 km");       // 12,3 + 45,6
  assert.equal(d.totalDuracionTexto, "50 min"); // 1000 + 2000 s
  const sumaTramos = d.tramos.reduce((s, t) => s + t.distanciaMetros, 0);
  assert.equal(sumaTramos, 57900);
});

test("6. con filas en paradas_viaje NO se agregan origen/destino de la carga (no se duplica A/B)", () => {
  const paradas = [parada(0, "Escobar", "retiro"), parada(1, "Pilar", "entrega")];
  const pend = paradasPendientes(paradas, { origen: "Escobar", destino: "Pilar", estado: "En camino" });
  assert.equal(pend.length, 2);
  assert.deepEqual(pend.map(p => p.etiqueta), ["A", "B"]);
  const etiquetas = pend.map(p => p.etiqueta);
  assert.equal(new Set(etiquetas).size, etiquetas.length);
});

test("7. fallo de cálculo → null, nunca km_estimados como recorrido", () => {
  const viaje = { origen: "o", destino: "d", estado: "En camino", km_estimados: 400 };
  const pend = paradasPendientes([], viaje);
  assert.equal(armarDesgloseRecorrido(pend, null), null, "Directions falló");
  assert.equal(armarDesgloseRecorrido(pend, []), null, "sin legs");
  assert.equal(armarDesgloseRecorrido(pend, [leg(10, 600)]), null, "legs no coinciden con los puntos: no se inventa un tramo");
  const d = armarDesgloseRecorrido(pend, [leg(10, 600), leg(20, 900)]);
  assert.ok(!JSON.stringify(d).includes("400"), "km_estimados nunca aparece en el desglose");
});

test("sin paradas pendientes → lista vacía (viaje descargado)", () => {
  assert.deepEqual(paradasPendientes(null, { origen: "o", destino: "d", estado: "Descarga completada" }), []);
  assert.deepEqual(paradasPendientes([parada(0, "A", "retiro", "completada"), parada(1, "B", "entrega", "completada")], {}), []);
  assert.equal(armarDesgloseRecorrido([], [leg(1, 60)]), null);
});

test("tiempo total null si algún leg no trae segundos (no se muestra un total parcial)", () => {
  const pend = paradasPendientes([], { origen: "o", destino: "d" });
  const d = armarDesgloseRecorrido(pend, [leg(10, 600), { distanciaMetros: 5000, distanciaTexto: "5 km", duracionTexto: "7 min" }]);
  assert.equal(d.totalDuracionTexto, null);
  assert.equal(d.tramos[1].duracionTexto, "7 min", "el tramo usa el texto de Google si no hay segundos");
});

test("más de 6 paradas: las letras siguen (G, H…) sin tope", () => {
  const paradas = Array.from({ length: 8 }, (_, i) => parada(i, `P${i}`, i === 0 ? "retiro" : i === 7 ? "entrega" : "parada"));
  assert.deepEqual(paradasPendientes(paradas, {}).map(p => p.etiqueta), ["A", "B", "C", "D", "E", "F", "G", "H"]);
});
