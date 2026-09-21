# TILA — Informe de diferencias: producción REAL vs. código, documentación y migraciones

Fuente de verdad: `RESULTADO-ESQUEMA-PRODUCCION.json` (formato `tila-esquema-produccion/1`, generado 2026-09-19 15:38 UTC, PostgreSQL 17.6, `redacciones_aplicadas = 0`).
Comparado contra: código (`inventario-esquema.generado.json`), `BACKUP_RECOVERY_PLAN.md`, `supabase/migrations/*` (3), `docs/staging/PLAN-STAGING.md`, `docs/seguridad/*`.
**Nada de esto tocó producción.** No se corrigió ninguna vulnerabilidad: staging las reproduce.

> **Decisión (2026-09-20): el JSON de esquema de producción NO se copia al repo ni se versiona en Git.** Es una radiografía completa de roles, grants, policies, funciones, buckets y Realtime. Vive fuera del repositorio y todas las herramientas lo reciben por ruta externa con `--json <ruta>`.

---
## 0. Resumen

1. **Los números coinciden exactamente** con lo que indicaste: 14 tablas, 258 columnas, 22 constraints, 26 índices, 16 policies (10 en `public` + 6 en `storage.objects`), 2 buckets, 5 secuencias, 2 publicaciones. Comprobado por script, no a ojo.
2. **Todo el control de acceso de producción es RLS + policies.** Los GRANTs son los defaults de Supabase (`anon`/`authenticated`/`service_role` con todos los privilegios sobre todo). No hay ningún GRANT por columna.
3. **Realtime no funciona como el código y `PLAN-STAGING.md` suponen.** Solo 2 tablas están publicadas (`cargas`, `mensajes_viaje`), no 4. El frontend se suscribe además a `usuarios` y `paradas_viaje`, que **no** están publicadas → esos eventos nunca llegan. Y `cargas`/`mensajes_viaje` tienen RLS activo **sin ninguna policy** → predicción: tampoco se entregan a `anon` (sin verificar: es exactamente lo que `smoke/realtime.mjs` medirá en staging).
4. **Migraciones del repo ≠ producción:** la `20250606` está aplicada a medias (falta su índice), la `20260725` **no** está aplicada (confirmado), y hay objetos en producción que no están en ninguna migración (10 tablas base, 4 CHECK, 2 UNIQUE, 4 FK, 13 índices, un trigger, una función SECURITY DEFINER).
5. **Event trigger resuelto (2026-09-20):** `rls_auto_enable()` la dispara `ensure_rls` (`ddl_command_end`; `CREATE TABLE`, `CREATE TABLE AS`, `SELECT INTO`; habilitado; dueño `postgres`). Los otros 6 event triggers de producción son de `supabase_admin` y no se recrean (§6).

---
## 1. Confirmaciones pedidas (1–12)

