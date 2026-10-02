-- Geografía de publicación de cargas (origen, destino y paradas).
--
-- Al publicar una carga, el servidor hace UNA llamada a Google Directions con todos los
-- puntos (app/lib/geo/rutaPublicacion.ts). Esa respuesta ya trae, para cada punto, su
-- place_id y sus coordenadas. Esta migración agrega dónde guardarlos, para que los
-- lectores (Vuelta a Casa, primero) no tengan que geocodificar cada dirección otra vez.
--
-- Reglas de almacenamiento de Google Maps Platform:
--   - place_id: puede conservarse indefinidamente.
--   - lat/lng obtenidas de Google: hasta 30 días. Por eso cada grupo de coordenadas lleva
--     geo_obtenido_at y existe purgar_coordenadas_google_vencidas(), que las borra al
--     cumplir 30 días y conserva el place_id. La programación diaria de la purga
--     (pg_cron o Vercel Cron) NO se hace en esta migración.
--
-- IMPORTANTE: cargas.lat / cargas.lng NO se tocan. Siguen siendo exclusivamente la última
-- posición GPS del chofer (las escribe /api/cargas/gps). Las coordenadas de la carga van en
-- columnas nuevas con prefijo origen_ / destino_.
--
-- Sin backfill: las cargas y paradas existentes quedan en NULL (las paradas legacy que ya
-- tenían lat/lng las conservan, con geo_obtenido_at NULL); los lectores hacen fallback
-- (geocodificar el texto) cuando no hay coordenadas vigentes.
-- Todas las columnas son nullable: aplicar esta migración no cambia el comportamiento del
-- código actual (que no las lee ni las escribe).

-- ── 1. cargas: place_id + coordenadas de origen y destino + fecha de obtención ──────────
ALTER TABLE public.cargas
  ADD COLUMN IF NOT EXISTS origen_place_id  text             NULL,
  ADD COLUMN IF NOT EXISTS origen_lat       double precision NULL,
  ADD COLUMN IF NOT EXISTS origen_lng       double precision NULL,
  ADD COLUMN IF NOT EXISTS destino_place_id text             NULL,
  ADD COLUMN IF NOT EXISTS destino_lat      double precision NULL,
  ADD COLUMN IF NOT EXISTS destino_lng      double precision NULL,
  ADD COLUMN IF NOT EXISTS geo_obtenido_at  timestamptz      NULL;

COMMENT ON COLUMN public.cargas.origen_place_id  IS 'place_id de Google del origen (se conserva indefinidamente).';
COMMENT ON COLUMN public.cargas.origen_lat       IS 'Latitud del origen obtenida de Google al publicar. Se borra a los 30 días (purgar_coordenadas_google_vencidas). NO es el GPS del chofer (ese es cargas.lat).';
COMMENT ON COLUMN public.cargas.origen_lng       IS 'Longitud del origen obtenida de Google al publicar. Se borra a los 30 días. NO es el GPS del chofer (ese es cargas.lng).';
COMMENT ON COLUMN public.cargas.destino_place_id IS 'place_id de Google del destino (se conserva indefinidamente).';
COMMENT ON COLUMN public.cargas.destino_lat      IS 'Latitud del destino obtenida de Google al publicar. Se borra a los 30 días.';
COMMENT ON COLUMN public.cargas.destino_lng      IS 'Longitud del destino obtenida de Google al publicar. Se borra a los 30 días.';
COMMENT ON COLUMN public.cargas.geo_obtenido_at  IS 'Cuándo se obtuvieron origen_lat/lng y destino_lat/lng de Google. NULL = sin coordenadas almacenadas.';

-- ── 2. cargas: validaciones de las coordenadas nuevas ───────────────────────────────────
-- Rango geográfico válido; lat y lng siempre de a pares; y toda coordenada almacenada
-- tiene fecha de obtención (si no, la purga de 30 días no podría alcanzarla).
-- Las columnas son nuevas (todo NULL), así que validar las filas existentes es inmediato.
ALTER TABLE public.cargas DROP CONSTRAINT IF EXISTS cargas_origen_coords_validas;
ALTER TABLE public.cargas ADD CONSTRAINT cargas_origen_coords_validas CHECK (
  (origen_lat IS NULL AND origen_lng IS NULL)
  OR (origen_lat IS NOT NULL AND origen_lng IS NOT NULL
      AND origen_lat BETWEEN -90 AND 90 AND origen_lng BETWEEN -180 AND 180
      AND geo_obtenido_at IS NOT NULL)
);

