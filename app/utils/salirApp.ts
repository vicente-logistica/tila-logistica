/**
 * Cierre de sesión global — mismo modal y misma acción reutilizados por el
 * botón "Cerrar sesión" (en cualquier pantalla) y por el back-button en las
 * raíces de cada rol (panel-cliente, panel-chofer, admin).
 *
 * Elimina únicamente la clave de sesión ("usuario"). No toca "viajeActivoId"
 * ni ninguna otra clave — son estado operativo, no de autenticación.
 */

type AbrirModal = () => void;

let abrirModalActual: AbrirModal | null = null;

/** El modal global se registra una sola vez, al montarse en el layout. */
export function registrarAperturaSalirApp(abrir: AbrirModal): () => void {
  abrirModalActual = abrir;
  return () => {
    if (abrirModalActual === abrir) abrirModalActual = null;
  };
}

/** Pide que se abra el modal global de confirmación de cierre de sesión. */
export function solicitarSalirApp(): void {
  abrirModalActual?.();
}

/**
 * Acción real de cierre de sesión — se ejecuta solo al confirmar en el modal.
 *
 * Nativo: borra la sesión y sale de la app (App.exitApp()) sin depender de
 * que la navegación llegue a completarse. Al reabrir, useProtegerRuta ya no
 * encuentra "usuario" y redirige.
 *
 * Web: borra la sesión y navega a /login con recarga completa.
 */
export async function cerrarSesionYSalir(): Promise<void> {
  localStorage.removeItem("usuario");

  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { App } = await import("@capacitor/app");
      App.exitApp();
      return;
    }
  } catch {
    // No es Capacitor nativo — seguir al camino web
  }

  window.location.href = "/login";
}
