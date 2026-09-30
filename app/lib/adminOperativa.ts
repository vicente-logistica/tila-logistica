import { leerConfiguracionOperativa, guardarConfiguracionOperativa, type ConfiguracionOperativa } from "./configuracionOperativa.ts";
import { autorizarAdmin } from "./adminComisiones.ts";

/**
 * Lógica de /api/admin/configuracion/operativa — misma autorización que comisiones y radio:
 * la ruta obtiene la identidad con identidadAdminComisiones (sesión firmada, x-user-id
 * ignorado, control de origen) y acá se exige rol admin verificado en la base.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteDb = { from: (tabla: string) => any };

const cuerpo = (c: ConfiguracionOperativa) => ({
  ok: true,
  radio_matching_km: c.radioKm,
  vuelta_casa_habilitada: c.vuelta.habilitada,
  vuelta_casa_inicio_km: c.vuelta.inicioKm,
  fuente: c.radioFuente === "db" && c.vuelta.fuente === "db" ? "db" : "fallback",
});

export async function procesarGetOperativa(db: ClienteDb, userId: string | null) {
  const rechazo = await autorizarAdmin(db, userId);
  if (rechazo) return rechazo;
  return { status: 200, body: cuerpo(await leerConfiguracionOperativa(db)) };
}

export async function procesarPutOperativa(db: ClienteDb, userId: string | null, body: unknown) {
  const rechazo = await autorizarAdmin(db, userId);
  if (rechazo) return rechazo;
  const b = (body ?? {}) as Record<string, unknown>;
  const r = await guardarConfiguracionOperativa(db, {
    radioKm: b.radio_matching_km,
    vueltaHabilitada: b.vuelta_casa_habilitada,
    vueltaInicioKm: b.vuelta_casa_inicio_km,
  }, userId as string);
  if (!r.ok) return { status: r.error.startsWith("Valor inválido") ? 400 : 500, body: { error: r.error } };
  return { status: 200, body: cuerpo(r.config) };
}