ALTER TABLE public.cargas DROP CONSTRAINT IF EXISTS cargas_destino_coords_validas;
ALTER TABLE public.cargas ADD CONSTRAINT cargas_destino_coords_validas CHECK (
  (destino_lat IS NULL AND destino_lng IS NULL)
  OR (destino_lat IS NOT NULL AND destino_lng IS NOT NULL
      AND destino_lat BETWEEN -90 AND 90 AND destino_lng BETWEEN -180 AND 180
      AND geo_obtenido_at IS NOT NULL)
);

-- ── 3. paradas_viaje: place_id + fecha de obtención (lat/lng ya existen y se conservan) ─
ALTER TABLE public.paradas_viaje
  ADD COLUMN IF NOT EXISTS place_id        text        NULL,
  ADD COLUMN IF NOT EXISTS geo_obtenido_at timestamptz NULL;

COMMENT ON COLUMN public.paradas_viaje.place_id        IS 'place_id de Google de la parada (se conserva indefinidamente).';
COMMENT ON COLUMN public.paradas_viaje.geo_obtenido_at IS 'Cuándo se obtuvieron lat/lng de Google. Se borran a los 30 días (purgar_coordenadas_google_vencidas). NULL con lat/lng = coordenadas legacy sin fecha: no se purgan y no se consideran vigentes.';

-- ── 4. paradas_viaje: validaciones de lat/lng ───────────────────────────────────────────
-- Par completo y rango válido, como en cargas. A diferencia de cargas, NO exige
-- geo_obtenido_at: lat/lng ya existían en esta tabla y hay filas legacy con coordenadas y
-- sin fecha (no se inventa ni se borra nada). Como un CHECK — aun NOT VALID — se evalúa en
-- todo UPDATE de la fila, exigir la fecha impediría actualizar esas paradas (p. ej. marcarlas
-- completadas). Las legacy sin fecha no se purgan (la purga exige geo_obtenido_at) y los
-- lectores no las consideran vigentes (coordenadasVigentes exige fecha): van por fallback.
-- NOT VALID: no revalida filas históricas al crear la restricción (la migración no puede
-- fallar por datos viejos); se aplica a toda fila nueva o modificada desde ahora.
ALTER TABLE public.paradas_viaje DROP CONSTRAINT IF EXISTS paradas_viaje_coords_validas;
ALTER TABLE public.paradas_viaje ADD CONSTRAINT paradas_viaje_coords_validas CHECK (
  (lat IS NULL AND lng IS NULL)
  OR (lat IS NOT NULL AND lng IS NOT NULL
      AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
) NOT VALID;

-- ── 5. Purga de coordenadas de Google con 30 días o más ─────────────────────────────────
-- Borra lat/lng y geo_obtenido_at; conserva place_id. Sólo toca filas con
-- geo_obtenido_at (nunca filas históricas sin fecha). Devuelve cuántas filas purgó de
-- cada tabla. Pensada para correr una vez por día (programación pendiente).
CREATE OR REPLACE FUNCTION public.purgar_coordenadas_google_vencidas()
RETURNS TABLE (cargas_purgadas integer, paradas_purgadas integer)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  limite timestamptz := now() - interval '30 days';
BEGIN
  UPDATE public.cargas
     SET origen_lat = NULL, origen_lng = NULL,
         destino_lat = NULL, destino_lng = NULL,
         geo_obtenido_at = NULL
   WHERE geo_obtenido_at IS NOT NULL
     AND geo_obtenido_at <= limite;
  GET DIAGNOSTICS cargas_purgadas = ROW_COUNT;

  UPDATE public.paradas_viaje
     SET lat = NULL, lng = NULL,
         geo_obtenido_at = NULL
   WHERE geo_obtenido_at IS NOT NULL
     AND geo_obtenido_at <= limite;
  GET DIAGNOSTICS paradas_purgadas = ROW_COUNT;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.purgar_coordenadas_google_vencidas() IS
  'Borra coordenadas obtenidas de Google con 30 días o más (cargas.origen_/destino_lat/lng y paradas_viaje.lat/lng) y su geo_obtenido_at; conserva place_id.';

-- ── 6. Permisos de la función ───────────────────────────────────────────────────────────
-- En Postgres toda función nueva es ejecutable por PUBLIC, y en este proyecto anon y
-- authenticated pueden invocar funciones de public vía /rpc. La purga es una escritura:
-- sólo el backend (service_role) y el dueño (postgres, el que usará pg_cron) la ejecutan.
REVOKE ALL ON FUNCTION public.purgar_coordenadas_google_vencidas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_coordenadas_google_vencidas() TO service_role;
