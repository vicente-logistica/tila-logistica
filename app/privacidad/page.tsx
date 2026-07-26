import { DocumentoLegal } from "../components/legal/DocumentoLegal";
import { documento } from "../lib/legal/privacidad/v2026-07";

export const metadata = {
  title: "Política de Privacidad — TILA",
  description: "Política de Privacidad y tratamiento de datos personales de TILA.",
};

export default function PrivacidadPage() {
  return <DocumentoLegal documento={documento} />;
}
