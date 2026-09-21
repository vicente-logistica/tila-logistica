# TILA — Plan de staging / preproducción

Estado (actualizado 21/09/2026): **CLONACIÓN ESTRUCTURAL DE STAGING: COMPLETA.** El proyecto Supabase `tila-staging` existe (organización separada `TILA-STAGING`, región `sa-east-1`, PostgreSQL 17.6), los SQL 01–08 los ejecutaste vos a mano, uno por uno y en orden, y la verificación posterior dio **0 diferencias inesperadas** con producción (§0.2). **Todavía FALTA**, en este orden (**seed ficticio ANTES de V3**, decisión del usuario): seed (dry-run → revisión → aplicar), V3 (pruebas con la anon key), `realtime.mjs` y smoke tests reales contra staging; no se cargaron claves ni existe `.env.staging`. Los **5 elementos nuevos de código están ✔ PREPARADOS Y VALIDADOS LOCALMENTE**, completos **únicamente** como «herramienta escrita + validación local»; **ninguno fue ejecutado contra staging real ni aprobado funcionalmente**: (1) `v3-anon.mjs` (71/71 tests); (2) `levantar-staging.mjs` (76/76; no hizo build real, no levantó Next, no abrió puertos, no se conectó a Supabase); (3) `realtime.mjs` (53/53; control positivo, DELETE, limpieza específica y clasificación PASS/FAIL/INCONCLUSO); (4) `limpiar-pruebas.mjs` (55/55; no ejecutó limpieza real); (5) `verificar-entorno.mjs` (56/56; no se ejecutó `--local` ni `--remoto` reales); además, la **comparación manual de Data API / Realtime / Storage entre paneles está ✔ COMPLETA y PASS (21/09/2026)** (única diferencia esperada: 14 tablas expuestas en producción vs 10 en staging, por las 4 `backup_*` excluidas; ver `PLAN-V3-STAGING.md` Anexo A). Plan detallado: `PLAN-V3-STAGING.md`. **Producción no fue modificada** (en esta etapa lo único hecho contra producción fueron 2 consultas de catálogo de solo lectura, ejecutadas por vos; las lecturas con la anon key son de la auditoría del 18/09, anterior).
Fecha del análisis original: 18/09/2026 · Rama `diag-nav-temporal` · commit `76f9ae5` (+ cambios locales de la migración de auth). Detalle de la última etapa: `INFORME-DIFERENCIAS-PRODUCCION.md` y `PLAN-EJECUCION-STAGING.md` (esta carpeta).

> Regla: staging debe reproducir TILA lo bastante como para probar las rutas críticas (viaje activo, ofertas, alarma, chat, Realtime, GPS)
> **sin datos reales y sin ninguna forma de escribir en producción**.

---
## 0. Resumen ejecutivo

| Pregunta | Respuesta |
|---|---|
| ¿Qué falta para crear staging? | ~~El esquema SQL real~~ **Resuelto** (§0.1). ~~El proyecto Supabase separado y los SQL 01–08~~ **Hecho** (§0.2): `tila-staging` creado y con el esquema clonado. Falta lo que va **encima** de la estructura: claves en `.env.staging`, seed ficticio (**antes** de V3), V3, `realtime.mjs` y smoke tests reales, y decidir dónde corre la app de staging (`PLAN-V3-STAGING.md`). |
| ¿Qué recomiendo? | **Proyecto Supabase Cloud separado** (plan gratuito) + app corriendo **local** (`next start`) en 3 instancias (legacy/dual/strict). Vercel Preview y mobile se agregan después. Alternativa sin nube: Supabase local con Docker (requiere instalar WSL2 + Docker Desktop). |
| ¿Qué ya está listo? | **Estructura de staging completa y verificada** (§0.2): 10 tablas, 22 constraints, 26 índices, 16 policies, buckets, Realtime y event triggers idénticos a producción. Más: guardas anti-producción, seed 100 % ficticio (**escrito, no aplicado a staging**), smoke tests de flujos (152 verificaciones OK contra el **simulador local**, no contra staging), simulador de GPS, test de Realtime (**no verificado**: aún no corrió contra Supabase real), inventarios y plantilla de variables. |
| ¿Qué necesito de vos? | Cargar las claves de staging en `.env.staging` cuando lo decidas (**nunca por el chat**; ver `PLAN-EJECUCION-STAGING.md` §6–§7) y las decisiones pendientes de la §8. Las consultas de solo lectura y los SQL 01–08 ya los hiciste. |
| Riesgo principal | Que una corrida de staging herede claves de producción (Next carga `.env.local` automáticamente y `NEXT_PUBLIC_*` se incrusta en el *build*). Mitigación en §7. |

### 0.1 Estado REAL actual del esquema y de los SQL de staging (2026-09-20)

**Fuente de verdad:** `RESULTADO-ESQUEMA-PRODUCCION.json` (formato `tila-esquema-produccion/1`, relevado el 2026-09-19 con `LEER-ESQUEMA-PRODUCCION.sql`, 100 % solo lectura, PostgreSQL 17.6, `redacciones_aplicadas = 0`) + `RESULTADO-EVENT-TRIGGERS-PRODUCCION.json` (7 event triggers, consulta `LEER-EVENT-TRIGGERS-PRODUCCION.sql`, solo lectura).
**Decisión (2026-09-20): el JSON de esquema de producción NO se copia al repo ni se versiona en Git** (es una radiografía completa de roles, grants, policies, funciones, buckets y Realtime). Vive fuera del repo y todos los scripts lo reciben por ruta externa con `--json`. **Lo mismo rige para `RESULTADO-ESQUEMA-STAGING.json`** (esquema del proyecto de staging, relevado el 2026-09-20): también fuera del repo.

