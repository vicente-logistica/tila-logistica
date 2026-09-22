/**
 * Cierre de sesión global — mismo modal y misma acción reutilizados por el
 * botón "Cerrar sesión" (en cualquier pantalla) y por el back-button en las
 * raíces de cada rol (panel-cliente, panel-chofer, admin).
 *
 * Elimina únicamente la clave de sesión ("usuario"). No toca "viajeActivoId"
 * ni ninguna otra clave — son estado operativo, no de autenticación.
 * Además pide al servidor que borre la cookie de sesión firmada (ver cerrarSesionEnServidor).
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
 * Avisa al servidor para que borre la cookie de sesión firmada (POST /api/auth/logout).
 * Nunca lanza ni bloquea la salida: si falla (sin red, timeout, error del servidor) el usuario sale igual
 * de la app — su sesión local ya se limpió — y solo se deja un aviso genérico en consola, sin datos.
 * Espera como máximo 2 s para que el borrado de la cookie termine antes de navegar / salir de la app.
 */
export async function cerrarSesionEnServidor(): Promise<void> {
  try {
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), 2000);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", keepalive: true, signal: control.signal });
      if (!res.ok) console.warn("[logout] el servidor respondió con error", res.status);
    } finally {
      clearTimeout(corte);
    }
  } catch {
    console.warn("[logout] no se pudo avisar al servidor; la sesión local se cerró igual");
  }
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
  await cerrarSesionEnServidor();

  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      const { App } = await import("@capacitor/app");
      App.exitApp();
      return;
    }
  } catch {
    // No es Capacitor nativo — seguir al camino web
  }

  window.location.href = "/login";
}
