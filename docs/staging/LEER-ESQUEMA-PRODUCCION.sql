-- =====================================================================================================================
-- LEER-ESQUEMA-PRODUCCION.sql  ·  SOLO LECTURA  ·  TILA
-- =====================================================================================================================
-- QUÉ ES
--   UN ÚNICO `SELECT` (con CTEs) que lee EXCLUSIVAMENTE catálogos del sistema de PostgreSQL y la lista de buckets de Storage,
--   y devuelve UNA sola fila con dos columnas:
--       redacciones_aplicadas  (número)  → cuántos tokens/claves detectó y enmascaró automáticamente
--       esquema_json           (texto)   → el esquema completo en JSON  ←←← ESTA es la celda que hay que copiar
--
-- POR QUÉ ES SOLO LECTURA
--   · Es una sola sentencia que empieza con `WITH` y contiene únicamente `SELECT`. No hay INSERT/UPDATE/DELETE/MERGE, ni DDL
--     (CREATE/ALTER/DROP/TRUNCATE/COMMENT), ni GRANT/REVOKE, ni SET/RESET, ni COPY, ni DO/CALL/EXECUTE, ni SELECT ... INTO,
--     ni FOR UPDATE/SHARE, ni transacciones (BEGIN/COMMIT), ni bloqueos (LOCK).
--   · Las ÚNICAS relaciones que lee son catálogos (pg_class, pg_attribute, pg_constraint, pg_policies, pg_publication...) y
--     `storage.buckets` (nombres y flags de los buckets). NO lee ninguna tabla de `public` (usuarios, cargas, mensajes_viaje,
--     billetera_chofer, documentacion_chofer, viaje_evidencias, etc.), ni `auth.*`, ni `storage.objects` (la lista de archivos).
--   · Las ÚNICAS funciones que invoca son de introspección o de formato/JSON (pg_get_*, format_type, aclexplode, to_jsonb,
--     regexp_*, now, version, count...). Ninguna tiene efectos secundarios (no hay nextval/setval/set_config/pg_sleep/lo_*/dblink).
--   · Este archivo se puede verificar mecánicamente: `node scripts/staging/auditar-sql-solo-lectura.mjs docs/staging/LEER-ESQUEMA-PRODUCCION.sql`
--
-- QUÉ NO DEVUELVE
--   Ninguna fila de negocio ni de usuarios: nada de emails, contraseñas, DNI, teléfonos, CBU/CVU, viajes, mensajes,
--   documentos ni ubicaciones. Tampoco `pg_authid` (hashes de contraseñas de roles) ni el contenido de `supabase_migrations`,
--   `cron.job` o `vault.*`. Solo METADATOS: nombres, tipos, constraints, índices, policies, permisos, publicaciones, buckets.
--
-- CÓMO EJECUTARLO
--   1. Supabase Dashboard (proyecto de PRODUCCIÓN) → SQL Editor → New query. Rol: el predeterminado (`postgres`).
--   2. Pegar TODO este archivo y presionar Run. Es una única sentencia, así que el editor muestra un único resultado.
--   3. En la grilla de resultados, copiar la celda `esquema_json` (doble clic sobre la celda → Copiar; o botón derecho → Copy cell)
--      y guardarla como archivo:  docs/staging/RESULTADO-ESQUEMA-PRODUCCION.json  (o pegarla en el chat).
--      Pasame además el número de la columna `redacciones_aplicadas`.
--   4. ANTES de compartirlo, buscá en el texto las palabras: password, secret, token, key, authorization, bearer, apikey.
--      El script enmascara JWT, claves sb_secret_/sb_publishable_, "Bearer ..." y contraseñas dentro de URLs, pero NO puede
--      adivinar otros formatos de secreto escritos dentro del cuerpo de una función o de un trigger. Si encontrás alguno,
--      reemplazalo por REDACTADO.
--
-- SI ALGO FALLA
--   Un error de permisos o de sintaxis NO modifica nada (es un SELECT): simplemente no devuelve resultado. Decime el mensaje
--   exacto y te doy una versión sin esa sección. Lo más probable de fallar, en orden: `storage.buckets` (S18),
--   `pg_publication_tables` (S17). Con el rol `postgres` del SQL Editor no deberían fallar.
--
-- SECCIONES (cada una = un CTE; todas de solo lectura)
--   S01 t          tablas/vistas/matviews de public + RLS + replica identity      pg_class, pg_namespace, pg_depend
--   S02 cols       columnas: tipo, not null, default, identity, generada          pg_attribute, pg_attrdef
--   S03 tipos      enums y dominios de public                                     pg_type, pg_enum
--   S04 cons       PK, FK, UNIQUE, CHECK, EXCLUDE (definición completa)           pg_constraint
--   S05 idx        índices (definición completa)                                  pg_indexes
--   S06 seqs       secuencias (sin last_value) y columna dueña                    pg_class, pg_sequence, pg_depend
--   S07 trg        triggers (public/auth/storage) con su función                  pg_trigger, pg_proc
--   S08 funcs      funciones/RPC propias y funciones usadas por triggers          pg_proc, pg_language, pg_depend
--   S09 vistas     definición de vistas                                           pg_get_viewdef sobre S01
--   S10 gr_rel     GRANT de tablas y secuencias de public                         pg_class.relacl (aclexplode)
--   S11 gr_col     GRANT por columna                                              pg_attribute.attacl (aclexplode)
--   S12 gr_fn      GRANT EXECUTE de funciones de public                           pg_proc.proacl (aclexplode)
--   S13 gr_esq     GRANT sobre los esquemas public/storage/realtime               pg_namespace.nspacl (aclexplode)
--   S14 defacl     privilegios por defecto (lo que reciben las tablas nuevas)     pg_default_acl
--   S15 pol        policies RLS completas (public, storage, realtime)             pg_policies
--   S16 rls_otros  RLS habilitado en tablas de storage/realtime                   pg_class
--   S17 pubs/pubtbl publicaciones Realtime y sus tablas                           pg_publication, pg_publication_tables
--   S18 buckets    buckets de Storage: nombre, público/privado, límites           storage.buckets
--   S19 exts       extensiones instaladas                                         pg_extension
--   S20 esqs/otras esquemas y tablas fuera de los esquemas estándar de Supabase   pg_namespace, pg_class
--   S21 roles/rolcfg roles (sin contraseñas) y su configuración (p. ej. pgrst.db_schemas)  pg_roles
--   S22 cfg        parámetros del servidor relevantes para Realtime               pg_settings
--   S23 d/s/final  arma el JSON, y enmascara tokens (regexp_replace)
-- =====================================================================================================================

