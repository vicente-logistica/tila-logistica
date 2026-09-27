/**
 * Decide qué IDs (de `cargasCercanas`, ya filtradas por radio) deben disparar la alarma
 * sonora — separado de panel-chofer/page.tsx para poder testearlo sin React/audio de por
 * medio.
 *
 * Regla de negocio: cada carga cercana suena UNA vez por sesión online — incluidas las
 * que ya existían al ponerse ONLINE (mismo comportamiento que antes del filtro por radio,
 * cuando se vaciaba viajesSonadosRef al activar). `idsYaVistos` son las ya notificadas;
 * el polling no las repite. Una carga que nunca entra en `idsActuales` (fuera de radio, o
 * sin GPS con cargasCercanas = []) nunca puede aparecer en `nuevas` — el filtro
 * geográfico ya la excluyó antes de llegar aquí.
 */
export function detectarNuevasCercanas(
  idsActuales: string[],
  idsYaVistos: Set<string>,
): { nuevas: string[]; siguienteVistos: Set<string> } {
  const nuevas = idsActuales.filter(id => !idsYaVistos.has(id));
  return { nuevas, siguienteVistos: new Set(idsActuales) };
}

/**
 * Un paso del efecto de alarma de panel-chofer, sin React: mientras no esté online y
 * `estado === "listo"` (GPS ok + lista inicial cargada + cálculo real recibido) no se
 * evalúa nada, así nunca suena algo sin un cálculo de radio confirmado. Cuando evalúa,
 * devuelve los ids cercanos todavía no notificados.
 */
export function pasoAlarmaCercanas(p: {
  online: boolean;
  estado: string;
  idsActuales: string[];
  vistos: Set<string>;
}): { nuevas: string[]; vistos: Set<string> } | null {
  if (!p.online || p.estado !== "listo") return null;
  const { nuevas, siguienteVistos } = detectarNuevasCercanas(p.idsActuales, p.vistos);
  return { nuevas, vistos: siguienteVistos };
}
