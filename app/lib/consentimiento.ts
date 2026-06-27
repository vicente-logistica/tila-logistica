import { SupabaseClient } from "@supabase/supabase-js";
import { VERSIONES_LEGALES, TipoDocumentoLegal } from "./versiones-legales";

interface OpcionesConsentimiento {
  supabaseAdmin: SupabaseClient;
  usuarioId:     string;
  documentos:    TipoDocumentoLegal[];
  req:           Request;
  metodo?:       string;
}

/**
 * Inserta una fila en `consentimientos_legales` por cada documento aceptado.
 * La fecha/hora, IP y user-agent se leen siempre del servidor — nunca del body.
 * Retorna null si todo fue bien, o un string de error si algo falló.
 */
export async function registrarConsentimiento({
  supabaseAdmin,
  usuarioId,
  documentos,
  req,
  metodo = "checkbox_registro",
}: OpcionesConsentimiento): Promise<string | null> {

  const fechaHora  = new Date().toISOString();
  const ip         = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
                  ?? req.headers.get("x-real-ip")
                  ?? null;
  const userAgent  = req.headers.get("user-agent") ?? null;

  const filas = documentos.map((tipo) => ({
    usuario_id:        usuarioId,
    tipo_documento:    tipo,
    version_documento: VERSIONES_LEGALES[tipo],
    fecha_hora:        fechaHora,
    ip_address:        ip,
    user_agent:        userAgent,
    metodo,
  }));

  const { error } = await supabaseAdmin
    .from("consentimientos_legales")
    .insert(filas);

  if (error) {
    console.error("[consentimiento] ❌ error INSERT consentimientos_legales:", error.message, "| usuario:", usuarioId);
    return error.message;
  }

  console.log("[consentimiento] ✅ consentimientos registrados — usuario:", usuarioId, "| docs:", documentos.join(", "), "| ip:", ip);
  return null;
}