with

-- S01 ─ tablas, vistas y vistas materializadas de `public` ────────────────────────────────────────────────────────
t as (
  select c.oid as oid,
         c.relname as nombre,
         c.relkind::text as tipo,
         pg_get_userbyid(c.relowner) as dueno,
         c.relrowsecurity as rls_habilitado,
         c.relforcerowsecurity as rls_forzado,
         case c.relreplident when 'd' then 'default' when 'n' then 'nothing' when 'f' then 'full' when 'i' then 'index' end as replica_identity,
         c.relpersistence::text as persistencia,
         c.relispartition as es_particion,
         to_jsonb(c.reloptions) as opciones,
         obj_description(c.oid, 'pg_class') as comentario,
         exists (select 1 from pg_depend dp where dp.classid = 'pg_class'::regclass and dp.objid = c.oid and dp.deptype = 'e') as de_extension
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
),

-- S02 ─ columnas ──────────────────────────────────────────────────────────────────────────────────────────────────
cols as (
  select t.nombre as tabla,
         a.attnum as pos,
         a.attname as columna,
         format_type(a.atttypid, a.atttypmod) as tipo,
         a.attnotnull as not_null,
         pg_get_expr(d.adbin, d.adrelid) as default_expr,
         nullif(a.attidentity::text, '') as identidad,
         nullif(a.attgenerated::text, '') as generado,
         col_description(a.attrelid, a.attnum) as comentario
  from t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
),

