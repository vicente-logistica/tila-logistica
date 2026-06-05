/**
 * TILA — Módulo de Tarifas v2
 * Modelo: Costos Fijos (tiempo) + Costos Variables (km) + extras
 *
 * Calibración base:
 *   Tractor semi playo 1.200 km = USD 2.600 × $1.435 = $3.731.000
 *   valorKm: 2900 $/km | valorHora: 50000 $/h | mínimo: 300.000
 *
 * Comisión TILA: 14%
 *   precioCliente = subtotal × 1.14
 *   choferCobra   = subtotal
 *   comisionTila  = subtotal × 0.14
 */

// ─── Tabla de vehículos ───────────────────────────────────────────────────────

export interface ConfigVehiculo {
    valorKm: number;
    valorHora: number;
    minimo: number;
  }
  
  export const VEHICULOS: Record<string, ConfigVehiculo> = {
    tractor_semi_playo:   { valorKm: 2900, valorHora: 50000, minimo: 300000 },
    camion_grande_semi:   { valorKm: 2900, valorHora: 50000, minimo: 300000 },
    camion_mediano:       { valorKm: 1800, valorHora: 30000, minimo: 150000 },
    utilitario:           { valorKm: 900,  valorHora: 15000, minimo: 50000  },
    // Aliases — nombres exactos usados en Supabase campo tipo_vehiculo
    "Camión tractor":     { valorKm: 2900, valorHora: 50000, minimo: 300000 },
    "Bitrén":             { valorKm: 2900, valorHora: 50000, minimo: 300000 },
    "Camión rígido":      { valorKm: 1800, valorHora: 30000, minimo: 150000 },
    "Furgón":             { valorKm: 900,  valorHora: 15000, minimo: 50000  },
    "Pick-up":            { valorKm: 900,  valorHora: 15000, minimo: 50000  },
    "Utilitario":         { valorKm: 900,  valorHora: 15000, minimo: 50000  },
    "Moto":               { valorKm: 400,  valorHora: 8000,  minimo: 15000  },
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
    porcentajeComisionTila?: number;
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
    porcentajeComisionTila = 14,
  }: InputTarifa): ResultadoTarifa {
  
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
  
    const comision      = porcentajeComisionTila / 100;
    const precioCliente = Math.round(subtotal * (1 + comision));
    const choferCobra   = subtotal;
    const comisionTila  = precioCliente - choferCobra;
  
    console.log("[tarifas v2]", {
      distanciaKm, tipoVehiculo, tipoCarga, horas,
      costoDistancia: Math.round(costoDistancia),
      costoTiempo:    Math.round(costoTiempo),
      subtotalBase:   Math.round(subtotalBase),
      factorCarga, minimoAplicado, subtotal,
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