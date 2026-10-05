-- Configuración operativa de "Vuelta a Casa" (Panel Admin → Configuración operativa).
--
-- Agrega a configuracion_plataforma (fila única id = 1; requiere 20260928 y 20260929):
--   - vuelta_casa_habilitada  boolean NOT NULL DEFAULT true
--   - vuelta_casa_inicio_km   integer NOT NULL DEFAULT 150  → empezar a buscar oportunidades
--     de regreso cuando al chofer le falten esos km (o menos) para llegar al destino B.
--
-- radio_matching_km ya existe (20260929_radio_matching_configurable.sql); se repite con
-- IF NOT EXISTS sólo por idempotencia — no cambia su valor ni su default (35).
--
-- Vuelta a Casa es SÓLO LECTURA: estos valores sólo deciden cuándo y cómo se BUSCAN
-- recomendaciones. No cambian el matching normal, ni estados, ni asignaciones.
--
-- La tabla ya tiene RLS activo, sin policies y sin permisos para anon/authenticated: las
-- columnas nuevas heredan esa protección (sólo el backend con service_role accede).

ALTER TABLE public.configuracion_plataforma
  ADD COLUMN IF NOT EXISTS radio_matching_km integer NOT NULL DEFAULT 35;

ALTER TABLE public.configuracion_plataforma
  ADD COLUMN IF NOT EXISTS vuelta_casa_habilitada boolean NOT NULL DEFAULT true;

ALTER TABLE public.configuracion_plataforma
  ADD COLUMN IF NOT EXISTS vuelta_casa_inicio_km integer NOT NULL DEFAULT 150;

ALTER TABLE public.configuracion_plataforma
  DROP CONSTRAINT IF EXISTS configuracion_plataforma_radio_matching_km_minimo;
ALTER TABLE public.configuracion_plataforma
  ADD CONSTRAINT configuracion_plataforma_radio_matching_km_minimo CHECK (radio_matching_km > 0);

ALTER TABLE public.configuracion_plataforma
  DROP CONSTRAINT IF EXISTS configuracion_plataforma_vuelta_casa_inicio_km_minimo;
ALTER TABLE public.configuracion_plataforma
  ADD CONSTRAINT configuracion_plataforma_vuelta_casa_inicio_km_minimo CHECK (vuelta_casa_inicio_km > 0);