| Concepto | Producción (relevado) | En staging (creado y verificado, §0.2) | Nota |
|---|---|---|---|
| Tablas | 14 | **10** (164 columnas) | Se excluyen las 4 `backup_*_20260614` (snapshot con datos reales, 94 columnas, sin uso en el código; sirven de huella anti-producción en las guardas). |
| Columnas | 258 | **164** | Nombre, orden, tipo, `NOT NULL`, default e identity idénticos. |
| Constraints | 22 | **22** | 10 PK · 2 UNIQUE · 5 CHECK · 5 FK. Todas pertenecen a las 10 tablas replicadas (las `backup_*` no tienen ninguna). |
| Índices | 26 | **26** | 14 independientes + 12 creados por PK/UNIQUE. Las `backup_*` no tienen índices, así que no hay nada que excluir. `idx_usuarios_vehiculo_activo_id` (de la migración 20250606) **no existe en producción** y no se crea. |
| Policies RLS | 16 | **16** | 10 en `public` + 6 en `storage.objects`. Reproducen las abiertas de producción (`anon_select_usuarios`, `anon_update_usuarios_permisivo`, etc.); **no se corrigió nada**. |
| Buckets | 2 | **2** | `documentacion-choferes` y `vehiculos`, públicos, sin límite de tamaño ni de MIME. |
| Realtime (`supabase_realtime`) | `cargas` + `mensajes_viaje` | **`cargas` + `mensajes_viaje`** | **No** se publican `usuarios` ni `paradas_viaje` aunque el frontend se suscribe a ellas (corrige lo que decía la versión anterior de este plan: 4 tablas). |
| Funciones / triggers propios | `set_updated_at` + trigger `vehiculos_updated_at`; `rls_auto_enable` (SECURITY DEFINER) | **igual** | Textuales de `pg_get_functiondef`. |
| Event trigger propio | `ensure_rls` (`ddl_command_end`; `CREATE TABLE` / `CREATE TABLE AS` / `SELECT INTO`; habilitado; dueño `postgres`) | **`ensure_rls` presente e idéntico** (y `rls_auto_enable` presente). `04` lo crea con guarda anti-duplicado: no recrea si ya existe idéntico, **aborta** si existe distinto, falla con mensaje claro ante «permission denied». | Confirmado en producción y **verificado idéntico en staging** (V2b). Origen en staging (creado por `04` o traído por el proyecto) sin determinar; no cambia el resultado. |
| Event triggers de Supabase | 6 (`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`) | **NO se recrean; presentes e idénticos en staging (6/6)** | Son de `supabase_admin` (Supabase / PostgREST / extensiones); los trae el proyecto. |
| GRANTs | defaults de Supabase (`anon`/`authenticated`/`service_role` con todo) | **explícitos en `06`**; 53 combinaciones objeto×rol verificadas idénticas | Sin GRANT por columna, igual que producción. |
| Secuencias | 5 | **5** (4 serial + 1 identity en `cargas.id`) | |

**Verificación previa a crear staging (sin ejecutar SQL contra ninguna base):**

| Verificación | Resultado |
|---|---|
| Suite completa `scripts/staging` (`node --test`) | **109/109** (48 auditor de solo lectura · 16 comparador · 9 guardas · 36 verificador + mutaciones + reproducibilidad) |
| Verificador estático de los SQL contra el JSON (`verificar-sql-staging.mjs`) | **80/80** controles |
| Reproducibilidad | Los 8 SQL se regeneran **byte a byte idénticos** desde el generador (`--json` + `--evt`) |
| Sintaxis con parser real de PostgreSQL 17 (`libpg-query@17.7.4`, WASM, `node --permission`, solo lectura) | **9/9 archivos** (8 SQL + `rollback-staging.sql`) parsean sin errores: **212 sentencias**. Canario de permisos previo 19/19 (escritura, lectura fuera de ruta y `child_process` bloqueados). |
| Límite de esa validación | **No valida PL/pgSQL** (la versión no expone `parsePlPgSQL`). Los 14 bloques `DO` se revisaron a mano y sus 28 fragmentos SQL embebidos se parsearon aparte. Esa limitación se cerró después: los SQL se ejecutaron en un Postgres real (staging) y el resultado coincide con producción (§0.2). |
| `libpg-query` temporal | Instalado solo en una carpeta temporal **fuera del repo** y **eliminado por completo** (con su cache de npm). El repo no tiene `libpg-query` en `node_modules`, `package.json` ni `package-lock.json`. |
| Producción | **No modificada.** En esta etapa ningún comando mío se conectó a una base de datos. Contra producción solo hubo las 2 consultas de catálogo de solo lectura que ejecutaste vos. |

Herramientas de diagnóstico **temporales** (canario de permisos, validador de sintaxis, conteos esperados, salida): **fuera del repo** por decisión; se reejecutan con una instalación temporal nueva.

### 0.2 Staging creado y verificado (2026-09-20) — clonación estructural COMPLETA

**Proyecto (creado por vos en el panel de Supabase):** organización separada `TILA-STAGING` · proyecto `tila-staging` · región `sa-east-1` (la misma que producción) · PostgreSQL 17.6 (la misma versión que producción).
**Ejecución:** los SQL `01` a `08` los ejecutaste vos manualmente en el SQL Editor de staging, uno por uno y en orden. Esto se conoce por lo que informaste y por los resultados de abajo; ninguna herramienta de esta sesión se conectó a Supabase. No se me informó si algún archivo dio error o aviso, ni el resultado del «estado inicial» previo, por lo que no se sabe si `ensure_rls`/`rls_auto_enable` los creó `04` o los traía el proyecto.

**Verificaciones posteriores** (esquema de staging relevado con `LEER-ESQUEMA-PRODUCCION.sql`, solo lectura, PostgreSQL 17.6, `redacciones_aplicadas = 0`; comparado con `comparar-esquema-staging.mjs`, exit 0, **SIN DIFERENCIAS** en el alcance replicado):

| Concepto | Staging |
|---|---|
| Tablas | 10 |
| Columnas | 164 |
| Constraints | 22 |
| Índices | 26 |
| Policies | 16 |
| Grants (objeto × rol) | 53 |
| Secuencias | 5 |
| Buckets | 2 |
| Realtime (`supabase_realtime`) | `cargas` + `mensajes_viaje` |
| `rls_auto_enable` | presente (mismo cuerpo, dueño y `SECURITY DEFINER`) |
| `ensure_rls` | presente e idéntico a producción |

**Comparación estructural (todas las secciones del JSON): 244 diferencias, 0 inesperadas.**
- **228 esperadas:** 226 por las tablas `backup_*` correctamente excluidas (4 tablas, 94 columnas, 128 grants) + 2 por las fechas de creación de los buckets.
- **16 gestionadas por Supabase:** 15 de la infraestructura de `realtime.messages` que todavía no existe en staging (publicación `supabase_realtime_messages_publication` y 7 particiones diarias, siempre van a diferir) + 1 configuración del rol `supabase_realtime_admin`. Impacto probable bajo (la app usa `postgres_changes`); causa sin verificar.
- **Informativo:** PostgreSQL 17.6 en ambos; arquitectura distinta (`aarch64` en producción, `x86_64` en staging).

**Event triggers: 7/7 idénticos** entre producción y staging (`LEER-EVENT-TRIGGERS-PRODUCCION.sql` corrida en staging, comparada con `RESULTADO-EVENT-TRIGGERS-PRODUCCION.json`): `ensure_rls` idéntico (evento, tags en el mismo orden, habilitado, dueño, función, `SECURITY DEFINER`) y los 6 gestionados por Supabase (`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`) idénticos. No se compararon los cuerpos de esas 6 funciones (gestionadas por la plataforma).