-- S03 ─ tipos propios (enums y dominios) ─────────────────────────────────────────────────────────────────────────
tipos as (
  select ty.typname as nombre,
         ty.typtype::text as clase,
         case when ty.typtype = 'e' then (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = ty.oid) end as valores,
         case when ty.typtype = 'd' then format_type(ty.typbasetype, ty.typtypmod) end as base
  from pg_type ty
  join pg_namespace n on n.oid = ty.typnamespace
  where n.nspname = 'public' and ty.typtype in ('e', 'd')
),

-- S04 ─ constraints: p = PK, f = FK, u = UNIQUE, c = CHECK, x = EXCLUDE ───────────────────────────────────────────
cons as (
  select t.nombre as tabla,
         k.conname as nombre,
         k.contype::text as tipo,
         pg_get_constraintdef(k.oid, true) as definicion,
         k.convalidated as validada,
         k.condeferrable as diferible,
         k.condeferred as diferida
  from t
  join pg_constraint k on k.conrelid = t.oid
),

-- S05 ─ índices ───────────────────────────────────────────────────────────────────────────────────────────────────
idx as (
  select i.tablename as tabla, i.indexname as nombre, i.indexdef as definicion
  from pg_indexes i
  where i.schemaname = 'public'
),

-- S06 ─ secuencias (NO se lee last_value: solo la definición) ─────────────────────────────────────────────────────
seqs as (
  select c.relname as nombre,
         format_type(sq.seqtypid, null) as tipo,
         sq.seqstart as inicio,
         sq.seqmin as minimo,
         sq.seqmax as maximo,
         sq.seqincrement as incremento,
         sq.seqcycle as cicla,
         sq.seqcache as cache_tam,
         (select tc.relname || '.' || a.attname
            from pg_depend dp
            join pg_class tc on tc.oid = dp.refobjid
            join pg_attribute a on a.attrelid = dp.refobjid and a.attnum = dp.refobjsubid
           where dp.objid = c.oid and dp.classid = 'pg_class'::regclass and dp.refclassid = 'pg_class'::regclass and dp.deptype in ('a', 'i')
           limit 1) as columna_duena
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_sequence sq on sq.seqrelid = c.oid
  where n.nspname = 'public' and c.relkind = 'S'
),

-- S07 ─ triggers definidos por el usuario (excluye los internos de FK) ────────────────────────────────────────────
trg as (
  select tn.nspname as esquema,
         tc.relname as tabla,
         g.tgname as nombre,
         pg_get_triggerdef(g.oid, true) as definicion,
         g.tgenabled::text as habilitado,
         fn.nspname || '.' || p.proname as funcion
  from pg_trigger g
  join pg_class tc on tc.oid = g.tgrelid
  join pg_namespace tn on tn.oid = tc.relnamespace
  join pg_proc p on p.oid = g.tgfoid
  join pg_namespace fn on fn.oid = p.pronamespace
  where not g.tgisinternal and tn.nspname in ('public', 'auth', 'storage')
),

-- S08 ─ funciones/RPC propias de `public` (sin las de extensiones) + funciones usadas por triggers ────────────────
funcs as (
  select n.nspname as esquema,
         p.proname as nombre,
         p.prokind::text as clase,
         l.lanname as lenguaje,
         pg_get_function_identity_arguments(p.oid) as argumentos,
         pg_get_function_result(p.oid) as retorna,
         p.prosecdef as security_definer,
         p.provolatile::text as volatilidad,
         to_jsonb(p.proconfig) as config,
         pg_get_userbyid(p.proowner) as dueno,
         (p.proacl is null) as acl_por_defecto,
         pg_get_functiondef(p.oid) as definicion
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where p.prokind in ('f', 'p')
    and ( n.nspname = 'public'
          or ( p.oid in (select g.tgfoid from pg_trigger g where not g.tgisinternal)
               and n.nspname not in ('pg_catalog', 'information_schema') ) )
    and not exists (select 1 from pg_depend dp where dp.classid = 'pg_proc'::regclass and dp.objid = p.oid and dp.deptype = 'e')
),

