# TILA — Plan detallado de V3: comprobar que STAGING se comporta como PRODUCCIÓN

Estado (actualizado 21/09/2026): **PLAN APROBADO EN SU ORDEN; NADA EJECUTADO CONTRA STAGING. Los 5 elementos de código están ✔ PREPARADOS Y VALIDADOS LOCALMENTE (herramienta escrita + validación local; ninguno ejecutado contra staging real).**
No existe `.env.staging`, no se cargaron claves, no se aplicó el seed, **V3 no se ejecutó contra staging real** (no se conectó a Supabase), no se corrió `realtime.mjs` ni ningún smoke test contra staging, no se ejecutó `levantar-staging.mjs` (ni build real, ni Next, ni puertos), ni `limpiar-pruebas.mjs`, ni `verificar-entorno.mjs` (`--local`/`--remoto`). Los 5 elementos de código (§3) están completos **únicamente** como «herramienta escrita + validación local»: **ninguno** fue ejecutado contra staging real ni aprobado funcionalmente. Producción y staging no se tocaron en esta etapa.
Contexto: la clonación **estructural** de `tila-staging` está COMPLETA (`PLAN-EJECUCION-STAGING.md` §2). Este plan cubre lo que falta: **comportamiento**.
Regla del plan: si aparece cualquier diferencia, **no se corrige automáticamente**; primero se informa (qué falló, qué esperaba producción, qué observó staging, posible causa, impacto).

## 1. Decisiones tomadas (por el usuario)
| Decisión | Detalle |
|---|---|
| **Orden: SEED antes de V3** | Con las tablas vacías, «policy abierta» y «policy cerrada» dan lo mismo (`[]`), y algunas escrituras necesitan filas padre (una `parada` necesita una `carga`). Secuencia: dry-run del seed → revisión → aplicación del seed **ficticio** → recién después V3. Ninguna prueba usa datos reales. |
| Los 5 elementos nuevos | Se prepararon **uno por vez, sin ejecutarlos** (§3). **Los 5 están ✔ preparados y validados localmente** (herramienta escrita + validación local); **ninguno ejecutado contra staging real**. |
| Data API / Realtime / Storage | **Comparación manual entre paneles: ✔ COMPLETA y PASS (21/09/2026).** Data API, Realtime y Storage iguales en producción y staging (única diferencia: 14 tablas expuestas en producción vs 10 en staging, **esperada** por las 4 `backup_*` excluidas). Data API instalada/activa en ambos proyectos; no se observó un interruptor independiente de habilitación. Resultado registrado en el Anexo A. Cumple la precondición C0b (§9). |
| Claves | Las carga el usuario a mano; **nunca se pegan en el chat**. |

## 2. Hallazgos del código que condicionan el plan
| # | Hallazgo | Consecuencia |
|---|---|---|
| 1 | `aplicar.mjs` no recorta espacios, no quita comentarios en línea y no expande `${VAR}` al leer `.env.staging`. | El archivo real lleva solo líneas `CLAVE=valor`, sin espacios, sin `# comentarios`, sin comillas y sin `${}`. **No copiar `env.staging.example` tal cual.** |
| 2 | Solo `aplicar.mjs` lee `.env.staging`; `realtime.mjs`, `flujos.mjs` y `simular-gps.mjs` leen solo variables de entorno. | Correrlos con `node --env-file=.env.staging …`. Una variable ya definida en la terminal **gana** sobre el archivo: usar una terminal limpia. |
| 3 | Las guardas comprueban URL y ref, **no las claves**. | Hace falta un chequeo de coherencia clave↔URL (fase 2) → `verificar-entorno.mjs` (elemento 5: ✔ preparado y validado localmente, 56/56; **no ejecutado**). |
| 4 | No existía ningún script de V3. | Elemento nuevo 1 (§3): ✔ **preparado y validado localmente** (`scripts/staging/smoke/v3-anon.mjs`); no ejecutado contra staging. |
| 5 | Faltaba `levantar-staging.mjs`. | Elemento nuevo 2 (§3): ✔ **preparado y validado localmente** (`scripts/staging/levantar-staging.mjs`, 76/76); **no ejecutado** (sin build real, sin Next, sin puertos, sin Supabase). |
| 6 | `flujos.mjs` acepta `--anon=KEY` por línea de comandos. | **No se usa** (claves nunca por argumento). El chequeo de documentación que activa ese parámetro se cubre en V3. |
| 7 | `--reset` del seed borra solo filas con ids del seed; **no** borra lo que crean las pruebas ni los archivos de Storage. | Elemento nuevo 4 (limpieza):✔ **preparado y validado localmente** (`scripts/staging/limpiar-pruebas.mjs`, 55/55); **no ejecutó ninguna limpieza real**. |
| 8 | La versión ORIGINAL de `realtime.mjs` no limpiaba, salía siempre con exit 0 y no tenía control positivo. | Elemento nuevo 3: ✔ **preparado y validado localmente** (`smoke/realtime.mjs` reescrito + `realtime.test.mjs`, 53/53: control positivo, DELETE, limpieza específica por marcador, clasificación PASS/FAIL/INCONCLUSO); **no ejecutado contra staging real**. |
| 9 | En `realtime.mjs`, la actualización de `usuarios.ultima_senal_at` va por `fetch` con `Authorization: Bearer <anon>`. | Riesgo **no verificado**: con claves `sb_publishable_…` el Bearer podría rechazarse y leerse como falso «no llegó». **Corregido en el elemento 3** (la actualización va por el cliente `supabase-js` anon, sin headers manuales); sin verificar contra Supabase real. |
| 10 | El dry-run del seed exige tener cargada la service_role (exit 2 si falta), aunque no se conecte. | El dry-run requiere `.env.staging` ya armado. |
| 11 | La app no tiene URL ni clave de producción escritas en el código; las rutas API exigen `SUPABASE_SERVICE_ROLE_KEY` (sin fallback a la anon). | El riesgo real es `.env.local`, que Next carga solo (fase 2). |
| 12 | **El seed usaba ids enteros en tablas cuyo `id` real es `uuid`** (`documentacion_chofer`, `mensajes_viaje`, `billetera_chofer`): aplicado en staging real habría fallado con `22P02`. | ✔ **CORREGIDO (2026-09-20)** en `scripts/staging/seed/datos.mjs` (5 líneas de código + 2 de comentario): ids UUID deterministas `uid(1000+n)`, `uid(2000+n)`, `uid(3001)`/`uid(3002)`. Validado **solo en local** contra el esquema real: 0 errores (antes 36). Ya no bloquea A5, A9, A10 ni B13. El seed **sigue sin aplicarse**. |

