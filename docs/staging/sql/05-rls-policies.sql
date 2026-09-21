-- =====================================================================================================================
-- 05-rls-policies.sql · RLS HABILITADO EN 10 TABLAS + 10 POLICIES DE public                                                     [SOLO STAGING · NO EJECUTAR EN PRODUCCIÓN]
-- Generado por scripts/staging/generar-esquema.mjs desde RESULTADO-ESQUEMA-PRODUCCION.json (2026-09-19T15:38:18Z, PostgreSQL 17.6 on aarch64-unknown-linux-gnu).
-- NO EDITAR A MANO: se regenera. Reproduce producción TAL CUAL (incluidas policies/permisos abiertos): NO corrige vulnerabilidades.
-- No contiene datos. No toca tablas backup_*. Se ejecuta completo, en una sola corrida, dentro de una transacción.
-- ⚠ Estas policies REPRODUCEN las de producción, incluidas las abiertas (anon_select_usuarios, anon_update_usuarios_permisivo, etc.).
-- Tablas con RLS habilitado y SIN policies (deniegan todo a anon/authenticated): billetera_chofer, cargas, consentimientos_legales, mensajes_viaje, tarifas_config.
-- Las policies de storage.objects están en 08-storage.sql.
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
    raise exception 'ABORTADO (05-rls-policies): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. Estos archivos son SOLO para STAGING.';
  end if;
end
$guarda$;

alter table public.billetera_chofer enable row level security;
alter table public.cargas enable row level security;
alter table public.consentimientos_legales enable row level security;
alter table public.documentacion_chofer enable row level security;
alter table public.mensajes_viaje enable row level security;
alter table public.paradas_viaje enable row level security;
alter table public.tarifas_config enable row level security;
alter table public.usuarios enable row level security;
alter table public.vehiculos enable row level security;
alter table public.viaje_evidencias enable row level security;

-- documentacion_chofer
create policy "documentacion_chofer_select_anon" on public.documentacion_chofer
  as permissive
  for select
  to anon
  using (true);

-- paradas_viaje
create policy "permitir actualizar paradas anon y authenticated" on public.paradas_viaje
  as permissive
  for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "permitir insertar paradas anon y authenticated" on public.paradas_viaje
  as permissive
  for insert
  to anon, authenticated
  with check (true);

create policy "permitir leer paradas anon y authenticated" on public.paradas_viaje
  as permissive
  for select
  to anon, authenticated
  using (true);

-- usuarios
create policy "anon_insert_usuarios_no_admin" on public.usuarios
  as permissive
  for insert
  to anon
  with check ((rol = ANY (ARRAY['cliente'::text, 'chofer'::text])));

create policy "anon_select_usuarios" on public.usuarios
  as permissive
  for select
  to anon
  using (true);

create policy "anon_update_usuarios_permisivo" on public.usuarios
  as permissive
  for update
  to anon
  using (true)
  with check (true);

-- vehiculos
create policy "vehiculos_select_anon" on public.vehiculos
  as permissive
  for select
  to anon
  using (true);

-- viaje_evidencias
create policy "viaje_evidencias_insert" on public.viaje_evidencias
  as permissive
  for insert
  to public
  with check (true);

create policy "viaje_evidencias_select" on public.viaje_evidencias
  as permissive
  for select
  to public
  using (true);

commit;
