-- =====================================================================================================================
-- 03-indexes.sql · ÍNDICES (14 independientes; +12 creados por 02-constraints)                                                     [SOLO STAGING · NO EJECUTAR EN PRODUCCIÓN]
-- Generado por scripts/staging/generar-esquema.mjs desde RESULTADO-ESQUEMA-PRODUCCION.json (2026-09-19T15:38:18Z, PostgreSQL 17.6 on aarch64-unknown-linux-gnu).
-- NO EDITAR A MANO: se regenera. Reproduce producción TAL CUAL (incluidas policies/permisos abiertos): NO corrige vulnerabilidades.
-- No contiene datos. No toca tablas backup_*. Se ejecuta completo, en una sola corrida, dentro de una transacción.
-- Incluye los índices redundantes que existen en producción (prefijos de otros índices): se replican a propósito.
-- Nota: idx_usuarios_vehiculo_activo_id (de la migración 20250606) NO existe en producción y por eso NO se crea.
-- =====================================================================================================================

begin;

-- Los nombres sin esquema (usuarios, cargas, *_seq, set_updated_at) se resuelven en public, sin depender del search_path del rol.
set local search_path to public, extensions;

-- ── GUARDA ANTI-PRODUCCIÓN ─────────────────────────────────────────────────────────────────────────
-- Producción tiene las tablas backup_*_20260614; un proyecto de staging NO debe tenerlas. Si existen, esto NO es staging.
do $guarda$
begin
  if to_regclass('public.backup_usuarios_20260614') is not null
     or to_regclass('public.backup_cargas_20260614') is not null then
    raise exception 'ABORTADO (03-indexes): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. Estos archivos son SOLO para STAGING.';
  end if;
end
$guarda$;

CREATE INDEX idx_cargas_mp_payment_id ON public.cargas USING btree (mp_payment_id);
CREATE INDEX idx_cargas_pago_estado ON public.cargas USING btree (pago_estado);
CREATE INDEX idx_consentimientos_tipo_version ON public.consentimientos_legales USING btree (tipo_documento, version_documento);
CREATE INDEX idx_consentimientos_usuario_id ON public.consentimientos_legales USING btree (usuario_id);
CREATE INDEX idx_documentacion_chofer_id ON public.documentacion_chofer USING btree (chofer_id);
CREATE INDEX idx_mensajes_viaje_created_at ON public.mensajes_viaje USING btree (viaje_id, created_at);
CREATE INDEX idx_mensajes_viaje_viaje_id ON public.mensajes_viaje USING btree (viaje_id);
CREATE INDEX idx_paradas_viaje_carga_id ON public.paradas_viaje USING btree (carga_id);
CREATE INDEX idx_paradas_viaje_carga_orden ON public.paradas_viaje USING btree (carga_id, orden);
CREATE INDEX idx_usuarios_estado_doc ON public.usuarios USING btree (estado_doc);
CREATE INDEX vehiculos_activo_idx ON public.vehiculos USING btree (activo);
CREATE INDEX vehiculos_chofer_id_idx ON public.vehiculos USING btree (chofer_id);
CREATE INDEX vehiculos_patente_idx ON public.vehiculos USING btree (patente);
CREATE INDEX idx_viaje_evidencias_carga_id ON public.viaje_evidencias USING btree (carga_id);

commit;
