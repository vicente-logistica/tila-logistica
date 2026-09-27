/**
 * Filtro FAIL-CLOSED de cercanía — reemplaza el viejo comportamiento de
 * useCargasCercanas que, mientras no había GPS/cálculo todavía, mostraba `cargas` SIN
 * FILTRAR (fail-open). Regla de negocio explícita: sin un cálculo real "ok" que confirme
 * `dentroRadioInicial`, la carga NO se muestra — nunca como fallback "por si acaso".
 *
 * `gpsListo` es responsabilidad del llamador (useCargasCercanas): debe ser `true`
 * únicamente cuando ya hay una posición GPS confirmada (gpsEstado === "ok"). Con
 * `gpsListo=false` (sin GPS, buscando, o error de permiso) el resultado es SIEMPRE []
 * sin importar qué haya en `distancias` (datos de una posición anterior, por ejemplo).
 */
export interface EstadoDistanciaMinimo {
  estado: string;
  dentroRadioInicial: boolean;
}

export function filtrarCercanas<T extends { id: number }>(
  cargas: T[],
  gpsListo: boolean,
  distancias: Record<number, EstadoDistanciaMinimo>
): T[] {
  if (!gpsListo) return [];
  return cargas.filter(c => {
    const d = distancias[c.id];
    return d?.estado === "ok" && d.dentroRadioInicial === true;
  });
}