| # | Punto | Resultado | Detalle |
|---|---|---|---|
| 1 | 14 tablas y 258 columnas | ✔ | 10 tablas de negocio (164 columnas) + 4 `backup_*` (94: 5+40+9+40). `usuarios` tiene 42 columnas vivas (el `attnum` llega a 43: hay una columna eliminada en la posición 31) y `billetera_chofer` otra eliminada en la posición 3. **PLAN-STAGING decía 43 para `usuarios`: son 42.** Sin vistas, sin enums, sin dominios. |
| 2 | Tipos, defaults, identity | ✔ | Solo `cargas.id` es `IDENTITY BY DEFAULT`. `consentimientos_legales`, `paradas_viaje`, `vehiculos`, `viaje_evidencias` usan `DEFAULT nextval(...)` (serial). Los `id` uuid usan `gen_random_uuid()`. Ninguna columna generada. Ver §5 para los tipos que la documentación tiene mal. |
| 3 | 22 constraints | ✔ | 10 PK · 2 UNIQUE (`usuarios_email_key`, `documentacion_chofer_chofer_tipo_unique`) · 5 CHECK · **5 FK**. Todas validadas, ninguna diferible. Referencia circular `usuarios ↔ vehiculos`. |
| 4 | 26 índices | ✔ | 12 son de PK/UNIQUE (los crea el constraint) + 14 independientes. Hay 3 redundantes (`idx_paradas_viaje_carga_id`, `idx_mensajes_viaje_viaje_id`, `idx_documentacion_chofer_id`: son prefijo de otro índice). **No existe `idx_usuarios_vehiculo_activo_id`** aunque la migración `20250606` lo crea. |
| 5 | Funciones/triggers | ✔ | 6 funciones: 2 propias (`public.set_updated_at`, `public.rls_auto_enable`) + 4 gestionadas por Supabase (`realtime.subscription_check_filters`, `storage.enforce_bucket_name_length`, `storage.protect_delete`, `storage.update_updated_at_column`). 5 triggers: 1 propio (`vehiculos_updated_at` → `set_updated_at`) + 4 de `storage` (gestionados). Ningún trigger sobre `usuarios`, `cargas`, etc. |
| 6 | 16 policies | ✔ | 10 en `public` (5 tablas) + 6 en `storage.objects`. Listadas en §3. Todas `PERMISSIVE`. Ninguna para `cargas`, `mensajes_viaje`, `billetera_chofer`, `consentimientos_legales`, `tarifas_config`. Ninguna de `DELETE` en ningún lado. |
| 7 | GRANTs efectivos | ✔ | 508 filas: 14 tablas × 4 roles × 8 privilegios + 5 secuencias × 4 roles × 3. Roles: `anon`, `authenticated`, `service_role`, `postgres`. **Todo proviene de `pg_default_acl`** (idéntico para `postgres` y `supabase_admin` en `public`). `anon` tiene `TRUNCATE`, `TRIGGER`, `REFERENCES`, `MAINTAIN` en todas las tablas (PostgREST no expone TRUNCATE, pero el permiso existe). `grants_columnas = 0`. Funciones: `EXECUTE` a `PUBLIC`, `anon`, `authenticated`, `service_role`. |
| 8 | 2 buckets | ✔ | `documentacion-choferes` y `vehiculos`: `public = true`, `file_size_limit = null`, `allowed_mime_types = null`, versionado desactivado. Creados el 2026-06-03. |
| 9 | Policies de `storage.objects` | ✔ | 6, todas para `anon` y `authenticated`: SELECT + INSERT + UPDATE sobre cada bucket, filtradas solo por `bucket_id`. **Sin DELETE.** RLS activo en `storage.objects`. |
| 10 | Realtime | ✔ | `supabase_realtime` (dueño `postgres`) publica **solo `public.cargas` (40 columnas) y `public.mensajes_viaje` (9)**, sin filtro de filas, con INSERT/UPDATE/DELETE/TRUNCATE. `supabase_realtime_messages_publication` es de Supabase (particiones `realtime.messages_*`). `wal_level = logical`. Replica identity = default en todas las tablas. |
| 11 | Secuencias | ✔ | 5, todas `bigint`, inicio 1, incremento 1, máx. 9223372036854775807, sin ciclo, cache 1, cada una dueña de su columna `id`. Sin `last_value` (por diseño de la consulta). |
| 12 | Diferencias con doc/repo | ✔ | §5. |

---
## 2. Método
Los conteos, la lista de tablas y columnas, y la comparación código↔producción se hicieron con scripts sobre el JSON (`node -e` de una línea, no commiteados) y con `scripts/staging/inventario-esquema.mjs` (ya existente). Nada se estimó a mano.

---
## 3. Atención especial — confirmado, sin modificar