-- S09 ─ definición de vistas y vistas materializadas ─────────────────────────────────────────────────────────────
vistas as (
  select t.nombre as nombre, t.tipo as tipo, pg_get_viewdef(t.oid, true) as definicion
  from t
  where t.tipo in ('v', 'm')
),

-- S10 ─ GRANT sobre tablas/vistas/secuencias de `public` (relacl NULL = privilegios por defecto del dueño) ────────
gr_rel as (
  select c.relname as objeto,
         c.relkind::text as tipo,
         case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
         x.privilege_type as privilegio,
         x.is_grantable as con_grant_option
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) as x
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
),

-- S11 ─ GRANT a nivel de columna ──────────────────────────────────────────────────────────────────────────────────
gr_col as (
  select t.nombre as tabla,
         a.attname as columna,
         case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
         x.privilege_type as privilegio
  from t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  cross join lateral aclexplode(a.attacl) as x
),

-- S12 ─ GRANT EXECUTE de funciones de `public` (proacl NULL = EXECUTE para PUBLIC por defecto) ────────────────────
gr_fn as (
  select p.proname as funcion,
         pg_get_function_identity_arguments(p.oid) as argumentos,
         case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
         x.privilege_type as privilegio
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) as x
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend dp where dp.classid = 'pg_proc'::regclass and dp.objid = p.oid and dp.deptype = 'e')
),

-- S13 ─ GRANT sobre esquemas ─────────────────────────────────────────────────────────────────────────────────────
gr_esq as (
  select n.nspname as esquema,
         case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
         x.privilege_type as privilegio
  from pg_namespace n
  cross join lateral aclexplode(n.nspacl) as x
  where n.nspname in ('public', 'storage', 'realtime')
),

-- S14 ─ privilegios por defecto (Supabase suele darle a anon/authenticated/service_role permisos sobre tablas nuevas) ─
defacl as (
  select pg_get_userbyid(d.defaclrole) as rol_creador,
         coalesce(n.nspname, '(global)') as esquema,
         d.defaclobjtype::text as tipo_objeto,
         case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
         x.privilege_type as privilegio
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) as x
),

-- S15 ─ policies RLS completas (public, storage.objects/buckets, realtime.messages) ──────────────────────────────
pol as (
  select p.schemaname as esquema,
         p.tablename as tabla,
         p.policyname as nombre,
         p.permissive as permisiva,
         to_jsonb(p.roles) as roles,
         p.cmd as comando,
         p.qual as using_expr,
         p.with_check as with_check_expr
  from pg_policies p
  where p.schemaname in ('public', 'storage', 'realtime')
),

-- S16 ─ ¿RLS habilitado en las tablas de storage/realtime? (solo nombres y flags) ────────────────────────────────
rls_otros as (
  select n.nspname as esquema, c.relname as tabla, c.relrowsecurity as rls_habilitado, c.relforcerowsecurity as rls_forzado
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('storage', 'realtime') and c.relkind in ('r', 'p')
),

-- S17 ─ publicaciones Realtime: cuáles existen y qué tablas publican ─────────────────────────────────────────────
pubs as (
  select pb.pubname as nombre,
         pg_get_userbyid(pb.pubowner) as dueno,
         pb.puballtables as todas_las_tablas,
         pb.pubinsert as inserts,
         pb.pubupdate as updates,
         pb.pubdelete as deletes,
         pb.pubtruncate as truncates
  from pg_publication pb
),
pubtbl as (
  select to_jsonb(x) as fila
  from pg_publication_tables x
),

