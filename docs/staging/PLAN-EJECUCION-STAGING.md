# TILA — Plan de ejecución de los SQL de STAGING (proyecto `tila-staging` ya creado)

Estado (actualizado 2026-09-20): **CLONACIÓN ESTRUCTURAL DE STAGING: COMPLETA.**
El proyecto `tila-staging` existe (organización separada `TILA-STAGING`, región `sa-east-1`, PostgreSQL 17.6), los SQL 01–08 se ejecutaron manualmente en él (por el usuario, uno por uno y en orden) y la verificación posterior no encontró **ninguna diferencia inesperada** con producción (§2). Producción no fue modificada.
**Todavía FALTA** (no hecho), **en este orden: seed ficticio ANTES de V3** (dry-run → revisión → aplicar; decisión del usuario), luego V3 (pruebas de comportamiento con la anon key), `realtime.mjs` y smoke tests reales contra staging. **No se cargaron claves ni se creó `.env.staging`.** Además: Los **5 elementos nuevos de código están ✔ PREPARADOS Y VALIDADOS LOCALMENTE**, completos **únicamente** como «herramienta escrita + validación local»; **ninguno fue ejecutado contra staging real ni aprobado funcionalmente**: (1) `v3-anon.mjs` (71/71 tests); (2) `levantar-staging.mjs` (76/76; no hizo build real, no levantó Next, no abrió puertos, no se conectó a Supabase); (3) `realtime.mjs` (53/53; control positivo, DELETE, limpieza específica y clasificación PASS/FAIL/INCONCLUSO); (4) `limpiar-pruebas.mjs` (55/55; no ejecutó limpieza real); (5) `verificar-entorno.mjs` (56/56; no se ejecutó `--local` ni `--remoto` reales) (se prepararon **uno por vez, sin ejecutar**). Y la **comparación manual de Data API / Realtime / Storage entre paneles está ✔ COMPLETA y PASS (21/09/2026)** (única diferencia esperada: 14 tablas expuestas en producción vs 10 en staging, por las 4 `backup_*` excluidas). Plan detallado: `PLAN-V3-STAGING.md`.
Insumos: `RESULTADO-ESQUEMA-PRODUCCION.json` (2026-09-19) y `RESULTADO-ESQUEMA-STAGING.json` (2026-09-20 19:10 UTC), **ambos fuera del repo** por decisión · Informe: `INFORME-DIFERENCIAS-PRODUCCION.md`.
Principio: staging **reproduce producción tal cual, incluidas sus vulnerabilidades**. Endurecer viene después, primero en staging.

## 0. Qué hay
```
docs/staging/sql/
  01-schema.sql            10 tablas · 164 columnas · 4 secuencias serial + 1 identity · extensiones
  02-constraints.sql       22 constraints (10 PK · 2 UNIQUE · 5 CHECK · 5 FK)
  03-indexes.sql           14 índices independientes (los otros 12 los crea 02)
  04-functions-triggers.sql set_updated_at + trigger vehiculos_updated_at + rls_auto_enable + event trigger ensure_rls (con guarda anti-duplicado)
  05-rls-policies.sql      RLS en 10 tablas + 10 policies de public
  06-grants.sql            GRANTs explícitos de tablas, secuencias y funciones (anon/authenticated/service_role)
  07-realtime.sql          publicación supabase_realtime = cargas + mensajes_viaje
  08-storage.sql           2 buckets públicos + 6 policies de storage.objects
  rollback-staging.sql     deshace todo (destructivo; con guardas)
scripts/staging/
  generar-esquema.mjs            JSON de producción → 01..08 (regenerable; los SQL NO se editan a mano)
  verificar-sql-staging.mjs      verificación ESTÁTICA de los SQL contra el JSON (80 controles) + tests de mutación y de reproducibilidad (36)
  comparar-esquema-staging.mjs   compara el esquema de staging YA CREADO contra producción (+ tests 16)
```
Cada archivo: transacción propia (`begin … commit`), `set local search_path`, y una **guarda anti-producción** (aborta si existen `backup_*_20260614`, que solo existen en producción). En producción los `CREATE TABLE`/`CREATE POLICY` fallarían igualmente porque los objetos ya existen; la guarda evita además los `REVOKE/GRANT` de 06.

