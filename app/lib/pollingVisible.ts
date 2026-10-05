/**
 * Polling periódico que sólo corre con la pestaña VISIBLE y el usuario ACTIVO.
 * Lo usa el panel admin (app/admin/page.tsx); sin React, para poder testearlo con dobles.
 *
 *  - Visible y activo: una tanda cada `intervaloMs`, contados desde que TERMINA la anterior
 *    (setTimeout encadenado: nunca hay dos tandas a la vez).
 *  - Pestaña oculta: no se programa nada. Al volver a verse: una tanda inmediata y se reanuda.
 *  - Sin actividad durante `inactividadMs`: se detiene. Ante nueva actividad: una tanda
 *    inmediata y se reanuda.
 *  - `enCursoInicial`: la carga inicial que ya lanzó la página; cuenta como tanda en curso,
 *    así el polling no se le superpone.
 *  - `detener()` limpia el timer y todos los listeners. Una tanda en vuelo no se cancela,
 *    pero al terminar ya no se programa otra.
 */

type Objetivo = {
  addEventListener: (tipo: string, fn: () => void, opciones?: AddEventListenerOptions) => void;
  removeEventListener: (tipo: string, fn: () => void, opciones?: EventListenerOptions) => void;
};

export interface OpcionesPollingVisible {
  tanda: () => Promise<unknown>;
  intervaloMs: number;
  inactividadMs: number;
  doc: Objetivo & { hidden: boolean };
  win: Objetivo;
  enCursoInicial?: Promise<unknown>;
  ahora?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
  alFallar?: (e: unknown) => void;
}

export const EVENTOS_ACTIVIDAD = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export function iniciarPollingVisible(o: OpcionesPollingVisible): { detener: () => void } {
  const ahora = o.ahora ?? (() => Date.now());
  const programarTimeout = o.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const cancelarTimeout = o.clearTimeoutFn ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const alFallar = o.alFallar ?? ((e) => console.error("[polling] error en la tanda:", e));

  let detenido = false;
  let timer: unknown = null;
  let enCurso: Promise<void> | null = null;
  let ultimaActividad = ahora();
  // Dos motivos de pausa independientes. Una sola reactivación los levanta A LOS DOS y hace
  // UNA sola actualización: si coinciden "volver a la pestaña" y "volver de inactividad"
  // (en cualquier orden de eventos), el segundo ya no encuentra pausa y no actualiza.
  let pausadoPorOculta = o.doc.hidden;
  let pausadoPorInactividad = false;

  const inactivo = () => ahora() - ultimaActividad >= o.inactividadMs;
  const puedeCorrer = () => !detenido && !o.doc.hidden && !pausadoPorOculta && !pausadoPorInactividad;

  const limpiarTimer = () => {
    if (timer !== null) { cancelarTimeout(timer); timer = null; }
  };

  // Una sola tanda a la vez: si hay una en curso, se espera ésa en lugar de lanzar otra.
  const ejecutar = (): Promise<void> => {
    if (enCurso) return enCurso;
    enCurso = Promise.resolve()
      .then(o.tanda)
      .then(() => undefined, alFallar)
      .finally(() => { enCurso = null; });
    return enCurso;
  };

  const programar = () => {
    limpiarTimer();
    if (puedeCorrer()) timer = programarTimeout(tick, o.intervaloMs);
  };

  async function tick() {
    timer = null;
    if (detenido) return;
    if (o.doc.hidden) { pausadoPorOculta = true; return; }
    if (!puedeCorrer()) return;
    if (inactivo()) { pausadoPorInactividad = true; return; }
    await ejecutar();
    programar();
  }

  /** Única vía de reanudación: si había alguna pausa y la pestaña se ve, levanta todas y actualiza UNA vez. */
  const reactivar = async () => {
    if (detenido || o.doc.hidden || (!pausadoPorOculta && !pausadoPorInactividad)) return;
    pausadoPorOculta = false;
    pausadoPorInactividad = false;
    limpiarTimer();
    await ejecutar();
    programar();
  };

  const alCambiarVisibilidad = () => {
    if (detenido) return;
    if (o.doc.hidden) { pausadoPorOculta = true; limpiarTimer(); return; }
    ultimaActividad = ahora(); // volver a la pestaña es actividad del usuario
    void reactivar();
  };

  const alActividad = () => {
    if (detenido) return;
    ultimaActividad = ahora();
    void reactivar();
  };

  o.doc.addEventListener("visibilitychange", alCambiarVisibilidad);
  for (const ev of EVENTOS_ACTIVIDAD) o.win.addEventListener(ev, alActividad, { passive: true });

  if (o.enCursoInicial) {
    enCurso = o.enCursoInicial.then(() => undefined, () => undefined).finally(() => { enCurso = null; });
  }
  programar();

  return {
    detener: () => {
      detenido = true;
      limpiarTimer();
      o.doc.removeEventListener("visibilitychange", alCambiarVisibilidad);
      for (const ev of EVENTOS_ACTIVIDAD) o.win.removeEventListener(ev, alActividad);
    },
  };
}
