import {
  debeBuscarVuelta, evaluarOportunidadVuelta, esCompatibleVehiculo, rankearVuelta, distanciaAlCorredorKm,
  type OportunidadVuelta,
} from "./geo/vueltaACasa.ts";
import { distanciaHaversineKm, esCoordenadaValida, type PuntoGeo } from "./geo/haversine.ts";
import { leerConfiguracionOperativa } from "./configuracionOperativa.ts";

/**
 * Lógica de GET /api/chofer/oportunidades-vuelta ("Vuelta a Casa"), separada del handler
 * para testearla con dobles. SÓLO LECTURA: únicamente SELECT — nunca update/insert/upsert/
 * delete/rpc —, no toca el viaje activo, su estado, el chofer_id ni ninguna carga.
 */

export const ESTADOS_VIAJE_EN_CURSO = ["Chofer asignado", "En camino", "Carga retirada", "En ruta", "Descarga completada"];
export const MAXIMO_CARGAS_EVALUADAS = 200;
const CONCURRENCIA = 4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteDb = { from: (tabla: string) => any };
export interface DependenciasVuelta {
  db: ClienteDb;
  geocodificar: (direccion: string) => Promise<PuntoGeo | null>;
  obtenerCorredor: (dirB: string, dirA: string) => Promise<PuntoGeo[] | null>;
}
type Respuesta = { status: number; body: Record<string, unknown> };

const inactivo = (motivo: string, extra: Record<string, unknown> = {}): Respuesta =>
  ({ status: 200, body: { ok: true, activo: false, motivo, oportunidades: [], ...extra } });