**La clonación ESTRUCTURAL de staging queda COMPLETA.** Alcance: esquema, columnas, constraints, índices, funciones, triggers, RLS y policies, grants, secuencias, buckets, publicación Realtime y event triggers. **No** incluye datos ni comportamiento.

**Todavía FALTA (no hecho, no autorizado aún):**
Orden aprobado (**el seed va ANTES de V3**: con tablas vacías, «policy abierta» y «policy cerrada» dan lo mismo, `[]`):
1. **Seed ficticio** (`scripts/staging/seed/aplicar.mjs`): dry-run → revisión → aplicar. Requiere `.env.staging`, que **todavía no existe**; no se cargó ninguna clave.
2. **V3 — pruebas con la anon key** contra staging (confirman que se comporta como producción, incluidas las policies abiertas). Necesita el seed aplicado.
3. **`realtime.mjs`** contra staging (mide si Realtime entrega eventos a `anon`; sigue siendo una predicción; requiere control positivo).
4. **Smoke tests reales** (`flujos.mjs`, `simular-gps.mjs`) contra staging, no solo contra el simulador local, con la app en los 3 modos de auth.

**Elementos nuevos de código (uno por vez):**
- **1. Script de V3 — ✔ PREPARADO Y VALIDADO LOCALMENTE.** `scripts/staging/smoke/v3-anon.mjs` + `scripts/staging/smoke/v3-anon.test.mjs`; **71/71** tests de V3 y **180/180** en la suite `scripts/staging`. **NO ejecutado contra staging real, NO conectado a Supabase, NO aprobado funcionalmente**; el comportamiento real de PostgREST, Storage y de las claves `sb_publishable_*` sigue sin verificar.
- **2. Launcher — ✔ PREPARADO Y VALIDADO LOCALMENTE.** `scripts/staging/levantar-staging.mjs` + `levantar-staging.test.mjs`; **76/76**. **NO ejecutó build real, NO levantó Next, NO abrió puertos, NO se conectó a Supabase.**
- **3. Realtime — ✔ PREPARADO Y VALIDADO LOCALMENTE.** `scripts/staging/smoke/realtime.mjs` + `realtime.test.mjs`; **53/53**; control positivo, DELETE, limpieza específica y clasificación PASS/FAIL/INCONCLUSO. **NO ejecutado contra staging real.**
- **4. Limpieza general — ✔ PREPARADO Y VALIDADO LOCALMENTE.** `scripts/staging/limpiar-pruebas.mjs` + `limpiar-pruebas.test.mjs`; **55/55**. **NO ejecutó limpieza real, NO se conectó a Supabase.**
- **5. Verificación de entorno — ✔ PREPARADO Y VALIDADO LOCALMENTE.** `scripts/staging/verificar-entorno.mjs` + `verificar-entorno.test.mjs`; **56/56**. **NO se ejecutó `--local` real ni `--remoto` real; NO se conectó a Supabase.**
- Los 5 están completos **únicamente** como «herramienta escrita + validación local»; **ninguno** se validó contra staging real. Suite `scripts/staging` (última corrida local): 420 tests, 369 OK, 0 fallidos, 51 saltados (requieren el JSON externo de producción).

**Comparación manual de Data API / Realtime / Storage entre paneles de producción y staging: ✔ COMPLETA y PASS (21/09/2026).** Data API, Realtime y Storage iguales en ambos proyectos; única diferencia **esperada**: 14 tablas expuestas en producción vs 10 en staging (las 4 `backup_*` se excluyeron a propósito). **Data API instalada/activa en ambos proyectos; no se observó un interruptor independiente de habilitación.** Detalle de valores en `PLAN-V3-STAGING.md` Anexo A. Cumple la precondición C0b del veredicto «funcionalmente equivalente» (son ajustes de panel: el comportamiento sigue sin medirse hasta V3).

Detalle y orden en `PLAN-EJECUCION-STAGING.md` (§1, §2 y §7).

---
## 1. FASE 1 — Inventario (solo lectura del repo)

### 1.1 Variables de entorno (solo nombres; no se imprimió ningún valor)

| Variable | Clase | Dónde se lee | Notas |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Pública (bundle del navegador) + Supabase | `lib/supabase.ts` y 39 rutas API (fallback) | Se **incrusta en el build**: staging necesita su propio build. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Pública + Supabase | `lib/supabase.ts` | En prod es formato nuevo `sb_publishable_…`. |
| `SUPABASE_URL` | Backend (opcional) | 39 rutas API | Si falta, cae a `NEXT_PUBLIC_SUPABASE_URL`. No está en `.env.local`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Backend secreta** + Supabase | 39 de las 41 rutas API (todas salvo `distancia` y `auth/logout`) | Bypasea RLS. Jamás debe llegar al navegador. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Pública + Google | `MapaTILA.tsx` (Maps JS, Routes API, Geocoder, Directions) | Restringida por *referrer* (verificado). |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Pública + Google | `MapaTILA.tsx` | |
| `GOOGLE_SERVER_API_KEY` | Backend secreta + Google | `api/distancia` | **Sin restricción de IP** (verificado): se pudo usar desde otra IP. |
| `MERCADOPAGO_ACCESS_TOKEN` | Backend secreta + MP | `crear-preferencia`, `webhook` | En `.env.local` mide 23 caracteres = el placeholder `REEMPLAZAR_CON_TU_TOKEN`. El valor real está solo en Vercel (**no verificable desde acá**). |
| `MERCADOPAGO_WEBHOOK_SECRET` | Backend secreta + MP | `webhook` | No está en `.env.local`. **Sin él el webhook responde 401 en producción.** |
| `NEXT_PUBLIC_BASE_URL` | Pública (pero se lee en servidor) + MP | `crear-preferencia` (back_urls / `notification_url`) | En `.env.local` apunta a **producción**: una corrida local crearía preferencias con retorno a prod. |
| `NODE_ENV` | Otras | `webhook` | En `development` el webhook **omite la firma** si falta el secreto. |
| `TILA_SESSION_SECRET`, `TILA_AUTH_MODE` | Backend secreta / config (nuevas) | `lib/auth/sesion.ts` | Defaults seguros: sin secreto no hay sesión; sin modo = `legacy`. |
| `VERCEL_OIDC_TOKEN` | Otras (artefacto de Vercel CLI) | nadie | Está en `.env.local` (1.286 caracteres). No se usa. |
| Móvil | — | `capacitor.config.ts` | **No usa variables**: `server.url = https://tila-logistica.vercel.app` fijo; también fijo en `AndroidManifest.xml` (App Links) y `assetlinks.json`. |

