-- Arquitectura de documentos legales versionados + consentimientos auditables.
-- El texto legal NO vive acá — vive en el código (app/lib/legal/...). Esta
-- migración solo guarda referencias inmutables (versión, hash, ruta) y el
-- registro de qué usuario aceptó/rechazó qué versión, cuándo y por qué medio.

-- ══════════════════════════════════════════════════════════════════════
-- PASO 0 — tipos_documento_legal (tabla de referencia, no CHECK con lista fija)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE tipos_documento_legal (
  codigo      text PRIMARY KEY,
  descripcion text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tipos_documento_legal (codigo, descripcion) VALUES
  ('terminos',               'Términos y Condiciones de Uso'),
  ('privacidad',             'Política de Privacidad'),
  ('contrato_transportista', 'Contrato de Adhesión para Transportistas Independientes');

-- Agregar un documento nuevo en el futuro = un INSERT acá, cero migraciones
-- ni CHECK constraints para tocar.


-- ══════════════════════════════════════════════════════════════════════
-- PASO 1 — documentos_legales
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE documentos_legales (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo_documento    text NOT NULL REFERENCES tipos_documento_legal(codigo),
  version           text NOT NULL,
  hash_documento    text NOT NULL,   -- SHA-256 del texto exacto y normalizado publicado
  ruta_documento    text NOT NULL,   -- ej. "app/lib/legal/contrato-transportista/v2025-06.ts"
  git_commit        text,            -- opcional
  release_tag       text,            -- opcional
  fecha_publicacion timestamptz NOT NULL DEFAULT now(),
  estado            text NOT NULL DEFAULT 'borrador',
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_estado_valores
    CHECK (estado IN ('borrador', 'vigente', 'reemplazado')),

  UNIQUE (tipo_documento, version)
);

-- Como máximo una versión "vigente" por tipo_documento.
CREATE UNIQUE INDEX ux_documentos_legales_vigente_unico
  ON documentos_legales (tipo_documento)
  WHERE estado = 'vigente';


-- ══════════════════════════════════════════════════════════════════════
-- PASO 2 — trigger: metadatos inmutables + transiciones de estado permitidas
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION proteger_documento_legal_publicado()
RETURNS trigger AS $$
BEGIN
  -- Metadatos inmutables una vez publicado (vigente o reemplazado). Una fila
  -- en 'borrador' puede editarse libremente (este bloque ni se evalúa).
  IF OLD.estado IN ('vigente', 'reemplazado') THEN
    IF NEW.tipo_documento    IS DISTINCT FROM OLD.tipo_documento
    OR NEW.version           IS DISTINCT FROM OLD.version
    OR NEW.hash_documento    IS DISTINCT FROM OLD.hash_documento
    OR NEW.ruta_documento    IS DISTINCT FROM OLD.ruta_documento
    OR NEW.git_commit        IS DISTINCT FROM OLD.git_commit
    OR NEW.release_tag       IS DISTINCT FROM OLD.release_tag
    OR NEW.fecha_publicacion IS DISTINCT FROM OLD.fecha_publicacion
    OR NEW.created_at        IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'documento_legal id=% ya publicado (estado=%): no se pueden modificar sus metadatos.', OLD.id, OLD.estado;
    END IF;
  END IF;

  -- Transiciones de estado permitidas explícitamente. "vigente -> vigente"
  -- es una actualización inocua (sin cambios protegidos, ya validado arriba).
  IF NOT (
    (OLD.estado = 'borrador'    AND NEW.estado IN ('borrador', 'vigente')) OR
    (OLD.estado = 'vigente'     AND NEW.estado IN ('vigente', 'reemplazado')) OR
    (OLD.estado = 'reemplazado' AND NEW.estado = 'reemplazado')
  ) THEN
    RAISE EXCEPTION 'Transición de estado no permitida: % -> % (documento_legal id=%)', OLD.estado, NEW.estado, OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_proteger_documento_legal
BEFORE UPDATE ON documentos_legales
FOR EACH ROW
EXECUTE FUNCTION proteger_documento_legal_publicado();


-- ══════════════════════════════════════════════════════════════════════
-- PASO 3 — trigger: impedir DELETE de documentos publicados
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION prevenir_borrado_documento_legal_publicado()
RETURNS trigger AS $$
BEGIN
  IF OLD.estado IN ('vigente', 'reemplazado') THEN
    RAISE EXCEPTION 'No se puede eliminar documento_legal id=% (estado=%). Los documentos publicados no se borran.', OLD.id, OLD.estado;
  END IF;
  RETURN OLD;  -- 'borrador' sí puede eliminarse
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevenir_borrado_documento_legal
BEFORE DELETE ON documentos_legales
FOR EACH ROW
EXECUTE FUNCTION prevenir_borrado_documento_legal_publicado();


-- ══════════════════════════════════════════════════════════════════════
-- PASO 4 — consentimientos_legales (columnas nuevas sobre la tabla existente)
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE consentimientos_legales
  ADD COLUMN decision            text,
  ADD COLUMN fecha_decision      timestamptz,
  ADD COLUMN documento_legal_id  bigint REFERENCES documentos_legales(id),
  ADD COLUMN hash_documento      text,       -- copia defensiva, la completa el servidor
  ADD COLUMN plataforma          text,
  ADD COLUMN tipo_evento         text,
  ADD COLUMN idempotency_key     uuid;

ALTER TABLE consentimientos_legales
  ADD CONSTRAINT chk_decision_valores
    CHECK (decision IN ('aceptado', 'rechazado')),
  ADD CONSTRAINT chk_plataforma_valores
    CHECK (plataforma IS NULL OR plataforma IN ('web', 'android', 'ios', 'desconocida')),
  ADD CONSTRAINT chk_tipo_evento_valores
    CHECK (tipo_evento IS NULL OR tipo_evento IN
      ('registro', 'actualizacion_version', 'reaceptacion'));

-- metodo: SIN CHECK todavía. Se mantiene libre para no romper el valor
-- histórico 'checkbox_registro' (confirmado: es el único valor que existe
-- hoy, ningún endpoint lo sobrescribe). Valores nuevos previstos para el
-- código (no impuestos por la base todavía): 'checkbox_y_boton', 'boton_rechazo'.
-- Normalizar/restringir metodo queda para una tarea posterior.

COMMENT ON COLUMN consentimientos_legales.idempotency_key IS
  'Dato TÉCNICO de la solicitud HTTP, no forma parte de la decisión legal. '
  'Debe recibirse por header "Idempotency-Key", nunca dentro del body legal '
  '(que solo debe contener tipo_documento y decision). El servidor debe '
  'validar: (1) formato UUID; (2) que la clave pertenezca a una operación '
  'del usuario autenticado que la envía; (3) que la misma clave no pueda '
  'reutilizarse con otro usuario, documento o decisión distintos; (4) ante '
  'un reintento idéntico con la misma clave, devolver la fila ya registrada '
  'en lugar de crear un evento nuevo. La clave nunca decide version, hash, '
  'fecha ni cuál documento está vigente — eso lo resuelve el servidor '
  'exclusivamente a partir de documentos_legales.';


-- ══════════════════════════════════════════════════════════════════════
-- PASO 5 — backfill de lo único que se puede afirmar con certeza histórica
-- ══════════════════════════════════════════════════════════════════════
-- Todo consentimiento histórico es, por diseño del código actual, una
-- aceptación (no existe hoy ningún camino que inserte un rechazo). No es una
-- suposición: registrarConsentimiento() siempre corrió después de un alta
-- exitosa de usuario.
UPDATE consentimientos_legales
SET decision       = 'aceptado',
    fecha_decision = fecha_hora
WHERE decision IS NULL;

ALTER TABLE consentimientos_legales
  ALTER COLUMN decision       SET NOT NULL,
  -- ETAPA 1 (backward-compatible): DEFAULT temporal para que el código actual
  -- (registrarConsentimiento(), que no envía `decision`) siga insertando sin
  -- romperse. Se retira en la Etapa 3, cuando el código nuevo mande `decision`
  -- explícito en cada INSERT.
  ALTER COLUMN decision       SET DEFAULT 'aceptado',
  ALTER COLUMN fecha_decision SET NOT NULL,
  ALTER COLUMN fecha_decision SET DEFAULT now();

-- fecha_hora se conserva intacta, sin tocar ni renombrar (compatibilidad con
-- el código actual). fecha_hora y fecha_decision ya se generan en el
-- servidor (new Date() en registrarConsentimiento) — nunca desde el body
-- del request. Ese mismo criterio se mantiene hacia adelante: el navegador
-- nunca manda una fecha; el body legal del endpoint solo debe aceptar
-- tipo_documento y decision, todo lo demás (documento_legal_id, version,
-- hash_documento, fecha_decision, ip, user_agent, plataforma, metodo,
-- tipo_evento) lo resuelve y completa el servidor.

-- documento_legal_id / hash_documento / plataforma / tipo_evento quedan
-- nullable a propósito: no existe forma honesta de backfillearlos para el
-- historial (documentos_legales no existía antes de esta migración). Es el
-- código de la aplicación el que debe garantizar completarlos en cada
-- INSERT nuevo. Si más adelante hace falta una garantía dura a nivel DB,
-- se resuelve con una migración aparte, cuando corresponda — no acá, no con
-- una fecha de corte hardcodeada.


-- ══════════════════════════════════════════════════════════════════════
-- PASO 6 — idempotencia: evita duplicados sin bloquear el historial legítimo
-- ══════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX ux_consentimientos_idempotency_key
  ON consentimientos_legales (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Deliberadamente NO existe ningún UNIQUE(usuario_id, documento_legal_id,
-- decision): la tabla debe permitir múltiples aceptaciones y/o rechazos
-- legítimos de la misma versión en momentos distintos (ej. rechaza y después
-- acepta). La prevención de doble-submit es responsabilidad exclusiva de
-- idempotency_key, un dato técnico de la solicitud — no de la decisión.


-- ══════════════════════════════════════════════════════════════════════
-- NOTA — publicación de una nueva versión (procedimiento, no código todavía)
-- ══════════════════════════════════════════════════════════════════════
-- Publicar una versión nueva de un documento (ej. reemplazar el contrato de
-- transportistas vigente por uno nuevo) DEBE hacerse en una única
-- transacción que:
--   1. UPDATE documentos_legales SET estado = 'reemplazado'
--      WHERE tipo_documento = <tipo> AND estado = 'vigente';
--   2. UPDATE documentos_legales SET estado = 'vigente'
--      WHERE id = <id de la nueva versión, que ya debe existir en 'borrador'>;
--   3. COMMIT de ambas operaciones juntas (BEGIN ... COMMIT / una función
--      transaccional), nunca como dos statements sueltos e independientes —
--      si el paso 2 fallara después de confirmar el paso 1, quedaría un
--      tipo_documento sin ninguna versión vigente.
-- No se crea todavía ninguna función SQL para esto — el índice único parcial
-- del PASO 1 ya impide tener dos "vigente" simultáneas para el mismo tipo,
-- así que cualquier violación de este procedimiento fallaría de forma
-- segura (con excepción), no de forma silenciosa. La función/ruta
-- administrativa que ejecute esta transacción se implementa cuando exista
-- una necesidad real de publicar una versión nueva.
