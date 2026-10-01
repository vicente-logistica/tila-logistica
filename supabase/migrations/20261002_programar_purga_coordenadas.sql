-- Programa la purga diaria de coordenadas obtenidas de Google (30 días).
--
-- Requiere 20261001_geo_publicacion_cargas.sql, que define
-- public.purgar_coordenadas_google_vencidas(): borra lat/lng y geo_obtenido_at con 30 días
-- o más (cargas.origen_*/destino_* y paradas_viaje) y conserva place_id.
--
-- Se usa pg_cron (corre DENTRO de Postgres, como el rol que programa el job): no existe
-- ninguna URL ni endpoint público para disparar la purga.
--
-- Idempotente: volver a ejecutar esta migración deja exactamente UN job llamado
-- 'purgar-coordenadas-google' (se da de baja el anterior, si existe, y se vuelve a crear).
--
-- Permisos: esta migración no otorga nada a nadie. La función ya tiene revocado EXECUTE a
-- PUBLIC/anon/authenticated (ver 20261001); el esquema cron no se expone por la Data API.

-- ── 1. La función a programar tiene que existir (si no, se aborta sin tocar nada) ──────
DO $$
BEGIN
  IF to_regprocedure('public.purgar_coordenadas_google_vencidas()') IS NULL THEN
    RAISE EXCEPTION 'ABORTADO: falta public.purgar_coordenadas_google_vencidas(). Aplicar antes 20261001_geo_publicacion_cargas.sql.';
  END IF;
END
$$;

-- ── 2. pg_cron, de la forma que indica Supabase (esquema pg_catalog) ──────────────────
-- Supabase la incluye entre sus extensiones disponibles; al crearla, su event trigger
-- issue_pg_cron_access otorga el acceso al esquema cron al rol postgres (no a anon ni a
-- authenticated). Si ya estaba habilitada (por ejemplo desde el Dashboard), no hace nada.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- ── 3. Job diario con nombre fijo, sin duplicados ───────────────────────────────────────
-- 06:00 UTC = 03:00 en Argentina (poco tráfico). Antes de crearlo se da de baja cualquier
-- job previo con el mismo nombre, así una re-ejecución nunca deja dos.
DO $$
DECLARE
  previo bigint;
BEGIN
  FOR previo IN SELECT jobid FROM cron.job WHERE jobname = 'purgar-coordenadas-google' LOOP
    PERFORM cron.unschedule(previo);
  END LOOP;

  PERFORM cron.schedule(
    'purgar-coordenadas-google',
    '0 6 * * *',
    'SELECT public.purgar_coordenadas_google_vencidas();'
  );
END
$$;
