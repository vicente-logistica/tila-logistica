-- =====================================================================================================================
-- rollback-staging.sql · DESHACE 01..08 en el proyecto de STAGING            [DESTRUCTIVO · SOLO STAGING · NO EJECUTAR EN PRODUCCIÓN]
-- =====================================================================================================================
-- Borra las 10 tablas de public (y con ellas datos, índices, constraints, policies, grants y triggers), las 4 secuencias, la función
-- set_updated_at y las 6 policies de storage.objects; y saca cargas/mensajes_viaje de la publicación supabase_realtime.
--
-- NO toca (a propósito):
--   · public.rls_auto_enable(): puede venir de Supabase y no se sabe si preexistía (04 usa CREATE OR REPLACE). Ver PLAN-EJECUCION-STAGING.md.
--   · Buckets 'documentacion-choferes' y 'vehiculos': storage.protect_delete impide borrarlos por SQL y hay que vaciarlos antes.
--     → Panel de Storage: vaciar cada bucket y «Delete bucket» (o Storage API). Si tienen archivos y se borra la fila a mano quedan objetos huérfanos.
--   · Extensiones, esquemas y roles gestionados por Supabase.
--
-- ALTERNATIVA MÁS SIMPLE Y RECOMENDADA: eliminar el proyecto de staging desde el panel (Project Settings → General → Delete project)
-- y crear otro. Staging es descartable; este archivo es para reiniciar sin recrear el proyecto.
--
-- Se ejecuta completo, en una corrida. Idempotente (if exists).
-- =====================================================================================================================

begin;
set local search_path to public, extensions;

-- ── GUARDA 1: huella de producción ───────────────────────────────────────────────────────────────────────────────────
do $guarda1$
begin
  if to_regclass('public.backup_usuarios_20260614') is not null
     or to_regclass('public.backup_cargas_20260614') is not null then
    raise exception 'ABORTADO (rollback): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. NO se borra nada.';
  end if;
end
$guarda1$;

-- ── GUARDA 2: solo datos ficticios ───────────────────────────────────────────────────────────────────────────────────
-- Si public.usuarios tiene algún email que NO sea @tila-staging.invalid, hay datos reales: se aborta. (Solo cuenta, no muestra nada.)
do $guarda2$
declare n bigint;
begin
  if to_regclass('public.usuarios') is not null then
    execute $q$select count(*) from public.usuarios where email is not null and email not like '%@tila-staging.invalid'$q$ into n;
    if n > 0 then
      raise exception 'ABORTADO (rollback): public.usuarios tiene % fila(s) con email que no es @tila-staging.invalid => posibles datos reales. NO se borra nada.', n;
    end if;
  end if;
end
$guarda2$;

-- ── 08 · policies de storage.objects (los buckets se borran por panel/API, ver arriba) ──────────────────────────────
drop policy if exists "Public read documentacion choferes"    on storage.objects;
drop policy if exists "Public read vehiculos"                 on storage.objects;
drop policy if exists "Public updates documentacion choferes" on storage.objects;
drop policy if exists "Public updates vehiculos"              on storage.objects;
drop policy if exists "Public uploads documentacion choferes" on storage.objects;
drop policy if exists "Public uploads vehiculos"              on storage.objects;

-- ── 07 · publicación Realtime ────────────────────────────────────────────────────────────────────────────────────────
do $rt$
declare t text;
begin
  foreach t in array array['cargas', 'mensajes_viaje'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$rt$;

-- ── 06..01 · tablas (llevan consigo policies, grants, constraints, índices y el trigger vehiculos_updated_at) ─────────
drop table if exists public.consentimientos_legales cascade;
drop table if exists public.documentacion_chofer     cascade;
drop table if exists public.paradas_viaje            cascade;
drop table if exists public.mensajes_viaje           cascade;
drop table if exists public.viaje_evidencias         cascade;
drop table if exists public.billetera_chofer         cascade;
drop table if exists public.tarifas_config           cascade;
drop table if exists public.cargas                   cascade;
drop table if exists public.vehiculos                cascade;
drop table if exists public.usuarios                 cascade;

-- Secuencias serial (la identity de cargas se borró con la tabla; las serial también, pero se dejan por si quedaron sueltas).
drop sequence if exists public.consentimientos_legales_id_seq;
drop sequence if exists public.paradas_viaje_id_seq;
drop sequence if exists public.vehiculos_id_seq;
drop sequence if exists public.viaje_evidencias_id_seq;

-- ── 04 · función del trigger ─────────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.set_updated_at();

commit;
