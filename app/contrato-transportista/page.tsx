import { DocumentoLegal } from "../components/legal/DocumentoLegal";
import { documento } from "../lib/legal/contrato-transportista/v2026-07";

export const metadata = {
  title: "Contrato de Adhesión para Transportistas Independientes — TILA",
  description: "Contrato de adhesión para transportistas independientes que operan en la plataforma TILA.",
};

export default function ContratoTransportistaPage() {
  return <DocumentoLegal documento={documento} />;
}