Hallazgos de higiene: existe un `app/.env.local` suelto (no lo carga Next) que contiene **la clave de Google filtrada en el historial de git (la que sigue activa para Directions)** y una `NEXT_PUBLIC_SUPABASE_URL` con un error de tipeo (`.supabase.com` en vez de `.supabase.co`). Conviene revocar esa clave y borrar ese archivo cuando se haga la limpieza de claves; no hay `vercel.json` (la config vive en el panel de Vercel, no verificable).

### 1.2 Tablas y columnas que usa el código
Generado con `node scripts/staging/inventario-esquema.mjs` (salida completa en `docs/staging/inventario-esquema.generado.json`) y contrastado con `BACKUP_RECOVERY_PLAN.md` + las columnas reales observadas en la auditoría (`node scripts/staging/comparar-con-doc.mjs`).

| Tabla | Archivos que la tocan | Columnas usadas | Documentada en el repo | Observada en BD real |
|---|---|---|---|---|
| `usuarios` | 43 | 36 (rol, estado_aprobacion, estado_doc, online, bateria_*, ultima_senal_at, vehiculo_activo_id, navegador_preferido, datos personales/bancarios, password…) | Sí, pero **faltan** `estado_doc`, `fecha_aceptacion_terminos`, `seguro_carga` (confirmadas en BD real) | Sí: **42 columnas vivas** (había 43 en la observación por REST; el catálogo muestra una columna eliminada). Sin uso en el código: `cuit`, `contacto`, `direccion`, `deposito`, `seguro_vehiculo`, `vtv_rto`, `antecedentes` |
| `cargas` | 24 | 37 (estado, pago_*, precios, lat/lng/velocidad*, gps_actualizado, hora_*, oculto_*, mp_*…) | Sí, pero **faltan** `detalles`, `precio_base`, `tipo_carroceria`, `vehiculo`, `velocidad` | Sí: **40 columnas** (relevada con el catálogo; `anon` no la ve por RLS sin policies) |
| `mensajes_viaje` | 6 | 9 | Sí | Sí: **9 columnas** (RLS sin policies para `anon`) |
| `paradas_viaje` | 8 | 5 | Sí | Sí |
| `vehiculos` | 7 | 15 | Sí | Sí (+ `color`, `motivo_rechazo` sin uso) |
| `documentacion_chofer` | 5 | 3 | Sí | Sí |
| `viaje_evidencias` | 2 | 15 | Sí | Sí (+ `parada_id` sin uso: función pendiente) |
| `billetera_chofer` | 3 | 4 | Sí | Sí: **5 columnas** (`monto` sin uso directo; `viaje_id` **no** es único) |
| `consentimientos_legales` | 1 | 7 (`usuario_id, tipo_documento, version_documento, fecha_hora, ip_address, user_agent, metodo`) | **No documentada** | Sí: **8 columnas**, con FK a `usuarios` (`ON DELETE CASCADE`) |
| `tarifas_config` | 0 | — | Sí ("no se usa") | Sí: **8 columnas** (existe, sin uso en el código) |

Sin RPC (`.rpc(` no aparece en el código). Sin funciones SQL propias en el repo (**producción sí tiene 2**: `set_updated_at` y `rls_auto_enable`; ver §0.1).

La columna «Observada en BD real» se actualizó con el esquema relevado el 19/09 (§0.1). Además existen en producción las 4 tablas `backup_*_20260614` (no usadas por el código, no replicadas en staging).

### 1.3 Storage, Realtime, triggers, policies
- **Buckets**: `documentacion-choferes` (DNI, licencia, antecedentes, seguro, VTV, cédula, fotos de evidencia en `evidencias/<viaje>/`) y `vehiculos` (fotos). Ambos **públicos** hoy; el código guarda `getPublicUrl` en la BD.
- **Realtime**: 7 canales / 14 suscripciones `postgres_changes`, todas con la **anon key**: `admin-realtime` (cargas, usuarios, paradas_viaje, mensajes_viaje, todos `*`); `panel-chofer-realtime` (cargas INSERT/UPDATE/DELETE **sin filtro**); `cliente-rt-{id}` (cargas con `cliente_id=eq.{id}`, paradas_viaje); `cliente-mensajes-{id}` y `viaje-activo-chat-{id}` y `chat-rt-{viaje}-{tipo}-{usuario}` (mensajes_viaje INSERT); `viaje-activo-rt-{id}` (cargas `id=eq.{id}`, paradas_viaje `carga_id=eq.{id}`). Todas se usan como **disparador de re-fetch** con polling de respaldo (3–5 s). **Publicación real `supabase_realtime` en producción: SOLO `cargas` y `mensajes_viaje`** (relevado el 19/09). El frontend se suscribe además a `usuarios` y `paradas_viaje`, que **no están publicadas** y por lo tanto nunca emiten eventos; y `cargas`/`mensajes_viaje` tienen RLS activo **sin ninguna policy**, así que se predice que `anon` tampoco recibe sus eventos (sin verificar: lo medirá `realtime.mjs` en staging, §6).
- **Triggers/FK/índices (real, relevado el 19/09)**: 22 constraints (10 PK · 2 UNIQUE · 5 CHECK · **5 FK**), 26 índices y 1 trigger propio (`vehiculos_updated_at`). `UNIQUE(chofer_id, tipo)` en `documentacion_chofer` **confirmado**; `billetera_chofer.viaje_id` **no es único** (la base no impide acreditar dos veces un viaje). **No existen** FK en `cargas`, `mensajes_viaje`, `viaje_evidencias` ni `billetera_chofer`. En el repo solo hay 3 migraciones: la `20250606` está aplicada **a medias** (falta su índice), la `20250630` aplicada y la `20260725` **no** aplicada. Ver `INFORME-DIFERENCIAS-PRODUCCION.md`.
- **Policies (real: 16)**: ninguna en el repo. Producción tiene 10 en `public` (`usuarios`: `anon_insert_usuarios_no_admin`, `anon_select_usuarios` USING true, `anon_update_usuarios_permisivo` USING/CHECK true; `paradas_viaje`: 3 abiertas a `anon`+`authenticated`; `vehiculos_select_anon`; `documentacion_chofer_select_anon`; `viaje_evidencias` SELECT/INSERT a `public`) y 6 en `storage.objects` (SELECT/INSERT/UPDATE abiertos a `anon`+`authenticated` sobre ambos buckets, sin DELETE). Sin policies (deniegan a `anon`): `cargas`, `mensajes_viaje`, `billetera_chofer`, `consentimientos_legales`, `tarifas_config`. Coincide con lo observado con la anon key el 18/09. El frontend además **escribe** con anon en `usuarios`, `paradas_viaje` (INSERT/UPDATE) y Storage.

