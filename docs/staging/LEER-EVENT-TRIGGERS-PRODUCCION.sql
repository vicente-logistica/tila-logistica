-- =====================================================================================================================
-- LEER-EVENT-TRIGGERS-PRODUCCION.sql  ·  SOLO LECTURA  ·  TILA
-- Un único SELECT sobre catálogos del sistema (pg_event_trigger, pg_proc, pg_namespace). No lee ninguna tabla de negocio ni de usuarios,
-- ni auth.*, ni storage.*. Devuelve METADATOS: nombre del event trigger, evento, comandos que lo disparan, si está habilitado y qué función ejecuta.
-- 0 filas = no hay ningún event trigger en la base.
--   habilitado: O = habilitado (origin) · D = deshabilitado · R = solo réplica · A = siempre
-- =====================================================================================================================
select e.evtname                        as nombre,
       e.evtevent                       as evento,
       e.evttags                        as tags,
       e.evtenabled::text               as habilitado,
       pg_get_userbyid(e.evtowner)      as dueno,
       n.nspname || '.' || p.proname    as funcion,
       p.prosecdef                      as funcion_security_definer
from pg_event_trigger e
join pg_proc p on p.oid = e.evtfoid
join pg_namespace n on n.oid = p.pronamespace
order by e.evtname;
