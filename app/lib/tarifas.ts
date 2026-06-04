/**
 * TILA — Módulo de Tarifas
 * Basado en CATAC / UTN-CEDOL abril 2026
 *
 * Fórmula base: Tarifa = CF_base + CV × km
 * Derivada de tabla CATAC cereales y oleaginosas abril 2026:
 *   100 km → $27.192,78  |  500 km → $80.160,92
 *   CV = (80.160,92 − 27.192,78) / 400 = 132,42 $/km
 *   CF_base = 27.192,78 − 132,42 × 100 = 13.950,78 $
 *
 * Factores por categoría (relación proporcional UTN):
 *   N3 = 1,00  (camión > 3,5 t)
 *   N2 = 0,55  (furgón / utilitario pesado)
 *   N1 = 0,25  (moto / utilitario liviano)
 *
 * Comisión plataforma TILA: 7,5%
 *   precio_cliente = tarifa_base × 1,075
 *   pago_chofer    = tarifa_base × 0,925
 */

// ─── Parámetros base (N3, interurbano, abril 2026) ────────────────────────────

const CV_N3 = 132.42;       // $/km variable
const CF_N3 = 13_950.78;   // $ costo fijo base

// Índice CEDOL acumulado 2026 (actualizar mensualmente)
// Mayo 2026: +1,91% sobre abril → acumulado 2026: +17,57%
export const INDICE_CEDOL = 1.1757;

// Factores por categoría legal
const FACTOR_CATEGORIA: Record<string, number> = {
  N3: 1.00,
  N2: 0.55,
  N1: 0.25,
};

// Factor urbano: estructura de costos urbana vs interurbana
// Combustible urbano 26,5% vs interurbano 42% → ratio ≈ 0,63
// Se aplica al componente variable (CV), no al fijo
const FACTOR_URBANO_CV = 0.63;

// Recargos por tipo de carga (opcional, extensible)
const RECARGO_TIPO_CARGA: Record<string, number> = {
  peligrosa:    1.25,
  refrigerada:  1.20,
  granel:       1.00,
  fraccionada:  1.05,
  liquidos:     1.15,
  maquinaria:   1.10,
  normal:       1.00,
};