### 1.4 Datos mínimos para probar
Ver §3 (seed): 6 usuarios en los 3 roles y estados de aprobación, 3 vehículos, 26 documentos, 7 cargas cubriendo todos los estados del flujo, 5 paradas, 8 mensajes en las 3 vías, 2 movimientos de billetera, 3 evidencias, 15 consentimientos y 25 imágenes ficticias.

### 1.5 Qué esquema SQL hay en el repo y qué faltaba (RESUELTO el 20/09: ver §0.1)
Hay **3 archivos** en `supabase/migrations/`, ninguno crea una tabla base:
1. `20250606_vehiculo_activo_id.sql` — `ALTER TABLE usuarios` + migración de datos que asume que `vehiculos` ya existe.
2. `20250630_estado_doc_usuarios.sql` — agrega `estado_doc`.
3. `20260725_documentos_legales_y_consentimientos.sql` — **sin commitear y NO aplicada en producción**; además **rompería el registro** si se aplica (agrega `decision NOT NULL` y `lib/consentimiento.ts` no la envía).

**Faltaba todo lo demás (ya relevado de producción y generado como `docs/staging/sql/01–08`, ver §0.1)**: `CREATE TABLE` de las 10 tablas (tipos de `id`, tipos de las FK — el documento dice `text` para `cliente_id` pero `usuarios.id` es `uuid` —, defaults, identity), PKs, FKs, UNIQUE, índices, `ENABLE ROW LEVEL SECURITY`, policies, GRANTs, membership de la publicación Realtime, buckets y políticas de Storage, extensiones.
`scripts/staging/comparar-con-doc.mjs` lista además qué columnas usa el código que el documento no describe (arriba). **Todas las tablas y columnas que usa el código existen en producción** (verificado contra el esquema real).

---
## 2. FASE 2 — Propuesta de staging

### 2.1 Opciones evaluadas
| Opción | Aísla de prod | Realtime/RLS/Storage reales | Costo | Esfuerzo | Veredicto |
|---|---|---|---|---|---|
| **A. Proyecto Supabase Cloud separado** (gratuito) + app local | Total | Sí | USD 0 | Bajo (crear proyecto + pegar SQL) | **Recomendada** |
| **B. Supabase local (Docker Desktop + WSL2 + CLI)** | Total, sin nube | Sí | USD 0 | Medio-alto: hoy la máquina **no tiene Docker, WSL, `supabase`, `psql` ni `pg_dump`**; instalar requiere admin y reinicio | Buena para RLS/Realtime destructivos; segunda etapa |
| C. Otro *schema* dentro del proyecto de producción | **No** | — | — | — | **Rechazada** (comparte claves, cuotas y riesgo) |
| D. Solo el simulador local actual | Total | **No** (sin RLS, constraints, Realtime, Storage reales) | 0 | Ya está | Insuficiente para rutas críticas; sigue útil para lógica y auth |

Qué cubre y qué no el simulador actual (para no sobreestimarlo): cubre lógica de rutas API, autenticación legacy/dual/strict, flujos cliente/chofer/admin y filtros; **no cubre** RLS, permisos por columna, constraints/índices/carreras reales de Postgres, tipos, Realtime, políticas de Storage.

### 2.2 Diseño recomendado (Opción A)
- **Supabase**: proyecto `tila-staging` (**creado el 20/09**: organización separada `TILA-STAGING`, región `sa-east-1` igual a producción, PostgreSQL 17.6). **Esquema y policies = las de producción tal cual** (para reproducir también las vulnerabilidades actuales y poder verificar cada endurecimiento primero acá). Se crea con los SQL `docs/staging/sql/01–08` (10 tablas, sin las `backup_*`).
- **Buckets**: `documentacion-choferes` y `vehiculos`, públicos al inicio (espejo); pasan a privados en staging cuando se pruebe esa etapa.
- **Realtime**: publicar en `supabase_realtime` **solo `cargas` y `mensajes_viaje`** (exactamente como producción; `07-realtime.sql`); *replica identity* por defecto. `usuarios` y `paradas_viaje` **no** se publican (tampoco lo están en producción).
- **App**: `next build` **con las variables de staging** + `next start` en 3 instancias (legacy / dual / strict) contra la misma base (igual que el entorno local aislado). Vercel Preview y builds móviles apuntando a staging quedan para una segunda etapa (requieren dominio de staging y `CAP_SERVER_URL` configurable, hoy fijo a producción).
- **Mercado Pago**: sandbox (`TEST-…`, usuarios de prueba). Fase 1 **sin pagos** (se fija `pago_estado` en el seed): las rutas críticas del chofer no lo necesitan.
- **Google**: clave de staging restringida por referrer y por API con cuota baja, o sin clave (MapaTILA falla en pantalla pero los flujos de API no dependen de él). Navegación/mapas quedan fuera de este alcance.
- **Variables**: `scripts/staging/env.staging.example` (sin valores). Se completan en `.env.staging` (git-ignorado).

### 2.3 Usuarios (todos ficticios)
| Rol | Email | Clave | Estado |
|---|---|---|---|
| admin | `admin@tila-staging.invalid` | `Staging-Admin-1234` | — |
| cliente | `cliente1@tila-staging.invalid` | `Staging-Cliente1-1234` | con viaje activo e historial |
| cliente | `cliente2@tila-staging.invalid` | `Staging-Cliente2-1234` | con viaje finalizado |
| chofer | `chofer1@tila-staging.invalid` | `Staging-Chofer1-1234` | aprobado, **online**, camión rígido N2, docs completos |
| chofer | `chofer2@tila-staging.invalid` | `Staging-Chofer2-1234` | aprobado, **offline**, utilitario N1, docs completos |
| chofer | `chofer3@tila-staging.invalid` | `Staging-Chofer3-1234` | **pendiente**, docs parciales |

---
## 3. FASE 3 — Seed (listo y verificado contra el simulador local)
`scripts/staging/seed/`: `datos.mjs` (datos deterministas), `png.mjs` (imágenes grises lisas generadas sin dependencias), `aplicar.mjs`.
- **Ficticio total**: emails `@tila-staging.invalid`, DNI `000000NN`, teléfonos `+54 11 0000 00NN`, CUIT `20-000000NN-0`, alias `alias.staging.*`, contraseñas con hash bcrypt, documentos = imágenes grises. Nada proviene de producción.
- **Contenido**: 1 admin, 2 clientes, 3 choferes (aprobado+online, aprobado+offline, pendiente); 7 cargas: 2 pendientes (una con 3 paradas, una pagada), 1 en camino (viaje activo con GPS), 1 con chofer asignado, 2 finalizadas (con billetera), 1 cancelada por chofer (republicable); mensajes en `viaje`, `soporte_cliente` y `soporte_chofer` leídos y no leídos; evidencias; consentimientos legales.
- **Seguro**: por defecto es **dry-run**; para escribir exige `--aplicar`, y contra un host que no sea local, además `--confirmar=<host>`. Idempotente (upsert por id). `--reset` borra **solo** las filas del seed.
- **Verificado**: aplicado 3 veces contra el simulador (1ª pasada, 2ª idempotente con los mismos conteos, y con `--reset`).

