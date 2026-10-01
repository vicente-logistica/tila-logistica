import { leerConfiguracionComisiones } from "./configuracionComisiones.ts";
import { cotizarCarga, camposEconomicosCarga, TIPOS_VEHICULO_VALIDOS } from "./cotizacion.ts";
import type { ResultadoRutaPublicacion } from "./geo/rutaPublicacion.ts";

/**
 * Lógica de POST /api/cargas/publicar, separada del handler para testearla con dobles.
 *
 * La ruta del SERVIDOR (una llamada a Directions con origen → paradas → destino, ver
 * app/lib/geo/rutaPublicacion.ts) es la fuente de verdad de los km y de la geografía:
 *   - si los km que mostró /publicar no coinciden → 409, NO se crea nada, y se devuelven
 *     los km y la cotización correctos para que el cliente los vea y vuelva a publicar;
 *   - la tarifa se calcula con esos km del servidor (misma cotizarCarga que la vista previa);
 *   - place_id/lat/lng/geo_obtenido_at se guardan en cargas.origen_* / destino_* y en
 *     paradas_viaje. cargas.lat/lng NO se tocan: son sólo el GPS del chofer.
 * Las paradas se insertan acá (antes las insertaba el navegador). Sin transacción
 * disponible: si falla ese INSERT se COMPENSA borrando la carga recién creada.
 */

export const MAXIMO_PARADAS_INTERMEDIAS = 4;

/** Marca que pasa el handler cuando el body no es JSON válido (se rechaza tras validar el usuario). */
export const BODY_JSON_INVALIDO = Symbol("BODY_JSON_INVALIDO");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteDb = { from: (tabla: string) => any };
export interface DependenciasPublicar {
  db: ClienteDb;
  obtenerRuta: (direcciones: string[]) => Promise<ResultadoRutaPublicacion>;
  ahora?: () => Date;
}
type Respuesta = { status: number; body: Record<string, unknown> };

const error = (status: number, mensaje: string, extra: Record<string, unknown> = {}): Respuesta =>
  ({ status, body: { error: mensaje, ...extra } });