// Recargos por tipo de carrocería especial
const RECARGO_CARROCERIA: Record<string, number> = {
  "Cisterna":         1.15,
  "Refrigerado":      1.20,
  "Furgón térmico":   1.18,
  "Mosquito":         1.10,
  "Grúa plancha":     1.12,
  "Jaula":            1.05,
  "Tolva":            1.02,
  "Portacontenedor":  1.08,
  "Plataforma":       1.00,
  "Baranda volcable": 1.00,
  "Batea":            1.00,
  "Furgón":           1.00,
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface InputTarifa {
  km: number;
  categoria_legal: "N1" | "N2" | "N3" | string;
  tipo_carga?: string;
  tipo_carroceria?: string;
  esUrbano?: boolean;
}

export interface ResultadoTarifa {
  tarifa_base: number;
  precio_cliente: number;
  pago_chofer: number;
  comision_plataforma: number;
  detalle_calculo: DetalleTarifa;
}

export interface DetalleTarifa {
  km: number;
  categoria_legal: string;
  factor_categoria: number;
  factor_urbano: number;
  recargo_carga: number;
  recargo_carroceria: number;
  indice_cedol: number;
  cf_aplicado: number;
  cv_aplicado: number;
  tarifa_sin_cedol: number;
  tarifa_base: number;
  precio_cliente: number;
  pago_chofer: number;
  comision_plataforma: number;
  porcentaje_comision: number;
}

// ─── Función principal ────────────────────────────────────────────────────────

export function calcularTarifaTILA({
  km,
  categoria_legal,
  tipo_carga,
  tipo_carroceria,
  esUrbano = false,
}: InputTarifa): ResultadoTarifa {
  if (!km || km <= 0) {
    return tarifaVacia();
  }

  // 1. Factor de categoría
  const factorCat = FACTOR_CATEGORIA[categoria_legal] ?? FACTOR_CATEGORIA["N2"];

  // 2. Factor urbano (solo afecta al CV)
  const factorUrbano = esUrbano ? FACTOR_URBANO_CV : 1.0;

  // 3. CF y CV ajustados por categoría
  const cf = CF_N3 * factorCat;
  const cv = CV_N3 * factorCat * factorUrbano;

  // 4. Tarifa base sin ajustes adicionales
  const tarifaSinAjustes = cf + cv * km;

  // 5. Recargo por tipo de carga
  const recargoCarga =
    RECARGO_TIPO_CARGA[tipo_carga?.toLowerCase() ?? "normal"] ??
    RECARGO_TIPO_CARGA["normal"];

  // 6. Recargo por carrocería especial
  const recargoCarroceria =
    RECARGO_CARROCERIA[tipo_carroceria ?? ""] ??
    RECARGO_CARROCERIA["Furgón"];

  // 7. Tarifa antes de CEDOL
  const tarifaSinCedol = tarifaSinAjustes * recargoCarga * recargoCarroceria;

  // 8. Aplicar índice CEDOL
  const tarifaBase = Math.round(tarifaSinCedol * INDICE_CEDOL);

  // 9. Comisión TILA 7,5%
  const COMISION = 0.075;
  const precioCliente = Math.round(tarifaBase * (1 + COMISION));
  const pagoChofer    = Math.round(tarifaBase * (1 - COMISION));
  const comision      = precioCliente - pagoChofer;

  // ── LOG DIAGNÓSTICO — quitar después de verificar ──────────────────────────
  console.log("[tarifas.ts] calcularTarifaTILA →", {
    km,
    categoria_legal,
    tipo_carga,
    tipo_carroceria,
    esUrbano,
    factorCat,
    factorUrbano,
    cf: Math.round(cf),
    cv: Math.round(cv * 100) / 100,
    tarifaSinAjustes: Math.round(tarifaSinAjustes),
    recargoCarga,
    recargoCarroceria,
    tarifaSinCedol: Math.round(tarifaSinCedol),
    INDICE_CEDOL,
    tarifa_base: tarifaBase,
    precio_cliente: precioCliente,
    pago_chofer: pagoChofer,
    comision_plataforma: comision,
  });
  // ── FIN LOG ────────────────────────────────────────────────────────────────

  const detalle: DetalleTarifa = {
    km,
    categoria_legal,
    factor_categoria: factorCat,
    factor_urbano: factorUrbano,
    recargo_carga: recargoCarga,
    recargo_carroceria: recargoCarroceria,
    indice_cedol: INDICE_CEDOL,
    cf_aplicado: Math.round(cf),
    cv_aplicado: Math.round(cv * 100) / 100,
    tarifa_sin_cedol: Math.round(tarifaSinCedol),
    tarifa_base: tarifaBase,
    precio_cliente: precioCliente,
    pago_chofer: pagoChofer,
    comision_plataforma: comision,
    porcentaje_comision: COMISION * 100,
  };

  return {
    tarifa_base: tarifaBase,
    precio_cliente: precioCliente,
    pago_chofer: pagoChofer,
    comision_plataforma: comision,
    detalle_calculo: detalle,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tarifaVacia(): ResultadoTarifa {
  const detalle: DetalleTarifa = {
    km: 0,
    categoria_legal: "",
    factor_categoria: 0,
    factor_urbano: 0,
    recargo_carga: 0,
    recargo_carroceria: 0,
    indice_cedol: INDICE_CEDOL,
    cf_aplicado: 0,
    cv_aplicado: 0,
    tarifa_sin_cedol: 0,
    tarifa_base: 0,
    precio_cliente: 0,
    pago_chofer: 0,
    comision_plataforma: 0,
    porcentaje_comision: 7.5,
  };
  return { tarifa_base: 0, precio_cliente: 0, pago_chofer: 0, comision_plataforma: 0, detalle_calculo: detalle };
}

/**
 * Detecta si un viaje es urbano basándose en la distancia.
 * < 80 km → urbano (estructura de costos distribución urbana)
 */
export function esViajeUrbano(km: number): boolean {
  return km < 80;
}

/**
 * Formatea un número como pesos argentinos.
 */
export function formatearPesos(valor: number): string {
  return `$${valor.toLocaleString("es-AR")}`;
}