## 1. Orden de ejecución y estado (pasos 0–11 HECHOS el 2026-09-20; falta el 12)

La ejecución de los pasos 3–10 la realizó el usuario a mano en el SQL Editor de staging; el estado se conoce por lo que el usuario informó y por los resultados de las verificaciones (§2), no por acceso directo a Supabase (ninguna herramienta de esta sesión se conectó a ninguna base).

| Paso | Acción | Quién | Estado |
|---|---|---|---|
| 0 | Event triggers de producción leídos con `LEER-EVENT-TRIGGERS-PRODUCCION.sql` (solo lectura). Resultado en `RESULTADO-EVENT-TRIGGERS-PRODUCCION.json`: `ensure_rls` es propio y se replica; los otros 6 son de Supabase. | Vos | ✔ HECHO |
| 1 | Crear el proyecto Supabase de staging: **organización separada `TILA-STAGING`, proyecto `tila-staging`, región `sa-east-1` (la misma que producción), PostgreSQL 17.6 (la misma versión que producción)**, plan gratuito. | Vos | ✔ HECHO |
| 2 | Estado inicial de solo lectura en staging (cero tablas en `public`; si el proyecto ya traía `rls_auto_enable`, `ensure_rls` o `supabase_realtime`). | Vos | — Sin registro: no se informó su resultado. Consecuencia: **no se sabe si `ensure_rls`/`rls_auto_enable` los creó `04` o los traía el proyecto** (ver §5). |
| 3 | **01-schema.sql** | Vos | ✔ ejecutado (informado) |
| 4 | **02-constraints.sql** | Vos | ✔ ejecutado (informado) |
| 5 | **03-indexes.sql** | Vos | ✔ ejecutado (informado) |
| 6 | **04-functions-triggers.sql** | Vos | ✔ ejecutado (informado) |
| 7 | **05-rls-policies.sql** | Vos | ✔ ejecutado (informado) |
| 8 | **06-grants.sql** | Vos | ✔ ejecutado (informado) |
| 9 | **07-realtime.sql** | Vos | ✔ ejecutado (informado) |
| 10 | **08-storage.sql** | Vos | ✔ ejecutado (informado). Indicio coherente: los 2 buckets tienen `created_at` idéntico al microsegundo (`2026-09-20T19:07:25.854807Z`), como corresponde a una sola transacción. |
| 11 | Verificación de esquema (V2) y de event triggers (V2b) | Vos + yo | ✔ HECHO — resultados en §2 |
| 12 | **Seed ficticio primero** (dry-run → revisión → aplicar), y **después** V3, `realtime.mjs` y smoke tests reales (orden detallado en `PLAN-V3-STAGING.md` §4) | Yo (con `.env.staging` cargado por vos) | ⏳ **PENDIENTE** (§7) |

Reglas (vigentes si hubiera que repetir algo): **un archivo por corrida**, en ese orden. Si un archivo falla, su transacción se revierte sola: se corrige la causa y se **reejecuta ese archivo** (no los anteriores). Si hace falta empezar de cero: `rollback-staging.sql` (§3) o borrar el proyecto.

## 2. Verificaciones posteriores

**V1 — antes de crear nada (hecha, sin base):**
```
node scripts/staging/generar-esquema.mjs --json <RESULTADO-ESQUEMA-PRODUCCION.json> --evt docs/staging/RESULTADO-EVENT-TRIGGERS-PRODUCCION.json
node scripts/staging/verificar-sql-staging.mjs --json <RESULTADO-ESQUEMA-PRODUCCION.json>     # 80/80 OK
TILA_ESQUEMA_JSON=<…json> node --test scripts/staging/verificar-sql-staging.test.mjs         # 36/36 (32 mutaciones detectadas + reproducibilidad byte a byte de los 8 SQL)
```
Prueba, sin ejecutar SQL, que los archivos contienen exactamente lo de producción (tablas, columnas con tipo/NOT NULL/default/identity, 22 constraints, 26 índices, 16 policies, GRANTs, Realtime, buckets), que no hay datos ni DROP/DELETE/UPDATE, ni claves/hosts de producción.

