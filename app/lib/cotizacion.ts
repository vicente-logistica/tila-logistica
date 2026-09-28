import { calcularTarifaTILA, estimarDuracion, type ResultadoTarifa } from "./tarifas.ts";

/**
 * Cotización de una carga — la MISMA función y los mismos mapeos para
 * /api/tarifas/cotizar (vista previa del cliente) y /api/cargas/publicar (lo que se
 * guarda). Así lo que el cliente ve antes de publicar es exactamente lo que se congela.
 */

/** Mapeo tipo_carga (nombre visible) → tipo interno de tarifas. */
export const TIPO_CARGA_MAP: Record<string, string> = {
  "Carga común":       "general",
  "Carga frágil":      "fragil",
  "Carga cara":        "fragil",
  "Carga peligrosa":   "peligrosa",
  "Carga refrigerada": "refrigerada",
};

export const TIPOS_VEHICULO_VALIDOS = [
  "Moto", "Utilitario", "Furgón", "Pick-up",
  "Camión rígido", "Camión tractor", "Bitrén",
];

export interface DatosCotizacion {
  kmEstimados: number;
  tipoVehiculo: string;
  /** Nombre visible ("Carga común", …) — el mismo que se guarda en cargas.tipo_carga. */
  tipoCarga: string;
  paradasIntermedias?: unknown;
}

export interface ComisionesBp {
  comisionClienteBp: number;
  comisionChoferBp: number;
}

export function cotizarCarga(d: DatosCotizacion, comisiones: ComisionesBp): ResultadoTarifa {
  const cantidadParadas = Array.isArray(d.paradasIntermedias)
    ? d.paradasIntermedias.filter((p: unknown) => typeof p === "string" && p.trim()).length + 1
    : 1;
  return calcularTarifaTILA({
    distanciaKm:       d.kmEstimados,
    tipoVehiculo:      d.tipoVehiculo,
    tipoCarga:         TIPO_CARGA_MAP[d.tipoCarga] ?? "general",
    duracionHoras:     estimarDuracion(d.kmEstimados, d.tipoVehiculo),
    cantidadParadas,
    peajes:            0,
    horasEspera:       0,
    comisionClienteBp: comisiones.comisionClienteBp,
    comisionChoferBp:  comisiones.comisionChoferBp,
  });
}

/**
 * Montos que se guardan en `cargas` al publicar — y que cotizar devuelve tal cual. Quedan
 * fijos en la carga: un cambio posterior de comisiones sólo afecta cargas nuevas (ninguna
 * otra ruta escribe estos campos).
 */
export function camposEconomicosCarga(t: ResultadoTarifa) {
  return {
    precio_base:         t.subtotalAntesComision,
    precio_cliente:      t.precioCliente,
    pago_chofer:         t.choferCobra,
    comision_plataforma: t.comisionTila,
  };
}
