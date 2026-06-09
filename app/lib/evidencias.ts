/**
 * Helper para registrar evidencias automáticas de viaje en la tabla viaje_evidencias.
 * Si falla, solo loguea — nunca bloquea el flujo operativo.
 */

export type EventoEvidencia =
  | "viaje_aceptado"
  | "chofer_en_camino"
  | "carga_retirada"
  | "en_ruta"
  | "descarga_completada"
  | "viaje_finalizado";

export interface DatosEvidencia {
  usuarioId?: string;
  estadoViaje?: string;
  lat?: number | null;
  lng?: number | null;
  nombreReceptor?: string;
  observacion?: string;
  fotoUrl?: string;
  // campos ampliados para carga y descarga
  tipoOperacion?: string;  // "carga" | "descarga"
  tipoCarga?: string;
  entregaNombre?: string;  // quién entregó (evento carga_retirada)
  recibioNombre?: string;  // quién recibió (evento descarga_completada)
}

export async function registrarEvidencia(
  supabase: any,
  cargaId: number | string,
  evento: EventoEvidencia | string,
  datos: DatosEvidencia = {},
): Promise<void> {
  try {
    const payload: Record<string, any> = {
      carga_id:     Number(cargaId),
      evento,
      rol_usuario:  "chofer",
      estado_viaje: datos.estadoViaje ?? null,
      lat:          datos.lat ?? null,
      lng:          datos.lng ?? null,
    };

    if (datos.usuarioId)      payload.usuario_id      = datos.usuarioId;
    if (datos.nombreReceptor) payload.nombre_receptor = datos.nombreReceptor;
    if (datos.recibioNombre)  payload.recibio_nombre  = datos.recibioNombre;
    if (datos.entregaNombre)  payload.entrego_nombre  = datos.entregaNombre;
    if (datos.tipoOperacion)  payload.tipo_operacion  = datos.tipoOperacion;
    if (datos.tipoCarga)      payload.tipo_carga      = datos.tipoCarga;
    if (datos.observacion)    payload.observacion     = datos.observacion;
    if (datos.fotoUrl)        payload.foto_url        = datos.fotoUrl;

    console.log("[EVIDENCIA] Payload a insertar:", JSON.stringify(payload));
    const { error } = await supabase.from("viaje_evidencias").insert([payload]);

    if (error) {
      console.warn("[EVIDENCIA] Error al registrar evidencia:", evento, error.message);
    } else {
      console.log("[EVIDENCIA] Registrada OK:", evento, "carga:", cargaId);
    }
  } catch (err: any) {
    console.warn("[EVIDENCIA] Excepción al registrar evidencia:", evento, err?.message ?? err);
  }
}

/** Mapea nombre de estado del viaje al evento de evidencia correspondiente */
export function estadoAEvento(estado: string): EventoEvidencia | null {
  const mapa: Record<string, EventoEvidencia> = {
    "Chofer asignado":     "viaje_aceptado",
    "En camino":           "chofer_en_camino",
    "Carga retirada":      "carga_retirada",
    "En ruta":             "en_ruta",
    "Descarga completada": "descarga_completada",
    "Viaje finalizado":    "viaje_finalizado",
  };
  return mapa[estado] ?? null;
}