**V2 — esquema de staging vs producción: ✔ HECHA (2026-09-20).** Se corrió `LEER-ESQUEMA-PRODUCCION.sql` (100 % solo lectura) en staging (`redacciones_aplicadas = 0`, PostgreSQL 17.6), se guardó `RESULTADO-ESQUEMA-STAGING.json` fuera del repo y se comparó con:
```
node scripts/staging/comparar-esquema-staging.mjs --prod <RESULTADO-ESQUEMA-PRODUCCION.json> --staging <RESULTADO-ESQUEMA-STAGING.json>
```
Resultado del comparador (exit 0): **SIN DIFERENCIAS** en el alcance replicado.

| Concepto | Verificado en staging |
|---|---|
| Tablas | **10** |
| Columnas | **164** (nombre, orden, tipo, `NOT NULL`, default, identity) |
| Constraints | **22** |
| Índices | **26** |
| Policies | **16** (10 en `public` + 6 en `storage.objects`) |
| Grants (objeto × rol) | **53** |
| Secuencias | **5** |
| Buckets | **2** (públicos, sin límite de tamaño ni de MIME) |
| Realtime (`supabase_realtime`) | **`cargas` + `mensajes_viaje`** (40 y 9 columnas, sin filtro de filas) |
| Funciones / triggers de `public` | Idénticos (incluye `rls_auto_enable` presente, con el mismo cuerpo, dueño, `SECURITY DEFINER` y configuración) |
| Tablas `backup_*` | Ninguna en staging (correcto, excluidas por decisión) |

**Comparación amplia (todas las secciones del JSON, no solo el alcance replicado):** 244 diferencias en total, **todas explicadas y 0 inesperadas**:
- **228 esperadas:** 226 por las 4 tablas `backup_*` excluidas (4 tablas + 94 columnas + 128 grants; la aritmética cierra: 508−380 grants y 258−164 columnas) + 2 por las fechas de creación de los buckets (producción 2026-06-03, staging 2026-09-20; el resto de sus 8 campos es idéntico).
- **16 gestionadas por Supabase:** 15 de la infraestructura de `realtime.messages` que en staging todavía no existe (la publicación `supabase_realtime_messages_publication`, las 7 particiones diarias `realtime.messages_2026_09_15…21` y su membresía) + 1 configuración del rol `supabase_realtime_admin` (`search_path=public, extensions, realtime`, presente en staging y no en producción; proyecto más nuevo). Esas particiones son una ventana de fechas que rota, así que **siempre van a diferir**.
- **Informativo:** PostgreSQL 17.6 en ambos; arquitectura distinta (producción `aarch64`, staging `x86_64`). Idénticos: los 9 esquemas, las 5 extensiones, los 15 roles con todos sus flags, la configuración del servidor, los 300 privilegios por defecto, los 25 grants de esquemas, los 10 grants de funciones, y las 6 funciones y 5 triggers de todos los esquemas (incluidas las 4 funciones gestionadas de `storage`/`realtime`).
- **Impacto probable de lo gestionado:** bajo. La app usa `postgres_changes` (va por `supabase_realtime`, idéntica); las particiones de `realtime.messages` son para broadcast/presence. Causa de la ausencia **sin verificar** (hipótesis: el servicio Realtime del proyecto nuevo aún no las creó). Si `realtime.mjs` no llegara a suscribirse, mirar primero acá.

