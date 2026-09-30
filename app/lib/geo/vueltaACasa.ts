import { distanciaHaversineKm, type PuntoGeo } from "./haversine.ts";

/**
 * "Vuelta a Casa" — lógica PURA (sin Supabase ni Google). SÓLO RECOMIENDA: no acepta, no
 * reserva, no asigna, no cambia estados. Motor separado del matching normal.
 *
 * Viaje activo A → B. Destino de regreso = A (casa). El CORREDOR de regreso es la ruta real
 * B → A (polyline de Google Directions): una carga C → D es oportunidad si
 *   1. C está a ≤ anchoKm (= radio de matching configurado) de ese corredor — NO se mide
 *      sólo B → C: Tucumán puede estar a 300 km de Jujuy y ser candidata si está sobre la
 *      ruta Jujuy → Buenos Aires;
 *   2. D acerca al chofer a A: dist(D, A) < dist(C, A)  (y D queda más cerca de A que B).
 * Se activa sólo cuando al chofer le faltan ≤ inicioKm para llegar a B.
 *
 * Distancias de las métricas: línea recta (aproximadas). El corredor sí es la ruta real.
 */

export const MAXIMO_OPORTUNIDADES_VUELTA = 5;

/** ¿Ya corresponde buscar oportunidades? (faltan ≤ inicioKm hasta B). */
export function debeBuscarVuelta(kmRestantesHastaB: number, inicioKm: number, habilitada: boolean): boolean {
  return habilitada && Number.isFinite(kmRestantesHastaB) && kmRestantesHastaB <= inicioKm;
}

/** Decodifica una polyline codificada de Google (algoritmo estándar, precisión 1e-5). */
export function decodificarPolyline(codificada: string): PuntoGeo[] {
  const puntos: PuntoGeo[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < codificada.length) {
    for (const eje of ["lat", "lng"] as const) {
      let resultado = 0, desplazamiento = 0, b: number;
      do {
        b = codificada.charCodeAt(i++) - 63;
        resultado |= (b & 0x1f) << desplazamiento;
        desplazamiento += 5;
      } while (b >= 0x20 && i < codificada.length);
      const delta = resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
      if (eje === "lat") lat += delta; else lng += delta;
    }
    puntos.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return puntos;
}

/** Distancia (km) de P al segmento S1–S2, con proyección equirectangular local (precisa
 *  para segmentos cortos como los de una polyline de ruta). */
export function distanciaPuntoASegmentoKm(P: PuntoGeo, S1: PuntoGeo, S2: PuntoGeo): number {
  const kx = 111.32 * Math.cos((P.lat * Math.PI) / 180), ky = 110.574;
  const ax = (S1.lng - P.lng) * kx, ay = (S1.lat - P.lat) * ky;
  const bx = (S2.lng - P.lng) * kx, by = (S2.lat - P.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const largo2 = dx * dx + dy * dy;
  const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / largo2));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y);
}

/** Distancia mínima (km) de P al corredor (polyline B → A). */
export function distanciaAlCorredorKm(P: PuntoGeo, corredor: PuntoGeo[]): number {
  if (corredor.length === 0) return Infinity;
  if (corredor.length === 1) return distanciaHaversineKm(P, corredor[0]);
  let min = Infinity;
  for (let i = 0; i < corredor.length - 1; i++) {
    const d = distanciaPuntoASegmentoKm(P, corredor[i], corredor[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

export interface MetricasVuelta {
  kmHastaRetiro: number;       // B → C (desde el destino actual), aprox.
  kmCorredor: number;          // distancia de C a la ruta de regreso
  kmRestantesACasa: number;    // D → A, aprox.
  kmAcercaACasa: number;       // dist(B, A) − dist(D, A): cuánto más cerca de casa queda
}

/** null si C→D no es oportunidad de vuelta (C fuera del corredor, o D no acerca a casa). */
export function evaluarOportunidadVuelta(
  A: PuntoGeo, B: PuntoGeo, C: PuntoGeo, D: PuntoGeo, corredor: PuntoGeo[], anchoKm: number,
): MetricasVuelta | null {
  const kmCorredor = distanciaAlCorredorKm(C, corredor);
  if (!(kmCorredor <= anchoKm)) return null;
  const dCA = distanciaHaversineKm(C, A), dDA = distanciaHaversineKm(D, A), dBA = distanciaHaversineKm(B, A);
  if (!(dDA < dCA)) return null;  // D no acerca al chofer a casa respecto del retiro
  if (!(dDA < dBA)) return null;  // terminaría más lejos de casa que el destino actual
  return {
    kmHastaRetiro: Math.round(distanciaHaversineKm(B, C)),
    kmCorredor: Math.round(kmCorredor),
    kmRestantesACasa: Math.round(dDA),
    kmAcercaACasa: Math.round(dBA - dDA),
  };
}

// ─── Compatibilidad de vehículo — MISMA regla que cargarCargas() en panel-chofer ───
export interface CargaVehiculo { tipo_vehiculo?: string | null; categoria_legal?: string | null; vehiculo?: string | null }
const norm = (s: unknown) => String(s ?? "").toLowerCase().trim();

/** Sin vehículo activo no se recomienda nada. */
export function esCompatibleVehiculo(carga: CargaVehiculo, tipoActivo: string | null | undefined, categoriaChofer: string | null | undefined): boolean {
  if (!norm(tipoActivo)) return false;
  if (carga.tipo_vehiculo) {
    const matchTipo = norm(carga.tipo_vehiculo) === norm(tipoActivo);
    if (categoriaChofer && carga.categoria_legal) return matchTipo && norm(carga.categoria_legal) === norm(categoriaChofer);
    return matchTipo;
  }
  const v = norm(carga.vehiculo), t = norm(tipoActivo);
  return !!v && (v.includes(t) || t.includes(v));
}

export interface OportunidadVuelta {
  carga_id: number;
  retiro: string;
  destino: string;
  km_hasta_retiro: number;
  km_nuevo_viaje: number | null;
  km_acerca_a_casa: number;
  km_restantes_a_casa: number;
  pago_chofer: number | null;
  estado: "OPORTUNIDAD DE VUELTA";
}

/** Más avance hacia casa primero; a igual avance, el retiro más cercano. Máximo 5. */
export function rankearVuelta(ops: OportunidadVuelta[]): OportunidadVuelta[] {
  return [...ops]
    .sort((a, b) => b.km_acerca_a_casa - a.km_acerca_a_casa || a.km_hasta_retiro - b.km_hasta_retiro)
    .slice(0, MAXIMO_OPORTUNIDADES_VUELTA);
}
