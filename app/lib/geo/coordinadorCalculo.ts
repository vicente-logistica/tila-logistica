/**
 * Serializa los cálculos de distancias de useCargasCercanas: NUNCA hay dos requests en
 * paralelo, y un pedido que llega mientras otro está en vuelo NO se pierde — queda
 * marcado como pendiente y, al terminar el actual, se ejecuta UNA vez más. `ejecutar`
 * debe leer los ids/GPS MÁS RECIENTES en el momento de correr (no los del pedido), así
 * varios pedidos acumulados durante el vuelo se resuelven con un solo recálculo.
 */
export function crearCoordinadorCalculo(ejecutar: () => Promise<void>) {
  let enVuelo = false;
  let recalculoPendiente = false;

  async function correr() {
    enVuelo = true;
    try {
      do {
        recalculoPendiente = false;
        try { await ejecutar(); } catch { /* el llamador maneja sus errores; no cortar el ciclo */ }
      } while (recalculoPendiente);
    } finally {
      enVuelo = false;
    }
  }

  return {
    /** Pide un cálculo: si hay uno en vuelo, lo deja pendiente; si no, lo arranca. */
    solicitar(): Promise<void> {
      if (enVuelo) { recalculoPendiente = true; return Promise.resolve(); }
      return correr();
    },
    get enVuelo() { return enVuelo; },
    get recalculoPendiente() { return recalculoPendiente; },
  };
}
