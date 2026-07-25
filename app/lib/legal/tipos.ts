export type TipoDocumentoLegal =
  | "terminos"
  | "privacidad"
  | "contrato_transportista";

export interface DocumentoLegalFuente {
  tipoDocumento: TipoDocumentoLegal;
  version: string;
  titulo: string;
  contenido: string;
}

// Regla de hash (futura, no implementada acá): el contenido canónico a
// hashear es la concatenación determinista `${titulo}\n\n${contenido}`,
// normalizando saltos de línea con `.replace(/\r\n/g, "\n")` antes de
// calcular SHA-256. tipoDocumento y version NO se hashean por separado —
// ambos deben constar también dentro del texto visible (titulo/contenido)
// del propio documento.
