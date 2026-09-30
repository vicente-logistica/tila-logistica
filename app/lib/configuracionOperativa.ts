import { leerRadioMatching, esRadioMatchingValido, RADIO_MATCHING_KM_DEFECTO } from "./configuracionRadio.ts";

/**
 * Configuración operativa (Panel Admin → Configuración operativa), en la fila única de
 * configuracion_plataforma:
 *   - radio_matching_km       → radio normal de matching (lo leen listado, alarma y aceptación
 *                               vía leerRadioMatching — el mismo valor).
 *   - vuelta_casa_habilitada  → si "Vuelta a Casa" busca oportunidades.
 *   - vuelta_casa_inicio_km   → empezar a buscar cuando falten esos km (o menos) hasta B.
 *
 * Fallback (config ilegible, columnas aún no migradas, valores inválidos):
 *   radio 35 km · vuelta habilitada · inicio 150 km.
 * El radio y los campos de vuelta se leen por SEPARADO: si las columnas de vuelta todavía
 * no existen, el radio configurado por el admin se sigue respetando.
 *
 * Sin imports del servidor: el panel admin también usa textoAKmEntero.
 */

export const VUELTA_CASA_HABILITADA_DEFECTO = true;
export const VUELTA_CASA_INICIO_KM_DEFECTO = 150;
const KM_MAXIMO_TECNICO = 2147483647; // columna integer

export function esKmEnteroValido(km: unknown): km is number {
  return typeof km === "number" && Number.isInteger(km) && km >= 1 && km <= KM_MAXIMO_TECNICO;
}

/** "150" → 150 · " 65 km " → 65. null si no es un entero ≥ 1. */
export function textoAKmEntero(texto: string): number | null {
  const m = /^\s*(\d{1,10})\s*(?:km)?\s*$/i.exec(texto ?? "");
  if (!m) return null;
  const km = Number(m[1]);
  return esKmEnteroValido(km) ? km : null;
}

export interface ConfiguracionVuelta {
  habilitada: boolean;
  inicioKm: number;
  fuente: "db" | "fallback";
  motivo?: string;
}

export interface ConfiguracionOperativa {
  radioKm: number;
  radioFuente: "db" | "fallback";
  vuelta: ConfiguracionVuelta;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteDb = { from: (tabla: string) => any };

export async function leerConfiguracionVuelta(db: ClienteDb): Promise<ConfiguracionVuelta> {
  const fallback = (motivo: string): ConfiguracionVuelta => {
    console.error(`[vuelta-a-casa] usando configuración por defecto (habilitada, ${VUELTA_CASA_INICIO_KM_DEFECTO} km) — motivo: ${motivo}`);
    return { habilitada: VUELTA_CASA_HABILITADA_DEFECTO, inicioKm: VUELTA_CASA_INICIO_KM_DEFECTO, fuente: "fallback", motivo };
  };
  try {
    const { data, error } = await db
      .from("configuracion_plataforma")
      .select("vuelta_casa_habilitada, vuelta_casa_inicio_km")
      .eq("id", 1)
      .maybeSingle();
    if (error) return fallback(`error_lectura(${error.code ?? ""} ${error.message ?? ""})`.trim());
    if (!data) return fallback("sin_fila");
    if (typeof data.vuelta_casa_habilitada !== "boolean" || !esKmEnteroValido(data.vuelta_casa_inicio_km)) {
      return fallback(`valores_invalidos(${String(data.vuelta_casa_habilitada)}, ${String(data.vuelta_casa_inicio_km)})`);
    }
    return { habilitada: data.vuelta_casa_habilitada, inicioKm: data.vuelta_casa_inicio_km, fuente: "db" };
  } catch (e) {
    return fallback(`excepcion(${e instanceof Error ? e.message : String(e)})`);
  }
}

export async function leerConfiguracionOperativa(db: ClienteDb): Promise<ConfiguracionOperativa> {
  const [radio, vuelta] = await Promise.all([leerRadioMatching(db), leerConfiguracionVuelta(db)]);
  return { radioKm: radio.radioKm, radioFuente: radio.fuente, vuelta };
}

/** Guarda los tres valores (sólo lo llama el endpoint admin después de verificar el rol). */
export async function guardarConfiguracionOperativa(
  db: ClienteDb,
  valores: { radioKm: unknown; vueltaHabilitada: unknown; vueltaInicioKm: unknown },
  adminId: string,
): Promise<{ ok: true; config: ConfiguracionOperativa } | { ok: false; error: string }> {
  if (!esRadioMatchingValido(valores.radioKm)) return { ok: false, error: "Valor inválido: el radio debe ser un entero de km mayor que 0" };
  if (typeof valores.vueltaHabilitada !== "boolean") return { ok: false, error: "Valor inválido: activar/desactivar Vuelta a Casa debe ser verdadero o falso" };
  if (!esKmEnteroValido(valores.vueltaInicioKm)) return { ok: false, error: "Valor inválido: el inicio de Vuelta a Casa debe ser un entero de km mayor que 0" };
  const { data, error } = await db
    .from("configuracion_plataforma")
    .upsert({
      id: 1,
      radio_matching_km: valores.radioKm,
      vuelta_casa_habilitada: valores.vueltaHabilitada,
      vuelta_casa_inicio_km: valores.vueltaInicioKm,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    }, { onConflict: "id" })
    .select("radio_matching_km, vuelta_casa_habilitada, vuelta_casa_inicio_km")
    .single();
  if (error) return { ok: false, error: `No se pudo guardar la configuración (${error.message ?? error.code ?? "error"})` };
  if (!data || !esRadioMatchingValido(data.radio_matching_km) || typeof data.vuelta_casa_habilitada !== "boolean" || !esKmEnteroValido(data.vuelta_casa_inicio_km)) {
    return { ok: false, error: "La base devolvió valores inválidos" };
  }
  return {
    ok: true,
    config: {
      radioKm: data.radio_matching_km,
      radioFuente: "db",
      vuelta: { habilitada: data.vuelta_casa_habilitada, inicioKm: data.vuelta_casa_inicio_km, fuente: "db" },
    },
  };
}

export { RADIO_MATCHING_KM_DEFECTO };
