-- Comisiones configurables desde el Panel Admin.
--
-- Hasta ahora las comisiones (cliente 7,5% / chofer 7,5%) estaban fijas en código
-- (app/lib/tarifas.ts). Esta migración crea la configuración global que las reemplaza:
-- una única fila (id = 1) con las comisiones vigentes en PUNTOS BÁSICOS
-- (750 = 7,50%, 500 = 5,00%, 475 = 4,75%). Se inicializa en 750/750, exactamente los
-- valores actuales de producción: aplicar esta migración no cambia ningún precio.
--
-- Uso:
--   - /api/cargas/publicar y /api/tarifas/cotizar leen esta fila para calcular el precio
--     de las cargas NUEVAS.
--   - /api/admin/configuracion/comisiones (GET/PUT, sólo rol admin) la lee y la modifica.
--
-- Cargas existentes: no se tocan. Sus montos (precio_base, precio_cliente, pago_chofer,
-- comision_plataforma) quedan guardados al publicar y ninguna ruta los recalcula.
--
-- Seguridad: RLS activo, SIN policies, y se revocan todos los permisos de anon y
-- authenticated (en este proyecto los permisos por defecto de las tablas nuevas incluyen
-- a anon/authenticated — por eso el REVOKE explícito). Sólo el backend (service_role)
-- accede.
--
-- Si el código se desplegara antes que esta migración, publicar/cotizar usan 750/750 por
-- defecto (app/lib/configuracionComisiones.ts) y el Panel Admin no puede guardar hasta
-- que la tabla exista.

CREATE TABLE IF NOT EXISTS public.configuracion_plataforma (
  id                   smallint    PRIMARY KEY DEFAULT 1,
  comision_cliente_bp  integer     NOT NULL DEFAULT 750,
  comision_chofer_bp   integer     NOT NULL DEFAULT 750,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid        NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  -- Una única configuración: sólo puede existir la fila id = 1.
  CONSTRAINT configuracion_plataforma_fila_unica CHECK (id = 1),
  -- 0 ≤ bp < 10000 (menos de 100%: el chofer nunca queda en negativo). Sin tope comercial.
  CONSTRAINT configuracion_plataforma_comision_cliente_bp_rango CHECK (comision_cliente_bp >= 0 AND comision_cliente_bp < 10000),
  CONSTRAINT configuracion_plataforma_comision_chofer_bp_rango  CHECK (comision_chofer_bp  >= 0 AND comision_chofer_bp  < 10000)
);

-- Valores actuales de producción (7,50% / 7,50%). Idempotente: no pisa una fila existente.
INSERT INTO public.configuracion_plataforma (id, comision_cliente_bp, comision_chofer_bp)
VALUES (1, 750, 750)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.configuracion_plataforma ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.configuracion_plataforma FROM anon, authenticated;
