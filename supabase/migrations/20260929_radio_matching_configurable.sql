-- Radio de matching configurable desde Panel Admin.
--
-- Agrega a configuracion_plataforma (creada por 20260928_configuracion_comisiones.sql, que
-- DEBE aplicarse antes) el radio global en km: cuán lejos puede estar el punto de RETIRO A
-- del GPS del chofer para que la carga se le ofrezca y la pueda aceptar.
--
-- DEFAULT 35 = el radio actual de producción: aplicar esta migración no cambia qué cargas
-- se ofrecen. La fila id = 1 existente recibe 35 por el DEFAULT.
--
-- Lo usan con el MISMO valor /api/chofer/distancias-cercanas (prefiltro Haversine +
-- decisión final por ruta) y /api/cargas/aceptar (revalidación). Si la columna no existe,
-- el código usa 35 por defecto (app/lib/configuracionRadio.ts). Viajes ya aceptados no se
-- tocan.
--
-- Sin tope comercial: el CHECK sólo exige un entero ≥ 1. Radios muy grandes aumentan las
-- llamadas a Google Directions (costo/latencia), no cambian la lógica.
--
-- La tabla ya tiene RLS activo, sin policies, y sin permisos para anon/authenticated: la
-- columna nueva hereda esa protección (sólo el backend con service_role accede).

ALTER TABLE public.configuracion_plataforma
  ADD COLUMN IF NOT EXISTS radio_matching_km integer NOT NULL DEFAULT 35;

ALTER TABLE public.configuracion_plataforma
  DROP CONSTRAINT IF EXISTS configuracion_plataforma_radio_matching_km_minimo;
ALTER TABLE public.configuracion_plataforma
  ADD CONSTRAINT configuracion_plataforma_radio_matching_km_minimo CHECK (radio_matching_km >= 1);