-- S18 ─ buckets de Storage (NO se lee storage.objects: eso listaría archivos de usuarios) ────────────────────────
buckets as (
  select to_jsonb(b) - 'owner' - 'owner_id' as fila
  from storage.buckets b
),

-- S19 ─ extensiones ──────────────────────────────────────────────────────────────────────────────────────────────
exts as (
  select e.extname as nombre, e.extversion as version, n.nspname as esquema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
),

-- S20 ─ esquemas, y tablas que existan FUERA de los esquemas estándar de Supabase ───────────────────────────────
esqs as (
  select n.nspname as nombre, pg_get_userbyid(n.nspowner) as dueno
  from pg_namespace n
  where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
),
otras as (
  select n.nspname as esquema, c.relname as nombre, c.relkind::text as tipo
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
    and n.nspname not in ('public', 'auth', 'storage', 'realtime', 'extensions', 'graphql', 'graphql_public', 'vault', 'pgsodium',
                          'pgsodium_masks', 'supabase_functions', 'supabase_migrations', 'net', 'cron', 'pgbouncer', '_realtime',
                          '_analytics', 'supavisor', 'pgtle', 'topology', 'tiger', 'tiger_data')
),

-- S21 ─ roles (pg_roles NO expone contraseñas) y su configuración (statement_timeout, pgrst.db_schemas, etc.) ─────
roles as (
  select r.rolname as nombre, r.rolsuper as superusuario, r.rolinherit as hereda, r.rolcreaterole as crea_roles,
         r.rolcreatedb as crea_bd, r.rolcanlogin as puede_login, r.rolbypassrls as bypass_rls, r.rolreplication as replicacion
  from pg_roles r
  where r.rolname !~ '^pg_'
),
rolcfg as (
  select r.rolname as nombre, to_jsonb(r.rolconfig) as config
  from pg_roles r
  where r.rolname !~ '^pg_' and r.rolconfig is not null
),

-- S22 ─ parámetros del servidor que condicionan Realtime (wal_level, slots, senders) ─────────────────────────────
cfg as (
  select s.name as nombre, s.setting as valor
  from pg_settings s
  where s.name in ('server_version', 'wal_level', 'max_replication_slots', 'max_wal_senders', 'max_slot_wal_keep_size',
                   'timezone', 'default_transaction_isolation', 'row_security')
),

