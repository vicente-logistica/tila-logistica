/**
 * Decide qué IDs (de `cargasCercanas`, ya filtradas por radio) deben disparar la alarma
 * sonora — separado de panel-chofer/page.tsx para poder testearlo sin React/audio de por
 * medio.
 *
 * Regla de negocio explícita: la PRIMERA resolución de cargasCercanas en una sesión online
 * establece el BASELINE (esBaseline=true) — lo que ya está cerca en ese momento NO suena,
 * para no alarmar con "todo lo existente" apenas el chofer se pone online. Después del
 * baseline, sólo los IDs genuinamente NUEVOS (que no estaban en `idsYaVistos`) disparan
 * la alarma. Una carga que nunca entra en `idsActuales` (porque está fuera de radio, o
 * porque no hay GPS y cargasCercanas es []) nunca puede aparecer en `nuevas` — el filtro
 * geográfico ya la excluyó antes de llegar aquí.
 */
export function detectarNuevasCercanas(
  idsActuales: string[],
  idsYaVistos: Set<string>,
  esBaseline: boolean
): { nuevas: string[]; siguienteVistos: Set<string> } {
  const actualesSet = new Set(idsActuales);
  if (esBaseline) {
    return { nuevas: [], siguienteVistos: actualesSet };
  }
  const nuevas = idsActuales.filter(id => !idsYaVistos.has(id));
  return { nuevas, siguienteVistos: actualesSet };
}

/**
 * Un paso del efecto de alarma de panel-chofer, sin React: mientras no esté online y
 * `estado === "listo"` (GPS ok + lista inicial cargada + cálculo real recibido) no se
 * evalúa nada — ni siquiera se arma el baseline. La primera evaluación arma el baseline
 * (no suena); las siguientes devuelven sólo los ids nuevos.
 */
export function pasoAlarmaCercanas(p: {
  online: boolean;
  estado: string;
  idsActuales: string[];
  vistos: Set<string>;
  baselineHecho: boolean;
}): { nuevas: string[]; vistos: Set<string>; baselineHecho: true } | null {
  if (!p.online || p.estado !== "listo") return null;
  const { nuevas, siguienteVistos } = detectarNuevasCercanas(p.idsActuales, p.vistos, !p.baselineHecho);
  return { nuevas, vistos: siguienteVistos, baselineHecho: true };
}
