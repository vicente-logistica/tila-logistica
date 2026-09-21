-- =====================================================================================================================
-- 02-constraints.sql · CONSTRAINTS (22): PK, UNIQUE, CHECK y FOREIGN KEY                                                     [SOLO STAGING · NO EJECUTAR EN PRODUCCIÓN]
-- Generado por scripts/staging/generar-esquema.mjs desde RESULTADO-ESQUEMA-PRODUCCION.json (2026-09-19T15:38:18Z, PostgreSQL 17.6 on aarch64-unknown-linux-gnu).
-- NO EDITAR A MANO: se regenera. Reproduce producción TAL CUAL (incluidas policies/permisos abiertos): NO corrige vulnerabilidades.
-- No contiene datos. No toca tablas backup_*. Se ejecuta completo, en una sola corrida, dentro de una transacción.
-- Van DESPUÉS de crear todas las tablas porque hay una referencia circular (usuarios.vehiculo_activo_id → vehiculos, vehiculos.chofer_id → usuarios).
-- Los índices de PK/UNIQUE los crea el propio constraint (12 de los 26 índices de producción).
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
    raise exception 'ABORTADO (02-constraints): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. Estos archivos son SOLO para STAGING.';
  end if;
end
$guarda$;

-- PRIMARY KEY
alter table public.billetera_chofer add constraint billetera_chofer_pkey PRIMARY KEY (id);
alter table public.cargas add constraint cargas_pkey PRIMARY KEY (id);
alter table public.consentimientos_legales add constraint consentimientos_legales_pkey PRIMARY KEY (id);
alter table public.documentacion_chofer add constraint documentacion_chofer_pkey PRIMARY KEY (id);
alter table public.mensajes_viaje add constraint mensajes_viaje_pkey PRIMARY KEY (id);
alter table public.paradas_viaje add constraint paradas_viaje_pkey PRIMARY KEY (id);
alter table public.tarifas_config add constraint tarifas_config_pkey PRIMARY KEY (id);
alter table public.usuarios add constraint usuarios_pkey PRIMARY KEY (id);
alter table public.vehiculos add constraint vehiculos_pkey PRIMARY KEY (id);
alter table public.viaje_evidencias add constraint viaje_evidencias_pkey PRIMARY KEY (id);

-- UNIQUE
alter table public.documentacion_chofer add constraint documentacion_chofer_chofer_tipo_unique UNIQUE (chofer_id, tipo);
alter table public.usuarios add constraint usuarios_email_key UNIQUE (email);

-- CHECK
alter table public.mensajes_viaje add constraint mensajes_viaje_tipo_chat_check CHECK (tipo_chat = ANY (ARRAY['viaje'::text, 'soporte_cliente'::text, 'soporte_chofer'::text]));
alter table public.usuarios add constraint usuarios_estado_doc_check CHECK (estado_doc = ANY (ARRAY['completa'::text, 'pendiente_actualizacion'::text, 'vencida'::text]));
alter table public.usuarios add constraint usuarios_navegador_preferido_check CHECK (navegador_preferido IS NULL OR (navegador_preferido = ANY (ARRAY['google_maps'::text, 'waze'::text, 'sygic_truck'::text, 'tomtom_truck'::text, 'preguntar_siempre'::text])));
alter table public.vehiculos add constraint vehiculos_estado_validacion_check CHECK (estado_validacion = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text]));
alter table public.vehiculos add constraint vehiculos_tipo_vehiculo_check CHECK (tipo_vehiculo = ANY (ARRAY['Moto'::text, 'Utilitario'::text, 'Furgón'::text, 'Pick-up'::text, 'Camión rígido'::text, 'Camión tractor'::text, 'Bitrén'::text, 'utilitario'::text, 'furgon'::text, 'camion'::text, 'semi'::text, 'mosquito'::text, 'grua'::text, 'pickup'::text, 'minivan'::text, 'otro'::text]));

-- FOREIGN KEY
alter table public.consentimientos_legales add constraint consentimientos_legales_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public.documentacion_chofer add constraint documentacion_chofer_chofer_id_fkey FOREIGN KEY (chofer_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public.paradas_viaje add constraint paradas_viaje_carga_id_fkey FOREIGN KEY (carga_id) REFERENCES cargas(id) ON DELETE CASCADE;
alter table public.usuarios add constraint usuarios_vehiculo_activo_id_fkey FOREIGN KEY (vehiculo_activo_id) REFERENCES vehiculos(id) ON DELETE SET NULL;
alter table public.vehiculos add constraint vehiculos_chofer_id_fkey FOREIGN KEY (chofer_id) REFERENCES usuarios(id) ON DELETE CASCADE;

commit;
