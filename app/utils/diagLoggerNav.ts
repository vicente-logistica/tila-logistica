// TILA_NAV_DIAG — logger temporal en memoria para diagnosticar el módulo de
// navegación (MapaTILA.tsx) durante una prueba real manejando, sin depender de un
// teléfono conectado por USB/adb. Los eventos quedan en un array en memoria durante
// la sesión; al volver, se exportan desde la propia app (botón flotante 🐞 en
// MapaTILA, sólo en modoNavegacion) como texto para copiar o como archivo .txt.
//
// Activar/desactivar: DIAG_NAV_ACTIVO. En false, diagLog() no hace nada (ni guarda
// en memoria ni loguea a consola) — apagar el modo diagnóstico es cambiar esta
// única línea. Todo este archivo es temporal: borrar junto con el resto de la
// instrumentación ([TILA_NAV_DIAG] en MapaTILA.tsx) una vez conseguida la evidencia.
export const DIAG_NAV_ACTIVO = true;

const MAX_EVENTOS = 4000;
let eventos: string[] = [];

export function diagLog(mensaje: string): void {
  if (!DIAG_NAV_ACTIVO) return;
  eventos.push(`${Date.now()} | ${mensaje}`);
  if (eventos.length > MAX_EVENTOS) eventos.shift();
  // Se mantiene también en consola — no rompe el diagnóstico por adb logcat para
  // quien sí tenga el teléfono conectado por USB.
  console.log(mensaje);
}

export function diagObtenerTexto(): string {
  return eventos.join("\n");
}

export function diagContarEventos(): number {
  return eventos.length;
}

export function diagLimpiar(): void {
  eventos = [];
}
