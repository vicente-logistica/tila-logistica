import { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REINTENTO_IDENTICO = Symbol("reintento-identico");

/**
 * Deriva, de forma determinística, la idempotency_key de UN documento dentro de un lote de
 * alta. Determinística a propósito: el mismo (claveBase, usuarioId, tipoDocumento) SIEMPRE
 * produce la misma salida — nada de Math.random() ni Date.now() acá, porque un reintento
 * legítimo (mismo header Idempotency-Key que mandó el cliente) debe volver a producir
 * EXACTAMENTE la misma clave para poder detectarse como el mismo intento y no como un evento
 * nuevo. Combina usuarioId y tipoDocumento en el hash (no solo la claveBase) por dos motivos:
 *   1. Dos documentos del mismo lote (ej. "terminos" y "privacidad") necesitan claves
 *      DISTINTAS entre sí — la claveBase sola sería idéntica para ambos y el segundo INSERT
 *      del mismo lote chocaría contra el UNIQUE índice de la migración base
 *      (ux_consentimientos_idempotency_key) aunque no hubiera ningún reintento real.
 *   2. Si dos usuarios distintos mandaran por error/copy-paste el mismo valor de header, sus
 *      claves derivadas NO colisionan entre sí (quedan naturalmente separadas por usuarioId,
 *      y de todos modos resolverReintento() vuelve a chequear la titularidad más abajo).
 * No es una UUID v5 formal (no usa el namespace RFC 4122 real) — no hace falta: Postgres solo
 * exige el formato de texto de un uuid, no que sea válida contra ningún namespace en particular.
 */
export function derivarIdempotencyKey(claveBase: string, usuarioId: string, tipoDocumento: string): string {
  const h = createHash("sha256").update(`${claveBase}:${usuarioId}:${tipoDocumento}`).digest("hex");
  const variante = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
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
 * desde Etapa 2B.
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
 *
 * ETAPA 3 (idempotencia): si el request trae un header "Idempotency-Key" (UUID, OPCIONAL —
 * ningún caller actual lo manda todavía, así que sin el header el comportamiento es IDÉNTICO
 * al de antes: la columna idempotency_key queda NULL, sin ninguna garantía de deduplicación),
 * esta función:
 *   1. valida que sea un UUID con formato válido — si no lo es, no inserta nada y devuelve un
 *      error explícito (nunca lo ignora en silencio);
 *   2. deriva una clave DISTINTA por cada documento del lote (ver derivarIdempotencyKey);
 *   3. ANTES de insertar, busca si ya existe una fila con alguna de esas claves derivadas:
 *      - si no existe ninguna → sigue al INSERT normal, ahora con idempotency_key seteada;
 *      - si existen las N claves y las N filas coinciden en (usuario_id, documento_legal_id,
 *        decision) con lo que este mismo request insertaría → es un reintento idéntico: NO
 *        inserta nada nuevo y devuelve éxito (null), tal como pide el comentario de la
 *        migración base ("ante un reintento idéntico ... devolver la fila ya registrada en
 *        lugar de crear un evento nuevo" — ver nota de diseño sobre el valor de retorno);
 *      - si existe ALGUNA pero no coincide (otro usuario, otro documento u otra decisión) →
 *        devuelve un error explícito ("clave reutilizada para una operación distinta") y NO
 *        inserta nada;
 *      - si existen SOLO ALGUNAS de las N (ni 0 ni N) → estado inconsistente (no debería
 *        ocurrir con esta misma función, que inserta el lote completo en un solo INSERT
 *        atómico) → error explícito, tampoco inserta nada.
 *   4. Si el INSERT en sí choca contra el índice único (carrera: dos requests concurrentes con
 *      la misma clave pasaron el chequeo previo casi al mismo tiempo), se resuelve con la
 *      misma lógica del punto 3 en vez de propagar el error crudo de Postgres — la base es la
 *      que en última instancia garantiza que nunca hay un duplicado; el chequeo previo es solo
 *      una optimización para no depender de que siempre ocurra la colisión real.
 * Nota de diseño — valor de retorno: sigue siendo `string | null` (sin devolver la fila ya
 * registrada): ningún caller actual necesita la fila de vuelta, solo saber si hubo error.
 * Ampliar el retorno para incluir las filas es un cambio aislado a esta función si algún
 * caller futuro lo necesita.
 * Límite conocido y deliberado del alcance (no cubierto, por diseño mínimo): esta función NO
 * detecta que el MISMO header crudo se reutilizó para un lote de documentos distinto (ej.
 * usarlo primero solo para "terminos" y después, en otra llamada, para "privacidad"). Como
 * usuarioId Y tipoDocumento van adentro del hash de cada clave derivada, ese caso no colisiona
 * en absoluto contra el índice único — cada documento queda registrado de forma independiente
 * y correcta, sin duplicar ni corromper nada; el header simplemente no funcionó como un
 * "identificador de todo el intento" en ese caso. Cerrar ese límite exigiría guardar la clave
 * CRUDA del cliente en algún lugar (columna o tabla nueva) para poder compararla contra
 * intentos previos — se deja fuera a propósito de esta etapa (alcance mínimo, sin tocar
 * esquema más allá de lo que ya existía desde 0ebc0f5). El chequeo de "usuario/documento/
 * decisión no coinciden" que sí implementa este código es una defensa adicional para un
 * escenario distinto: que la clave DERIVADA (no la cruda) choque con una fila que no la
 * generó esta misma función (colisión real de hash — astronómicamente improbable — o una fila
 * escrita por otro camino en el futuro).
 * Sin el header, el chequeo de este bloque entero se salta (early return dentro de
 * resolverReintento) — cero costo y cero cambio de comportamiento para los callers actuales.
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

  // ── ETAPA 3: leer y validar el header opcional Idempotency-Key ──────────────────────────────
  const claveIdempotenciaHeader = req.headers.get("idempotency-key")?.trim() || null;
  if (claveIdempotenciaHeader && !UUID_REGEX.test(claveIdempotenciaHeader)) {
    const msg = `header Idempotency-Key inválido: "${claveIdempotenciaHeader}" no tiene formato UUID`;
    console.error("[consentimiento] ❌", msg, "| usuario:", usuarioId);
    return msg;
  }

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

  // ── ETAPA 3: clave derivada por documento (null si no vino header — sin cambio de comportamiento) ──
  const clavesPorTipo = new Map<TipoDocumentoLegal, string | null>();
  for (const tipo of documentos) {
    clavesPorTipo.set(tipo, claveIdempotenciaHeader ? derivarIdempotencyKey(claveIdempotenciaHeader, usuarioId, tipo) : null);
  }

  /**
   * Contra la base: ¿ya existe, para CADA clave derivada de este lote, una fila que coincide
   * exactamente con lo que este request insertaría? Devuelve:
   *   - null                 → nada previo (0 filas): seguro proceder al INSERT.
   *   - REINTENTO_IDENTICO    → las N filas ya existen y coinciden: no insertar, éxito.
   *   - string                → error explícito (clave reusada para otra operación, o estado
   *                             inconsistente entre 0 y N). No insertar nada en ningún caso.
   */
  async function resolverReintento(): Promise<string | typeof REINTENTO_IDENTICO | null> {
    if (!claveIdempotenciaHeader) return null; // sin header: comportamiento de siempre, sin chequeo

    const clavesDerivadas = documentos.map((t) => clavesPorTipo.get(t)!);
    const { data: existentes, error } = await supabaseAdmin
      .from("consentimientos_legales")
      .select("idempotency_key, usuario_id, documento_legal_id, decision")
      .in("idempotency_key", clavesDerivadas);

    if (error) {
      const msg = `error verificando idempotency_key previa: ${error.message}`;
      console.error("[consentimiento] ❌", msg, "| usuario:", usuarioId);
      return msg;
    }

    const encontradas = existentes ?? [];
    if (encontradas.length === 0) return null; // nada previo: OK, proceder a insertar

    if (encontradas.length !== documentos.length) {
      const msg = `idempotency_key en estado inconsistente: ${encontradas.length}/${documentos.length} documentos de este lote ya existen y el resto no (¿un intento anterior falló a mitad de camino?). No se inserta nada; requiere revisión manual.`;
      console.error("[consentimiento] ❌", msg, "| usuario:", usuarioId);
      return msg;
    }

    for (const tipo of documentos) {
      const claveEsperada = clavesPorTipo.get(tipo)!;
      const fila = encontradas.find((f) => f.idempotency_key === claveEsperada);
      const ref = referencias.get(tipo)!;
      const coincide = !!fila
        && String(fila.usuario_id) === String(usuarioId)
        && String(fila.documento_legal_id) === String(ref.documentoLegalId)
        && fila.decision === "aceptado";
      if (!coincide) {
        const msg = `Idempotency-Key reutilizada para una operación distinta (usuario, documento o decisión no coinciden con el registro existente para tipo_documento=${tipo}). No se inserta nada.`;
        console.error("[consentimiento] ❌", msg, "| usuario:", usuarioId);
        return msg;
      }
    }

    // Las N filas ya existen y coinciden exactamente: reintento idéntico, no es un error.
    console.log("[consentimiento] ↩️ reintento idempotente detectado, sin duplicar — usuario:", usuarioId, "| docs:", documentos.join(", "));
    return REINTENTO_IDENTICO;
  }

  const resultadoPrevio = await resolverReintento();
  if (resultadoPrevio === REINTENTO_IDENTICO) return null;
  if (typeof resultadoPrevio === "string") return resultadoPrevio;

  const filas = documentos.map((tipo) => ({
    usuario_id:          usuarioId,
    tipo_documento:      tipo,
    version_documento:   VERSIONES_LEGALES[tipo],
    fecha_hora:          fechaHora,
    ip_address:          ip,
    user_agent:          userAgent,
    metodo,
    decision:            "aceptado" as const,
    tipo_evento:         "registro" as const,
    plataforma:          null, // sin fuente confiable en el servidor todavía — ver comentario arriba
    documento_legal_id:  referencias.get(tipo)!.documentoLegalId,
    hash_documento:      referencias.get(tipo)!.hash,
    idempotency_key:     clavesPorTipo.get(tipo) ?? null,
  }));

  const { error } = await supabaseAdmin
    .from("consentimientos_legales")
    .insert(filas);

  if (error) {
    // Carrera: otra request con la misma Idempotency-Key insertó primero entre el chequeo de
    // arriba y este INSERT. Resolvemos con la misma lógica en vez de propagar el error crudo.
    if (claveIdempotenciaHeader && (error.code === "23505" || /idempotency/i.test(error.message))) {
      const resultado = await resolverReintento();
      if (resultado === REINTENTO_IDENTICO) return null;
      if (typeof resultado === "string") return resultado;
      // resultado === null acá significaría que el chequeo no encontró nada pese a que el
      // INSERT chocó — no debería pasar; no lo ocultamos, cae al error original de abajo.
    }
    console.error("[consentimiento] ❌ error INSERT consentimientos_legales:", error.message, "| usuario:", usuarioId);
    return error.message;
  }

  console.log("[consentimiento] ✅ consentimientos registrados — usuario:", usuarioId, "| docs:", documentos.join(", "), "| ip:", ip);
  return null;
}
