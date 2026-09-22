-- Inmutabilidad de consentimientos_legales: una vez insertada, una fila de consentimiento es
-- un registro legal-probatorio de una decisión tomada en un momento dado — a diferencia de
-- documentos_legales (que tiene un estado 'borrador' editable antes de publicarse), acá NO
-- existe ningún estado previo: cada INSERT en esta tabla ES ya la decisión final, tal como
-- ocurrió. No hay ningún escenario legítimo de "corregir" o "borrar" un consentimiento ya
-- registrado. Corregir un error solo puede hacerse insertando un evento NUEVO (ej. una futura
-- fila con tipo_evento='reaceptacion') — nunca modificando ni eliminando el histórico.
--
-- Mismo espíritu que trg_proteger_documento_legal / trg_prevenir_borrado_documento_legal
-- (migración 20260725_documentos_legales_y_consentimientos.sql), pero más simple: acá no hay
-- transiciones permitidas en absoluto — CUALQUIER UPDATE o DELETE sobre una fila ya insertada
-- es un error, sin excepciones.
--
-- Posterior e independiente de 20260725_documentos_legales_y_consentimientos.sql (0ebc0f5) y
-- de 20260922_poblar_documentos_legales.sql: ninguna de las dos se modifica, esta migración
-- solo agrega los dos triggers de abajo sobre la tabla consentimientos_legales ya existente.
--
-- Deliberadamente a nivel de BASE (trigger), no solo RLS: corre para cualquier rol que ejecute
-- el UPDATE/DELETE — incluida la service_role que usa el backend con supabaseAdmin (que en
-- Supabase por default se salta las políticas de RLS, pero NO se salta triggers). RLS sigue
-- existiendo aparte para las políticas de SELECT/INSERT por rol; esto es una capa ADICIONAL,
-- no un reemplazo — si algún día se revocara o rompiera una política de RLS, este trigger
-- sigue bloqueando la modificación/borrado igual.
--
-- No se tocan filas históricas: estos triggers solo se disparan ante un UPDATE o DELETE nuevo
-- — una fila que nunca se toca nunca dispara nada. No hay backfill ni UPDATE en esta migración.

CREATE OR REPLACE FUNCTION prevenir_update_consentimiento_legal()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consentimientos_legales es append-only: no se puede modificar el consentimiento id=% (usuario_id=%, tipo_documento=%, registrado el %). Para corregir un error, insertar una fila nueva en lugar de modificar esta.',
    OLD.id, OLD.usuario_id, OLD.tipo_documento, OLD.fecha_decision;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevenir_update_consentimiento_legal
BEFORE UPDATE ON consentimientos_legales
FOR EACH ROW
EXECUTE FUNCTION prevenir_update_consentimiento_legal();


CREATE OR REPLACE FUNCTION prevenir_borrado_consentimiento_legal()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consentimientos_legales es append-only: no se puede eliminar el consentimiento id=% (usuario_id=%, tipo_documento=%, registrado el %).',
    OLD.id, OLD.usuario_id, OLD.tipo_documento, OLD.fecha_decision;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevenir_borrado_consentimiento_legal
BEFORE DELETE ON consentimientos_legales
FOR EACH ROW
EXECUTE FUNCTION prevenir_borrado_consentimiento_legal();
