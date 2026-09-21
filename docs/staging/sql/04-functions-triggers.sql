-- =====================================================================================================================
-- 04-functions-triggers.sql · FUNCIONES (2) Y TRIGGERS (1) DE public                                                     [SOLO STAGING · NO EJECUTAR EN PRODUCCIÓN]
-- Generado por scripts/staging/generar-esquema.mjs desde RESULTADO-ESQUEMA-PRODUCCION.json (2026-09-19T15:38:18Z, PostgreSQL 17.6 on aarch64-unknown-linux-gnu).
-- NO EDITAR A MANO: se regenera. Reproduce producción TAL CUAL (incluidas policies/permisos abiertos): NO corrige vulnerabilidades.
-- No contiene datos. No toca tablas backup_*. Se ejecuta completo, en una sola corrida, dentro de una transacción.
-- Las 4 funciones/triggers de storage.* y realtime.* (enforce_bucket_name_length, protect_delete, update_updated_at_column,
-- subscription_check_filters) los gestiona Supabase: NO se replican acá (ver PLAN-EJECUCION-STAGING.md, «Diferencias inevitables»).
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
    raise exception 'ABORTADO (04-functions-triggers): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. Estos archivos son SOLO para STAGING.';
  end if;
end
$guarda$;

-- public.rls_auto_enable() · dueño postgres · security_definer=true · config=["search_path=pg_catalog"]
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- public.set_updated_at() · dueño postgres · security_definer=false · config=null
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- trigger vehiculos_updated_at → public.set_updated_at
CREATE TRIGGER vehiculos_updated_at BEFORE UPDATE ON vehiculos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── EVENT TRIGGER ensure_rls (propio del proyecto; leído de producción con pg_event_trigger) ──────────────────────────────────
--   Producción: evento ddl_command_end · tags [CREATE TABLE, CREATE TABLE AS, SELECT INTO] · habilitado (O) · dueño postgres · ejecuta public.rls_auto_enable() (SECURITY DEFINER=true).
--   Se crea DESPUÉS de la función (arriba). GUARDA anti-duplicado: si el proyecto ya tiene un event trigger llamado ensure_rls:
--     · idéntico (evento, tags, función, habilitado) → NO se recrea (queda un NOTICE);
--     · distinto                                     → se ABORTA sin modificar nada (revisar a mano).
--   NO se recrean los otros 6 event triggers de producción (issue_graphql_placeholder, issue_pg_cron_access, issue_pg_graphql_access, issue_pg_net_access, pgrst_ddl_watch, pgrst_drop_watch):
--   son de supabase_admin (Supabase / PostgREST / extensiones) y los trae el proyecto.
--   Si crear el event trigger fallara con «permission denied», este archivo (04 completo) se revierte; ver PLAN-EJECUCION-STAGING.md.
do $evt$
declare
  v_existe boolean;
  v_igual  boolean;
begin
  select true,
         (e.evtevent = 'ddl_command_end'
          and n.nspname = 'public' and p.proname = 'rls_auto_enable'
          and e.evtenabled = 'O'
          and (select array_agg(t order by t collate "C") from unnest(e.evttags) t) = array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'])
    into v_existe, v_igual
  from pg_event_trigger e
  join pg_proc p on p.oid = e.evtfoid
  join pg_namespace n on n.oid = p.pronamespace
  where e.evtname = 'ensure_rls';

  if v_existe is null then
    create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') execute function public.rls_auto_enable();
  elsif v_igual then
    raise notice 'event trigger ensure_rls ya existe y coincide con producción: no se recrea.';
  else
    raise exception 'ABORTADO (04): ya existe el event trigger ensure_rls pero NO coincide con producción (evento/tags/función/habilitado). No se modificó nada; revisar a mano.';
  end if;
end
$evt$;

commit;