| Punto pedido | ¿Confirmado? | Evidencia en el JSON | Efecto real (RLS × GRANT) |
|---|---|---|---|
| `anon_select_usuarios` USING true | ✔ | `usuarios` · SELECT · `{anon}` · `using: true` | `anon` lee **todas las filas y todas las columnas** (sin GRANT por columna): `password` (texto plano), `dni`, `cuit_cuil`, `alias_cbu_cvu`, `titular_cuenta`, `email`, `telefono`… con solo la clave anon que va en el bundle. |
| `anon_update_usuarios_permisivo` | ✔ | `usuarios` · UPDATE · `{anon}` · `using: true`, `with check: true` | `anon` puede modificar **cualquier columna de cualquier fila**: `rol`, `password`, `estado_aprobacion`, `email`. Anula a `anon_insert_usuarios_no_admin` (que solo restringe el INSERT a `rol ∈ {cliente, chofer}`). |
| `documentacion_chofer_select_anon` | ✔ | SELECT · `{anon}` · true | Lista todas las URLs de documentos (DNI, licencia, antecedentes…). Escribir en esa tabla no está permitido a `anon` (solo SELECT). |
| Policies abiertas de `paradas_viaje` | ✔ | 3 policies, `{anon, authenticated}`, SELECT/INSERT/UPDATE con `true` | Lectura, alta y modificación total por cualquiera. Sin DELETE. Con FK `carga_id → cargas ON DELETE CASCADE`. |
| `viaje_evidencias` SELECT/INSERT para `public` | ✔ | `viaje_evidencias_select` y `_insert`, roles `{public}` | `public` = todos los roles. Lectura total (incluye `foto_url`, `lat/lng`) y alta libre; sin UPDATE/DELETE. |
| Bucket `documentacion-choferes` público | ✔ | `public: true`, sin límites | Cualquier URL es legible sin autenticación. Además la policy SELECT permite listar objetos. |
| Bucket `vehiculos` público | ✔ | ídem | ídem. |
| Uploads/updates públicos en Storage | ✔ | 4 policies INSERT/UPDATE `{anon, authenticated}` por `bucket_id` | Cualquiera sube archivos (sin límite de tamaño ni de tipo) y puede reemplazar los existentes (UPDATE es lo que habilita el *upsert*). No hay restricción de ruta/dueño. |
| `cargas` publicada en `supabase_realtime` | ✔ | `publicaciones_tablas`: `cargas`, 40 columnas, `rowfilter: null` | Publicada, pero con RLS activo y **cero policies** → `anon` no puede verla (PLAN-STAGING ya lo había observado por REST: 0 filas). *Predicción:* Realtime no entrega sus eventos a `anon`; los `DELETE` podrían llegar solo con la PK. **A verificar en staging.** |
| `mensajes_viaje` publicada | ✔ | 9 columnas, sin filtro | Igual que `cargas`: RLS sin policies. |
| Posibles FK faltantes | ✔ (confirmadas) | Solo existen 5 FK | **No existen:** `cargas.cliente_id`, `cargas.chofer_id` (son `text`; `usuarios.id` es `uuid`: ni siquiera podrían), `mensajes_viaje.viaje_id`, `mensajes_viaje.remitente_id`, `viaje_evidencias.carga_id`, `.usuario_id`, `.parada_id`, `billetera_chofer.chofer_id` (text), `.viaje_id` (text). Existen: `usuarios.vehiculo_activo_id`, `vehiculos.chofer_id`, `documentacion_chofer.chofer_id`, `paradas_viaje.carga_id`, `consentimientos_legales.usuario_id`. |
| `billetera_chofer` sin UNIQUE de `viaje_id` | ✔ | Solo `billetera_chofer_pkey (id)` | La BD **no impide acreditar dos veces el mismo viaje**; solo el código lo evita. Además `chofer_id` y `viaje_id` son `text`. |
| `public.rls_auto_enable` SECURITY DEFINER | ✔ (con matiz) | dueño `postgres`, `SET search_path = pg_catalog`, retorna `event_trigger`, `EXECUTE` a `PUBLIC/anon/authenticated/service_role` | Su cuerpo solo hace `ALTER TABLE … ENABLE ROW LEVEL SECURITY` sobre tablas nuevas de `public`: es una **protección**, no una vulnerabilidad de escalada. Al devolver `event_trigger` no puede invocarse como función normal. Es una función SECURITY DEFINER dentro de `public` (los linters de seguridad suelen señalar ese patrón; no lo verifiqué). No está en el repo. **Event trigger confirmado en producción:** `ensure_rls`, `ddl_command_end`, tags `CREATE TABLE`/`CREATE TABLE AS`/`SELECT INTO`, habilitado (`O`), dueño `postgres` (a diferencia de los otros 6, que son de `supabase_admin`); se trata como **propio del proyecto** y ejecuta esta función. Es consistente con que las 4 `backup_*` (creadas con CREATE TABLE AS) tengan RLS activo, aunque no está demostrado que sea la causa. |

