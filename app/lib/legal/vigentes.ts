import type { TipoDocumentoLegal, DocumentoLegalFuente } from "./tipos";
import { documento as terminos } from "./terminos/v2026-07";
import { documento as privacidad } from "./privacidad/v2026-07";
import { documento as contratoTransportista } from "./contrato-transportista/v2026-07";

/**
 * El documento VIGENTE (última versión activa) de cada tipo — la misma fuente que usan las
 * páginas públicas (/terminos, /privacidad, /contrato-transportista) y la que debe coincidir,
 * versión y hash, con la fila estado='vigente' de documentos_legales para ese tipo.
 * Deliberadamente NO incluye versiones anteriores (v2025-06): esta etapa no implementa
 * reaceptación ni actualización de versión — solo el alta, que siempre usa la vigente.
 */
export const DOCUMENTOS_VIGENTES: Record<TipoDocumentoLegal, DocumentoLegalFuente> = {
  terminos,
  privacidad,
  contrato_transportista: contratoTransportista,
};
