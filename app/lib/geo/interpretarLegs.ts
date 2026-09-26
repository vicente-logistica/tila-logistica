export interface LegSimple {
  distanciaMetros: number;
  distanciaTexto: string;
  duracionTexto: string;
}

export interface ResultadoDistanciaLegs {
  dentroRadioInicial: boolean;
  dentroRadioMaximo: boolean;
  hastaCargaKm: number;
  hastaCargaTexto: string;
  recorridoCargaKm: number | null;
  recorridoCargaTexto: string | null;
  totalKm: number;
  totalTexto: string;
  duracionHastaCargaTexto: string | null;
}

export function formatearKm(metros: number): string {
  const km = metros / 1000;
  return km >= 1 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(metros)} m`;
}

/**
 * Lógica PURA de interpretación de los legs de un DirectionsResult ya resuelto (origin=GPS
 * del chofer, waypoints=A [+ intermedias], destination=B/entrega final) — separada de
 * route.ts para poder testearla sin Supabase/Google/env de por medio.
 *
 * legs[0] es SIEMPRE el tramo GPS del chofer → A (nunca cambia, sea carga simple o
 * multietapa: el origen del pedido a Directions siempre es el GPS, nunca una parada).
 * legs[1..] es el recorrido de la carga en sí (A → siguiente parada → ... → B).
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

  return {
    dentroRadioInicial: hastaCargaKm <= radioInicialKm,
    dentroRadioMaximo:  hastaCargaKm <= radioMaximoKm,
    hastaCargaKm,
    hastaCargaTexto: hastaCarga.distanciaTexto,
    recorridoCargaKm:    legsRecorrido.length ? recorridoMetros / 1000 : null,
    recorridoCargaTexto: legsRecorrido.length ? formatearKm(recorridoMetros) : null,
    totalKm: totalMetros / 1000,
    totalTexto: formatearKm(totalMetros),
    duracionHastaCargaTexto: hastaCarga.duracionTexto || null,
  };
}