```bash
# dry-run (no escribe)
TILA_ENTORNO=staging TILA_STAGING_SUPABASE_REF=<ref> STAGING_SUPABASE_URL=https://<ref>.supabase.co STAGING_SERVICE_ROLE_KEY=... \
  node scripts/staging/seed/aplicar.mjs
# aplicar
... node scripts/staging/seed/aplicar.mjs --aplicar --confirmar=<ref>.supabase.co [--reset]
```

---
## 4. FASE 4 — Pruebas (`scripts/staging/smoke/`)
| Script | Cubre | Estado |
|---|---|---|
| `flujos.mjs` | Cliente (login → publicar → historial → seguimiento → chat → chat ajeno 403), Chofer (login → disponibles → aceptar **con carrera de 2 choferes** → viaje activo → estados incl. salto inválido 422 → evidencia → GPS → chat → finalizar → billetera idempotente), Admin (login → usuarios → cargas → resumen chat → responder soporte → documentación), y matriz de auth por modo | **Verificado**: 152/152 (38 por cada modo legacy/dual/strict + instancia de control) contra el simulador |
| `simular-gps.mjs` | Recorrido GPS ficticio Rosario → Santa Fe sobre el viaje 103 vía `PATCH /api/cargas/gps` | **Verificado** (6/6 puntos OK en strict) |
| `realtime.mjs` | Con la misma anon key y suscripciones que el frontend: ¿llegan eventos de nueva carga, cambio de estado, mensaje, GPS y latido? | **NO VERIFICADO**: el simulador no tiene WebSocket. Solo corre contra un Supabase real. "No llegó" no es fallo: es el dato que buscamos (ver §6). |
| `guardas.test.mjs` | Las guardas anti-producción | **Verificado** (9/9) |

Cómo se corre en local hoy: `node scripts/validacion-local/levantar-entorno.mjs --build` → seed contra su simulador → `TILA_ENTORNO=local node scripts/staging/smoke/flujos.mjs`.

---
## 5. Plan de creación de staging (pasos 1–4 HECHOS; la estructura está completa; faltan los pasos 5–8)
| # | Paso | Quién | Automatizable |
|---|---|---|---|
| 1 | ✔ **HECHO** (19 y 20/09). Consultas de catálogo de solo lectura ejecutadas por vos en producción: `LEER-ESQUEMA-PRODUCCION.sql` (el Apéndice A quedó superado) y `LEER-EVENT-TRIGGERS-PRODUCCION.sql`. El JSON de esquema queda **fuera del repo**. | Vos | No (acceso a prod) |
| 2 | ✔ **HECHO**. `generar-esquema.mjs --json <esquema> --evt <event triggers>` produjo `docs/staging/sql/01–08` + `rollback-staging.sql`; verificados (§0.1). | Yo | Sí |
| 3 | ✔ **HECHO** (20/09). Proyecto Supabase de staging creado por vos: organización separada `TILA-STAGING`, proyecto `tila-staging`, región `sa-east-1`, PostgreSQL 17.6. **Las claves NO se cargaron todavía ni existe `.env.staging`.** | Vos | No |
| 4 | ✔ **HECHO** (20/09). SQL `01`→`08` ejecutados por vos en el SQL Editor de staging, uno por uno y en orden; verificados con V2 (esquema: 0 diferencias inesperadas) y V2b (event triggers 7/7 idénticos). **Clonación estructural COMPLETA.** Detalle: §0.2 y `PLAN-EJECUCION-STAGING.md` §1–§2. No se agregó `pg` ni ninguna dependencia. | Vos | Parcial |
| 5 | ⏳ **PENDIENTE.** Cargar las claves de staging en `.env.staging` (solo vos, nunca por el chat); luego, **en este orden**: `aplicar.mjs` (seed ficticio: dry-run → revisión → `--aplicar`), **después** V3 (anon key) y `realtime.mjs`. Usa el elemento 1 (script de V3: ✔ preparado y validado localmente, **no ejecutado contra staging**) y usa además los elementos 3 (`realtime.mjs` ampliado), 4 (`limpiar-pruebas.mjs`) y 5 (`verificar-entorno.mjs`), ✔ **preparados y validados localmente, no ejecutados** (`PLAN-V3-STAGING.md` §3) | Vos (claves) + yo | Sí |
| 6 | ✔ **PREPARADO Y VALIDADO LOCALMENTE** (`levantar-staging.mjs`, 76/76; **no ejecutado**: sin build real, sin Next, sin puertos). ⏳ **Su EJECUCIÓN sigue PENDIENTE** (necesita `.env.staging` y aprobación): build con variables de staging + 3 instancias (legacy/dual/strict) | Yo | Sí |
| 7 | ⏳ **PENDIENTE.** Correr `flujos.mjs`, `simular-gps.mjs`, `realtime.mjs` **contra staging** y guardar el informe | Yo | Sí |
| 8 | (Opcional) Vercel Preview, MP sandbox, clave Google de staging, build Android apuntando a staging | Vos + yo | Parcial |

Estimación restante: paso 5 ≈ 20 min tuyos (claves) + ½ sesión mía; pasos 6-7 ≈ 1 sesión mía. Nada de esto se ejecutó ni se autorizó todavía.

---
## 6. Realtime — qué vamos a aprender y por qué importa
Hipótesis (sin verificar): como la anon key ve **0 filas** de `cargas` y `mensajes_viaje`, Realtime `postgres_changes` **no entrega esos eventos** en producción, y la app funciona solo por su polling de 3–5 s. Si se confirma en staging, entonces (a) endurecer RLS de esas tablas **no rompe** Realtime (ya no anda), (b) el polling es crítico y sostiene toda la operación, (c) el costo del polling se puede medir. Si en cambio los eventos sí llegan, cualquier endurecimiento de RLS sobre `cargas`/`mensajes_viaje` afectaría la experiencia en vivo y hay que planificarlo. **Esto es lo que más justifica tener staging antes de tocar las rutas críticas.**