**V2b — event triggers: ✔ HECHA (2026-09-20).** Se corrió `LEER-EVENT-TRIGGERS-PRODUCCION.sql` (solo lectura) en staging: **7 filas, 7/7 idénticas** a `RESULTADO-EVENT-TRIGGERS-PRODUCCION.json` en los 7 campos (nombre, evento, tags, habilitado, dueño, función, `SECURITY DEFINER`):
- `ensure_rls` idéntico (`ddl_command_end`; `CREATE TABLE`, `CREATE TABLE AS`, `SELECT INTO`; `O`; dueño `postgres`; `public.rls_auto_enable`; SECURITY DEFINER), incluso el orden de los tags.
- Los 6 gestionados por Supabase idénticos (`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`; todos de `supabase_admin`, funciones en `extensions`).
- Límites: ambos lados son transcripciones del resultado del editor (no una exportación automática); se compararon los 7 campos, **no los cuerpos** de las 6 funciones de Supabase (gestionadas por la plataforma).

**V3 — comportamiento: ⏳ PENDIENTE** (solo con datos ficticios del seed, contra staging; **se hace DESPUÉS de aplicar el seed**: con las tablas vacías, «policy abierta» y «policy cerrada» dan lo mismo, `[]`; requiere cargar las claves de staging en `.env.staging`, que **todavía no existe**). Deben *reproducir* producción; que algo esté «abierto» acá es lo correcto. Las pruebas exactas (A1–A15 de solo lectura y B1–B16 con escritura ficticia) están en `PLAN-V3-STAGING.md` §FASE 4; el script que las ejecuta (`scripts/staging/smoke/v3-anon.mjs`) está ✔ **preparado y validado localmente** (71/71 tests) pero **NO fue ejecutado contra staging ni aprobado funcionalmente**.
| Prueba con la anon key de staging | Esperado (igual que producción) |
|---|---|
| `GET /rest/v1/usuarios?select=*` | devuelve todas las filas, incluida `password` |
| `PATCH /rest/v1/usuarios?id=eq.<id>` con `{rol:"admin"}` | 204/200 y la fila cambia |
| `POST /rest/v1/usuarios` con `rol:"admin"` | rechazado (RLS); con `rol:"chofer"` OK |
| `GET` de `vehiculos`, `documentacion_chofer`, `paradas_viaje`, `viaje_evidencias` | devuelven filas |
| `POST` en `documentacion_chofer` / `vehiculos` | rechazado (sin policy de INSERT) |
| `POST/PATCH` en `paradas_viaje`; `POST` en `viaje_evidencias` | permitido |
| `GET` de `cargas`, `mensajes_viaje`, `billetera_chofer`, `consentimientos_legales`, `tarifas_config` | `[]` (RLS sin policies) |
| `DELETE` en cualquier tabla | 0 filas afectadas |
| Storage: subir/reemplazar/listar en ambos buckets con anon; leer por URL pública | permitido; borrar: rechazado |
| `node scripts/staging/smoke/realtime.mjs` | **es el dato nuevo**: hipótesis = no llegan eventos de `cargas`/`mensajes_viaje` a `anon`, y nunca de `usuarios`/`paradas_viaje` |

## 3. Rollback de staging
Staging es descartable; **no hay nada que revertir en producción** porque no se toca.
1. **Recomendado:** eliminar el proyecto de staging (Project Settings → General → Delete project) y crear otro.
2. **Reiniciar sin recrear:** `docs/staging/sql/rollback-staging.sql`. Borra las 10 tablas (con sus datos, índices, constraints, policies, grants y trigger), las 4 secuencias, `set_updated_at`, las 6 policies de `storage.objects` y saca `cargas`/`mensajes_viaje` de `supabase_realtime`. **Guardas:** aborta si detecta `backup_*_20260614` (producción) o si `usuarios` tiene algún email que no sea `@tila-staging.invalid` (datos reales).
   No toca: `rls_auto_enable()` ni el event trigger `ensure_rls` (un proyecto nuevo podría traerlos de antes; dejarlos es inocuo y permite reejecutar 04 con la guarda), los buckets (`storage.protect_delete` impide borrarlos por SQL: vaciar y borrar desde el panel/API), extensiones ni nada gestionado.
