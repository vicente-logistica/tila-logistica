import {
  COMISION_CLIENTE_BP_DEFECTO, COMISION_CHOFER_BP_DEFECTO, esComisionBpValida,
} from "./tarifas.ts";

/**
 * Comisiones vigentes de TILA, leídas SÓLO en el servidor (service role) desde
 * `configuracion_plataforma` (fila única id = 1, ver migración
 * supabase/migrations/20260928_configuracion_comisiones.sql). El navegador nunca lee ni
 * escribe esta tabla directamente: RLS activo, sin permisos para anon/authenticated. Se
 * modifica sólo desde /api/admin/configuracion/comisiones (rol admin).
 *
 * Si la tabla todavía no existe (migración sin aplicar), no hay fila, o los valores no son
 * válidos, se usa 750/750 (las comisiones actuales de producción) y se registra el motivo
 * en el log. Así publicar/cotizar nunca se rompen ni calculan con un valor inválido.
 */
export interface ConfiguracionComisiones {
  comisionClienteBp: number;
  comisionChoferBp: number;
  fuente: "db" | "fallback";
  motivo?: string;
}

export const CONFIGURACION_COMISIONES_DEFECTO: ConfiguracionComisiones = Object.freeze({
  comisionClienteBp: COMISION_CLIENTE_BP_DEFECTO,
  comisionChoferBp:  COMISION_CHOFER_BP_DEFECTO,
  fuente: "fallback",
}) as ConfiguracionComisiones;

/** Valida una fila leída de configuracion_plataforma. */
export function interpretarFilaConfiguracion(fila: unknown): ConfiguracionComisiones | { error: string } {
  if (!fila || typeof fila !== "object") return { error: "sin_fila" };
  const { comision_cliente_bp, comision_chofer_bp } = fila as Record<string, unknown>;
  if (!esComisionBpValida(comision_cliente_bp) || !esComisionBpValida(comision_chofer_bp)) {
    return { error: `valores_invalidos(cliente=${String(comision_cliente_bp)}, chofer=${String(comision_chofer_bp)})` };
  }
  return { comisionClienteBp: comision_cliente_bp, comisionChoferBp: comision_chofer_bp, fuente: "db" };
}

/** Cliente Supabase del servidor (o un doble en tests). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteLectura = { from: (tabla: string) => any };

export async function leerConfiguracionComisiones(db: ClienteLectura): Promise<ConfiguracionComisiones> {
  const fallback = (motivo: string): ConfiguracionComisiones => {
    console.error(`[comisiones] usando 750/750 por defecto — motivo: ${motivo}`);
    return { ...CONFIGURACION_COMISIONES_DEFECTO, motivo };
  };
  try {
    const { data, error } = await db
      .from("configuracion_plataforma")
      .select("comision_cliente_bp, comision_chofer_bp")
      .eq("id", 1)
      .maybeSingle();
    if (error) return fallback(`error_lectura(${error.code ?? ""} ${error.message ?? ""})`.trim());
    const r = interpretarFilaConfiguracion(data);
    return "error" in r ? fallback(r.error) : r;
  } catch (e) {
    return fallback(`excepcion(${e instanceof Error ? e.message : String(e)})`);
  }
}

/**
 * Guarda nuevas comisiones (sólo lo llama el endpoint admin, después de verificar el rol).
 * Upsert sobre la fila id = 1. Valida de nuevo acá: nunca se escribe un valor inválido,
 * aunque la base también lo impediría (CHECK de rango).
 */
export async function guardarConfiguracionComisiones(
  db: ClienteLectura,
  valores: { comisionClienteBp: unknown; comisionChoferBp: unknown },
  adminId: string,
): Promise<{ ok: true; config: ConfiguracionComisiones } | { ok: false; error: string }> {
  if (!esComisionBpValida(valores.comisionClienteBp) || !esComisionBpValida(valores.comisionChoferBp)) {
    return { ok: false, error: "Comisiones inválidas: deben ser enteros en puntos básicos entre 0 y 9999" };
  }
  const { data, error } = await db
    .from("configuracion_plataforma")
    .upsert(
      { id: 1, comision_cliente_bp: valores.comisionClienteBp, comision_chofer_bp: valores.comisionChoferBp, updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "id" },
    )
    .select("comision_cliente_bp, comision_chofer_bp")
    .single();
  if (error) return { ok: false, error: `No se pudo guardar la configuración (${error.message ?? error.code ?? "error"})` };
  const r = interpretarFilaConfiguracion(data);
  return "error" in r ? { ok: false, error: r.error } : { ok: true, config: r };
}
