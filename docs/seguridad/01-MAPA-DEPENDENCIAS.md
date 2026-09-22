# Mapa de dependencias — qué rompería cada cambio de seguridad

Generado leyendo el código de la rama `diag-nav-temporal` (commit 76f9ae5 + cambios locales). Solo lectura.
Líneas aproximadas: pueden moverse unas pocas líneas si el archivo cambia.

---
## R1 — Autenticación (`x-user-id`, `localStorage`, `useProtegerRuta`)

### Servidor: 35 de 40 rutas API leen `x-user-id`
Inventario exacto: `logistica-app-RESTORE-2026-09-18/BASELINE/endpoints.txt` (regenerable con `inventario-endpoints.mjs`).
Todas tienen el mismo patrón: `const userId = req.headers.get("x-user-id")` → `if (!userId) 401` → lookup en `usuarios` (service_role) → chequeo de rol/propiedad.

| Grupo | Rutas | Roles |
|---|---|---|
| admin (8) | `admin/billetera` GET/DELETE, `admin/cargas` GET/DELETE, `admin/cargas/estado`, `admin/cargas/ocultar`, `admin/reset-password`, `admin/usuarios` GET, `admin/usuarios/[id]`, `admin/usuarios/[id]/estado` | admin |
| cargas (12) | `publicar`, `republicar`, `cancelar-cliente`, `historial-cliente`, `aceptar`, `activa`, `cancelar-chofer`, `disponibles`, `historial-chofer`, `estado`, `evidencia`, `gps`, `ocultar-historial` | cliente / chofer (`estado` también admin; `ocultar-historial` ambos) |
| chat (6) | `mensaje`, `mensajes`, `mensajes-viaje` DELETE, `marcar-leidos`, `no-leidos`, `resumen-admin` | cliente / chofer / admin según canal |
| chofer (6) | `billetera` GET, `billetera/acreditar`, `documentacion`, `vehiculos`, `vehiculos/[id]`, `vehiculos/[id]/activo`, `vehiculos/[id]/docs` | chofer |
| pagos (1) | `mercadopago/crear-preferencia` | cliente |

Sin header (no cambian con R1): `auth/login`, `usuarios/registro-cliente`, `usuarios/registro-chofer-usuario`, `mercadopago/webhook` (firma MP), `distancia` (sin auth: hallazgo aparte).

Comportamiento distinto al "401 genérico" que hay que **preservar** (medido en el baseline, 111 casos):
`admin/usuarios*`, `admin/reset-password`, `cargas/evidencia`, `chofer/documentacion`, `chofer/vehiculos` (POST) responden **403** ante usuario inexistente; `chofer/vehiculos/[id]*` responden **404** (buscan el vehículo antes de autenticar).

### Frontend: 57 líneas que construyen `x-user-id` en 14 archivos
`admin/page.tsx` 16 · `viaje-activo/page.tsx` 8 · `panel-cliente/page.tsx` 7 · `panel-chofer/page.tsx` 5 · `GestionVehiculosChofer.tsx` 5 · `hooks/useChatRealtime.ts` 4 · `registro-chofer/page.tsx` 3 · `historial-cliente.tsx` 2 · `historial-chofer.tsx` 2 · `publicar/page.tsx` 1 · `lib/vehiculos.ts` 1 · `lib/evidencias.ts` 1 · `SubirDocumentacion.tsx` (código muerto) 1 · `billetera-chofer/page.tsx` 1.
Se arma siempre desde `JSON.parse(localStorage.getItem("usuario")).id` (o del prop `choferId`/`usuarioId`).

### `localStorage["usuario"]` — 16 archivos
- **Escriben**: `login/page.tsx:32` (login), `registro-cliente/page.tsx:44` (**auto-login tras registro**), `panel-chofer/page.tsx:274` y `GestionVehiculosChofer.tsx:83,127` (actualizan datos cacheados del chofer).
- **Borra**: `utils/salirApp.ts:38` (logout; lo usan `BotonCerrarSesion` y `SalirAppModal`).
- **Leen** (id/rol): admin 12, panel-chofer 11, viaje-activo 4, GestionVehiculos 4, historial-* 2+2, publicar, panel-cliente, billetera-chofer, `CapacitorBackHandler`, `AppUrlOpenHandler` (decide si el retorno de Mercado Pago vuelve al panel).
- Otras claves: `viajeActivoId` (15 usos), `tila_mp_checkout_activo` (7).