3. **Solo datos:** `node scripts/staging/seed/aplicar.mjs --aplicar --reset --confirmar=<ref>.supabase.co`.
4. **Un solo paso:** cada archivo 01–08 es una transacción; si falla, no queda nada a medias de ese paso.
5. **Repo:** todo lo generado está en `docs/staging/` y `scripts/staging/` (untracked). Para quitarlo: `rm -r docs/staging/sql`.

## 4. Diferencias inevitables entre staging y producción
(Las observadas de verdad el 2026-09-20 están en §2, «Comparación amplia».)

| Categoría | Diferencia | Efecto / mitigación |
|---|---|---|
| Identidad del proyecto | ref, URL, contraseña de BD, claves anon/service_role y JWT secret distintos | Se cargan solo en `.env.staging` (todavía **no creado**); `NEXT_PUBLIC_*` se incrusta en el *build* → build propio de staging. |
| Datos | Vacío. Secuencias en 1, ids nuevos, sin objetos en Storage | Seed 100 % ficticio (pendiente). Las URLs públicas tendrán otro host (el código valida el formato `/storage/v1/object/public/<bucket>/…`, no el host). |
| Esquema `auth` | Lo crea Supabase; TILA no usa Supabase Auth | Sin impacto. |
| `storage.*`, `realtime.*`, `graphql*`, `vault`, `extensions`, `pgbouncer` | Gestionados por Supabase; no se replican. **Observado:** faltan en staging la publicación `supabase_realtime_messages_publication` y las particiones `realtime.messages_*`; `storage.buckets.created_at` distinto | El comparador amplio los clasifica como gestionados/esperados. |
| Funciones/triggers de Supabase (`enforce_bucket_name_length`, `protect_delete`, `update_updated_at_column`, `subscription_check_filters`) | Las trae el proyecto | **Observado: idénticas a producción.** |
| Roles, `rolconfig`, GRANTs de esquemas, `pg_default_acl` | Los fija Supabase | **Observado: idénticos**, salvo `search_path` del rol `supabase_realtime_admin` (solo en staging). 06 hace explícitos los GRANTs de las 10 tablas → no dependen de los defaults. |
| Event trigger `ensure_rls` y `rls_auto_enable()` | Propio de producción; 04 lo crea solo si no existe (opción A) | **Observado: presentes e idénticos a producción.** Origen (creado por 04 o traído por el proyecto) **sin determinar**. |
| Otros 6 event triggers (`issue_*`, `pgrst_*`) | Son de `supabase_admin`; los trae el proyecto | **Observado: presentes e idénticos.** No se recrean. |
| Versión de PostgreSQL | Producción 17.6 | **Observado: 17.6 en staging.** |
| Arquitectura del servidor | — | **Observado:** producción `aarch64`, staging `x86_64`. Informativo. |
| Extensiones | Producción: `pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp` | **Observado: las mismas 5, en las mismas versiones.** |
| Columnas eliminadas | Producción tiene un hueco de `attnum` en `usuarios` (31) y `billetera_chofer` (3) | Solo cambian los números internos; nombres, tipos y orden idénticos. |
| Tablas `backup_*` (4) | **No se replican** (datos reales, sin uso) | Decisión documentada en el informe §7; 10 tablas / 164 columnas en vez de 14 / 258. |
| Migración `20260725` | No incluida (tampoco está en producción) | Igual que producción. |
| Ajustes fuera de SQL | Esquemas expuestos y *max rows* de la Data API, opciones de Realtime, límite global de Storage | Comparación manual entre paneles: **✔ COMPLETA y PASS (21/09/2026)** (Data API, Realtime y Storage iguales; única diferencia esperada: 14 vs 10 tablas expuestas por las 4 `backup_*` excluidas). **Data API instalada/activa en ambos proyectos; no se observó un interruptor independiente de habilitación.** Detalle en `PLAN-V3-STAGING.md` Anexo A; cumple la precondición C0b. |
| Plan/infraestructura | Plan gratuito: pausa por inactividad, límites de conexiones/mensajes Realtime, tamaño de BD y de Storage, cómputo menor | Medir; no representa la carga real de producción. |
| Índices redundantes y sin `idx_usuarios_vehiculo_activo_id` | Idénticos a producción a propósito | No «arreglarlos» todavía. |