## 3. Los 5 elementos nuevos (preparados UNO POR VEZ; los 5 ✔ PREPARADOS Y VALIDADOS LOCALMENTE; ninguno ejecutado contra staging real)
Cada uno se preparó solo con aprobación explícita y **no se ejecuta** sin otra aprobación explícita.
| # | Elemento | Para qué | Estado |
|---|---|---|---|
| 1 | **Script de V3** (A: solo lectura; B: escrituras ficticias) | Ejecutar las pruebas de la fase 4 con la anon key vía `supabase-js`, con marcadores, relectura y limpieza | ✔ **PREPARADO Y VALIDADO LOCALMENTE** (completo solo como «script escrito + validación local»; **NO ejecutado contra staging**; ver detalle abajo) |
| 2 | **`levantar-staging.mjs`** | Build con variables de staging y 3 instancias (legacy/dual/strict) con verificación post-build | ✔ **PREPARADO Y VALIDADO LOCALMENTE** (76/76; **NO ejecutó build real, NO levantó Next, NO abrió puertos, NO se conectó a Supabase**) |
| 3 | **Ampliaciones de `realtime.mjs`** | Control positivo con service_role, prueba de DELETE, limpieza y arreglo del `fetch` con Bearer | ✔ **PREPARADO Y VALIDADO LOCALMENTE** (53/53; control positivo, DELETE, limpieza específica y clasificación PASS/FAIL/INCONCLUSO; **NO ejecutado contra staging real**) |
| 4 | **Limpieza de datos de prueba** | Herramienta `limpiar-pruebas.mjs`: borrado por marcador exacto (V3, Realtime, flujos opt-in) + objetos de Storage por API, con dry-run por defecto | ✔ **PREPARADO Y VALIDADO LOCALMENTE** (55/55; **NO ejecutó limpieza real, NO se conectó a Supabase**) |
| 5 | **Verificación de entorno de solo lectura** | Coherencia clave↔URL y escaneo de contaminación de producción (nivel local sin red; nivel remoto solo lectura) | ✔ **PREPARADO Y VALIDADO LOCALMENTE** (56/56; **NO se ejecutó `--local` real ni `--remoto` real, NO se conectó a Supabase**) |

### Elemento 1 — Script de V3: detalle del estado
**ESTADO: ✔ PREPARADO Y VALIDADO LOCALMENTE.** Completo únicamente en cuanto a «script escrito + validación local».
- **Archivo:** `scripts/staging/smoke/v3-anon.mjs`
- **Tests:** `scripts/staging/smoke/v3-anon.test.mjs`
- **Implementado:**
  - pruebas **A1–A15** (solo lectura) y **B1–B16** (escrituras ficticias);
  - guardas anti-producción y validación de configuración (solo variables de entorno; nunca claves por argumentos);
  - redacción de secretos (nada sensible sale por pantalla);
  - modo `--listar` / `--plan`, sin red, sin leer claves y sin escribir;
  - resultados PASS / FAIL / SKIP y códigos de salida (0 todo pasó · 1 hay FAIL · 2 configuración o argumentos inválidos · 3 SKIP obligatorio);
  - la **anon** mide los permisos; la **service_role** solo verifica (relectura, detección del seed) y limpia de forma controlada con `--limpiar` (apagado por defecto);
  - marcadores `V3-MARCADOR`, `v3-*@tila-staging.invalid` y `v3-marcador/*` para todo dato ficticio.
