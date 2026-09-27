/**
 * Estado combinado para que panel-chofer pueda mostrar un mensaje claro (nunca cargas
 * crudas como fallback):
 *  - "sin_gps": todavía no hay posición (inactivo/buscando) — "Buscando ubicación…"
 *  - "gps_error": permiso denegado o falló getCurrentPosition — pedir que active el permiso
 *  - "error_calculo": la última consulta a /api/chofer/distancias-cercanas falló (!ok o
 *    red) — no hay validación vigente, se reintenta sola — "No pudimos calcular…"
 *  - "calculando": ya hay GPS, esperando la primera respuesta del endpoint para ESTE
 *    conjunto de cargas — "Calculando distancias…"
 *  - "listo": ya se sabe con certeza qué hay dentro del radio (aunque sea 0 resultados)
 */
export type EstadoCargasCercanas = "sin_gps" | "gps_error" | "error_calculo" | "calculando" | "listo";

export type RespuestaCercanas<D> =
  | { ok: true; resultados: Record<number, D> | null | undefined }
  | { ok: false };

export interface EstadoCalculoCercanas<D> {
  distancias: Record<number, D>;
  errorCalculo: boolean;
}

/**
 * FAIL-CLOSED real: cada consulta REEMPLAZA por completo el estado anterior. Si falla
 * (!res.ok, excepción de red, o body sin `resultados`), las distancias previas se
 * descartan — nunca se usa una validación vieja como fallback. Si funciona, se toman sólo
 * los resultados nuevos y se limpia el error.
 */
export function aplicarRespuestaCercanas<D>(respuesta: RespuestaCercanas<D>): EstadoCalculoCercanas<D> {
  if (!respuesta.ok || !respuesta.resultados || typeof respuesta.resultados !== "object") {
    return { distancias: {}, errorCalculo: true };
  }
  return { distancias: respuesta.resultados, errorCalculo: false };
}

/**
 * `listaCargada` = cargarCargas() ya trajo la lista real de esta sesión online. Sin eso,
 * una lista vacía significa "todavía no la trajimos", NO "no hay cargas": nunca se pasa
 * a "listo" antes (la alarma sólo se evalúa en "listo").
 */
export function derivarEstadoCercanas(
  gpsEstado: "inactivo" | "buscando" | "ok" | "error",
  errorCalculo: boolean,
  calculando: boolean,
  primeraRespuestaLlegada: boolean,
  listaCargada: boolean,
): EstadoCargasCercanas {
  if (gpsEstado === "error") return "gps_error";
  if (gpsEstado !== "ok") return "sin_gps";
  if (errorCalculo) return "error_calculo";
  if (!listaCargada || calculando || !primeraRespuestaLlegada) return "calculando";
  return "listo";
}
