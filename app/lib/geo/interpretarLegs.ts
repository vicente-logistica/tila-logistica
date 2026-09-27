export interface LegSimple {
  distanciaMetros: number;
  distanciaTexto: string;
  duracionTexto: string;
  /** Segundos del leg (Directions `duration.value`) — sólo se necesita para poder SUMAR
   *  la duración de varios legs (multietapa) sin concatenar texto ("39 min" + "20 min" no
   *  se puede sumar como string). Opcional para no romper compatibilidad con quien ya
   *  construía un LegSimple sin este campo (por ej. tests existentes). */
  duracionSegundos?: number;
}

export interface ResultadoDistanciaLegs {
  dentroRadioInicial: boolean;
  dentroRadioMaximo: boolean;
  hastaCargaKm: number;
  hastaCargaTexto: string;
  recorridoCargaKm: number | null;
  recorridoCargaTexto: string | null;
  /** Duración estimada SOLO del recorrido propio de la carga (A → ... → destino final),
   *  EXCLUYENDO el tramo GPS→A. Con un único leg de recorrido (carga simple) se reusa el
   *  texto que ya trae Directions tal cual (sin redondeos propios); con más de uno
   *  (multietapa) se suman los segundos y se formatea. null si no hay recorrido (no debería
   *  pasar en la práctica: toda carga tiene al menos A→B) o si Directions no trajo duración. */
  recorridoCargaDuracionTexto: string | null;
  totalKm: number;
  totalTexto: string;
  duracionHastaCargaTexto: string | null;
}

export function formatearKm(metros: number): string {
  const km = metros / 1000;
  return km >= 1 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(metros)} m`;
}

export function formatearDuracion(segundos: number): string {
  const minutosTotales = Math.round(segundos / 60);
  if (minutosTotales < 60) return `${minutosTotales} min`;
  const horas = Math.floor(minutosTotales / 60);
  const minutos = minutosTotales % 60;
  return minutos > 0 ? `${horas} h ${minutos} min` : `${horas} h`;
}

/**
 * Lógica PURA de interpretación de los legs de un DirectionsResult ya resuelto (origin=GPS
 * del chofer, waypoints=A [+ intermedias], destination=B/entrega final) — separada de
 * route.ts para poder testearla sin Supabase/Google/env de por medio.
 *
 * legs[0] es SIEMPRE el tramo GPS del chofer → A (nunca cambia, sea carga simple o
 * multietapa: el origen del pedido a Directions siempre es el GPS, nunca una parada).
 * legs[1..] es el recorrido de la carga en sí (A → siguiente parada → ... → B) — es este
 * tramo, y SOLO este, el que se muestra hoy como "Distancia"/"Tiempo estimado" en la
 * tarjeta principal (ver panel-chofer/page.tsx): GPS→A se sigue calculando y sigue
 * decidiendo el radio, pero deliberadamente no se expone ahí como km del viaje.
 *
 * La decisión de "dentro de radio" usa EXCLUSIVAMENTE hastaCargaKm (legs[0]) — nunca el
 * total ni B (regla de negocio explícita: la cercanía se decide por la distancia al punto
 * de retiro, no por cuánto dura la carga en sí).
 *
 * Devuelve null si `legs` viene vacío (Directions no trajo nada útil) — el llamador lo
 * trata como "no se pudo calcular", nunca inventa un número.
 */
export function interpretarLegs(
  legs: LegSimple[],
  radioInicialKm: number,
  radioMaximoKm: number
): ResultadoDistanciaLegs | null {
  if (!legs || legs.length === 0) return null;

  const hastaCarga     = legs[0];
  const legsRecorrido  = legs.slice(1);
  const recorridoMetros = legsRecorrido.reduce((s, l) => s + l.distanciaMetros, 0);
  const totalMetros     = legs.reduce((s, l) => s + l.distanciaMetros, 0);
  const hastaCargaKm    = hastaCarga.distanciaMetros / 1000;

  let recorridoCargaDuracionTexto: string | null = null;
  if (legsRecorrido.length === 1) {
    // Carga simple (A→B): un solo leg — se reusa el texto de Directions tal cual.
    recorridoCargaDuracionTexto = legsRecorrido[0].duracionTexto || null;
  } else if (legsRecorrido.length > 1) {
    // Multietapa (A→B→C→...): no se puede concatenar texto, se suman segundos.
    const segundosRecorrido = legsRecorrido.reduce((s, l) => s + (l.duracionSegundos ?? 0), 0);
    recorridoCargaDuracionTexto = segundosRecorrido > 0 ? formatearDuracion(segundosRecorrido) : null;
  }

  return {
    dentroRadioInicial: hastaCargaKm <= radioInicialKm,
    dentroRadioMaximo:  hastaCargaKm <= radioMaximoKm,
    hastaCargaKm,
    hastaCargaTexto: hastaCarga.distanciaTexto,
    recorridoCargaKm:    legsRecorrido.length ? recorridoMetros / 1000 : null,
    recorridoCargaTexto: legsRecorrido.length ? formatearKm(recorridoMetros) : null,
    recorridoCargaDuracionTexto,
    totalKm: totalMetros / 1000,
    totalTexto: formatearKm(totalMetros),
    duracionHastaCargaTexto: hastaCarga.duracionTexto || null,
  };
}
