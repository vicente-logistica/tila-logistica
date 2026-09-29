/**
 * TILA — Módulo de Tarifas v2
 * Modelo: Costos Fijos (tiempo) + Costos Variables (km) + extras
 *
 * Calibración base:
 *   Tractor semi playo 1.200 km = USD 2.600 × $1.435 = $3.731.000
 *   valorKm: 2900 $/km | valorHora: 50000 $/h | mínimo: 300.000
 *
 * Comisiones TILA, en PUNTOS BÁSICOS (bp; 750 = 7,50%), por separado:
 *   precioCliente = subtotal × (1 + comisionClienteBp / 10000)   → lo que paga el cliente
 *   choferCobra   = subtotal × (1 − comisionChoferBp  / 10000)   → lo que cobra el chofer
 *   comisionTila  = precioCliente − choferCobra
 * Redondeo a pesos enteros con aritmética ENTERA (sin floats en el porcentaje). Con
 * 750/750 da exactamente los mismos montos que la fórmula anterior (7.5 / 100), verificado
 * para todo subtotal entero de 0 a 100.000.000.
 */

// ─── Comisiones ───────────────────────────────────────────────────────────────

/** Comisiones vigentes por defecto (7,50% / 7,50%) — mismas que producción. */
export const COMISION_CLIENTE_BP_DEFECTO = 750;
export const COMISION_CHOFER_BP_DEFECTO  = 750;

/** Límite TÉCNICO (no comercial): máximo de la columna `integer` de Postgres donde se
 *  guardan los bp = 21.474.836,47 %. */
export const COMISION_BP_MAXIMO_TECNICO = 2147483647;
/** 100 % — límite MATEMÁTICO de la comisión del chofer: con 100 % el chofer cobra $0; con
 *  más, su pago sería negativo. */
export const COMISION_CHOFER_BP_MAXIMO = 10000;

/** Comisión del cliente: entero de bp ≥ 0, sin tope comercial (sólo el técnico). */
export function esComisionClienteBpValida(bp: unknown): bp is number {
  return typeof bp === "number" && Number.isInteger(bp) && bp >= 0 && bp <= COMISION_BP_MAXIMO_TECNICO;
}

/** Comisión del chofer: entero de bp entre 0 y 10000 (100 %) — nunca un pago negativo. */
export function esComisionChoferBpValida(bp: unknown): bp is number {
  return typeof bp === "number" && Number.isInteger(bp) && bp >= 0 && bp <= COMISION_CHOFER_BP_MAXIMO;
}

/** monto × (10000 ± bp) / 10000, redondeado a pesos enteros (mitad hacia arriba), todo
 *  en enteros. `monto` debe ser un entero ≥ 0. */
function aplicarBp(monto: number, factorBp: number): number {
  const numerador = monto * factorBp;
  // Aritmética entera exacta sólo mientras el producto sea un entero seguro de JS.
  if (!Number.isSafeInteger(numerador)) throw new Error(`Cálculo fuera de rango (monto=${monto}, factor=${factorBp})`);
  const cociente  = Math.floor(numerador / 10000);
  const resto     = numerador - cociente * 10000;
  return resto * 2 >= 10000 ? cociente + 1 : cociente;
}

// ─── Tabla de vehículos ───────────────────────────────────────────────────────

