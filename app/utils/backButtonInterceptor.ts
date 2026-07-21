/**
 * Coordinador del botón físico "Atrás" (Android) para pantallas con overlay propio.
 *
 * CapacitorBackHandler mantiene el único listener nativo de la app. Antes de
 * aplicar su navegación por defecto, consulta acá si hay algo que quiera
 * interceptar el evento (ej. un modal de confirmación de un overlay abierto).
 *
 * Un solo interceptor a la vez: los overlays de pantalla completa de esta app
 * son mutuamente excluyentes, no hace falta una pila.
 */

type Interceptor = () => void;

let actual: { token: symbol; fn: Interceptor } | null = null;

/**
 * Registra el interceptor activo y devuelve su propio cleanup. El cleanup
 * solo borra el interceptor si sigue siendo el mismo que lo registró — evita
 * que un desmontaje tardío pise el interceptor de un componente más nuevo.
 */
export function registrarBackButtonInterceptor(fn: Interceptor): () => void {
  const token = Symbol();
  actual = { token, fn };
  return () => {
    if (actual?.token === token) {
      actual = null;
    }
  };
}

/** Ejecuta el interceptor activo si existe. Devuelve true si lo manejó. */
export function ejecutarBackButtonInterceptor(): boolean {
  if (!actual) return false;
  actual.fn();
  return true;
}
