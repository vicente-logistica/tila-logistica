/**
 * Validaciones puras sobre una ruta de navegación recién recibida — sin Google Maps ni
 * React, para poder testearlas con node:test.
 */

// Más de ~135° entre el heading con que se pidió la ruta y el rumbo de su primer tramo
// = la ruta arranca prácticamente en sentido contrario al que va el vehículo.
export const UMBRAL_RUTA_DIRECCIONAL_OPUESTA_GRADOS = 135;

/**
 * Decide si una ruta direccional debe descartarse: sólo cuando se pidió con heading
 * confiable (no null), se conoce el rumbo del primer tramo, la diferencia supera el
 * umbral y todavía no se reintentó (un único reintento por ciclo).
 */
export function debeRechazarRutaDireccional(
  diferenciaAngular: number | null,
  yaReintentada: boolean
): boolean {
  if (yaReintentada) return false;
  if (diferenciaAngular === null || Number.isNaN(diferenciaAngular)) return false;
  return diferenciaAngular > UMBRAL_RUTA_DIRECCIONAL_OPUESTA_GRADOS;
}
