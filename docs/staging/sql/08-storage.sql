-- =====================================================================================================================
-- 08-storage.sql · BUCKETS (2) Y POLICIES DE storage.objects (6)                                                     [SOLO STAGING · NO EJECUTAR EN PRODUCCIÓN]
-- Generado por scripts/staging/generar-esquema.mjs desde RESULTADO-ESQUEMA-PRODUCCION.json (2026-09-19T15:38:18Z, PostgreSQL 17.6 on aarch64-unknown-linux-gnu).
-- NO EDITAR A MANO: se regenera. Reproduce producción TAL CUAL (incluidas policies/permisos abiertos): NO corrige vulnerabilidades.
-- No contiene datos. No toca tablas backup_*. Se ejecuta completo, en una sola corrida, dentro de una transacción.
-- Ambos buckets son PÚBLICOS, sin límite de tamaño ni de tipo MIME, y storage.objects permite a anon/authenticated leer, subir y ACTUALIZAR
-- (no hay policy de DELETE). Se reproduce tal cual. RLS en storage.objects lo habilita Supabase (no se toca).
-- Los buckets se crean por SQL (storage.buckets); alternativa equivalente: crearlos desde el panel de Storage marcándolos públicos.
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
    raise exception 'ABORTADO (08-storage): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. Estos archivos son SOLO para STAGING.';
  end if;
end
$guarda$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documentacion-choferes', 'documentacion-choferes', true, null, null),
  ('vehiculos', 'vehiculos', true, null, null)
on conflict (id) do update set name = excluded.name, public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Public read documentacion choferes" on storage.objects
  as permissive
  for select
  to anon, authenticated
  using ((bucket_id = 'documentacion-choferes'::text));

create policy "Public read vehiculos" on storage.objects
  as permissive
  for select
  to anon, authenticated
  using ((bucket_id = 'vehiculos'::text));

create policy "Public updates documentacion choferes" on storage.objects
  as permissive
  for update
  to anon, authenticated
  using ((bucket_id = 'documentacion-choferes'::text))
  with check ((bucket_id = 'documentacion-choferes'::text));

create policy "Public updates vehiculos" on storage.objects
  as permissive
  for update
  to anon, authenticated
  using ((bucket_id = 'vehiculos'::text))
  with check ((bucket_id = 'vehiculos'::text));

create policy "Public uploads documentacion choferes" on storage.objects
  as permissive
  for insert
  to anon, authenticated
  with check ((bucket_id = 'documentacion-choferes'::text));

create policy "Public uploads vehiculos" on storage.objects
  as permissive
  for insert
  to anon, authenticated
  with check ((bucket_id = 'vehiculos'::text));

commit;