**Otros hallazgos no listados en tu pedido**
- `vehiculos_select_anon` (SELECT true, `anon`): lectura total de vehículos y URLs de sus documentos.
- Las 4 `backup_*` tienen RLS activo sin policies (protegidas solo por eso) y `anon` con todos los privilegios de tabla. `backup_usuarios_20260614` contiene la columna `password`.
- `usuarios` no tiene ninguna policy de DELETE ni de acceso para `authenticated`; la app no usa Supabase Auth, así que todo el tráfico del navegador es `anon`.
- `usuarios.rol`, `cargas.estado`, `cargas.pago_estado` y `estado_aprobacion` **no tienen CHECK**: la BD acepta cualquier texto (los CHECK existentes son solo los 5 listados en §1-3).

---
## 4. Matriz efectiva de `anon` en producción (RLS × GRANT)

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `usuarios` | **todo** | solo `rol ∈ {cliente, chofer}` | **todo** | no |
| `paradas_viaje` | todo | todo | todo | no |
| `vehiculos` | todo | no | no | no |
| `documentacion_chofer` | todo | no | no | no |
| `viaje_evidencias` | todo | todo | no | no |
| `cargas`, `mensajes_viaje`, `billetera_chofer`, `consentimientos_legales`, `tarifas_config`, `backup_*` (4) | no | no | no | no |
| `storage.objects` (2 buckets) | listar/leer | subir | reemplazar | no |

`anon` no puede acceder a `cargas`, `mensajes_viaje`, `billetera_chofer` ni `consentimientos_legales`: su uso operativo depende de las rutas `/api/*` con la service role (que ignora RLS).

---
## 5. Diferencias producción ↔ documentación / repo

### 5.1 `BACKUP_RECOVERY_PLAN.md` vs producción
| Tema | El documento dice | Producción |
|---|---|---|
| `id` de `mensajes_viaje`, `documentacion_chofer`, `billetera_chofer` | `bigint` | **`uuid`** (`gen_random_uuid()`) |
| `usuarios.id` | `uuid/bigint` | `uuid` |
| `chofer_id` en `vehiculos`, `documentacion_chofer` | `text FK` | **`uuid` FK** (`ON DELETE CASCADE`) |
| `usuarios.created_at`, `billetera_chofer.created_at` | `timestamptz` | **`timestamp without time zone`** |
| `cargas.lat/lng` | `numeric` | **`double precision`** (igual `velocidad`) |
| `cargas.gps_actualizado` | `timestamptz` | **`timestamp without time zone`** |
| `usuarios.bateria_nivel` | `int` | `numeric` |
| `vehiculos.seguro_vencimiento`, `vtv_rto_vencimiento` | `text` | **`date`** |
| `navegador_preferido` | `google_maps/waze/maps_apple` | CHECK: `google_maps, waze, sygic_truck, tomtom_truck, preguntar_siempre` |
| `estado_aprobacion` | 4 valores | sin CHECK |
| FK `cargas.cliente_id/chofer_id`, `mensajes_viaje.viaje_id/remitente_id`, `viaje_evidencias.carga_id/usuario_id`, `billetera_chofer.chofer_id/viaje_id` | «FK → …» | **No existen** |
| `vehiculos.tipo_vehiculo` | libre | CHECK con 16 valores (7 capitalizados + 9 en minúscula) |
| `tarifas_config` | «posiblemente inexistente» | **existe** (8 columnas), sin uso en el código |
| `consentimientos_legales` | no documentada | existe, con FK a `usuarios` |
| `backup_*` (4) | no documentadas | existen (snapshot del 2026-06-14) |
| Columnas no documentadas | — | `usuarios`: `cuit, contacto, direccion, deposito, seguro_vehiculo, seguro_carga, vtv_rto, fecha_aceptacion_terminos`; `cargas`: `precio, vehiculo, detalles, precio_base, tipo_carroceria, velocidad, litros_por_km, ultima_senal_at`; `paradas_viaje`: `lat, lng, created_at`; `vehiculos`: `color, motivo_rechazo`; `viaje_evidencias`: `parada_id`; `documentacion_chofer`: `created_at` |
| UNIQUE `(chofer_id, tipo)` en `documentacion_chofer` | sí | ✔ confirmado |
| Realtime | «habilitar en `mensajes_viaje`» | `cargas` **y** `mensajes_viaje` |