## 5. Límites de lo verificado hasta ahora (honesto)
- **Los SQL ya corrieron en un Postgres real (staging), ejecutados por el usuario**, y la verificación posterior (§2) confirma que el resultado coincide con producción en el alcance replicado. Lo que **no** sé: si algún archivo dio error o aviso al ejecutarse, ni si se repitió alguno (no se me informó). Antes de eso se hizo una validación sintáctica con `libpg-query@17.7.4` (parser de PostgreSQL 17 en WASM, carpeta temporal fuera del repo, ya eliminada; `node --permission`): 9 archivos, 212 sentencias, sin errores; no valida PL/pgSQL (14 bloques DO revisados a mano).
- **Origen de `ensure_rls`/`rls_auto_enable` en staging:** la consulta muestra el estado, no quién lo creó (nuestro `04` o el proyecto). Ambos casos dan el mismo resultado; no cambia lo verificado.
- Las comparaciones (V2, V2b) se hicieron sobre **archivos guardados**; los resultados de V2b son transcripciones del editor. No hubo acceso directo a Supabase desde esta sesión.
- El alcance del comparador (`comparar-esquema-staging.mjs`) es el esquema replicado; la comparación amplia (todas las secciones del JSON) se hizo aparte, de forma local y puntual.
- **El comportamiento de Realtime (¿llegan eventos a `anon`?) sigue siendo una predicción estructural, no un hecho medido.** Tampoco se probó todavía cómo responde staging con la anon key (V3).
- Los ajustes de proyecto fuera de SQL (Data API, Realtime, Storage) **se compararon a mano entre paneles: ✔ COMPLETA y PASS (21/09/2026)** (§4, «Ajustes fuera de SQL»; `PLAN-V3-STAGING.md` Anexo A). Son ajustes de panel: no prueban comportamiento.

## 6. Decisiones
**Resueltas**
1. ~~¿Autorizás la consulta `pg_event_trigger`?~~ Hecho; `04` aprobado y aplicado (event trigger `ensure_rls` con guarda, opción A).
2. ~~¿Copiar los JSON de esquema al repo?~~ **NO** (decisión 20/09), ni el de producción ni el de staging: quedan fuera del repo y los scripts los reciben por `--json`.
3. ~~¿Actualizo `PLAN-STAGING.md`?~~ Hecho y vuelto a actualizar con el estado de staging (20/09).
4. ~~¿Validamos la sintaxis con `libpg-query`?~~ Hecho; no se agregó `@libpg-query/parser`.
5. ~~Opción A/B, organización, región, quién ejecuta los SQL~~ → Opción A (Supabase Cloud); organización `TILA-STAGING` separada; región `sa-east-1` igual a producción; los SQL los ejecutó el usuario a mano.

**Pendientes**
1. Cuándo y cómo cargar las claves de staging en `.env.staging` (git-ignorado; **nunca por el chat**) y completar `TILA_ENTORNO=staging` y `TILA_STAGING_SUPABASE_REF=<ref de staging>` para que las guardas anti-producción reconozcan ese proyecto.
2. ~~Aprobar el orden del plan detallado~~ **Aprobado: SEED antes de V3** (`PLAN-V3-STAGING.md`). Elemento 1 (script de V3): ✔ **preparado y validado localmente** (no ejecutado contra staging ni aprobado funcionalmente). Elementos 2 a 5 (`levantar-staging.mjs`, `realtime.mjs` ampliado, `limpiar-pruebas.mjs`, `verificar-entorno.mjs`): ✔ **preparados y validados localmente** (uno por vez, con aprobación; ninguno ejecutado contra staging). Pendiente: **ejecutarlos**, siempre con aprobación explícita y después de cargar `.env.staging`.
2b. ~~Comparar a mano Data API / Realtime / Storage entre producción y staging~~ — **✔ COMPLETA y PASS (21/09/2026)** (resultado en `PLAN-V3-STAGING.md` Anexo A).
3. Qué de `docs/staging/` y `scripts/staging/` se versiona en Git y qué se ignora (sin trackear y sin ignorar; `.gitignore` sin tocar).

