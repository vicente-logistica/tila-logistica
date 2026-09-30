/**
 * Validaciones puras sobre una ruta de navegación recién recibida — sin Google Maps ni
 * React, para poder testearlas con node:test.
 */

// Más de ~135° entre el rumbo del primer tramo de la ruta y una dirección de marcha
// = la ruta arranca prácticamente en sentido contrario a esa dirección.
export const UMBRAL_RUTA_DIRECCIONAL_OPUESTA_GRADOS = 135;

// Último fix aceptado con más antigüedad que esto → velocidad/desplazamiento viejos, no
// representan el movimiento actual del vehículo.
export const EDAD_MAX_FIX_HEADING_CONFIABLE_MS = 3000;

const diferenciaAngular = (a: number, b: number): number =>
  Math.abs(((a - b + 540) % 360) - 180);

const esNumero = (v: number | null): v is number => v !== null && Number.isFinite(v);

/**
 * Decide si una ruta direccional debe descartarse. Criterio conservador: el heading
 * usado para pedirla puede ser uno conservado de un fix anterior (MapaTILA y
 * viaje-activo conservan el último válido cuando el fix trae null), así que por sí solo
 * nunca alcanza. Se descarta SÓLO si se cumplen todas:
 *  - no es el reintento (un único reintento por ciclo);
 *  - el primer tramo está a más de UMBRAL_RUTA_DIRECCIONAL_OPUESTA_GRADOS del heading
 *    con que se pidió la ruta;
 *  - Y también a más de ese umbral del rumbo del desplazamiento real reciente;
 *  - el vehículo se mueve a velocidadMinMps o más;
 *  - el último fix aceptado es reciente (≤ EDAD_MAX_FIX_HEADING_CONFIABLE_MS).
 * Cualquier dato faltante o condición que falle → false (la ruta se instala).
 */
export function debeRechazarRutaDireccional(p: {
  bearingRuta: number | null;
  headingAlPedir: number | null;
  bearingDesplazamiento: number | null;
  velocidadMps: number | null;
  velocidadMinMps: number;
  edadUltimoFixMs: number | null;
  yaReintentada: boolean;
}): boolean {
  if (p.yaReintentada) return false;
  if (!esNumero(p.bearingRuta) || !esNumero(p.headingAlPedir) || !esNumero(p.bearingDesplazamiento)) return false;
  if (!esNumero(p.velocidadMps) || p.velocidadMps < p.velocidadMinMps) return false;
  if (!esNumero(p.edadUltimoFixMs) || p.edadUltimoFixMs < 0 || p.edadUltimoFixMs > EDAD_MAX_FIX_HEADING_CONFIABLE_MS) return false;
  return diferenciaAngular(p.bearingRuta, p.headingAlPedir) > UMBRAL_RUTA_DIRECCIONAL_OPUESTA_GRADOS
    && diferenciaAngular(p.bearingRuta, p.bearingDesplazamiento) > UMBRAL_RUTA_DIRECCIONAL_OPUESTA_GRADOS;
}