### 5.2 Migraciones del repo vs producción
| Migración | Estado real |
|---|---|
| `20250606_vehiculo_activo_id.sql` | **Aplicada a medias.** Columna y FK (`usuarios_vehiculo_activo_id_fkey`, `ON DELETE SET NULL`) ✔; el índice `idx_usuarios_vehiculo_activo_id` **no existe**. |
| `20250630_estado_doc_usuarios.sql` | ✔ Aplicada: `estado_doc` (NOT NULL, default `'pendiente_actualizacion'`), su CHECK e `idx_usuarios_estado_doc`. |
| `20260725_documentos_legales_y_consentimientos.sql` | **No aplicada** (confirmado): no existen `tipos_documento_legal` ni `documentos_legales`; `consentimientos_legales` no tiene `decision`, `documento_legal_id`, etc. Staging **no** la incluye. |

Fuera de las migraciones (no versionado en ningún lado): los `CREATE TABLE` de las 10 tablas, `vehiculos_updated_at` + `set_updated_at`, `rls_auto_enable` + event trigger `ensure_rls`, 4 CHECK, 4 FK, 2 UNIQUE, 13 índices, RLS y todas las policies, las 4 `backup_*`.

### 5.3 `PLAN-STAGING.md` vs producción — correcciones que se desprenden
| Sección | Decía | Real |
|---|---|---|
| §2.2 Realtime | publicar `cargas`, `usuarios`, `paradas_viaje`, `mensajes_viaje` | producción publica **solo `cargas` y `mensajes_viaje`**; staging replica eso |
| §1.2 `usuarios` | 43 columnas observadas | 42 (una eliminada) |
| §1.3 / §1.5 | «se asume UNIQUE(chofer_id,tipo)» / «no se sabe si `billetera_chofer.viaje_id` es único» | UNIQUE confirmado; `viaje_id` **no** es único |
| §1.2 `tarifas_config` | «no verificada» | existe |
| §6 hipótesis Realtime | sin verificar | sigue sin verificar, pero ahora hay evidencia estructural (RLS sin policies + 2 tablas no publicadas) |

`docs/staging/PLAN-STAGING.md` **no fue modificado**; se puede actualizar si lo autorizás.

### 5.4 Código vs producción
- Todas las tablas que usa el código existen; ninguna columna usada falta en producción (el «exact» que reporta el inventario es un falso positivo de `{ count: "exact" }`).
- Tablas reales que el código no usa: `tarifas_config` y las 4 `backup_*`.
- Suscripciones Realtime del código a tablas **no publicadas**: `usuarios` (admin) y `paradas_viaje` (admin, cliente, viaje-activo).

