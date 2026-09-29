import { leerRadioMatching, guardarRadioMatching } from "./configuracionRadio.ts";
import { autorizarAdmin } from "./adminComisiones.ts";

/**
 * Lógica de /api/admin/configuracion/radio — misma autorización que comisiones: la ruta
 * obtiene la identidad con identidadAdminComisiones (sesión firmada, x-user-id ignorado,
 * control de origen) y acá se exige rol admin verificado en la base.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteDb = { from: (tabla: string) => any };

export async function procesarGetRadio(db: ClienteDb, userId: string | null) {
  const rechazo = await autorizarAdmin(db, userId);
  if (rechazo) return rechazo;
  const c = await leerRadioMatching(db);
  return { status: 200, body: { ok: true, radio_matching_km: c.radioKm, fuente: c.fuente, ...(c.motivo ? { motivo: c.motivo } : {}) } };
}

export async function procesarPutRadio(db: ClienteDb, userId: string | null, body: unknown) {
  const rechazo = await autorizarAdmin(db, userId);
  if (rechazo) return rechazo;
  const valor = ((body ?? {}) as Record<string, unknown>).radio_matching_km;
  const r = await guardarRadioMatching(db, valor, userId as string);
  if (!r.ok) return { status: r.error.startsWith("Radio inválido") ? 400 : 500, body: { error: r.error } };
  return { status: 200, body: { ok: true, radio_matching_km: r.config.radioKm, fuente: "db" } };
}