export async function procesarPublicacion(
  deps: DependenciasPublicar, userId: string | null, body: unknown,
): Promise<Respuesta> {
  const { db, obtenerRuta } = deps;
  const ahora = deps.ahora ?? (() => new Date());

  // ── 1. Usuario ─────────────────────────────────────────────────────────────
  if (!userId) return error(401, "No autorizado: falta x-user-id");
  const { data: usuario, error: userError } = await db
    .from("usuarios")
    .select("id, rol, eliminado, estado_aprobacion")
    .eq("id", userId)
    .single();
  if (userError || !usuario) return error(401, "No autorizado: usuario no encontrado");
  if (usuario.eliminado) return error(403, "Esta cuenta ha sido eliminada.");
  if (usuario.rol !== "cliente") return error(403, "Prohibido: solo clientes pueden publicar viajes");
  if (usuario.estado_aprobacion === "suspendido") {
    return error(403, "Tu cuenta está suspendida. Contactá al administrador para reactivarla.");
  }

  // ── 2. Campos obligatorios (mismas validaciones y mensajes que antes) ──────
  if (body === BODY_JSON_INVALIDO) return error(400, "Body JSON inválido");
  const {
    origen, destino, tipo_vehiculo, tipo_carroceria, categoria_legal,
    peso, tipo_carga, detalles, km_estimados, paradas_intermedias,
  } = (body ?? {}) as Record<string, unknown>;

  if (!origen || typeof origen !== "string" || !origen.trim()) return error(400, "Campo obligatorio: origen");
  if (!destino || typeof destino !== "string" || !destino.trim()) return error(400, "Campo obligatorio: destino");
  if (!tipo_vehiculo || typeof tipo_vehiculo !== "string") return error(400, "Campo obligatorio: tipo_vehiculo");
  if (!TIPOS_VEHICULO_VALIDOS.includes(tipo_vehiculo)) {
    return error(400, `tipo_vehiculo inválido. Valores permitidos: ${TIPOS_VEHICULO_VALIDOS.join(", ")}`);
  }
  if (!tipo_carga || typeof tipo_carga !== "string") return error(400, "Campo obligatorio: tipo_carga");

  // km que vio el cliente en la vista previa — sólo se usan para detectar que quedaron
  // viejos (o fueron manipulados); los km guardados salen de la ruta del servidor.
  const kmNum = Number(km_estimados);
  if (!kmNum || kmNum <= 0) return error(400, "km_estimados debe ser un número positivo");

  // ── 3. Paradas intermedias (mismo filtrado que /publicar: texto recortado, sin vacías) ─
  if (paradas_intermedias !== undefined && paradas_intermedias !== null
      && (!Array.isArray(paradas_intermedias) || paradas_intermedias.some(p => typeof p !== "string"))) {
    return error(400, "paradas_intermedias inválidas");
  }
  const paradas = ((paradas_intermedias ?? []) as string[]).map(p => p.trim()).filter(Boolean);
  if (paradas.length > MAXIMO_PARADAS_INTERMEDIAS) {
    return error(400, `Máximo ${MAXIMO_PARADAS_INTERMEDIAS} paradas intermedias`);
  }
  const direcciones = [origen.trim(), ...paradas, destino.trim()];

  // ── 4. Ruta definitiva en el servidor (km + geografía) ────────────────────────
  const ruta = await obtenerRuta(direcciones);
  if (!ruta.ok) {
    console.error(`[cargas/publicar] no se pudo calcular la ruta: ${ruta.motivo}`);
    return error(503, "No pudimos calcular la distancia del viaje. Revisá las direcciones o reintentá en unos minutos.", { motivo: ruta.motivo });
  }
  const kmServidor = ruta.kmTotal;

  // ── 5. Tarifa con los km del servidor (misma configuración y función que la vista previa) ─
  const comisiones = await leerConfiguracionComisiones(db);
  const tarifa = cotizarCarga(
    { kmEstimados: kmServidor, tipoVehiculo: tipo_vehiculo, tipoCarga: tipo_carga, paradasIntermedias: paradas },
    comisiones,
  );
  const economicos = camposEconomicosCarga(tarifa);

  // ── 6. km de la vista previa desactualizados/manipulados → 409, sin crear nada ──
  if (kmNum !== kmServidor) {
    return error(
      409,
      `La distancia del viaje se actualizó a ${kmServidor} km. Revisá el precio y volvé a publicar.`,
      { codigo: "KM_DESACTUALIZADOS", km_enviados: kmNum, km_estimados: kmServidor, cotizacion: economicos },
    );
  }

  // ── 7. INSERT de la carga (campos sensibles siempre server-side) ──────────────
  const geoObtenidoAt = ahora().toISOString();
  const puntoOrigen = ruta.puntos[0];
  const puntoDestino = ruta.puntos[ruta.puntos.length - 1];
  const vehiculoTexto = [tipo_vehiculo, tipo_carroceria, categoria_legal].filter(Boolean).join(" - ");

  const { data: carga, error: insertError } = await db
    .from("cargas")
    .insert([{
      // ── Identidad (server-side) ──────────────────────────────────────────
      cliente_id:          userId,
      estado:              "pendiente",
      pago_estado:         "pendiente_pago",
      pagado_cliente:      false,
      tracking:            false,
      chofer_id:           null,
      oculto_cliente:      false,
      oculto_chofer:       false,
      // ── Datos del viaje (del body, ya validados) ─────────────────────────
      origen:              origen.trim(),
      destino:             destino.trim(),
      vehiculo:            vehiculoTexto,
      categoria_legal:     categoria_legal ?? null,
      tipo_vehiculo,
      tipo_carroceria:     tipo_carroceria ?? null,
      peso:                peso ?? null,
      tipo_carga,
      detalles:            detalles ?? null,
      km_estimados:        kmServidor,
      // ── Geografía de la ruta del servidor (NO cargas.lat/lng: ese es el GPS del chofer) ─
      origen_place_id:     puntoOrigen.placeId,
      origen_lat:          puntoOrigen.lat,
      origen_lng:          puntoOrigen.lng,
      destino_place_id:    puntoDestino.placeId,
      destino_lat:         puntoDestino.lat,
      destino_lng:         puntoDestino.lng,
      geo_obtenido_at:     geoObtenidoAt,
      // ── Tarifas (calculadas server-side) ─────────────────────────────────
      precio_base:         economicos.precio_base,
      precio_cliente:      economicos.precio_cliente,
      pago_chofer:         economicos.pago_chofer,
      comision_plataforma: economicos.comision_plataforma,
    }])
    .select()
    .single();

  if (insertError || !carga) {
    console.error("[cargas/publicar] error INSERT:", insertError?.message);
    return error(500, "Error al publicar la carga");
  }

  // ── 8. Paradas (sólo multietapa, mismas filas que armaba el navegador) + geografía ─
  if (paradas.length > 0) {
    const cargaId = Number(carga.id);
    const fila = (orden: number, tipo: string, direccion: string) => ({
      carga_id:        cargaId,
      orden,
      tipo,
      direccion,
      estado:          "pendiente",
      lat:             ruta.puntos[orden].lat,
      lng:             ruta.puntos[orden].lng,
      place_id:        ruta.puntos[orden].placeId,
      geo_obtenido_at: geoObtenidoAt,
    });
    const filas = [
      fila(0, "retiro", origen.trim()),
      ...paradas.map((direccion, i) => fila(i + 1, "parada", direccion)),
      fila(paradas.length + 1, "entrega", destino.trim()),
    ];
    // Un único INSERT de todas las filas: PostgREST lo ejecuta como una sola sentencia
    // (o entran todas o ninguna).
    const { error: errorParadas } = await db.from("paradas_viaje").insert(filas);
    if (errorParadas) {
      // Compensación: no puede quedar una carga multietapa sin sus paradas.
      console.error(`[cargas/publicar] error INSERT paradas_viaje (carga ${cargaId}): ${errorParadas.message}`);
      const { error: errorBorrado } = await db.from("cargas").delete().eq("id", cargaId);
      if (errorBorrado) {
        console.error(`[cargas/publicar] COMPENSACION_FALLIDA: la carga ${cargaId} quedó sin paradas: ${errorBorrado.message}`);
      }
      return error(500, "Error al publicar la carga");
    }
  }

  return { status: 200, body: { ok: true, carga } };
}