export interface ConfigVehiculo {
    valorKm: number;
    valorHora: number;
    minimo: number;
  }
  
  export const VEHICULOS: Record<string, ConfigVehiculo> = {
    tractor_semi_playo:   { valorKm: 2550, valorHora: 50000, minimo: 500000 },
    camion_grande_semi:   { valorKm: 2550, valorHora: 50000, minimo: 500000 },
  
    camion_mediano:       { valorKm: 2200, valorHora: 45000, minimo: 180000 },
  
    utilitario:           { valorKm: 1800, valorHora: 27000, minimo: 31050 },
  
    // Aliases
    "Camión tractor":     { valorKm: 2550, valorHora: 50000, minimo: 500000 },
    "Bitrén":             { valorKm: 2550, valorHora: 50000, minimo: 700000 },
  
    "Camión rígido":      { valorKm: 2200, valorHora: 45000, minimo: 180000 },
  
    "Furgón":             { valorKm: 2000, valorHora: 36000, minimo: 41400 },
  
    "Pick-up":            { valorKm: 1900, valorHora: 30000, minimo: 34500 },
  
    "Utilitario":         { valorKm: 1800, valorHora: 27000, minimo: 31050 },
  
    "Moto":               { valorKm: 700,  valorHora: 10000, minimo: 15000 },
  };
  
  // ─── Factores por tipo de carga ───────────────────────────────────────────────
  
  export const FACTORES_CARGA: Record<string, number> = {
    general:               1.00,
    normal:                1.00,
    "Carga común":         1.00,
    fragil:                1.15,
    "Carga frágil":        1.15,
    "Carga cara":          1.15,
    refrigerada:           1.30,
    "Carga refrigerada":   1.30,
    peligrosa:             1.50,
    "Carga peligrosa":     1.50,
    sobredimensionada:     1.80,
  };
  
  // ─── Tipos exportados ─────────────────────────────────────────────────────────
  
  export interface InputTarifa {
    distanciaKm: number;
    tipoVehiculo: string;
    tipoCarga?: string;
    duracionHoras?: number;
    cantidadParadas?: number;
    peajes?: number;
    horasEspera?: number;
    /** Puntos básicos (750 = 7,50%). Por defecto, las comisiones vigentes. */
    comisionClienteBp?: number;
    comisionChoferBp?: number;
  }
  
  export interface DetalleTarifa {
    costoDistancia: number;
    costoTiempo: number;
    costoParadas: number;
    costoEspera: number;
    peajes: number;
    factorCarga: number;
    tipoVehiculo: string;
    tipoCarga: string;
    duracionHoras: number;
    distanciaKm: number;
    minimoAplicado: boolean;
  }
  
  export interface ResultadoTarifa {
    precioCliente: number;
    choferCobra: number;
    comisionTila: number;
    subtotalAntesComision: number;
    detalle: DetalleTarifa;
  }
  
  // ─── Función principal ────────────────────────────────────────────────────────
  
  export function calcularTarifaTILA({
    distanciaKm,
    tipoVehiculo,
    tipoCarga = "general",
    duracionHoras,
    cantidadParadas = 1,
    peajes = 0,
    horasEspera = 0,
    comisionClienteBp = COMISION_CLIENTE_BP_DEFECTO,
    comisionChoferBp = COMISION_CHOFER_BP_DEFECTO,
  }: InputTarifa): ResultadoTarifa {

    // Nunca calcular un precio con una comisión inválida (NaN, negativa, decimal, o chofer
    // > 100% — su pago quedaría negativo).
    if (!esComisionClienteBpValida(comisionClienteBp) || !esComisionChoferBpValida(comisionChoferBp)) {
      throw new Error(`Comisión inválida (cliente=${comisionClienteBp} bp, chofer=${comisionChoferBp} bp)`);
    }

    const vehiculo: ConfigVehiculo =
      VEHICULOS[tipoVehiculo] ?? VEHICULOS["camion_mediano"];
  
    const horas = duracionHoras ?? distanciaKm / 60;
  
    const costoDistancia = distanciaKm * vehiculo.valorKm;
    const costoTiempo    = horas * vehiculo.valorHora;
    const paradasExtra   = Math.max(0, cantidadParadas - 1);
    const costoParadas   = paradasExtra * vehiculo.valorHora;
    const costoEspera    = horasEspera * vehiculo.valorHora;
  
    const subtotalBase     = costoDistancia + costoTiempo + costoParadas + costoEspera + peajes;
    const factorCarga      = FACTORES_CARGA[tipoCarga] ?? FACTORES_CARGA["general"];
    const subtotalConCarga = subtotalBase * factorCarga;
    const minimoAplicado   = subtotalConCarga < vehiculo.minimo;
    const subtotal         = Math.round(Math.max(subtotalConCarga, vehiculo.minimo));
  
    const precioCliente = aplicarBp(subtotal, 10000 + comisionClienteBp);
    const choferCobra   = aplicarBp(subtotal, 10000 - comisionChoferBp);
    const comisionTila  = precioCliente - choferCobra;

    console.log("[tarifas v2]", {
      distanciaKm, tipoVehiculo, tipoCarga, horas,
      costoDistancia: Math.round(costoDistancia),
      costoTiempo:    Math.round(costoTiempo),
      subtotalBase:   Math.round(subtotalBase),
      factorCarga, minimoAplicado, subtotal,
      comisionClienteBp, comisionChoferBp,
      precioCliente, choferCobra, comisionTila,
    });

    return {
      precioCliente,
      choferCobra,
      comisionTila,
      subtotalAntesComision: subtotal,
      detalle: {
        costoDistancia:  Math.round(costoDistancia),
        costoTiempo:     Math.round(costoTiempo),
        costoParadas:    Math.round(costoParadas),
        costoEspera:     Math.round(costoEspera),
        peajes,
        factorCarga,
        tipoVehiculo,
        tipoCarga,
        duracionHoras:   Math.round(horas * 10) / 10,
        distanciaKm,
        minimoAplicado,
      },
    };
  }
  
  // ─── Helpers ──────────────────────────────────────────────────────────────────
  
  export function velocidadPromedio(tipoVehiculo: string): number {
    const velocidades: Record<string, number> = {
      "Moto":           60,
      "Utilitario":     55,
      "Furgón":         55,
      "Pick-up":        60,
      "Camión rígido":  70,
      "Camión tractor": 80,
      "Bitrén":         75,
    };
    return velocidades[tipoVehiculo] ?? 60;
  }
  
  export function estimarDuracion(distanciaKm: number, tipoVehiculo: string): number {
    return distanciaKm / velocidadPromedio(tipoVehiculo);
  }
  
  export function esViajeUrbano(km: number): boolean {
    return km < 80;
  }
  
  export function formatearPesos(valor: number): string {
    return `$${valor.toLocaleString("es-AR")}`;
  }