*Evidencia estructural del relevamiento del 19/09 (aún no medida):* `supabase_realtime` publica solo `cargas` y `mensajes_viaje`; `cargas` y `mensajes_viaje` tienen RLS activo **sin policies** (deniegan a `anon`); y las suscripciones a `usuarios` y `paradas_viaje` apuntan a tablas **no publicadas**. Todo apunta a que hoy Realtime `postgres_changes` no entrega eventos útiles a la app y a que el polling sostiene la operación. `realtime.mjs` en staging lo confirma o lo refuta. **Estado (20/09):** los SQL 01–08 ya están aplicados en staging y reproducen exactamente esta configuración (publicación `supabase_realtime` = `cargas` + `mensajes_viaje`, RLS sin policies en ambas); `realtime.mjs` **todavía no se corrió**. Nota: en staging aún no existen la publicación `supabase_realtime_messages_publication` ni las particiones de `realtime.messages` (infraestructura gestionada por Supabase; causa sin verificar); si la suscripción fallara, revisar eso primero.

---
## 7. Riesgos y controles
| Riesgo | Control |
|---|---|
| Una corrida de staging usa claves/URL de producción (Next carga `.env.local` automáticamente; `NEXT_PUBLIC_*` se incrusta en el build; `NEXT_PUBLIC_BASE_URL` local apunta a prod) | El lanzador de staging define **todas** las variables explícitamente; los scripts abortan si el host es de producción; `.env.staging` separado; verificación post-build de que `.next/static` no contiene el host/clave de prod (ya lo hacemos en el entorno local). |
| El seed o un smoke escribe en producción | Guardas (`guardas.mjs`): `TILA_ENTORNO` obligatorio, lista negra de hosts de prod (incluye el *ref*), lista blanca explícita de refs de staging, `--aplicar` + `--confirmar`, dry-run por defecto. Probadas: apuntar a la URL de producción aborta **antes** de conectar. |
| Claves de staging filtradas | Solo en `.env.staging` (git-ignorado) y variables del proyecto de staging; nunca por argumento de línea de comandos; los logs las enmascaran. |
| Webhook de MP de staging notificando a producción o al revés | `NEXT_PUBLIC_BASE_URL` y `notification_url` propios; credenciales `TEST-…`. |
| Deriva de esquema staging ≠ producción | `comparar-esquema-staging.mjs` (V2) compara el esquema de staging con el de producción tras crearlo; regenerar los SQL desde un JSON nuevo (`generar-esquema.mjs`) antes de cada ola de migración. Los SQL no se editan a mano. |
| Staging hereda las vulnerabilidades de producción (intencional) | Solo datos ficticios; sin datos reales jamás; proyecto aislado. |
| El plan gratuito pausa proyectos inactivos / límites de Realtime | Reactivar antes de cada sesión; medir el uso. |
| Se pierde tiempo si el esquema real difiere de lo que supone el código | **Cerrado:** el esquema real ya está relevado; toda tabla/columna que usa el código existe en producción (verificado). |
| Los JSON de esquema (producción y staging: radiografía de roles, grants, policies, funciones, buckets y Realtime) terminan versionados en Git | **Decisión 20/09:** ninguno de los dos se copia al repo; los scripts los reciben por `--json` desde una ruta externa. Ojo: `docs/staging/` y `scripts/staging/` están **sin trackear y sin ignorar**; los `.sql` generados y `INFORME-DIFERENCIAS-PRODUCCION.md` contienen el mismo tipo de información (policies, grants, buckets y la descripción de las debilidades). Antes de cualquier `git add`, decidir qué se versiona (ver §8, punto 5). |

### Rollback
Staging es **descartable**: no hay nada que revertir en producción porque no se toca.
- Datos: `aplicar.mjs --aplicar --reset` (o borrar y recrear el proyecto de staging).
- Servicios externos: eliminar el proyecto Supabase de staging (y el proyecto Vercel/MP sandbox si se crearon).
- Repo: los archivos nuevos están todos bajo `scripts/staging/`, `docs/staging/` y `scripts/validacion-local/` (ver §9); `rm -r scripts/staging docs/staging` los elimina. Cambios en archivos existentes de esta etapa: solo `mock-supabase.mjs` (2 ajustes de la herramienta de prueba).
- Esquema SQL en staging: `docs/staging/sql/rollback-staging.sql` (guardas: aborta si detecta `backup_*` de producción o emails que no sean `@tila-staging.invalid`), o eliminar el proyecto (recomendado). Detalle en `PLAN-EJECUCION-STAGING.md` §3.

---
## 8. Decisiones que necesito de vos
**Resueltas**
- ~~Consultas de catálogo en producción~~ → hechas por vos (solo lectura); no hizo falta `pg_dump` ni Supabase CLI.
- ~~Copiar el JSON de esquema al repo~~ → **NO** (decisión 20/09): queda fuera del repo, los scripts lo reciben por `--json`.
- ~~Validar la sintaxis de los SQL~~ → hecho con `libpg-query@17.7.4` temporal (eliminado); no se agregó `@libpg-query/parser`.
- ~~Aplicar el esquema por script con `pg`~~ → por ahora **no**: se pegan los SQL a mano, un archivo por corrida; no se agregó ninguna dependencia.
- ~~Opción A o B~~ → **Opción A: Supabase Cloud** (decisión 20/09).
- ~~Organización y región~~ → organización separada `TILA-STAGING`; región `sa-east-1`, la misma que producción.
- ~~Quién ejecuta los SQL 01–08~~ → **vos, a mano** (hecho el 20/09, uno por uno y en orden).

**Pendientes**
1. ¿Cuándo y cómo se cargan las claves de staging en `.env.staging` (git-ignorado; **nunca por el chat**) y `TILA_STAGING_SUPABASE_REF` para que las guardas reconozcan solo ese proyecto?
2. ~~¿Aprobás el orden del plan de V3?~~ **Aprobado: SEED antes de V3** (`PLAN-V3-STAGING.md`). Elemento 1 (script de V3): ✔ **preparado y validado localmente** (no ejecutado contra staging ni aprobado funcionalmente). Elementos 2 a 5 (`levantar-staging.mjs`, `realtime.mjs` ampliado, `limpiar-pruebas.mjs`, `verificar-entorno.mjs`): ✔ **preparados y validados localmente** (uno por vez, con aprobación; ninguno ejecutado contra staging). Pendiente: **ejecutarlos**, siempre con aprobación explícita y después de cargar `.env.staging`.
3. ¿Vercel Preview / builds móviles de staging ahora o después? ¿Mercado Pago sandbox ahora o después?
4. ¿Guardás una copia de los JSON de esquema (producción y staging) en un lugar privado fuera de Git (gestor de contraseñas / disco cifrado)?
5. ¿Qué de `docs/staging/` y `scripts/staging/` se versiona y qué se ignora (por ejemplo, agregar a `.gitignore` los `.sql` generados y los informes con detalle de las debilidades)? No se tocó `.gitignore`.
6. ~~Comparar a mano los ajustes de Data API, Realtime y Storage~~ entre los paneles de producción y staging: **✔ COMPLETA y PASS (21/09/2026)** (hecho por el usuario; solo mirar y anotar, sin cambios). Resultado en `PLAN-V3-STAGING.md` Anexo A.