- **Validación local:** **71/71** tests de V3 (contra un Supabase falso en memoria) (al prepararlo; la suite total de `scripts/staging` daba 180/180). Última corrida local con los 5 elementos: suite `scripts/staging` de 420 tests, 369 OK, 0 fallidos y 51 saltados (los que requieren el JSON externo de producción).

**ACLARACIÓN OBLIGATORIA — lo que este estado NO significa:**
- **NO se ejecutó V3 contra staging real.**
- **NO se conectó a Supabase.**
- **NO existe `.env.staging`** y **NO se cargaron claves.**
- El comportamiento real de **PostgREST, Storage y de las claves `sb_publishable_*` / `sb_secret_*` sigue sin verificar.**
- **V3 NO está ejecutado ni aprobado funcionalmente.** Lo pendiente sigue siendo: cargar `.env.staging` (el usuario), aplicar el seed ficticio y recién después correr V3 (§4).

### Elementos 2 a 5 — detalle del estado
**ESTADO de cada uno: ✔ PREPARADO Y VALIDADO LOCALMENTE.** Completos únicamente como «herramienta escrita + validación local». **Ninguno se ejecutó contra staging real.**
| # | Archivos | Tests locales | Lo que NO se hizo |
|---|---|---|---|
| 2 | `scripts/staging/levantar-staging.mjs` + `.test.mjs` | **76/76** | no ejecutó build real, no levantó Next, no abrió puertos, no se conectó a Supabase (solo se corrió `--plan`) |
| 3 | `scripts/staging/smoke/realtime.mjs` + `realtime.test.mjs` | **53/53** | no ejecutado contra staging real; incluye control positivo con service_role, DELETE de carga ficticia marcada, limpieza específica por marcador y clasificación PASS/FAIL/INCONCLUSO |
| 4 | `scripts/staging/limpiar-pruebas.mjs` + `.test.mjs` | **55/55** | no ejecutó ninguna limpieza real; no se conectó a Supabase |
| 5 | `scripts/staging/verificar-entorno.mjs` + `.test.mjs` | **56/56** | no se ejecutó `--local` real ni `--remoto` real; no se conectó a Supabase |

**Sin verificar hasta la primera ejecución real (con aprobación):** comportamiento real de PostgREST, Storage, Realtime y de las claves `sb_publishable_*` / `sb_secret_*`; los endpoints del nivel remoto de `verificar-entorno.mjs`; el arranque real de Next en los 3 hosts loopback.

## 4. Orden de ejecución (cuando se autorice cada paso)
| Paso | Qué | Fase |
|---|---|---|
| 1 | Cargar `.env.staging` (el usuario) y verificarlo | 1 |
| 2 | Guardas y coherencia clave↔URL (solo lectura) | 2 |
| 3 | Estado base de staging: SQL de solo lectura (conteos = 0) que corre el usuario | 2/3 |
| 4 | **Seed:** dry-run → revisión → aplicar | 6 |
| 5 | Verificar el seed (conteos y emails `@tila-staging.invalid`) | 6 |
| 6 | V3-A (solo lectura) | 4 |
| 7 | V3-B (escrituras ficticias) + limpieza | 4 |
| 8 | Levantar la app en 3 modos | 7 |
| 9 | Realtime, con control positivo | 5 |
| 10 | Smoke por modo, con reseed entre modos | 7 |
| 11 | Limpieza y checklist final | 8 |

---
## FASE 1 — `.env.staging`
**Dónde:** raíz del repo, junto a `.env.local` (Next **no** lo carga solo; ya lo buscan `aplicar.mjs` y las guardas). Ignorado por `.gitignore` (regla `.env*`, líneas 34 y 54).

**Formato exacto** (los `<…>` los reemplaza el usuario; sin espacios, comentarios ni comillas):
```
TILA_ENTORNO=staging
TILA_STAGING_SUPABASE_REF=<ref de tila-staging>
TILA_STAGING_APP_HOSTS=
STAGING_SUPABASE_URL=https://<ref de tila-staging>.supabase.co
STAGING_ANON_KEY=<publishable / anon de staging>
STAGING_SERVICE_ROLE_KEY=<secret / service_role de staging>
NEXT_PUBLIC_SUPABASE_URL=https://<ref de tila-staging>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<la misma publishable / anon>
SUPABASE_URL=https://<ref de tila-staging>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<la misma secret / service_role>
TILA_SESSION_SECRET=<32 o más caracteres aleatorios, propios de staging>
NEXT_PUBLIC_BASE_URL=http://localhost:3131
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=SIN-CLAVE-DE-PRUEBA
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=SIN-MAP-ID-DE-PRUEBA
GOOGLE_SERVER_API_KEY=SIN-CLAVE-DE-PRUEBA
MERCADOPAGO_ACCESS_TOKEN=REEMPLAZAR_CON_TU_TOKEN
```
- `TILA_AUTH_MODE` **no va** en el archivo: la fija el lanzador en cada instancia.
- `MERCADOPAGO_WEBHOOK_SECRET` se omite a propósito; con el token placeholder cualquier ruta de pagos falla de forma segura.
- `TILA_STAGING_SUPABASE_REF` lleva **un solo ref**, sin comas.