export async function procesarOportunidadesVuelta(
  deps: DependenciasVuelta, userId: string | null,
  params: { cargaId: string | null; lat: unknown; lng: unknown },
): Promise<Respuesta> {
  const { db, geocodificar, obtenerCorredor } = deps;
  if (!userId) return { status: 401, body: { error: "No autorizado" } };

  // ── 1. Chofer ──────────────────────────────────────────────────────────────
  const { data: usuario, error: errUsuario } = await db
    .from("usuarios").select("id, rol, eliminado, categoria_legal, vehiculo_activo_id").eq("id", userId).maybeSingle();
  if (errUsuario || !usuario) return { status: 401, body: { error: "No autorizado" } };
  if (usuario.rol !== "chofer" || usuario.eliminado) return { status: 403, body: { error: "Prohibido" } };

  // ── 2. Configuración operativa (fallback: habilitada, 150 km, radio 35) ─────
  const config = await leerConfiguracionOperativa(db);
  if (!config.vuelta.habilitada) return inactivo("deshabilitada");

  // ── 3. SU viaje activo (A → B) ───────────────────────────────────────────────
  const columnas = "id, chofer_id, estado, origen, destino, lat, lng";
  let viaje: { id: number; chofer_id: string; estado: string; origen: string | null; destino: string | null; lat: number | null; lng: number | null } | null;
  if (params.cargaId) {
    const { data } = await db.from("cargas").select(columnas).eq("id", params.cargaId).maybeSingle();
    if (!data || String(data.chofer_id) !== String(userId)) return { status: 403, body: { error: "Ese viaje no es tuyo" } };
    viaje = data;
  } else {
    const { data } = await db.from("cargas").select(columnas)
      .eq("chofer_id", userId).in("estado", ESTADOS_VIAJE_EN_CURSO)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    viaje = data ?? null;
  }
  if (!viaje || !ESTADOS_VIAJE_EN_CURSO.includes(viaje.estado)) return inactivo("sin_viaje_activo");

  const { data: paradas } = await db.from("paradas_viaje").select("orden, direccion").eq("carga_id", viaje.id).order("orden", { ascending: true });
  const puntos: string[] = paradas && paradas.length >= 2 ? paradas.map((p: { direccion: string }) => p.direccion) : [viaje.origen ?? "", viaje.destino ?? ""];
  const dirA = puntos[0], dirB = puntos[puntos.length - 1];
  if (!dirA?.trim() || !dirB?.trim()) return inactivo("sin_direcciones");

  // ── 4. ¿Ya falta poco para B? (GPS del request, o el último guardado del viaje) ──
  const gps: PuntoGeo | null = esCoordenadaValida(params.lat, params.lng)
    ? { lat: params.lat as number, lng: params.lng as number }
    : esCoordenadaValida(viaje.lat, viaje.lng) ? { lat: viaje.lat as number, lng: viaje.lng as number } : null;
  if (!gps) return inactivo("sin_gps", { destino_regreso: dirA });
  const [A, B] = await Promise.all([geocodificar(dirA), geocodificar(dirB)]);
  if (!A || !B) return inactivo("sin_coordenadas", { destino_regreso: dirA });
  const kmRestantes = Math.round(distanciaHaversineKm(gps, B));
  if (!debeBuscarVuelta(kmRestantes, config.vuelta.inicioKm, true)) {
    return inactivo("lejos_del_destino", { destino_regreso: dirA, km_restantes_hasta_destino: kmRestantes, inicio_km: config.vuelta.inicioKm });
  }

  // ── 5. Vehículo del chofer ───────────────────────────────────────────────────
  let tipoActivo: string | null = null;
  if (usuario.vehiculo_activo_id) {
    const { data: v } = await db.from("vehiculos").select("tipo_vehiculo").eq("id", usuario.vehiculo_activo_id).maybeSingle();
    tipoActivo = v?.tipo_vehiculo ?? null;
  }
  const base = { ok: true, activo: true, destino_regreso: dirA, km_restantes_hasta_destino: kmRestantes, inicio_km: config.vuelta.inicioKm };
  if (!tipoActivo) return { status: 200, body: { ...base, oportunidades: [], motivo: "sin_vehiculo_activo" } };

  // ── 6. Corredor de regreso B → A (ruta real) ─────────────────────────────────
  const corredor = await obtenerCorredor(dirB, dirA);
  if (!corredor || corredor.length === 0) return { status: 200, body: { ...base, oportunidades: [], motivo: "sin_corredor" } };

  // ── 7. Cargas pendientes sin chofer, compatibles ─────────────────────────────
  const { data: pendientes, error: errPend } = await db.from("cargas")
    .select("id, origen, destino, tipo_vehiculo, vehiculo, categoria_legal, pago_chofer, km_estimados, estado, chofer_id")
    .eq("estado", "pendiente").is("chofer_id", null).neq("id", viaje.id)
    .order("created_at", { ascending: false }).limit(MAXIMO_CARGAS_EVALUADAS);
  if (errPend) return { status: 500, body: { error: "Error al leer cargas" } };

  const candidatas = (pendientes ?? []).filter((c: Record<string, unknown>) =>
    c.estado === "pendiente" && !c.chofer_id && c.id !== viaje!.id
    && typeof c.origen === "string" && c.origen.trim() && typeof c.destino === "string" && c.destino.trim()
    && esCompatibleVehiculo(c, tipoActivo, usuario.categoria_legal));

  // ── 8. Evaluación (D sólo se geocodifica si C está sobre el corredor) ─────────
  const ops: OportunidadVuelta[] = [];
  for (let i = 0; i < candidatas.length; i += CONCURRENCIA) {
    await Promise.all(candidatas.slice(i, i + CONCURRENCIA).map(async (c: Record<string, unknown>) => {
      const C = await geocodificar(c.origen as string);
      if (!C || !(distanciaAlCorredorKm(C, corredor) <= config.radioKm)) return; // prefiltro: C fuera del corredor
      const D = await geocodificar(c.destino as string);
      if (!D) return;
      const m = evaluarOportunidadVuelta(A, B, C, D, corredor, config.radioKm);
      if (!m) return;
      const kmEst = Number(c.km_estimados);
      ops.push({
        carga_id: c.id as number,
        retiro: c.origen as string,
        destino: c.destino as string,
        km_hasta_retiro: m.kmHastaRetiro,
        km_nuevo_viaje: kmEst > 0 ? Math.round(kmEst) : Math.round(distanciaHaversineKm(C, D)),
        km_acerca_a_casa: m.kmAcercaACasa,
        km_restantes_a_casa: m.kmRestantesACasa,
        pago_chofer: c.pago_chofer == null ? null : Number(c.pago_chofer),
        estado: "OPORTUNIDAD DE VUELTA",
      });
    }));
  }

  return { status: 200, body: { ...base, oportunidades: rankearVuelta(ops), metodo: "corredor_ruta_real" } };
}