-- S23 ─ arma el documento JSON (una sola pieza) ──────────────────────────────────────────────────────────────────
d as (
  select jsonb_build_object(
    'formato', 'tila-esquema-produccion/1',
    'generado_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'meta', jsonb_build_object('version', version(), 'base', current_database(), 'usuario_sql', current_user),
    'resumen', jsonb_build_object(
      'tablas', (select count(*) from t where t.tipo in ('r', 'p', 'f')),
      'vistas', (select count(*) from t where t.tipo in ('v', 'm')),
      'columnas', (select count(*) from cols),
      'constraints', (select count(*) from cons),
      'indices', (select count(*) from idx),
      'triggers', (select count(*) from trg),
      'funciones', (select count(*) from funcs),
      'policies', (select count(*) from pol),
      'buckets', (select count(*) from buckets),
      'publicaciones', (select count(*) from pubs)
    ),
    'configuracion_servidor', (select coalesce(jsonb_object_agg(cfg.nombre, cfg.valor), '{}'::jsonb) from cfg),
    'esquemas', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from esqs x), '[]'::jsonb),
    'tablas_fuera_de_esquemas_estandar', coalesce((select jsonb_agg(to_jsonb(x) order by x.esquema, x.nombre) from otras x), '[]'::jsonb),
    'extensiones', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from exts x), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from roles x), '[]'::jsonb),
    'configuracion_por_rol', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from rolcfg x), '[]'::jsonb),
    'tipos', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from tipos x), '[]'::jsonb),
    'tablas', coalesce((select jsonb_agg(to_jsonb(x) - 'oid' order by x.nombre) from t x), '[]'::jsonb),
    'columnas', coalesce((select jsonb_agg(to_jsonb(x) order by x.tabla, x.pos) from cols x), '[]'::jsonb),
    'constraints', coalesce((select jsonb_agg(to_jsonb(x) order by x.tabla, x.tipo, x.nombre) from cons x), '[]'::jsonb),
    'indices', coalesce((select jsonb_agg(to_jsonb(x) order by x.tabla, x.nombre) from idx x), '[]'::jsonb),
    'secuencias', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from seqs x), '[]'::jsonb),
    'triggers', coalesce((select jsonb_agg(to_jsonb(x) order by x.esquema, x.tabla, x.nombre) from trg x), '[]'::jsonb),
    'funciones', coalesce((select jsonb_agg(to_jsonb(x) order by x.esquema, x.nombre, x.argumentos) from funcs x), '[]'::jsonb),
    'vistas_definicion', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from vistas x), '[]'::jsonb),
    'grants_tablas', coalesce((select jsonb_agg(to_jsonb(x) order by x.objeto, x.grantee, x.privilegio) from gr_rel x), '[]'::jsonb),
    'grants_columnas', coalesce((select jsonb_agg(to_jsonb(x) order by x.tabla, x.columna, x.grantee, x.privilegio) from gr_col x), '[]'::jsonb),
    'grants_funciones', coalesce((select jsonb_agg(to_jsonb(x) order by x.funcion, x.grantee, x.privilegio) from gr_fn x), '[]'::jsonb),
    'grants_esquemas', coalesce((select jsonb_agg(to_jsonb(x) order by x.esquema, x.grantee, x.privilegio) from gr_esq x), '[]'::jsonb),
    'privilegios_por_defecto', coalesce((select jsonb_agg(to_jsonb(x) order by x.rol_creador, x.esquema, x.tipo_objeto, x.grantee, x.privilegio) from defacl x), '[]'::jsonb),
    'policies', coalesce((select jsonb_agg(to_jsonb(x) order by x.esquema, x.tabla, x.nombre) from pol x), '[]'::jsonb),
    'rls_storage_realtime', coalesce((select jsonb_agg(to_jsonb(x) order by x.esquema, x.tabla) from rls_otros x), '[]'::jsonb),
    'publicaciones_realtime', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from pubs x), '[]'::jsonb),
    'publicaciones_tablas', coalesce((select jsonb_agg(x.fila order by x.fila::text) from pubtbl x), '[]'::jsonb),
    'buckets_storage', coalesce((select jsonb_agg(x.fila order by x.fila::text) from buckets x), '[]'::jsonb)
  ) as j
),
s as (
  select d.j::text as x
  from d
)

-- S23 (final) ─ enmascara tokens y devuelve UNA fila: [redacciones_aplicadas, esquema_json] ───────────────────────
-- Patrones: (1) JWT eyJ..  (2) claves sb_secret_/sb_publishable_  (3) "Bearer/Basic <credencial>"  (4) usuario:clave@ en URLs.
select
  (select count(*)
     from regexp_matches(s.x,
       '(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}|sb_(secret|publishable)_[A-Za-z0-9_-]+|(bearer|basic) +[A-Za-z0-9._~+/=-]{12,}|://[^/:@ ]+:[^@/ ]+@)',
       'gi')) as redacciones_aplicadas,
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(s.x, 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}', '<JWT-REDACTADO>', 'g'),
        'sb_(secret|publishable)_[A-Za-z0-9_-]+', '<CLAVE-REDACTADA>', 'g'),
      '(bearer|basic) +[A-Za-z0-9._~+/=-]{12,}', '\1 <REDACTADO>', 'gi'),
    '://[^/:@ ]+:[^@/ ]+@', '://<REDACTADO>@', 'g') as esquema_json
from s;
