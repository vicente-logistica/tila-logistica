-- Puebla documentos_legales con las versiones que YA existen en app/lib/legal/**.
-- Posterior e independiente de 20260725_documentos_legales_y_consentimientos.sql (0ebc0f5):
-- esta migración NO se modifica, solo se agrega. Requiere que esa migración ya esté
-- aplicada (tipos_documento_legal sembrada, documentos_legales creada).
--
-- hash_documento se calculó con app/lib/legal/hash.ts (hashDocumentoLegal), la ÚNICA función
-- que implementa la regla canónica: titulo + "\n\n" + contenido, normalizando los saltos de
-- línea ("\r\n" a "\n") antes de calcular SHA-256. No se recalcula acá: SQL no puede reproducir
-- fielmente el string en tiempo de ejecución de un módulo TypeScript. Los tests locales de esta
-- etapa (PGlite) verifican que estos literales coinciden EXACTAMENTE con lo que esa función
-- devuelve hoy para cada archivo; si el contenido de algún .ts cambia, hay que recalcular y
-- actualizar el valor de abajo.
--
-- git_commit / release_tag quedan NULL a propósito: cada archivo de v2026-07 aparece en más de
-- un commit (borrador/finalización/activación en la página) sin un criterio inequívoco de cuál
-- es "el" commit — se deja sin completar en vez de elegir uno arbitrariamente.
-- fecha_publicacion queda en su DEFAULT (now(), el momento en que esta migración corre) — no se
-- intenta inferir una fecha real a partir del texto libre "Última actualización: ..." dentro del
-- contenido: sería parsear/inventar una fecha "de negocio" que el esquema no exige como dato duro.
--
-- Idempotente: ON CONFLICT (tipo_documento, version) — que es exactamente el UNIQUE ya existente
-- en documentos_legales — evita duplicar si esta migración se corre más de una vez; no toca ni
-- reevalúa las filas ya insertadas (no es un upsert: una fila ya publicada es inmutable por el
-- trigger de PASO 2 de la migración base, y esto ni intenta tocarla).
INSERT INTO documentos_legales (tipo_documento, version, hash_documento, ruta_documento, estado) VALUES
  ('terminos',               '2026-07', 'b5edadcb644c8216fb1a0320d00a3d97cac7ded0be958c4599f79a2f310fe5e4', 'app/lib/legal/terminos/v2026-07.ts',               'vigente'),
  ('terminos',               '2025-06', '1547e7909cc4b52b266ed558b0db716db7a05e320e6a4269192407dd7ba3a365', 'app/lib/legal/terminos/v2025-06.ts',               'reemplazado'),
  ('privacidad',             '2026-07', 'ce0c456e154abf4db07ea3d57cdffb6a6cff5191a4a9bf8277509305c698e5ef', 'app/lib/legal/privacidad/v2026-07.ts',             'vigente'),
  ('privacidad',             '2025-06', '0458379067779ffab57f8c979b9dea06a07bba6bc1ca04a4fa09f500138736c1', 'app/lib/legal/privacidad/v2025-06.ts',             'reemplazado'),
  ('contrato_transportista', '2026-07', '6d0007a1dcf6b8552fb245652e7b5f5f9bd7b2881105a7b880173948b6b9b3db', 'app/lib/legal/contrato-transportista/v2026-07.ts', 'vigente'),
  ('contrato_transportista', '2025-06', '2b496b3361ecdd5fe90cadb595684c282ec3437b41e0a2c6bfe9c5e7aa89898e', 'app/lib/legal/contrato-transportista/v2025-06.ts', 'reemplazado')
ON CONFLICT (tipo_documento, version) DO NOTHING;
