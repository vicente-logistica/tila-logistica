# Migración de seguridad compatible — diseño, cambios implementados y rollback

Regla: **más seguro + mismas funciones + mismo comportamiento.** Nuevo sistema primero, validación después, sistema viejo se retira al final.
Restore point: `C:\Users\Martin\Documents\logistica-app-RESTORE-2026-09-18\` (ver su `RESTORE.md`).

---
## 1. Cambios implementados localmente (nada desplegado, nada tocó Supabase/producción)

| # | Archivo | Tipo | Qué hace | Efecto con la config actual |
|---|---|---|---|---|
| 1 | `app/lib/auth/sesion.ts` | NUEVO | Sesión firmada HMAC-SHA256 (sin dependencias nuevas) + `resolverUsuario(req)` con modos `legacy`/`dual`/`strict` | Ninguno: no lo usa nadie salvo los 2 archivos de abajo |
| 2 | `app/lib/auth/sesion.test.mjs` | NUEVO | 28 tests (firma, expiración, manipulación, modos, CSRF/origen, cookies) | — |
| 3 | `app/api/auth/login/route.ts` | MODIFICADO (+11 líneas) | Si existe `TILA_SESSION_SECRET`, agrega `Set-Cookie: tila_sesion` (HttpOnly, SameSite=Lax, Secure en https). El cuerpo de la respuesta es idéntico | **Ninguno** mientras la variable no exista |
| 4 | `app/api/chofer/billetera/route.ts` | MODIFICADO (2 líneas) | Ruta **piloto** (GET, solo lectura): `req.headers.get("x-user-id")` → `resolverUsuario(req).userId` | **Ninguno** en modo `legacy` (defecto): devuelve exactamente el mismo valor |
| 5 | `package.json` | MODIFICADO (+1 línea) | Script `"test"` (usa `node --test`) | Ninguno |
| 6 | `scripts/verificar-modos-auth.mjs` | NUEVO | Prueba en un servidor real los 3 modos sobre las rutas migradas | — |
| 7 | `docs/seguridad/*` | NUEVO | Estos documentos | — |
| 8 | `scripts/validacion-local/` (`mock-supabase.mjs`, `levantar-entorno.mjs`, `pruebas-http.mjs`) | NUEVO | Entorno de validación 100 % local: Supabase simulado con usuarios inventados + app en modos legacy/dual/strict + matriz de pruebas HTTP. **No se conecta a producción.** | — |

Variables de entorno **nuevas y opcionales** (no se definieron en ningún lado): `TILA_SESSION_SECRET` (≥ 32 caracteres), `TILA_AUTH_MODE` (`legacy` por defecto | `dual` | `strict`).

### Cómo se mantiene idéntico el comportamiento
- En `legacy`, `resolverUsuario` **no lee cookies ni Bearer**; devuelve el header crudo (`""` → `null`, igual que el `if (!userId)` de hoy). Cubierto por 4 tests.
- Mensajes y códigos de error de la ruta piloto no cambian.

---
## 2. Resultados de la verificación (comparados con el baseline)

| Chequeo | Baseline | Después |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 |
| `npm run build` | exit 0 · 56 rutas | exit 0 · 56 rutas |
| ESLint (`app scripts …`) | 212 errores / 44 warnings | **212 / 44** (0 issues en los archivos nuevos) |
| Tests existentes | no había | 28/28 (nuevos) |
| Contrato de auth de 35 rutas (111 casos, servidor real) | `BASELINE/smoke-baseline.json` | **idéntico**, byte a byte |
| Modos legacy/dual/strict en ruta piloto (18 casos) | — | 18/18 según lo diseñado |

No verificado (requiere credenciales reales): que el login realmente emita la cookie de punta a punta (hay tests de las piezas y el código es de 5 líneas), y los flujos de UI con usuarios reales.

---
## 3. Diseño de la migración de autenticación (R1)

| Etapa | Qué se hace | Riesgo de romper | Estado |
|---|---|---|---|
| **E1** | Módulo de sesión + tests; el login emite cookie si hay secreto | Nulo (inerte) | ✅ hecho local |
| **E2** | Migrar las 34 rutas restantes al resolver **de a 4-5 por lote**, orden: lecturas GET → chat → cargas → chofer → admin → pagos/billetera. Cada lote: build + tsc + `smoke-contrato-auth` + `verificar-modos-auth` | Muy bajo (modo `legacy`) | Lote 1 hecho local (3 rutas) + piloto + 3 de registro |
| **E3** | El alta de cliente emite cookie; el alta de chofer emite sesión de alcance `registro` (1 h) aceptada solo por `chofer/documentacion` y los endpoints de subida. Nueva `POST /api/auth/logout` (borra cookie) conectada en `utils/salirApp.ts` | Bajo | ✅ hecho local |
| **E4** | Deploy con `TILA_SESSION_SECRET` y `TILA_AUTH_MODE=legacy`; verificar que el login sigue igual y que aparece la cookie. Luego `TILA_AUTH_MODE=dual`: el header sigue valiendo; los logs `[auth-migracion]` muestran cuántas requests dependen aún solo del header | Bajo | pendiente |
| **E5** | Frontend: manejo global de 401 ("Tu sesión venció, ingresá de nuevo") y sonda de sesión al abrir la app. Es la **única** modificación visible, y solo aparece si la sesión falta | Medio | pendiente |
| **E6** | `TILA_AUTH_MODE=strict` (los usuarios ya logueados sin cookie deben iniciar sesión **una vez**). Rollback: volver a `dual` y redeploy (~1 min) | Medio | pendiente |
| **E7** | Retirar la rama `legacy-header` del código (recién cuando `strict` lleve semanas estable) | — | pendiente |

Decisiones y por qué:
- **Cookie HttpOnly firmada** (no Supabase Auth): las contraseñas y usuarios viven en una tabla propia; migrarlos a Supabase Auth es un cambio grande e irreversible. La cookie no requiere tocar los 57 puntos del frontend que arman headers: el navegador la envía sola.
- **`dual` deja mandar al header**: es lo que garantiza compatibilidad. No hay ganancia de seguridad hasta `strict`; la ganancia de `dual` es medir.
- **`strict` sin secreto falla cerrado** (401), nunca abierto.
- **CSRF**: `SameSite=Lax` + verificación de `Origin` en métodos que mutan cuando la sesión llega por cookie.
- **Vencimiento 90 días** (hoy no vencen). Configurable en código.
- **Sesión "registro"** resuelve el alta de chofer (sube documentos antes de poder loguearse).

---
## 4. Diseño de la migración R2/R5 (lecturas/escrituras directas a Supabase)

Principio: **crear la API equivalente → migrar UNA pantalla → verificar idéntica → repetir → recién entonces cerrar RLS.**

Orden propuesto (de menor a mayor riesgo):
1. **Admin, solo lectura** (usuarios = admin, sin flujo crítico): evidencias (`viaje_evidencias`), documentos (`documentacion_chofer`), paradas y batería de choferes → ampliar `api/admin/*` (ya existe `admin/cargas` y `admin/usuarios`).
2. **Cliente, solo lectura**: paradas, datos del chofer asignado y vehículo → una API `GET` con la misma forma de datos que hoy consume la pantalla.
3. **Chofer, lectura**: paradas de la oferta, estado online/docs, vehículo.
4. **Escrituras**, cada una con su endpoint, conservando el momento en que hoy se ejecutan:
   - presencia (`online`, `navegador_preferido`, batería) → `PATCH /api/chofer/presencia`;
   - el `update` de `usuarios` **por cada fix GPS** (viaje-activo:689) se puede absorber en `/api/cargas/gps` (ya autenticada) y eliminar 1 request/s por chofer;
   - `paradas_viaje` INSERT → dentro de `cargas/publicar` (además elimina el caso "viaje creado sin paradas" si el insert falla);
   - `paradas_viaje` UPDATE (parada completada) → `POST /api/cargas/parada-completada`.
5. **Realtime**: se deja para el final (ver riesgos); solo se usa como disparador de re-fetch.

### Paso de Supabase que NO requiere tocar el frontend (proponerlo más adelante, primero en staging)
Como el frontend usa un conjunto cerrado de columnas de `usuarios` (ver mapa), se puede reemplazar el acceso amplio por **privilegios por columna** para `anon`:
- `SELECT` solo sobre: `id, nombre, telefono, vehiculo, online, bateria_nivel, bateria_cargando, ultima_senal_at, vehiculo_activo_id, navegador_preferido, categoria_legal`;
- `UPDATE` solo sobre: `online, navegador_preferido, bateria_nivel, bateria_cargando, ultima_senal_at`.
Eso cierra la fuga de `password`, DNI, CUIT, CBU y la escalada de `rol`, **sin cambiar una línea de frontend**. Riesgo a probar antes: Realtime sobre `usuarios` (el panel admin se suscribe) puede requerir SELECT de tabla completa; y el admin/otros consumidores deben seguir andando.

---
## 5. Diseño de la migración de Storage (R4)

1. **Endpoint de URLs firmadas** `POST /api/storage/firmar`: recibe URLs guardadas (formato público actual), deriva bucket/ruta, verifica permiso (admin, o el chofer dueño) y devuelve URL firmada de vida corta. Funciona también con el bucket público (se puede probar sin privatizar).
2. **Compatibilidad del frontend**: solo el panel admin *muestra* archivos (4 puntos en `admin/page.tsx`); con un helper que usa la URL firmada y, si falla, cae a la URL original. El resto usa la URL solo como indicador "subido": no cambia nada.
3. **Subida**: endpoint que entrega una URL de subida firmada tras validar propiedad (`{choferId}/…` o `evidencias/{viaje}/…` de un viaje del chofer) y reemplaza el `upload` con anon key de `lib/vehiculos.ts` y `viaje-activo`. El valor guardado en BD sigue siendo la URL de formato público (los validadores `urlPertenecaAlChofer` no cambian).
4. **Probar** visualización de docs y subida de documentación/evidencias en local.
5. **Recién al final**: buckets privados + retirar las políticas de INSERT/UPDATE anon de Storage.
Rollback de este paso: volver a marcar el bucket como público (instantáneo).

---
## 6. Consultas de diagnóstico de SOLO LECTURA para ejecutar en el SQL Editor de Supabase
(No modifican nada. Sirven para documentar el estado real de RLS/permisos que no se puede ver con la anon key.)

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2;
select table_name, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon' order by 1, 2;
select table_name, column_name, privilege_type from information_schema.column_privileges
  where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE') order by 1, 2;
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects';
select id, name, public from storage.buckets;
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.billetera_chofer'::regclass;
select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('billetera_chofer','cargas','mensajes_viaje');
select pubname, schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

---
## 7. Qué cambio futuro podría romper algo (y con qué)

| Cambio | Puede romper | Mitigación |
|---|---|---|
| `strict` en producción | Usuarios ya logueados sin cookie (401); alta de chofer (necesita sesión `registro`); registro de cliente (auto-login); cookies separadas en el navegador de Mercado Pago/`SFSafariViewController` | E3 antes de E6; E5; probar el retorno de MP en Android |
| Cambiar variables de entorno en Vercel | Requiere **redeploy** para aplicarse | Preparar `dual` como estado de vuelta |
| Privilegios por columna en `usuarios` | Realtime de `usuarios` en admin; cualquier `select("*")` nuevo | Probar en staging; el frontend actual no usa `*` |
| RLS más estricto en `paradas_viaje`/`viaje_evidencias` | Todas las pantallas que hoy leen directo | Solo después de migrar las lecturas (§4) |
| Buckets privados | Vistas de documentos en admin; validadores que exigen `/public/` en la URL | Mantener el formato guardado; firmar al mostrar |
| Aplicar `supabase/migrations/20260725_documentos_legales…sql` | **Rompe el registro**: agrega `decision NOT NULL` y `lib/consentimiento.ts` no la envía | Alinear código y migración antes de aplicarla |
| Actualizar Next a 16.3.5 | Convención `proxy`/middleware; cambios de comportamiento | Lote aparte, con este mismo baseline |

---
## 8. Rollback exacto

**Nada de esto está commiteado ni desplegado; el rollback es local.**

Archivos MODIFICADOS por esta etapa: `package.json`, `app/api/auth/login/route.ts`, `app/api/chofer/billetera/route.ts`.
Comandos exactos (Git Bash, desde la raíz del repo):
```bash
RP=/c/Users/Martin/Documents/logistica-app-RESTORE-2026-09-18/working-tree
cp $RP/package.json                              package.json
cp $RP/app/api/auth/login/route.ts               app/api/auth/login/route.ts
cp $RP/app/api/chofer/billetera/route.ts         app/api/chofer/billetera/route.ts
# archivos NUEVOS (no existían antes): borrarlos
rm -r app/lib/auth scripts/verificar-modos-auth.mjs scripts/validacion-local docs/seguridad
# verificación: todo debe coincidir con el manifest original
cd $RP && sha256sum -c ../git-metadata/sha256-manifest.txt | grep -v ': OK$'   # sin salida = idéntico
```
Rollback lógico en producción (cuando exista): `TILA_AUTH_MODE=legacy` (o borrar la variable) + redeploy → vuelve el comportamiento actual al 100 %; la cookie emitida queda inerte.


---
## 9. E3 implementado (logout + altas + sesión limitada) — solo local

| Archivo | Cambio |
|---|---|
| `app/api/auth/logout/route.ts` | NUEVO. `POST` que borra `tila_sesion` (mismos atributos que la emitida; `Max-Age=0` + `Expires` pasado). Sin auth, sin BD, respuesta idéntica exista o no la cookie. |
| `app/lib/auth/sesion.ts` | +helpers `setCookieSesion`, `setCookieBorrarSesion`, `TTL_SESION_REGISTRO_SEG` (30 min); `Expires` en la cookie de borrado. |
| `app/api/usuarios/registro-cliente/route.ts` | Emite cookie de sesión COMPLETA si hay secreto. Respuesta sin cambios. |
| `app/api/usuarios/registro-chofer-usuario/route.ts` | Emite cookie de sesión LIMITADA (alcance `registro`, 30 min) si hay secreto. Respuesta sin cambios. |
| `app/api/chofer/documentacion`, `app/api/chofer/vehiculos` (POST), `app/api/chofer/vehiculos/[id]/docs` | **Únicas 3 rutas** (además de la piloto) que pasan por el resolver, con `permitirAlcanceRegistro: true`: son las que llama el registro de chofer. En `legacy` devuelven exactamente lo mismo. |
| `app/utils/salirApp.ts` | +`cerrarSesionEnServidor()` (POST logout, timeout 2 s, nunca lanza) llamada desde `cerrarSesionYSalir()`. |
| `app/billetera-chofer/page.tsx` | Su botón propio de logout también llama `cerrarSesionEnServidor()` (era un segundo camino de logout). |
| `app/lib/auth/sesion-e3.test.mjs` | 25 tests nuevos. |
| `scripts/validacion-local/*` | Entorno aislado (mock de Supabase con Storage) + `pruebas-e3-http.mjs` (45 pruebas). |

### Rollback exacto de E3 (Git Bash, raíz del repo)
```bash
RP=/c/Users/Martin/Documents/logistica-app-RESTORE-2026-09-18/working-tree
# restaurar los archivos existentes que E3 tocó (el restore point tiene su versión previa, incluido tu WIP en salirApp.ts)
for f in app/api/usuarios/registro-cliente/route.ts app/api/usuarios/registro-chofer-usuario/route.ts          app/api/chofer/documentacion/route.ts app/api/chofer/vehiculos/route.ts "app/api/chofer/vehiculos/[id]/docs/route.ts"          app/utils/salirApp.ts app/billetera-chofer/page.tsx; do cp "$RP/$f" "$f"; done
rm -r app/api/auth/logout app/lib/auth/sesion-e3.test.mjs scripts/validacion-local/pruebas-e3-http.mjs
# (sesion.ts vuelve al estado de la etapa anterior quitando los 2 helpers y Expires; si se revierte TODO: ver sección 8)
```


---
## 10. E2 — Lote 1 (3 rutas de solo lectura) — solo local

Rutas migradas al resolver (solo la obtención de identidad; roles, códigos HTTP, JSON y consultas intactos):
`GET /api/cargas/historial-cliente`, `GET /api/cargas/historial-chofer`, `GET /api/chat/resumen-admin` (+2 −1 líneas cada una).

Verificación: `scripts/validacion-local/lote1.mjs` (66 pruebas por ruta/modo) comparada contra un **golden master** capturado con el código previo:
`BASELINE/lote1-golden.json` (en la carpeta del restore point).

### Rollback exacto del Lote 1 (byte a byte, desde el restore point)
```bash
RP=/c/Users/Martin/Documents/logistica-app-RESTORE-2026-09-18/working-tree
for f in app/api/cargas/historial-cliente/route.ts app/api/cargas/historial-chofer/route.ts app/api/chat/resumen-admin/route.ts; do
  cp "$RP/$f" "$f"
done
rm scripts/validacion-local/lote1.mjs
```
Nota: estos 3 archivos usan fin de línea CRLF (y `resumen-admin` tiene un carácter corrupto preexistente en un comentario). No revertir con `sed`: normaliza los saltos de línea. Copiar desde el restore point es exacto.


---
## 11. E2 — Lote 2 (1 ruta) — solo local

Evaluadas: `chat/no-leidos`, `chat/mensajes`, `cargas/activa`, `cargas/disponibles`, `admin/usuarios`.
- **Migrada**: `GET /api/admin/usuarios` (+2 −1). Solo la pantalla admin la consume; sin efectos secundarios; columnas, filtros, orden y permisos intactos.
- **Descartadas**: `activa`/`disponibles` (excluidas por instrucción: núcleo operativo del chofer); `no-leidos` (usada por viaje-activo junto al GPS, disparada por Realtime, con log DIAG_FASE2B); `mensajes` (canal Realtime + polling 3 s; decide sonidos/alertas en panel-cliente).
- Verificación: `scripts/validacion-local/lote2.mjs` (34 pruebas) contra `BASELINE/lote2-golden.json` (código previo).

### Rollback exacto del Lote 2 (byte a byte)
```bash
RP=/c/Users/Martin/Documents/logistica-app-RESTORE-2026-09-18/working-tree
cp "$RP/app/api/admin/usuarios/route.ts" app/api/admin/usuarios/route.ts
rm scripts/validacion-local/lote2.mjs
```
