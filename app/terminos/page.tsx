import { DocumentoLegal } from "../components/legal/DocumentoLegal";
import { documento } from "../lib/legal/terminos/v2026-07";

export const metadata = {
  title: "Términos y Condiciones — TILA",
  description: "Términos y Condiciones de Uso de la plataforma TILA.",
};

export default function TerminosPage() {
  return <DocumentoLegal documento={documento} />;
}
