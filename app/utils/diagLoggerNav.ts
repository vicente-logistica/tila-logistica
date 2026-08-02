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

// ─── Captura de errores sin ADB/DevTools ───────────────────────────────────
// Google Maps JS API no lanza una excepción común ante un problema de API key: llama
// a window.gm_authFailure (si existe) y/o imprime el error por console.error/warn
// (RefererNotAllowedMapError, InvalidKeyMapError, ApiNotActivatedMapError,
// BillingNotEnabledMapError, etc.) — nunca queda en el flujo normal de la app. Por
// eso hace falta instalar esto ANTES de que se inyecte el script de Maps
// (useJsApiLoader, dentro de MapaTILA) para poder capturarlo. Como este módulo se
// importa al principio de MapaTILA.tsx, el import ya alcanza: la evaluación de un
// módulo ES ocurre antes de que el componente que lo importa llegue a ejecutarse.
function argATexto(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function instalarHandlersGlobales(): void {
  if (typeof window === "undefined" || !DIAG_NAV_ACTIVO) return;
  const w = window as unknown as { __tilaDiagHandlersInstalados?: boolean; gm_authFailure?: () => void };
  if (w.__tilaDiagHandlersInstalados) return;
  w.__tilaDiagHandlersInstalados = true;

  // Google Maps llama específicamente a esto cuando la API key es rechazada — es la
  // señal MÁS directa de RefererNotAllowedMapError/InvalidKeyMapError/
  // ApiNotActivatedMapError/BillingNotEnabledMapError.
  w.gm_authFailure = () => {
    diagLog(
      "[TILA_NAV_DIAG] GOOGLE MAPS gm_authFailure — la API key fue RECHAZADA para este "
      + "dominio (típicamente RefererNotAllowedMapError, InvalidKeyMapError, "
      + "ApiNotActivatedMapError o BillingNotEnabledMapError). Revisar las restricciones "
      + `HTTP referrer de la API key para: ${window.location.origin}`
    );
  };

  window.addEventListener("error", (event) => {
    diagLog(`[TILA_NAV_DIAG] window.onerror: ${event.message} en ${event.filename}:${event.lineno}:${event.colno}`);
  });

  window.addEventListener("unhandledrejection", (event) => {
    diagLog(`[TILA_NAV_DIAG] unhandledrejection: ${argATexto(event.reason)}`);
  });

  // Google Maps imprime el nombre exacto del error (RefererNotAllowedMapError, etc.)
  // por console.error/warn en varias versiones de la API — se intercepta para que
  // quede en el log exportable, sin dejar de mostrarse también en consola normal.
  const consoleErrorOriginal = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    diagLog(`[TILA_NAV_DIAG] console.error: ${args.map(argATexto).join(" ")}`);
    consoleErrorOriginal(...args);
  };

  const consoleWarnOriginal = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const texto = args.map(argATexto).join(" ");
    if (/maps|api key|referer|billing/i.test(texto)) {
      diagLog(`[TILA_NAV_DIAG] console.warn: ${texto}`);
    }
    consoleWarnOriginal(...args);
  };
}
instalarHandlersGlobales();