### `useProtegerRuta` — guarda 100 % cliente
Usado en 6 páginas: `admin`, `billetera-chofer`, `panel-chofer`, `panel-cliente`, `publicar`, `viaje-activo`. Lee el rol de `localStorage`; **no valida nada contra el servidor**. Seguirá funcionando igual mientras `usuario` exista en `localStorage`.

### Flujos con requisitos especiales
1. **Registro cliente** = login implícito (guarda `usuario`). El alta debe emitir cookie o el cliente quedaría sin sesión en modo estricto.
2. **Registro chofer**: sube documentos con `choferIdNuevo` **antes de poder loguearse** (la cuenta queda "pendiente de aprobación" y el login la rechaza). Necesita una sesión de **alcance limitado ("registro")** emitida por el alta. Ya soportado en `sesion.ts` (`alcance: "registro"` + `permitirAlcanceRegistro`).
3. **Mercado Pago en Android/iOS** abre el checkout en `@capacitor/browser` (otro contexto de cookies/localStorage). El retorno depende de `AppUrlOpenHandler`. No debe alterarse.
4. **WebView Capacitor** carga `https://tila-logistica.vercel.app` (`server.url`): mismo origen → las cookies HttpOnly funcionan; `fetch` same-origin las envía sola.
5. **Sesiones existentes**: hoy nunca vencen y no tienen cookie. En modo estricto habrá **un re-login único**. Es el único cambio visible previsto y es inevitable (emitir una sesión sin contraseña reintroduciría la vulnerabilidad).

---
## R2 / R5 — Lecturas y escrituras directas a Supabase desde el navegador (anon key)

### Lecturas (`select`)
| Archivo:línea | Tabla | Columnas | Flujo |
|---|---|---|---|
| admin/page.tsx:369, 1520 | documentacion_chofer | tipo, url | Admin revisa documentos del chofer |
| admin/page.tsx:539, 864 | viaje_evidencias | `*` | Admin ve evidencias (fotos, lat/lng, nombres) |
| admin/page.tsx:1297 | paradas_viaje | `*` | Admin lista viajes |
| admin/page.tsx:1316 | usuarios | id, nombre, bateria_nivel, bateria_cargando, ultima_senal_at | Admin: batería/señal de choferes |
| panel-cliente:549 | paradas_viaje | `*` | Cliente ve ruta de sus viajes |
| panel-cliente:559 | usuarios | id, nombre, vehiculo, telefono, bateria_*, ultima_senal_at, online, vehiculo_activo_id | Cliente ve datos del chofer asignado |
| panel-cliente:568 | vehiculos | id, marca, modelo, patente, tipo_vehiculo, anio | Cliente ve vehículo del chofer |
| panel-chofer:252, 313 | usuarios | vehiculo_activo_id, categoria_legal, online, navegador_preferido | Estado online / validación |
| panel-chofer:253, 318, 689 | documentacion_chofer | tipo, url | ¿Documentación completa para ponerse online? (solo truthiness) |
| panel-chofer:269 | vehiculos | `*` (por id) | Vehículo activo |
| panel-chofer:470 | paradas_viaje | `*` | Ruta de la oferta de viaje |
| viaje-activo:451, 745 | paradas_viaje | `*` | Paradas del viaje activo |
| viaje-activo:754 | usuarios | navegador_preferido | Navegador externo |
| historial-chofer.tsx:53, 67 | paradas_viaje / usuarios | `*` / id, nombre, telefono (clientes) | Historial del chofer |
| GestionVehiculosChofer.tsx:48-50 | vehiculos / usuarios / documentacion_chofer | `*` / vehiculo_activo_id / tipo,url | Gestión de vehículos |
| historial-cliente.tsx:76, 90 · SubirDocumentacion.tsx:57 | — | — | **Componentes sin uso (código muerto)** |

