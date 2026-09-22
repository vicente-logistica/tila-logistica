import { createHash } from "node:crypto";
import type { DocumentoLegalFuente } from "./tipos";

/**
 * SHA-256 del CONTENIDO LEGAL de un documento (título + texto), no del archivo .ts que lo contiene.
 * Regla canónica (única función que la implementa — ver app/lib/legal/tipos.ts):
 *   canonico = `${titulo}\n\n${contenido}`, con los saltos de línea normalizados a "\n"
 *   ANTES de hashear (`\r\n` → `\n`), para que el resultado no dependa de cómo el editor o el
 *   sistema de archivos hayan guardado el archivo.
 * NO participan: tipoDocumento, version, comentarios del archivo, imports, indentación del
 * código ni ningún otro detalle de cómo está escrito el .ts — todo eso queda fuera del string
 * que se hashea. tipoDocumento/version deben poder inferirse igual leyendo el propio texto
 * visible (título/contenido) del documento.
 * Devuelve el hash en hexadecimal, minúsculas.
 */
export function hashDocumentoLegal(documento: Pick<DocumentoLegalFuente, "titulo" | "contenido">): string {
  const canonico = `${documento.titulo}\n\n${documento.contenido}`.replace(/\r\n/g, "\n");
  return createHash("sha256").update(canonico, "utf8").digest("hex");
}
