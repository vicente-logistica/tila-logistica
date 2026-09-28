/**
 * Conversión entre el porcentaje que escribe el admin ("7,50", "4.75", "5") y puntos
 * básicos enteros (750, 475, 500). Se hace sobre el TEXTO, sin pasar por números con
 * decimales binarios: "4,75" → 475 exacto, nunca 474.99999.
 */

/** "7,5" → 750 · "4.75" → 475 · "5" → 500. null si no es un porcentaje válido con hasta 2
 *  decimales, entre 0 y 99,99. */
export function porcentajeTextoABp(texto: string): number | null {
  const m = /^\s*(\d{1,2})(?:[.,](\d{1,2}))?\s*%?\s*$/.exec(texto ?? "");
  if (!m) return null;
  const enteros   = Number(m[1]);
  const decimales = Number((m[2] ?? "").padEnd(2, "0"));
  return enteros * 100 + decimales;
}

/** 750 → "7,50" · 475 → "4,75" · 0 → "0,00". */
export function bpAPorcentajeTexto(bp: number): string {
  const enteros   = Math.floor(bp / 100);
  const decimales = String(bp % 100).padStart(2, "0");
  return `${enteros},${decimales}`;
}
