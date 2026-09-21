-- =====================================================================================================================
-- 06-grants.sql · GRANTs EFECTIVOS DE TABLAS, SECUENCIAS Y FUNCIONES DE public                                                     [SOLO STAGING · NO EJECUTAR EN PRODUCCIÓN]
-- Generado por scripts/staging/generar-esquema.mjs desde RESULTADO-ESQUEMA-PRODUCCION.json (2026-09-19T15:38:18Z, PostgreSQL 17.6 on aarch64-unknown-linux-gnu).
-- NO EDITAR A MANO: se regenera. Reproduce producción TAL CUAL (incluidas policies/permisos abiertos): NO corrige vulnerabilidades.
-- No contiene datos. No toca tablas backup_*. Se ejecuta completo, en una sola corrida, dentro de una transacción.
-- En producción TODOS estos permisos provienen de los privilegios por defecto de Supabase (postgres/supabase_admin → anon, authenticated,
-- service_role). Se escriben explícitos para que staging no dependa de los defaults de su proyecto. Incluyen TRUNCATE/TRIGGER/REFERENCES a anon (igual que producción).
-- NO se replican: GRANTs de esquemas (public/storage/realtime), default privileges y roles → los gestiona Supabase. El dueño (postgres) conserva todo.
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
    raise exception 'ABORTADO (06-grants): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. Estos archivos son SOLO para STAGING.';
  end if;
end
$guarda$;

revoke all on table public.billetera_chofer from anon, authenticated, service_role;
grant all on table public.billetera_chofer to anon;
grant all on table public.billetera_chofer to authenticated;
grant all on table public.billetera_chofer to service_role;
revoke all on table public.cargas from anon, authenticated, service_role;
grant all on table public.cargas to anon;
grant all on table public.cargas to authenticated;
grant all on table public.cargas to service_role;
revoke all on table public.consentimientos_legales from anon, authenticated, service_role;
grant all on table public.consentimientos_legales to anon;
grant all on table public.consentimientos_legales to authenticated;
grant all on table public.consentimientos_legales to service_role;
revoke all on table public.documentacion_chofer from anon, authenticated, service_role;
grant all on table public.documentacion_chofer to anon;
grant all on table public.documentacion_chofer to authenticated;
grant all on table public.documentacion_chofer to service_role;
revoke all on table public.mensajes_viaje from anon, authenticated, service_role;
grant all on table public.mensajes_viaje to anon;
grant all on table public.mensajes_viaje to authenticated;
grant all on table public.mensajes_viaje to service_role;
revoke all on table public.paradas_viaje from anon, authenticated, service_role;
grant all on table public.paradas_viaje to anon;
grant all on table public.paradas_viaje to authenticated;
grant all on table public.paradas_viaje to service_role;
revoke all on table public.tarifas_config from anon, authenticated, service_role;
grant all on table public.tarifas_config to anon;
grant all on table public.tarifas_config to authenticated;
grant all on table public.tarifas_config to service_role;
revoke all on table public.usuarios from anon, authenticated, service_role;
grant all on table public.usuarios to anon;
grant all on table public.usuarios to authenticated;
grant all on table public.usuarios to service_role;
revoke all on table public.vehiculos from anon, authenticated, service_role;
grant all on table public.vehiculos to anon;
grant all on table public.vehiculos to authenticated;
grant all on table public.vehiculos to service_role;
revoke all on table public.viaje_evidencias from anon, authenticated, service_role;
grant all on table public.viaje_evidencias to anon;
grant all on table public.viaje_evidencias to authenticated;
grant all on table public.viaje_evidencias to service_role;

-- Secuencias
revoke all on sequence public.cargas_id_seq from anon, authenticated, service_role;
grant all on sequence public.cargas_id_seq to anon;
grant all on sequence public.cargas_id_seq to authenticated;
grant all on sequence public.cargas_id_seq to service_role;
revoke all on sequence public.consentimientos_legales_id_seq from anon, authenticated, service_role;
grant all on sequence public.consentimientos_legales_id_seq to anon;
grant all on sequence public.consentimientos_legales_id_seq to authenticated;
grant all on sequence public.consentimientos_legales_id_seq to service_role;
revoke all on sequence public.paradas_viaje_id_seq from anon, authenticated, service_role;
grant all on sequence public.paradas_viaje_id_seq to anon;
grant all on sequence public.paradas_viaje_id_seq to authenticated;
grant all on sequence public.paradas_viaje_id_seq to service_role;
revoke all on sequence public.vehiculos_id_seq from anon, authenticated, service_role;
grant all on sequence public.vehiculos_id_seq to anon;
grant all on sequence public.vehiculos_id_seq to authenticated;
grant all on sequence public.vehiculos_id_seq to service_role;
revoke all on sequence public.viaje_evidencias_id_seq from anon, authenticated, service_role;
grant all on sequence public.viaje_evidencias_id_seq to anon;
grant all on sequence public.viaje_evidencias_id_seq to authenticated;
grant all on sequence public.viaje_evidencias_id_seq to service_role;

-- Funciones (EXECUTE). PUBLIC = todos los roles.
revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;
grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role;
revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_updated_at() to public, anon, authenticated, service_role;

commit;
