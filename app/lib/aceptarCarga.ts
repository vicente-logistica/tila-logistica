import { esCoordenadaValida, type PuntoGeo } from "./geo/haversine.ts";
import { validarRadioInicial } from "./geo/calculoDistanciaCarga.ts";
import { RADIO_INICIAL_KM } from "./geo/config.ts";

/**
 * Reglas de /api/cargas/aceptar separadas del handler (que depende de Next y de un
 * cliente Supabase real) para poder testearlas con node --test.
 *
 * `codigo` es estable y lo lee el cliente para distinguir cada rechazo; `error` es el
 * texto que se le muestra al chofer.
 */
export type CodigoRechazoAceptacion = "sin_gps" | "fuera_de_radio" | "error_distancia" | "ya_tomado";

export interface RechazoAceptacion {
  ok: false;
  status: number;
  codigo: CodigoRechazoAceptacion;
  error: string;
}

/** Texto del rechazo por radio con el radio de matching REAL vigente. */
export const mensajeFueraDeRadio = (radioKm: number) =>
  `Esta carga está fuera del radio permitido de aceptación (${radioKm} km hasta el punto de retiro)`;

export const RECHAZOS = {
  sin_gps: { ok: false, status: 400, codigo: "sin_gps", error: "Se necesita tu ubicación actual (GPS) para aceptar un viaje" },
  fuera_de_radio: { ok: false, status: 403, codigo: "fuera_de_radio", error: mensajeFueraDeRadio(RADIO_INICIAL_KM) },
  error_distancia: { ok: false, status: 503, codigo: "error_distancia", error: "No pudimos calcular la distancia al punto de retiro. Probá de nuevo en unos segundos." },
  ya_tomado: { ok: false, status: 409, codigo: "ya_tomado", error: "Este viaje ya fue tomado por otro chofer" },
} as const satisfies Record<CodigoRechazoAceptacion, RechazoAceptacion>;

/** Sin GPS válido no se puede validar el radio — FAIL-CLOSED: se rechaza, nunca se
 *  asume "está cerca" a falta de datos. */
export function validarGpsAceptacion(lat: unknown, lng: unknown): { ok: true; gps: PuntoGeo } | RechazoAceptacion {
  if (!esCoordenadaValida(lat, lng)) return RECHAZOS.sin_gps;
  return { ok: true, gps: { lat: lat as number, lng: lng as number } };
}

/**
 * Regla de negocio server-side: distancia VIAL GPS→A (Directions, legs[0]) <= radio de
 * matching vigente (`radioKm`, el MISMO que usa el listado), vía la misma
 * validarRadioInicial. Haversine es sólo prefiltro, nunca la validación final. Sin API key,
 * sin geocode de A o sin Directions → error_distancia (rechazo, nunca "por las dudas").
 */
export async function validarRadioAceptacion(
  gps: PuntoGeo, puntosCarga: string[], apiKey: string | undefined, claveCacheBase: string,
  radioKm: number = RADIO_INICIAL_KM,
): Promise<{ ok: true } | RechazoAceptacion> {
  if (!apiKey) return RECHAZOS.error_distancia;
  const r = await validarRadioInicial(gps, puntosCarga, apiKey, claveCacheBase, radioKm);
  if (r.ok) return { ok: true };
  return r.motivo === "fuera_de_rango"
    ? { ...RECHAZOS.fuera_de_radio, error: mensajeFueraDeRadio(radioKm) }
    : RECHAZOS.error_distancia;
}

/** Cliente Supabase (o un doble en tests) — sólo se usa `from("cargas").update(...)`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteAsignacion = { from: (tabla: string) => any };

/**
 * UPDATE atómico anti-carrera: el doble filtro (estado=pendiente + chofer_id IS NULL) hace
 * que, si dos choferes aceptan a la vez, sólo uno actualice la fila; el otro recibe
 * ya_tomado.
 */
export async function asignarChoferAtomico(
  db: ClienteAsignacion, cargaId: unknown, choferId: string,
): Promise<{ ok: true; viajeId: unknown } | RechazoAceptacion> {
  const { data, error } = await db
    .from("cargas")
    .update({ estado: "Chofer asignado", chofer_id: choferId, tracking: true })
    .eq("id", cargaId)
    .eq("estado", "pendiente")
    .is("chofer_id", null)
    .select("id")
    .single();
  if (error || !data) return RECHAZOS.ya_tomado;
  return { ok: true, viajeId: data.id };
}