---
## 6. Event triggers (RESUELTO) y lo que el JSON NO pudo confirmar
1. **Event triggers de producción** — consulta de solo lectura `docs/staging/LEER-EVENT-TRIGGERS-PRODUCCION.sql`, ejecutada por vos; resultado en `docs/staging/RESULTADO-EVENT-TRIGGERS-PRODUCCION.json`:

   | Nombre | Evento | Tags | Hab. | Dueño | Función | SECURITY DEFINER | Tratamiento en staging |
   |---|---|---|---|---|---|---|---|
   | `ensure_rls` | ddl_command_end | CREATE TABLE, CREATE TABLE AS, SELECT INTO | O | `postgres` | `public.rls_auto_enable` | sí | **Propio del proyecto → se replica** (04 propuesto; con guarda anti-duplicado) |
   | `issue_graphql_placeholder` | sql_drop | DROP EXTENSION | O | `supabase_admin` | `extensions.set_graphql_placeholder` | no | Gestionado por Supabase: **no se recrea** |
   | `issue_pg_cron_access` | ddl_command_end | CREATE EXTENSION | O | `supabase_admin` | `extensions.grant_pg_cron_access` | no | ídem |
   | `issue_pg_graphql_access` | ddl_command_end | CREATE EXTENSION | O | `supabase_admin` | `extensions.grant_pg_graphql_access` | no | ídem |
   | `issue_pg_net_access` | ddl_command_end | CREATE EXTENSION | O | `supabase_admin` | `extensions.grant_pg_net_access` | no | ídem |
   | `pgrst_ddl_watch` | ddl_command_end | (todos) | O | `supabase_admin` | `extensions.pgrst_ddl_watch` | no | ídem (PostgREST recarga su caché de esquema tras cada DDL) |
   | `pgrst_drop_watch` | sql_drop | (todos) | O | `supabase_admin` | `extensions.pgrst_drop_watch` | no | ídem |

   Consecuencias: (a) `ensure_rls` hace que toda tabla nueva de `public` nazca con RLS activo; en staging 05 igualmente lo habilita explícitamente en las 10 tablas. (b) Los `pgrst_*` explican por qué el REST de Supabase ve las tablas nuevas sin acción manual: en staging los trae el proyecto. (c) No se creó ni cambió nada en producción.
2. **Ajustes de proyecto fuera de la base:** esquemas expuestos y *max rows* de la Data API, opciones de Realtime (canales privados, límites), límite global de tamaño de Storage, configuración de Auth (no se usa) y dominios/redirects. Se ven en el panel, no en SQL. **Actualización 21/09/2026:** Data API, Realtime y Storage se compararon a mano entre paneles: **PASS** (iguales; única diferencia esperada, 14 tablas expuestas en producción vs 10 en staging por las 4 `backup_*` excluidas; Auth y dominios/redirects no formaron parte de esa comparación). Ver `PLAN-V3-STAGING.md` Anexo A.
3. **Datos:** valores de `tarifas_config`, valor actual de las secuencias, contenido de las tablas (a propósito).

---
## 7. Decisión: tablas `backup_*` — **NO se replican** en staging
- Son un *snapshot con datos reales* del 2026-06-14 (`CREATE TABLE AS`: sin PK, defaults ni constraints). Su estructura no aporta nada que probar.
- **El código no las referencia** (0 usos).
- Son de un esquema anterior: `backup_usuarios` no tiene `estado_doc` ni `fecha_aceptacion_terminos`.
- Reproducirlas invita a que alguien las «restaure» en staging con datos reales, que es lo que este proyecto no debe hacer.
- Además funcionan como **huella anti-producción**: las guardas de los SQL abortan si detectan `backup_*_20260614` (solo existen en producción).
- Consecuencia: staging tiene **10 tablas / 164 columnas**, no 14 / 258. Las herramientas de comparación ya lo tienen en cuenta.
