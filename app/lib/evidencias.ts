/**
 * Helper para registrar evidencias de viaje.
 *
 * registrarEvidenciaApi  — vía API server-side (POST /api/cargas/evidencia).
 *   Úsalo desde componentes client-side en reemplazo del acceso directo a Supabase.
 *   No bloqueante: si falla, solo loguea — nunca interrumpe el flujo operativo.
 *
 * PENDIENTE ALTO: subirFotoEvidencia en viaje-activo/page.tsx sigue usando
 * supabase.storage con anon key directamente desde el browser. El bucket
 * "documentacion-choferes" no valida que el chofer pertenezca al viaje.
 * Debe migrarse a un endpoint server-side o protegerse con Storage policies.
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

/**
 * Registra una evidencia vía API server-side.
 * No bloqueante: si falla, solo loguea.
 */
export async function registrarEvidenciaApi(
  cargaId: number | string,
  evento: EventoEvidencia | string,
  datos: DatosEvidencia = {},
  userId?: string,
): Promise<void> {
  try {
    const body: Record<string, any> = {
      carga_id:    Number(cargaId),
      evento,
      estado_viaje: datos.estadoViaje ?? null,
      lat:          datos.lat ?? null,
      lng:          datos.lng ?? null,
    };

    if (datos.nombreReceptor) body.nombre_receptor = datos.nombreReceptor;
    if (datos.recibioNombre)  body.recibio_nombre  = datos.recibioNombre;
    if (datos.entregaNombre)  body.entrego_nombre  = datos.entregaNombre;
    if (datos.tipoOperacion)  body.tipo_operacion  = datos.tipoOperacion;
    if (datos.tipoCarga)      body.tipo_carga      = datos.tipoCarga;
    if (datos.observacion)    body.observacion     = datos.observacion;
    if (datos.fotoUrl)        body.foto_url        = datos.fotoUrl;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (userId) headers["x-user-id"] = userId;

    const res = await fetch("/api/cargas/evidencia", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn("[EVIDENCIA] API rechazó evidencia:", evento, err?.error ?? res.status);
    } else {
      console.log("[EVIDENCIA] Registrada OK vía API:", evento, "carga:", cargaId);
    }
  } catch (err: any) {
    console.warn("[EVIDENCIA] Excepción al registrar evidencia vía API:", evento, err?.message ?? err);
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
