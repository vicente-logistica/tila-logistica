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
 *
 * ETAPA 2 (modelo legal): escribe SOLO lo que este código puede garantizar sin
 * inventar ni consultar documentos_legales (que la migración deja vacía):
 *   - decision='aceptado'   — los dos callers actuales (alta cliente/chofer) ya
 *     exigieron la aceptación explícita ANTES de llamar a esta función; no existe
 *     ningún camino que la invoque para un rechazo.
 *   - tipo_evento='registro' — ambos callers son, sin excepción, un alta; no hay
 *     todavía ningún flujo de reaceptación/actualización de versión.
 *   - plataforma queda NULL — el cliente no manda ningún header que la indique
 *     con certeza hoy (ver docs/seguridad para el detalle).
 * documento_legal_id, hash_documento e idempotency_key quedan sin escribir
 * (NULL): requerirían, respectivamente, una fila "vigente" en documentos_legales
 * (tabla vacía hoy), una función de hash que no existe todavía, y un header
 * Idempotency-Key que ningún caller envía. Se completan en una etapa posterior.
 *
 * IMPORTANTE — orden de despliegue: esta función asume que la migración
 * backward-compatible (commit 0ebc0f5) ya está aplicada en la base. decision
 * y tipo_evento son columnas NUEVAS que este código manda explícitas; contra
 * el esquema viejo (sin esa migración) esas columnas no existen en absoluto,
 * así que el INSERT de más abajo falla con "column consentimientos_legales.
 * decision does not exist" — un error explícito y predecible, no un fallback
 * silencioso. fecha_decision NO es un problema en ningún caso: esta función
 * nunca la escribe, y la migración la deja NOT NULL DEFAULT now(), así que la
 * completa la base sola en cada INSERT (contra el esquema nuevo).
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
    decision:          "aceptado" as const,
    tipo_evento:       "registro" as const,
    plataforma:        null, // sin fuente confiable en el servidor todavía — ver comentario arriba
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
