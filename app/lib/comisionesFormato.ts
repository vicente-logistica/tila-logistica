/**
 * Conversión entre el porcentaje que escribe el admin ("7,50", "0.05", "100") y puntos
 * básicos enteros (750, 5, 10000). Se hace sobre el TEXTO, sin pasar por números con
 * decimales binarios: "4,75" → 475 exacto, nunca 474.99999. Acepta coma o punto.
 */

/** "7,5" → 750 · "0.05" → 5 · "100" → 10000. null si no es un número ≥ 0 con hasta 2
 *  decimales (los bp tienen precisión de centésimas de punto porcentual). */
export function porcentajeTextoABp(texto: string): number | null {
  const m = /^\s*(\d{1,8})(?:[.,](\d{1,2}))?\s*%?\s*$/.exec(texto ?? "");
  if (!m) return null;
  const enteros   = Number(m[1]);
  const decimales = Number((m[2] ?? "").padEnd(2, "0"));
  const bp = enteros * 100 + decimales;
  return Number.isSafeInteger(bp) ? bp : null;
}

/** 750 → "7,50" · 5 → "0,05" · 10000 → "100,00". */
export function bpAPorcentajeTexto(bp: number): string {
  const enteros   = Math.floor(bp / 100);
  const decimales = String(bp % 100).padStart(2, "0");
  return `${enteros},${decimales}`;
}

/**
 * ¿Un cambio en el input vino de una interacción real del admin (teclado, pegar, IME)?
 * Autocompletado del navegador (`insertReplacementText` o `:-webkit-autofill`) o cualquier
 * cambio sin interacción previa sobre ESE campo → se ignora y el campo conserva su valor.
 */
export function esCambioDelAdmin(c: { huboInteraccion: boolean; inputType?: string | null; autofill?: boolean }): boolean {
  if (!c.huboInteraccion) return false;
  if (c.autofill) return false;
  if (c.inputType === "insertReplacementText") return false;
  return true;
}
