export const VERSIONES_LEGALES = {
  terminos:               "2025-06",
  privacidad:             "2025-06",
  contrato_transportista: "2025-06",
} as const;

export type TipoDocumentoLegal = keyof typeof VERSIONES_LEGALES;
