import { formatearKm, formatearDuracion, interpretarLegs, type LegSimple } from "./interpretarLegs.ts";
import { RADIO_INICIAL_KM, RADIO_MAXIMO_KM } from "./config.ts";

/**
 * Desglose del recorrido RESTANTE de un viaje ya aceptado (planilla 📋 de viaje-activo):
 * GPS actual del chofer → próxima parada pendiente → ... → destino final.
 *
 * Funciones puras (sin Supabase/Google) — el endpoint /api/chofer/recorrido-viaje las
 * usa para armar los puntos que se piden a Directions y para interpretar los legs.
 */

export interface ParadaViaje {
  orden?: number | null;
  direccion: string;
  tipo?: string | null;
  estado?: string | null;
}

export interface PuntoPendiente {
  /** Letra ORIGINAL de la parada en el viaje (A, B, C…) — no se reetiqueta al completar. */
  etiqueta: string;
  direccion: string;
  tipo: "retiro" | "entrega" | "parada";
}

export interface TramoRecorrido {
  /** "Chofer actual" para el primer tramo; si no, la etiqueta de la parada de salida. */
  desde: string;
  hasta: string;
  hastaDireccion: string;
  distanciaTexto: string;
  duracionTexto: string | null;
  distanciaMetros: number;
  duracionSegundos: number | null;
}

export interface DesgloseRecorrido {
  tramos: TramoRecorrido[];
  totalTexto: string;
  totalDuracionTexto: string | null;
}

export const DESDE_CHOFER = "Chofer actual";

const etiquetaDe = (i: number) => String.fromCharCode(65 + i); // A, B, C, … (sin tope de 6)

// Mismos criterios de estado que viaje-activo usa para viajes sin filas en paradas_viaje.
const ESTADOS_RETIRO_COMPLETADO  = ["Carga retirada", "En ruta", "Descarga completada", "Viaje finalizado"];
const ESTADOS_ENTREGA_COMPLETADA = ["Descarga completada", "Viaje finalizado"];

const normalizarTipo = (t: string | null | undefined, i: number, total: number): PuntoPendiente["tipo"] =>
  t === "retiro" || t === "entrega" || t === "parada" ? t : i === 0 ? "retiro" : i === total - 1 ? "entrega" : "parada";

/**
 * Paradas que todavía faltan, en su orden real, con su letra original.
 *  - Con filas en paradas_viaje: se usan SÓLO esas (nunca se agregan origen/destino de la
 *    carga encima — así no se duplica A/B), ordenadas por `orden`, excluyendo las
 *    `estado === "completada"`.
 *  - Sin filas (viaje simple / legado): se sintetiza A = origen, B = destino, y se
 *    excluyen según el estado del viaje (mismo criterio que viaje-activo).
 */
export function paradasPendientes(
  paradas: ParadaViaje[] | null | undefined,
  viaje: { origen?: string | null; destino?: string | null; estado?: string | null },
): PuntoPendiente[] {
  if (paradas && paradas.length > 0) {
    const ordenadas = [...paradas].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    return ordenadas
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.estado !== "completada" && !!p.direccion?.trim())
      .map(({ p, i }) => ({ etiqueta: etiquetaDe(i), direccion: p.direccion, tipo: normalizarTipo(p.tipo, i, ordenadas.length) }));
  }
  const estado = viaje.estado ?? "Chofer asignado";
  const puntos: PuntoPendiente[] = [];
  if (viaje.origen?.trim() && !ESTADOS_RETIRO_COMPLETADO.includes(estado)) {
    puntos.push({ etiqueta: "A", direccion: viaje.origen, tipo: "retiro" });
  }
  if (viaje.destino?.trim() && !ESTADOS_ENTREGA_COMPLETADA.includes(estado)) {
    puntos.push({ etiqueta: "B", direccion: viaje.destino, tipo: "entrega" });
  }
  return puntos;
}

/**
 * Interpreta los legs de Directions (origin = GPS, waypoints = pendientes salvo el último,
 * destination = el último) como tramos. legs[i] termina en pendientes[i]. Devuelve null si
 * la cantidad de legs no coincide con la de puntos — nunca se inventa ni se reparte un
 * tramo. Totales vía interpretarLegs (misma suma que la tarjeta previa a aceptar).
 */
export function armarDesgloseRecorrido(pendientes: PuntoPendiente[], legs: LegSimple[] | null): DesgloseRecorrido | null {
  if (!legs || pendientes.length === 0 || legs.length !== pendientes.length) return null;
  const totales = interpretarLegs(legs, RADIO_INICIAL_KM, RADIO_MAXIMO_KM);
  if (!totales) return null;
  const tramos = legs.map((leg, i): TramoRecorrido => {
    const seg = typeof leg.duracionSegundos === "number" && leg.duracionSegundos > 0 ? leg.duracionSegundos : null;
    return {
      desde: i === 0 ? DESDE_CHOFER : pendientes[i - 1].etiqueta,
      hasta: pendientes[i].etiqueta,
      hastaDireccion: pendientes[i].direccion,
      distanciaTexto: formatearKm(leg.distanciaMetros),
      duracionTexto: seg !== null ? formatearDuracion(seg) : (leg.duracionTexto || null),
      distanciaMetros: leg.distanciaMetros,
      duracionSegundos: seg,
    };
  });
  return { tramos, totalTexto: totales.totalTexto, totalDuracionTexto: totales.totalDuracionTexto };
}
