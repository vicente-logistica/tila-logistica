export const VERSIONES_LEGALES = {
  terminos:               "2026-07",
  privacidad:             "2026-07",
  contrato_transportista: "2026-07",
} as const;

export type TipoDocumentoLegal = keyof typeof VERSIONES_LEGALES;
