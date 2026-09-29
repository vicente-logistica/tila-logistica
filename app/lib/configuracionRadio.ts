/**
 * Radio de matching (km) — cuán lejos puede estar el punto de RETIRO A de una carga
 * pendiente del GPS del chofer para que se le ofrezca y la pueda aceptar. Valor GLOBAL,
 * editable desde Panel Admin → Configuración, guardado en
 * `configuracion_plataforma.radio_matching_km` (migración
 * supabase/migrations/20260929_radio_matching_configurable.sql).
 *
 * Se lee SÓLO en el servidor (service role) y lo usan, con el MISMO valor, el listado
 * (/api/chofer/distancias-cercanas) y la revalidación al aceptar (/api/cargas/aceptar).
 *
 * Si la columna/tabla todavía no existe, hay error de lectura o el valor es inválido → 35
 * km (el radio actual de producción), registrando el motivo en el log.
 *
 * Nota de costo: el prefiltro Haversine usa este mismo radio, así que un radio muy grande
 * deja pasar más cargas a la etapa de distancia real y aumenta las llamadas a Google
 * Directions (una por carga candidata por chofer y posición, con caché de 3 min). Es un
 * efecto de costo/latencia, no cambia qué cargas se ofrecen.
 *
 * Este archivo no importa nada del servidor: el panel admin también usa textoARadioKm.
 */

export const RADIO_MATCHING_KM_DEFECTO = 35;
/** Límite TÉCNICO de la columna integer de Postgres (no es un tope comercial). */
export const RADIO_MATCHING_KM_MAXIMO_TECNICO = 2147483647;

export function esRadioMatchingValido(km: unknown): km is number {
  return typeof km === "number" && Number.isInteger(km) && km >= 1 && km <= RADIO_MATCHING_KM_MAXIMO_TECNICO;
}

/** "65" → 65 · " 100 km " → 100. null si no es un entero ≥ 1 (sin decimales ni texto). */
export function textoARadioKm(texto: string): number | null {
  const m = /^\s*(\d{1,10})\s*(?:km)?\s*$/i.exec(texto ?? "");
  if (!m) return null;
  const km = Number(m[1]);
  return esRadioMatchingValido(km) ? km : null;
}

export interface ConfiguracionRadio {
  radioKm: number;
  fuente: "db" | "fallback";
  motivo?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteDb = { from: (tabla: string) => any };

export async function leerRadioMatching(db: ClienteDb): Promise<ConfiguracionRadio> {
  const fallback = (motivo: string): ConfiguracionRadio => {
    console.error(`[radio-matching] usando ${RADIO_MATCHING_KM_DEFECTO} km por defecto — motivo: ${motivo}`);
    return { radioKm: RADIO_MATCHING_KM_DEFECTO, fuente: "fallback", motivo };
  };
  try {
    const { data, error } = await db
      .from("configuracion_plataforma")
      .select("radio_matching_km")
      .eq("id", 1)
      .maybeSingle();
    if (error) return fallback(`error_lectura(${error.code ?? ""} ${error.message ?? ""})`.trim());
    if (!data) return fallback("sin_fila");
    if (!esRadioMatchingValido(data.radio_matching_km)) return fallback(`valor_invalido(${String(data.radio_matching_km)})`);
    return { radioKm: data.radio_matching_km, fuente: "db" };
  } catch (e) {
    return fallback(`excepcion(${e instanceof Error ? e.message : String(e)})`);
  }
}

/** Guarda el radio (sólo lo llama el endpoint admin después de verificar el rol). */
export async function guardarRadioMatching(db: ClienteDb, valor: unknown, adminId: string):
  Promise<{ ok: true; config: ConfiguracionRadio } | { ok: false; error: string }> {
  if (!esRadioMatchingValido(valor)) return { ok: false, error: "Radio inválido: debe ser un número entero de km mayor o igual a 1" };
  const { data, error } = await db
    .from("configuracion_plataforma")
    .upsert({ id: 1, radio_matching_km: valor, updated_at: new Date().toISOString(), updated_by: adminId }, { onConflict: "id" })
    .select("radio_matching_km")
    .single();
  if (error) return { ok: false, error: `No se pudo guardar el radio (${error.message ?? error.code ?? "error"})` };
  if (!data || !esRadioMatchingValido(data.radio_matching_km)) return { ok: false, error: "La base devolvió un radio inválido" };
  return { ok: true, config: { radioKm: data.radio_matching_km, fuente: "db" } };
}