---
## 9. Archivos agregados en esta etapa (todos locales; ninguno afecta a la app)
```
scripts/staging/guardas.mjs · guardas.test.mjs · inventario-esquema.mjs · comparar-con-doc.mjs · env.staging.example
scripts/staging/seed/datos.mjs · png.mjs · aplicar.mjs
scripts/staging/smoke/util.mjs · flujos.mjs · simular-gps.mjs · realtime.mjs
docs/staging/PLAN-STAGING.md · inventario-esquema.generado.json
scripts/validacion-local/mock-supabase.mjs   (modificado: ?vacio=1 en /__reset y endpoint de buckets)

— Agregados en la etapa 19–20/09 (esquema real; los SQL solo los ejecutaste vos, en staging) —
scripts/staging/auditar-sql-solo-lectura.mjs · .test.mjs        auditor mecánico de «solo lectura» (48 tests)
scripts/staging/generar-esquema.mjs                             JSON de producción (+ event triggers) → 01..08 (regenerable)
scripts/staging/verificar-sql-staging.mjs · .test.mjs           80 controles estáticos + 31 mutaciones + reproducibilidad (36 tests)
scripts/staging/comparar-esquema-staging.mjs · .test.mjs        compara staging ya creado contra producción (16 tests)
docs/staging/LEER-ESQUEMA-PRODUCCION.sql                        consulta 100 % solo lectura (ya ejecutada en producción por vos)
docs/staging/LEER-EVENT-TRIGGERS-PRODUCCION.sql · RESULTADO-EVENT-TRIGGERS-PRODUCCION.json
docs/staging/sql/01-schema … 08-storage.sql · rollback-staging.sql
docs/staging/INFORME-DIFERENCIAS-PRODUCCION.md · PLAN-EJECUCION-STAGING.md · PLAN-V3-STAGING.md
(RESULTADO-ESQUEMA-PRODUCCION.json y RESULTADO-ESQUEMA-STAGING.json: FUERA del repo por decisión)
```
Escritos y validados solo en local (no ejecutados): `scripts/staging/levantar-staging.mjs`, `limpiar-pruebas.mjs`, `verificar-entorno.mjs` (cada uno con su `.test.mjs`) y la nueva versión de `scripts/staging/smoke/realtime.mjs` (+ `realtime.test.mjs`); también `smoke/v3-anon.mjs` + `v3-anon.test.mjs`. Las herramientas temporales de validación de sintaxis (canario de permisos, validador con `libpg-query`) **no están en el repo** por decisión.

---
## 10. Qué rutas críticas podremos probar después y en qué orden migrarlas (27 pendientes)
Cada ola repite lo ya hecho (golden master del código previo → tests que discriminan → migración de solo la identidad → legacy idéntico) y **suma** staging: `flujos.mjs`, `realtime.mjs` y una prueba manual con navegador real.

| Ola | Rutas | Qué se prueba en staging | Riesgo |
|---|---|---|---|
| 1 | `chat/no-leidos`, `chat/mensajes`, `chat/marcar-leidos`, `chat/mensaje` | Badges, sonido de mensaje, dedupe por id, Realtime de `mensajes_viaje`, polling | Bajo-medio |
| 2 | `cargas/disponibles`, `cargas/activa` | Ofertas + **alarma** con dos navegadores (chofer online/offline), redirección al viaje activo | **Alto** (operativo) |
| 3 | `cargas/ocultar-historial`, `chofer/vehiculos/[id]`, `.../activo`, `cargas/evidencia`, `admin/cargas/ocultar` | Escrituras simples e idempotentes | Medio |
| 4 | `cargas/estado`, `aceptar`, `cancelar-chofer`, `cancelar-cliente`, `republicar`, `publicar`, `admin/cargas/estado`, `cargas/gps` | Máquina de estados, carrera de aceptación **contra Postgres real**, carga de GPS a 1 Hz por chofer | **Alto** |
| 5 | `chofer/billetera/acreditar`, `mercadopago/crear-preferencia`, `admin/billetera` | Acreditación sin doble crédito (con UNIQUE real), MP sandbox | **Muy alto** (dinero) |
| 6 | `admin/cargas` (DELETE), `admin/reset-password`, `admin/usuarios/[id]`, `.../estado`, `chat/mensajes-viaje` | Acciones destructivas de admin | Alto |

Además, en staging se puede ensayar **antes** de producción el endurecimiento de Supabase: privilegios por columna sobre `usuarios`, buckets privados con URLs firmadas y RLS por tabla.

---
## Apéndice A — Consultas de SOLO LECTURA sobre el catálogo (SUPERADO: ya se relevó con `LEER-ESQUEMA-PRODUCCION.sql` y `LEER-EVENT-TRIGGERS-PRODUCCION.sql`; se conserva solo como referencia histórica)
No leen tablas de usuarios ni de negocio: solo metadatos del esquema, permisos y políticas.
```sql
-- 1. Columnas (tipos, nulabilidad, defaults, identity)
select table_name, column_name, data_type, udt_name, is_nullable, column_default, is_identity
from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position;
-- 2. Constraints (PK, FK, UNIQUE, CHECK)
select conrelid::regclass as tabla, conname, contype, pg_get_constraintdef(oid) as definicion
from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2;
-- 3. Índices
select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2;
-- 4. Triggers y funciones propias
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers where trigger_schema = 'public';
select p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
-- 5. RLS activado y políticas (public y storage)
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname in ('public', 'storage') order by 1, 2, 3;
-- 6. Permisos (GRANT) de anon/authenticated, a nivel tabla y columna
select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 2, 1, 3;
select grantee, table_name, column_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE') order by 2, 3;
-- 7. Realtime: tablas publicadas y replica identity
select pubname, schemaname, tablename from pg_publication_tables order by 1, 3;
select relname, relreplident from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;
-- 8. Storage: buckets y límites
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets;
-- 9. Extensiones
select extname, extversion from pg_extension order by 1;
```
Formato sugerido para pegarme el resultado: exportar cada consulta como JSON/CSV desde el editor de Supabase.
