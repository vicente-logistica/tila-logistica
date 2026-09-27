/**
 * Mismo patrón que ya usa cargarCargas() para `cargas.length` (setIndice(prev => prev >=
 * cargasFiltradas.length ? 0 : prev)), aplicado ahora también a `cargasCercanas.length` —
 * evita que `indice` quede apuntando fuera de rango cuando el filtro por radio reduce la
 * lista (por ej.: había 5 cargas con indice=3, y sólo 2 quedan dentro de 35km), lo que
 * hoy hace que `cargaActual` sea `undefined` y la pantalla muestre "No hay viajes" de
 * forma espuria aunque existan cargas cercanas válidas.
 */
export function clampearIndice(indiceActual: number, longitudLista: number): number {
  if (longitudLista <= 0) return 0;
  return indiceActual >= longitudLista ? 0 : indiceActual;
}
