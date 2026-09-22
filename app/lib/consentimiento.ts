import { SupabaseClient } from "@supabase/supabase-js";
import { VERSIONES_LEGALES, TipoDocumentoLegal } from "./versiones-legales";
import { hashDocumentoLegal } from "./legal/hash";
import { DOCUMENTOS_VIGENTES } from "./legal/vigentes";

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
 * documento_legal_id y hash_documento (ver bloque ETAPA 2B más abajo) se completan
 * desde Etapa 2B. idempotency_key sigue sin escribirse: requeriría un header
 * Idempotency-Key que ningún caller envía todavía — se completa en una etapa posterior.
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
 *
 * ETAPA 2B: además, ANTES de insertar nada, resuelve y valida documento_legal_id y
 * hash_documento de CADA documento del lote contra documentos_legales (poblada por la
 * migración 20260922_poblar_documentos_legales.sql, posterior a 0ebc0f5). Si algún
 * documento no tiene fila, o el hash guardado en la base no coincide con el que produce
 * hashDocumentoLegal() sobre el contenido local (app/lib/legal/vigentes.ts) — código y base
 * desincronizados —, esta función NO inserta absolutamente nada (ni ese documento ni los
 * demás del mismo lote) y devuelve un error explícito. Nunca se registra un consentimiento
 * con documento_legal_id/hash_documento en NULL "por las dudas".
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

  // ── Validar TODOS los documentos del lote antes de insertar cualquiera ──────────────────────
  // (documento_legal_id, hash) por tipo, solo si TODOS resuelven correctamente.
  const referencias = new Map<TipoDocumentoLegal, { documentoLegalId: number; hash: string }>();
  for (const tipo of documentos) {
    const version = VERSIONES_LEGALES[tipo];
    const fuente = DOCUMENTOS_VIGENTES[tipo];
    if (!fuente || fuente.version !== version) {
      const msg = `inconsistencia interna: VERSIONES_LEGALES marca ${tipo}=${version} pero DOCUMENTOS_VIGENTES no lo respalda con esa misma versión`;
      console.error("[consentimiento] ❌", msg, "| usuario:", usuarioId);
      return msg;
    }
    const hashEsperado = hashDocumentoLegal(fuente);
    const { data, error: errorBusqueda } = await supabaseAdmin
      .from("documentos_legales")
      .select("id, hash_documento")
      .eq("tipo_documento", tipo)
      .eq("version", version)
      .single();

    if (errorBusqueda || !data) {
      const msg = `no existe una fila en documentos_legales para tipo_documento=${tipo} version=${version} (¿falta aplicar 20260922_poblar_documentos_legales.sql?)`;
      console.error("[consentimiento] ❌", msg, "|", errorBusqueda?.message ?? "sin fila", "| usuario:", usuarioId);
      return msg;
    }
    if (data.hash_documento !== hashEsperado) {
      const msg = `hash_documento desincronizado para tipo_documento=${tipo} version=${version}: el guardado en la base no coincide con el que produce el contenido local`;
      console.error("[consentimiento] ❌", msg, "| usuario:", usuarioId);
      return msg;
    }
    referencias.set(tipo, { documentoLegalId: data.id, hash: hashEsperado });
  }

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
    documento_legal_id: referencias.get(tipo)!.documentoLegalId,
    hash_documento:      referencias.get(tipo)!.hash,
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