| Variable | Tipo | La usan |
|---|---|---|
| `STAGING_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **publishable / anon** | V3 y `realtime.mjs`; navegador y build de la app |
| `STAGING_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | **secret / service_role** | seed, relectura y limpieza; servidor de la app |
| `TILA_SESSION_SECRET` | secreto propio | cookies de sesión (generarlo con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`; nunca por el chat) |
| `NEXT_PUBLIC_*` | públicas | se **incrustan en el build** |

**Verificar que ninguna variable apunte a producción** (futuro, solo lectura, **sin imprimir valores**): (1) el ref de la URL coincide con `TILA_STAGING_SUPABASE_REF`; (2) búsqueda en el archivo del ref de producción (`imbtep…ihi`) y de `tila-logistica.vercel.app`: debe dar cero (solo nombres de variable o líneas); (3) la anon de staging es distinta de la publishable de producción que figura en `BACKUP_RECOVERY_PLAN.md`; (4) coherencia clave↔URL: `GET /rest/v1/` de staging con cada clave debe dar 200 (una clave de producción daría 401).

**Verificar que `.env.staging` esté ignorado por Git** (futuro, solo lectura): `git check-ignore -v .env.staging` (debe citar la regla), `git ls-files --error-unmatch .env.staging` (debe **fallar**: no está trackeado), `git status --short --ignored` (debe mostrar `!! .env.staging`). Sin `git add`, ni siquiera en simulación.

## FASE 2 — Guardas anti-producción
Hoy los scripts exigen `TILA_ENTORNO=staging|local`, rechazan el host de producción y cualquier host que contenga su ref, exigen que el ref esté en `TILA_STAGING_SUPABASE_REF` y, para la URL de la app, solo aceptan localhost o `TILA_STAGING_APP_HOSTS`. Todo ocurre antes de conectarse; no hay una orden suelta «solo comprobar».
| # | Chequeo (todos de solo lectura) | Comando futuro | Esperado |
|---|---|---|---|
| G1 | Tests de las guardas | `node --test scripts/staging/guardas.test.mjs` | 9/9 |
| G2 | La guarda reconoce staging | `node scripts/staging/seed/aplicar.mjs` (dry-run) | imprime host de staging y clave enmascarada; **no se conecta** |
| G3 | Control negativo | el mismo dry-run con `STAGING_SUPABASE_URL` puesta a la URL de producción, solo en esa orden | aborta «apunta a PRODUCCIÓN», exit 2, antes de conectar |
| G4 | Escaneo de valores | búsqueda del ref y host de producción en el archivo | cero coincidencias |
| G5 | Coherencia clave↔URL | `GET /rest/v1/` con anon y con service_role de staging | ambas 200 |
| G6 | La app le pega a staging (con la app arriba) | login de `cliente1@tila-staging.invalid` | 200; ese email solo existe en staging |
| G7 | Post-build | búsqueda en `.next/static` del ref y host de producción | cero |

**Riesgo de la app:** Next carga `.env.local` (con valores de producción); las variables de proceso ganan sobre él. El lanzador debe definir **todas** las variables del ejemplo de forma explícita, como hace `levantar-entorno.mjs` con el mock. Un build de staging **reemplaza** la carpeta `.next` del repo: nunca se despliega.

## FASE 3 — Orden entre V3 y el seed
Resuelto (§1): **seed primero.** Lo que no necesita filas (fases 1 y 2 y el estado base) va antes del seed. Estado base: SQL de solo lectura que corre el usuario en el SQL Editor de **staging** con los conteos de las 10 tablas (esperado: todo 0). Las secciones de otros documentos que listaban V3 antes del seed quedan corregidas.

## FASE 6 — Seed ficticio (`scripts/staging/seed/aplicar.mjs`)
| Aspecto | Detalle |
|---|---|
| Dry-run (por defecto) | `node scripts/staging/seed/aplicar.mjs` |
| Qué crearía | 6 usuarios · 3 vehículos · 26 documentaciones · 7 cargas (ids 101–107) · 5 paradas · 8 mensajes · 2 billeteras · 3 evidencias · 15 consentimientos · 25 imágenes en los 2 buckets |
| Por qué es ficticio | emails `@tila-staging.invalid` (dominio reservado), DNI `000000NN`, teléfonos `+54 11 0000 00NN`, CUIT `20-000000NN-0`, alias `alias.staging.*`, IP `203.0.113.10` (rango de documentación), ids con prefijo fijo `57a91000-…`, imágenes grises generadas al vuelo. No lee nada de producción. |
| Contraseñas | hash bcrypt de `Staging-<Rol>-1234`. En producción están en texto plano (el login acepta ambos), así que V3-A2 verá un hash bcrypt: diferencia de **datos**, no de policy. |
| Ids uuid (corregido) | `documentacion_chofer` 1001–1026 · `mensajes_viaje` 2001–2008 · `billetera_chofer` 3001–3002, todos `57a91000-0000-4000-8000-…`, válidos, únicos y deterministas (hallazgo 12 de §2). `consentimientos_legales` conserva ids enteros: su `id` real es `bigint`. `--reset` no usa estos ids (borra por `chofer_id`, `usuario_id`, `viaje_id`, `carga_id`), por eso no cambia. |
| Guardas | `TILA_ENTORNO`, host y ref; escribir exige `--aplicar` y `--confirmar=<host>` |
| Aplicar (futuro) | `node scripts/staging/seed/aplicar.mjs --aplicar --confirmar=<ref>.supabase.co` |
| Escribe con | service_role (ignora RLS), upsert por id |
| Buckets | los intenta crear; ya existen; el aviso «ya existe» no es fatal |
| Revisión previa | el usuario ve el dry-run (conteos y usuarios de prueba) y confirma |
| Verificación posterior | conteos 6/3/26/7/5/8/2/3/15 por SQL + 25 objetos en Storage + todos los emails `@tila-staging.invalid` |
| Revertir | `--reset --aplicar` borra **solo** filas con ids del seed (no lo que crean las pruebas ni los archivos de Storage). Limpieza completa: `limpiar-pruebas.mjs` (elemento 4; ✔ preparado y validado localmente, **no ejecutado**). |

## FASE 4 — V3 con la anon key
Pruebas con `supabase-js`, como el frontend. **Fuente del esperado:** **OBS** = observado en producción con la anon key el 18/09 (solo lecturas); **DER** = derivado del catálogo de producción (policies y grants; las escrituras nunca se probaron en producción y no se probarán).
**Marcadores:** todo lo escrito lleva `V3-MARCADOR` (emails `v3-<n>@tila-staging.invalid`, texto `V3-MARCADOR`, ruta `v3-marcador/…`). Nunca se escribe sobre los usuarios del seed.

### A) 100 % solo lectura
| ID | Endpoint | Método | Qué lee | Esperado (producción) | Sería una diferencia |
|---|---|---|---|---|---|
| A1 | `/rest/v1/usuarios?select=id,email,rol` | GET | usuarios | 200 con 6 filas (OBS) | `[]`, 401 o 403 |
| A2 | `/rest/v1/usuarios?select=id,password` | GET | columna password | legible (OBS/DER); acá será hash bcrypt | error o nulo |
| A3 | `/rest/v1/usuarios?select=dni,cuit_cuil,alias_cbu_cvu,titular_cuenta,telefono` | GET | datos sensibles | legibles (DER) | error o vacío |
| A4 | `/rest/v1/vehiculos` | GET | vehículos | 3 filas (OBS) | `[]` |
| A5 | `/rest/v1/documentacion_chofer` | GET | documentos | 26 filas (OBS) | `[]` |
| A6 | `/rest/v1/paradas_viaje` | GET | paradas | 5 filas (OBS) | `[]` |
| A7 | `/rest/v1/viaje_evidencias` | GET | evidencias | 3 filas (OBS) | `[]` |
| A8 | `/rest/v1/cargas` | GET | cargas | **`[]`** con 200 (OBS) | cualquier fila |
| A9 | `/rest/v1/mensajes_viaje` | GET | mensajes | `[]` (OBS) | cualquier fila |
| A10 | `/rest/v1/billetera_chofer` | GET | billetera | `[]` (OBS) | cualquier fila |
| A11 | `/rest/v1/consentimientos_legales` | GET | consentimientos | `[]` (OBS) | cualquier fila |
| A12 | `/rest/v1/tarifas_config` | GET | tarifas | `[]` (DER) | cualquier fila |
| A13 | `/storage/v1/object/list/documentacion-choferes` y `/vehiculos` | POST (solo lectura) | listar objetos | lista los archivos (DER: SELECT abierto) | lista vacía o 403 |
| A14 | `/storage/v1/object/public/<bucket>/<ruta del seed>` | GET | leer por URL pública | 200 (DER: bucket público) | 400 o 404 |
| A15 | `/rest/v1/backup_usuarios_20260614` | GET | tabla excluida | **diferencia esperada:** en producción daría `[]`; en staging la tabla no existe (4xx) | solo si devolviera filas |
| A-info | `/rest/v1/` y `/rest/v1/rpc/rls_auto_enable` | GET/POST | esquema expuesto y función | **sin PASS/FAIL**: se registra lo observado (no hay medición en producción) | — |

### B) Con escritura de datos ficticios (anon key, solo filas marcadas, relectura por service_role al final)
| ID | Endpoint | Método | Intenta | Esperado (DER) | Sería una diferencia |
|---|---|---|---|---|---|
| B1 | `usuarios` | POST | crear `rol=cliente` | 201 (`anon_insert_usuarios_no_admin`) | rechazado |
| B2 | `usuarios` | POST | crear `rol=admin` | **rechazado**, 403 / `42501` (WITH CHECK) | se crea |
| B3 | `usuarios` | POST | crear `rol=chofer` | 201 | rechazado |
| B4 | `usuarios` (fila B1) | PATCH | `rol=admin`, `estado_aprobacion`, `password` | 200/204 y la fila **cambia** (`anon_update_usuarios_permisivo`) | rechazado o sin cambio |
| B5 | `usuarios` (fila B1) | DELETE | borrarla | 0 filas afectadas; la fila sigue (sin policy DELETE) | se borra |
| B6 | `vehiculos`, `documentacion_chofer` | POST | crear | **rechazado** (sin policy INSERT) | se crea |
| B7 | `vehiculos`, `documentacion_chofer` | PATCH / DELETE | modificar o borrar | 0 filas | cambia |
| B8 | `paradas_viaje` (carga 101) | POST | crear | 201 | rechazado |
| B9 | `paradas_viaje` (fila B8) | PATCH / DELETE | actualizar / borrar | PATCH cambia; DELETE 0 filas | al revés |
| B10 | `viaje_evidencias` (carga 101) | POST | crear | 201 (rol `public`) | rechazado |
| B11 | `viaje_evidencias` (fila B10) | PATCH / DELETE | modificar / borrar | 0 filas | cambia |
| B12 | `cargas`, `mensajes_viaje`, `billetera_chofer`, `consentimientos_legales`, `tarifas_config` | POST | crear | **rechazado**, 403 / `42501` | se crea |
| B13 | esas mismas 5 | PATCH / DELETE | modificar filas del seed | 0 filas y **sin cambios** (relectura con service_role) | alguna cambia |
| B14 | Storage `vehiculos` y `documentacion-choferes` | POST | subir un archivo pequeño marcado, incluso de tipo no imagen | permitido (sin límite de MIME) | rechazado |
| B15 | Storage (mismo objeto) | PUT / upsert | reemplazarlo | permitido (policy UPDATE) | rechazado |
| B16 | Storage (mismo objeto) | DELETE | borrarlo | **rechazado o sin efecto** (sin policy DELETE) | se borra |

No se puede probar por API: `TRUNCATE` (PostgREST no lo expone); queda cubierto solo por la comparación estructural de grants. Limpieza de V3-B: borrar por marcador con service_role (Storage por API).

## FASE 5 — Realtime (`scripts/staging/smoke/realtime.mjs`)
**Hipótesis actual (NO comprobada):** `supabase_realtime` publica `cargas` y `mensajes_viaje`; ambas tienen RLS sin policies para anon; `usuarios` y `paradas_viaje` no están publicadas; **no se sabe** si `postgres_changes` llega o no a anon. No se afirma el resultado antes de medirlo.
| Aspecto (script ORIGINAL, previo al elemento 3) | Detalle |
|---|---|
| Tablas que suscribe | `cargas` (todos los eventos), `mensajes_viaje` (INSERT), `usuarios` (UPDATE), `paradas_viaje` (todos) |
| Eventos que genera | INSERT en `cargas` (publicar), UPDATE en `cargas` (aceptar y GPS), INSERT en `mensajes_viaje` (chat), UPDATE en `usuarios` (`ultima_senal_at`, vía REST) |
| Requisito | la app corriendo (`--base=<URL>`); usa `cliente1` y `chofer2` del seed |
| Timeouts | 8 s por suscripción y 8 s por acción (`--espera`); ~45 s en total |
| Salida | `LLEGÓ` / `NO LLEGÓ` por acción + resumen JSON; **siempre exit 0**, sin PASS/FAIL |
| Limpieza actual | ninguna: deja una carga `detalles='smoke realtime'`, un mensaje `smoke realtime`, la carga aceptada por `chofer2`, GPS y `ultima_senal_at` cambiados |

**Actualización 21/09/2026 — elemento 3 (✔ preparado y validado localmente, 53/53; NO ejecutado contra staging real):** `realtime.mjs` fue reescrito. Acciones R1–R6 (incluye el DELETE de una carga ficticia marcada), **control positivo obligatorio** con service_role, R5 (latido) por el cliente `supabase-js` anon en lugar de `fetch` con Bearer, limpieza específica por marcador `REALTIME-MARCADOR-<runId>`, tiempos centralizados y exit 0/1/2/3 con clasificación PASS/FAIL/INCONCLUSO. La tabla anterior describe el script original.

**Interpretación (con control positivo obligatorio — elemento nuevo 3):**
- **Control positivo:** un segundo suscriptor con service_role (ignora RLS) en las mismas tablas; debe recibir los eventos de `cargas` y `mensajes_viaje`. Si ni ese los recibe, la prueba está rota y **no se concluye nada**.
- **R-A (hipótesis confirmada):** control OK y anon recibe 0 eventos de las 5 acciones.
- **R-B (hipótesis refutada):** control OK y anon recibe algún evento. **Hallazgo de seguridad:** el payload podría exponer filas por Realtime; estudiarlo antes de endurecer RLS.
- **R-C (inconcluso):** alguna suscripción no llega a `SUBSCRIBED` o el control falla. Primer sospechoso: la infraestructura de `realtime.messages` que falta en staging (diferencia gestionada, causa sin verificar). No cuenta como evidencia.
- **Ampliación recomendada:** prueba del evento **DELETE** (`panel-chofer` se suscribe a DELETE de `cargas` sin filtro y los DELETE no pasan por RLS): crear y borrar una carga marcada con la ruta de admin. **Implementada en el elemento 3 (R6)**, preparada y validada localmente (no ejecutada).
- **Límite:** no se mide producción. Lo medido es lo que haría producción **si** tiene la misma configuración y la misma versión de Realtime.
- **Limpieza:** limpieza específica de `realtime.mjs` por marcador `REALTIME-MARCADOR-<runId>` (elemento 3) y limpieza general con `limpiar-pruebas.mjs` (elemento 4; preparado y validado localmente, no ejecutado). Los restos de la versión ORIGINAL (`detalles='smoke realtime'`, `mensaje='smoke realtime'`) no llevan runId y no se limpian automáticamente. Reseed si hace falta.

## FASE 7 — Smoke tests contra staging real (`flujos.mjs`, `simular-gps.mjs`)
**Requisito:** `levantar-staging.mjs` (elemento 2: ✔ preparado y validado localmente, 76/76; **no ejecutado**: sin build real, sin Next, sin puertos), modelado sobre `levantar-entorno.mjs`: un build con variables de staging + 3 instancias `next start` — legacy `127.0.0.1:3131`, dual `127.0.0.2:3132`, strict `127.0.0.3:3133` (hosts loopback distintos = cookies separadas; nunca `0.0.0.0`), todas contra la **misma** base de staging.
**`flujos.mjs` (38 verificaciones por modo; la corrida previa sobre el simulador dio 152 en 4 instancias):**
| Área | Qué verifica |
|---|---|
| Cliente | login, publicar (precio calculado en servidor), historial, seguimiento de la carga 103, chat, 403 al escribir en un viaje ajeno |
| Ofertas | `disponibles` incluye la oferta nueva |
| Aceptación | carrera de 2 choferes: exactamente uno gana (200) y el otro 409 |
| Viaje activo y estados | consulta del viaje, 422 ante salto inválido, secuencia hasta `Viaje finalizado` |
| GPS y evidencias | evidencia `chofer_en_camino`, PATCH de GPS visible para el cliente |
| Chat | chofer, cliente y admin (incluido soporte) |
| Finalización y billetera | `acreditar` y su idempotencia, billetera e historial del chofer |
| Admin | usuarios sin password, cargas, resumen de chat, 403 a un cliente en `/api/admin/cargas` |
| Auth por modo | solo cookie, solo `x-user-id`, ambas o ninguna |
- **Pagos:** solo el crédito interno de billetera. **Sin pasarela real:** con el token placeholder, `crear-preferencia` y el webhook fallan de forma segura y no se invocan. Una prueba con sandbox `TEST-…` sería aparte y opcional. Extensión opcional: dos `acreditar` en paralelo, para documentar que la base no impide el doble crédito (no hay UNIQUE), igual que producción.
- **Sin mezclar legacy/dual/strict:** (1) un modo por corrida (`--modos=<solo ese>`); (2) antes de cada corrida, limpieza + reseed (`--reset --aplicar`); (3) cada corrida a su propio log **fuera del repo**; (4) `flujos.mjs` ya imprime `[modo]` por línea y totales por modo; (5) `simular-gps.mjs --base=<URL del modo>` por separado (21 puntos por defecto; propuesto `--pasos=6 --intervalo=500`); (6) recién después, el modo siguiente.

## FASE 8 — Criterios de aprobación: «STAGING FUNCIONALMENTE EQUIVALENTE A PRODUCCIÓN»
| ID | Criterio | PASS si |
|---|---|---|
| C0 | Entorno y guardas | G1–G7 PASS; ningún valor apunta a producción |
| **C0b** | **Ajustes de Data API, Realtime y Storage** | **comparados a mano entre paneles y registrados como iguales — ✔ PASS (21/09/2026, Anexo A; diferencia esperada: 14 vs 10 tablas por las `backup_*`)** |
| C1 | Estructura (V2, V2b) | ya **PASS** |
| C2 | Seed ficticio | conteos 6/3/26/7/5/8/2/3/15 + 25 objetos de Storage; todos los emails `@tila-staging.invalid` |
| C3 | V3-A (solo lectura) | A1–A15 conforme a lo esperado |
| C4 | V3-B (escrituras) | B1–B16 conforme a lo esperado; datos de prueba limpiados |
| C5 | Realtime | control positivo OK **y** resultado clasificado R-A o R-B. **R-C bloquea el veredicto.** |
| C6 | Smoke por modo | 38/38 en cada modo (legacy, dual, strict) y GPS 100 % en los 3 |
| C7 | Sin contaminación | ningún comando tocó producción; solo el host de staging en los logs |
| C8 | Restauración | tras la limpieza, las tablas coinciden con el seed; instancias detenidas |
**Veredicto si todo es PASS:** «Staging es funcionalmente equivalente a producción **en las pruebas definidas**; producción no fue probada en escrituras». R-B no cambia la equivalencia pero abre una revisión de seguridad separada.
**Si algo da FAIL:** me detengo, no corrijo nada, informo (qué falló · esperado en producción · observado en staging · posible causa · impacto) y decide el usuario.
**Paradas inmediatas:** una guarda que aborta inesperadamente · un host que no sea el de staging en cualquier log · filas con emails que no sean `.invalid` · una clave visible en un log.

---
## Anexo A — Comparación manual PRODUCCIÓN vs STAGING (solo mirar y anotar) — ✔ COMPLETA · PASS (21/09/2026)
**Resultado registrado (hecho por el usuario en los paneles; no se cambió ningún valor; sin claves):** Data API **PASS**, Realtime **PASS**, Storage **PASS**. Tabla completa más abajo. El checklist original queda como referencia del procedimiento.
**Regla:** NO cambiar ningún valor. Si un botón «Save» / «Update» / «Apply» se activa, no lo toques. Salí sin guardar.
**Cuidado:** la pantalla de API puede mostrar claves. No las copies ni las incluyas en capturas.
**Cómo:** una pestaña por vez. Mirá **producción** (completá la columna «Prod»), cerrá esa pestaña, y recién entonces abrí **staging** (columna «Staging»). Los nombres de los menús pueden variar un poco: si algo no está, anotá «no lo encontré» y seguí.

| # | Ajuste | Dónde mirar | Producción | Staging | ¿Igual? |
|---|---|---|---|---|---|
| 1 | ¿Data API habilitada? | Project Settings → API / Integrations → Data API | integración Data API **INSTALLED**; se accedió a sus Settings. No se observó un interruptor independiente de «Data API enabled» | idem | ✔ (Data API instalada/activa en ambos) |
| 2 | Exposed schemas | misma pantalla | 2/2 | 2/2 | ✔ |
| 2b | Exposed functions | misma pantalla | 2/2 | 2/2 | ✔ |
| 2c | Automatically expose new tables | misma pantalla | ON | ON | ✔ |
| 3 | Extra search path | misma pantalla | public, extensions | public, extensions | ✔ |
| 4 | Max rows | misma pantalla | 1000 | 1000 | ✔ |
| 4b | Pool size (Data API) | misma pantalla | automático | automático | ✔ |
| 4c | Tablas expuestas | misma pantalla | 14/14 | 10/10 | ≠ **ESPERADA**: producción tiene 4 tablas `backup_*` que en staging se excluyen a propósito |
| 5 | Realtime: enable Realtime service | Realtime → Settings | ON | ON | ✔ |
| 5b | Realtime: allow public access to channels | misma pantalla | ON | ON | ✔ |
| 6 | Realtime: máximo de clientes concurrentes | misma pantalla | 200 | 200 | ✔ |
| 7 | Realtime: máximo de eventos por segundo | misma pantalla | 100 | 100 | ✔ |
| 8 | Realtime: otros límites | misma pantalla | database connection pool 2 · Postgres Changes pool 2 · presence events/s 20 · payload máx. 256 KB | iguales | ✔ |
| 9 | Storage: Global file size limit | Storage → Settings | 50 MB | 50 MB | ✔ |
| 9b | Storage: Image transformation | misma pantalla | OFF | OFF | ✔ |

**Conclusión (21/09/2026): comparación manual de Data API / Realtime / Storage ✔ COMPLETA y PASS.** Data API instalada/activa en ambos proyectos; no se observó un interruptor independiente de habilitación. Único desvío: 14 tablas expuestas en producción vs 10 en staging, esperado por las 4 `backup_*` excluidas (decisión documentada). Con esto el criterio **C0b** queda **PASS** (§9). Los valores de Realtime se registraron una sola vez como iguales en ambos proyectos (resultado PASS informado por el usuario). Alcance: son ajustes de panel; **no** prueban el comportamiento (eso sigue siendo V3 / `realtime.mjs` / smoke tests, todavía no ejecutados).
