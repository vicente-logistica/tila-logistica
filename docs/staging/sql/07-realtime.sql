-- =====================================================================================================================
-- 07-realtime.sql · PUBLICACIÓN supabase_realtime: cargas + mensajes_viaje                                                     [SOLO STAGING · NO EJECUTAR EN PRODUCCIÓN]
-- Generado por scripts/staging/generar-esquema.mjs desde RESULTADO-ESQUEMA-PRODUCCION.json (2026-09-19T15:38:18Z, PostgreSQL 17.6 on aarch64-unknown-linux-gnu).
-- NO EDITAR A MANO: se regenera. Reproduce producción TAL CUAL (incluidas policies/permisos abiertos): NO corrige vulnerabilidades.
-- No contiene datos. No toca tablas backup_*. Se ejecuta completo, en una sola corrida, dentro de una transacción.
-- Producción publica SOLO estas tablas. `usuarios` y `paradas_viaje` NO están publicadas aunque el frontend se suscribe a ellas
-- (PLAN-STAGING.md §2.2 decía 4 tablas: era una suposición; el dato real son 2). REPLICA IDENTITY: default en todas (no se modifica).
-- supabase_realtime_messages_publication y las particiones realtime.messages_* las gestiona Supabase.
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
    raise exception 'ABORTADO (07-realtime): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. Estos archivos son SOLO para STAGING.';
  end if;
end
$guarda$;

do $rt$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['cargas', 'mensajes_viaje'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$rt$;

commit;