**Conjunto cerrado de columnas de `usuarios` que el frontend lee:** `id, nombre, telefono, vehiculo, online, bateria_nivel, bateria_cargando, ultima_senal_at, vehiculo_activo_id, navegador_preferido, categoria_legal`. Ninguna pantalla usa `select("*")` sobre `usuarios`; **nadie necesita `password`, `email`, `dni`, `cuit_cuil`, `alias_cbu_cvu`, etc.**

### Escrituras (`insert/update/upsert`) con la anon key
| Archivo:línea | Tabla | Operación | Campos | Flujo |
|---|---|---|---|---|
| panel-chofer:331, 547 | usuarios | UPDATE | online | Botón online/offline |
| panel-chofer:639 | usuarios | UPDATE | navegador_preferido | Configuración de navegación |
| viaje-activo:324 | usuarios | UPDATE | bateria_nivel, bateria_cargando, ultima_senal_at | Heartbeat de batería |
| viaje-activo:689 | usuarios | UPDATE | ultima_senal_at, bateria_* | **En cada fix GPS (~1/s)** |
| publicar:252 | paradas_viaje | INSERT | carga_id, orden, tipo, direccion, estado | Publicar con paradas intermedias (si falla solo `console.error`) |
| viaje-activo:765 | paradas_viaje | UPDATE | estado, completada_at | Chofer marca parada completada |
| viaje-activo:955 | Storage `documentacion-choferes` | upload (upsert) | evidencias/{viaje}/… | Foto de evidencia |
| lib/vehiculos.ts:86 | Storage (`documentacion-choferes`, `vehiculos`) | upload (upsert) | {choferId}/{tipo}.{ext} | Registro y gestión de documentos |

### Realtime (lecturas por WebSocket con anon key)
`admin-realtime` (cargas, usuarios, paradas_viaje, mensajes_viaje, todos `*`), `panel-chofer-realtime` (cargas INSERT/UPDATE/DELETE **sin filtro**), `cliente-rt-{id}` (cargas por cliente_id, paradas_viaje), `cliente-mensajes-{id}` (mensajes_viaje INSERT), `viaje-activo-rt-{id}` (cargas, paradas_viaje), `viaje-activo-chat-{id}` y `chat-rt-…` (mensajes_viaje). Todos se usan como **disparadores de re-fetch**, con polling de respaldo de 4–5 s; el contenido del evento casi no se usa.

---
## R4 — Consumidores de URLs públicas de Storage

Solo el **panel admin** *muestra* archivos (`<img src>` / `<a href>`): `admin/page.tsx:372, 495-496` (docs de choferes), `698-700` y `1098-1100` (fotos de evidencia).
El resto solo usa la URL como **indicador de "documento subido"** (no la renderiza): `panel-chofer` (253, 318, 689), `GestionVehiculosChofer` (56), `lib/validacion-chofer.ts` (`cedula_verde_url`, `seguro_url`, `vtv_rto_url`), `SubirDocumentacion` (muerto).
Escritores de la URL: `lib/vehiculos.ts:103`, `viaje-activo:959` (`getPublicUrl`). Validadores server-side que dependen del **formato** `…/storage/v1/object/public/<bucket>/<dueño>/…`: `api/chofer/documentacion` (`urlPertenecaAlChofer`) y `api/chofer/vehiculos/[id]/docs`.
Buckets: `documentacion-choferes`, `vehiculos`. Datos actuales (medidos el 18/09): 24 filas en `documentacion_chofer` = 22 URLs de Storage (14 en `documentacion-choferes` + 8 en `vehiculos`) + 2 códigos `antecedentes_codigo`; 125 filas en `viaje_evidencias`.

**Consecuencia de diseño:** conviene **no cambiar el formato de URL guardado** (se sigue guardando la URL "pública" como identificador opaco) y resolverla a URL firmada solo al mostrarla. Así no se tocan validadores, ni datos existentes, ni los indicadores de "subido".
