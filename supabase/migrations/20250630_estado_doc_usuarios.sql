-- Agrega campo de estado documental independiente del estado de cuenta
-- estado_aprobacion = estado de la cuenta (pendiente/aprobado/suspendido)
-- estado_doc        = estado de la documentación (completa/pendiente_actualizacion/vencida)

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS estado_doc TEXT NOT NULL DEFAULT 'pendiente_actualizacion'
  CHECK (estado_doc IN ('completa', 'pendiente_actualizacion', 'vencida'));

CREATE INDEX IF NOT EXISTS idx_usuarios_estado_doc ON usuarios(estado_doc);
