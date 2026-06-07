-- vehiculo_activo_id en usuarios + migración de choferes existentes

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS vehiculo_activo_id BIGINT REFERENCES vehiculos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_vehiculo_activo_id ON usuarios(vehiculo_activo_id);

-- Crear vehículo stub para choferes existentes (patente en usuarios, sin fila en vehiculos)
INSERT INTO vehiculos (
  chofer_id,
  patente,
  tipo_vehiculo,
  capacidad_kg,
  activo,
  estado_validacion,
  created_at,
  updated_at
)
SELECT
  u.id,
  u.patente,
  COALESCE(u.tipo_vehiculo, u.vehiculo),
  NULLIF(regexp_replace(COALESCE(u.capacidad_carga, ''), '[^0-9]', '', 'g'), '')::integer,
  true,
  COALESCE(u.estado_validacion, 'pendiente'),
  NOW(),
  NOW()
FROM usuarios u
WHERE u.rol = 'chofer'
  AND u.patente IS NOT NULL
  AND TRIM(u.patente) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM vehiculos v WHERE v.chofer_id = u.id
  );

-- Vincular vehiculo_activo_id al vehículo activo (o el más reciente) de cada chofer
UPDATE usuarios u
SET vehiculo_activo_id = sub.vehiculo_id
FROM (
  SELECT DISTINCT ON (v.chofer_id)
    v.chofer_id,
    v.id AS vehiculo_id
  FROM vehiculos v
  ORDER BY v.chofer_id, v.activo DESC, v.created_at DESC
) sub
WHERE u.id = sub.chofer_id
  AND u.rol = 'chofer'
  AND u.vehiculo_activo_id IS NULL;