## 7. Qué FALTA (no hecho todavía)
La clonación **estructural** está completa; el trabajo sobre staging **no** lo está. Falta, en este orden:
1. **Preparar `.env.staging`** (no existe) con las claves del proyecto `tila-staging`, solo por el usuario, sin pasarlas por el chat, y comprobar que las guardas aceptan únicamente el ref de staging.
2. **Seed ficticio ANTES de V3** (`scripts/staging/seed/aplicar.mjs`): dry-run → revisión → aplicar con `--aplicar --confirmar=<host de staging>` → verificar conteos y que todos los emails sean `@tila-staging.invalid`. (Orden corregido: antes este documento listaba V3 primero.)
3. **V3 — pruebas con la anon key** (tabla de §2 y `PLAN-V3-STAGING.md`): confirman que staging *se comporta* como producción, incluidas las policies abiertas. Necesita el seed ya aplicado.
4. **`realtime.mjs`** contra staging: mide si `postgres_changes` entrega eventos a `anon` (predicción: no para `cargas`/`mensajes_viaje`; nunca para `usuarios`/`paradas_viaje`). Si no se suscribe, revisar primero la infraestructura de `realtime.messages` ausente (§2). Necesita la app levantada y, para poder interpretarse, un control positivo (ya incluido en la nueva versión de `realtime.mjs`, elemento 3: ✔ preparado y validado localmente, 53/53; **no ejecutado**).
5. **Smoke tests reales** (`flujos.mjs`, `simular-gps.mjs`) contra staging, en los 3 modos de auth (legacy/dual/strict).
6. Solo después de todo eso se podría planear cualquier endurecimiento (RLS, buckets privados, privilegios por columna), **primero en staging**.

**Elementos nuevos de código (uno por vez) — los 5 ✔ PREPARADOS Y VALIDADOS LOCALMENTE** (completos **únicamente** como «herramienta escrita + validación local»; **ninguno ejecutado contra staging real**):
- **(1) script de V3:** `scripts/staging/smoke/v3-anon.mjs` + `v3-anon.test.mjs`; 71/71. NO ejecutado contra staging real, NO aprobado funcionalmente.
- **(2) launcher:** `scripts/staging/levantar-staging.mjs` + `levantar-staging.test.mjs`; 76/76. NO ejecutó build real, NO levantó Next, NO abrió puertos, NO se conectó a Supabase.
- **(3) Realtime:** `scripts/staging/smoke/realtime.mjs` + `realtime.test.mjs`; 53/53; control positivo, DELETE, limpieza específica y clasificación PASS/FAIL/INCONCLUSO. NO ejecutado contra staging real.
- **(4) limpieza general:** `scripts/staging/limpiar-pruebas.mjs` + `limpiar-pruebas.test.mjs`; 55/55. NO ejecutó limpieza real, NO se conectó a Supabase.
- **(5) verificación de entorno:** `scripts/staging/verificar-entorno.mjs` + `verificar-entorno.test.mjs`; 56/56. NO se ejecutó `--local` ni `--remoto` reales, NO se conectó a Supabase.

Suite `scripts/staging` (última corrida local): 420 tests, 369 OK, 0 fallidos, 51 saltados (requieren el JSON externo de producción). El comportamiento real de PostgREST, Storage, Realtime y de las claves `sb_publishable_*` / `sb_secret_*` sigue sin verificar. **Comparación manual de Data API / Realtime / Storage entre paneles: ✔ COMPLETA y PASS** (Anexo A de `PLAN-V3-STAGING.md`). Data API instalada/activa en ambos proyectos; no se observó un interruptor independiente de habilitación.

Nada de esto se ejecutó ni se autorizó todavía.
