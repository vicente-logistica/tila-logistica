# TILA Logística — BACKUP & RECOVERY PLAN
> Generado: 2026-06-12  
> Repositorio: https://github.com/vicente-logistica/tila-logistica  
> Producción (aplicación operativa — este proyecto, `logistica-app`): https://tila-logistica.vercel.app  
> Nota: la web institucional (`https://www.tilalogistica.com`) es un proyecto separado (`tila-web`) y no está cubierta por este documento.  
> Último commit: `b78575d` — panel-cliente: botón seguimiento independiente de estado y pago_estado

---

## 1. ESTRUCTURA COMPLETA DEL PROYECTO

```
logistica-app/
├── app/
│   ├── admin/
│   │   └── page.tsx                  ← Panel administrador completo
│   ├── api/
│   │   ├── distancia/
│   │   │   └── route.ts              ← Google Maps Directions API (server-side)
│   │   └── mercadopago/
│   │       ├── crear-preferencia/
│   │       │   └── route.ts          ← Crea preferencia de pago MP
│   │       └── webhook/
│   │           └── route.ts          ← Recibe notificaciones de pago MP
│   ├── billetera-chofer/
│   │   └── page.tsx                  ← Historial de cobros del chofer
│   ├── cargas/
│   │   └── page.tsx                  ← Cargas disponibles (mapa público)
│   ├── components/
│   │   ├── BotonCerrarSesion.tsx     ← Limpia localStorage + redirect
│   │   ├── ChatAsistencia.tsx        ← ⚠️ CRÍTICO — motor de chat completo
│   │   ├── ChatToast.tsx             ← Toast compacto de nuevo mensaje
│   │   ├── GestionVehiculosChofer.tsx ← CRUD vehículos del chofer
│   │   ├── MapaTILA.tsx              ← ⚠️ CRÍTICO — mapa Google Maps con GPS live
│   │   ├── SubirDocumentacion.tsx    ← Upload docs a Supabase Storage
│   │   ├── historial-cliente.tsx     ← Historial de viajes del cliente
│   │   └── historial-chofer.tsx      ← Historial de viajes del chofer
│   ├── crear-cuenta/
│   │   └── page.tsx                  ← Selección tipo de cuenta (cliente/chofer)
│   ├── hooks/
│   │   ├── useChatRealtime.ts        ← ⚠️ CRÍTICO — hook centralizado de chat + realtime
│   │   └── useProtegerRuta.ts        ← Guard de rutas por rol (basado en localStorage)
│   ├── lib/
│   │   ├── evidencias.ts             ← Helper registrar evidencias en viaje_evidencias
│   │   ├── supabase.ts               ← ⚠️ CRÍTICO — cliente Supabase (claves hardcodeadas)
│   │   ├── tarifas.ts                ← Motor de cálculo de tarifas TILA
│   │   ├── validacion-chofer.ts      ← Reglas de validación de documentación
│   │   └── vehiculos.ts              ← Tipos, constantes y helpers de vehículos
│   ├── login/
│   │   └── page.tsx                  ← Login custom (tabla usuarios, NO Supabase Auth)
│   ├── panel-chofer/
│   │   └── page.tsx                  ← ⚠️ CRÍTICO — panel operativo del chofer
│   ├── panel-cliente/
│   │   └── page.tsx                  ← ⚠️ CRÍTICO — panel del cliente + SeguimientoViaje
│   ├── publicar/
│   │   └── page.tsx                  ← Publicar nueva carga (solo clientes)
│   ├── registro-chofer/
│   │   └── page.tsx                  ← Registro completo de chofer + documentación
│   ├── registro-cliente/
│   │   └── page.tsx                  ← Panel cliente alternativo (legacy/redirect)
│   ├── utils/
│   │   └── chatSound.ts              ← Reproduce drop.wav / fallback alerta-viaje.mp3
│   ├── viaje-activo/
│   │   └── page.tsx                  ← ⚠️ CRÍTICO — página GPS live del chofer en ruta
│   ├── data.ts                       ← Datos estáticos (zonas, vehículos, tipos de carga)
│   ├── globals.css                   ← Estilos globales Tailwind v4
│   ├── layout.tsx                    ← Layout raíz Next.js
│   └── page.tsx                      ← Landing page pública
├── public/
│   ├── logo-tila.png
│   └── sounds/
│       ├── drop.wav                  ← Sonido notificación chat (principal)
│       └── alerta-viaje.mp3          ← Sonido notificación chat (fallback)
├── supabase/
│   └── migrations/
│       └── 20250606_vehiculo_activo_id.sql  ← Única migración SQL en repo
├── .env.local                        ← Variables de entorno (NO subir al repo)
├── .gitignore                        ← Incluye .env* ✅
├── BACKUP_RECOVERY_PLAN.md           ← Este archivo
├── next.config.ts
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## 2. APIs DETECTADAS

### 2.1 Mercado Pago
| Endpoint | Método | Archivo | Función |
|---|---|---|---|
| `/api/mercadopago/crear-preferencia` | POST | `app/api/mercadopago/crear-preferencia/route.ts` | Crea preferencia de pago, guarda `mp_preference_id` en `cargas` |
| `/api/mercadopago/webhook` | POST | `app/api/mercadopago/webhook/route.ts` | Recibe notificación MP, consulta pago real a API MP, actualiza `pago_estado` en `cargas` |
| `/api/mercadopago/webhook` | GET | ídem | Responde `{ ok: true }` para verificación de MP |

**Flujo de pago:**
1. Cliente en `panel-cliente` → click "Pagar ahora" → POST `/api/mercadopago/crear-preferencia`
2. Backend crea preferencia → devuelve `init_point`
3. Cliente redirigido a Mercado Pago
4. MP llama al webhook con `type: "payment"` + `data.id`
5. Webhook consulta pago real a MP API (nunca confía solo en el body)
6. Si `approved` → `cargas.pago_estado = "pagado"`, `cargas.estado = "pendiente"`, `pagado_cliente = true`

### 2.2 Distancia (Google Maps Directions)
| Endpoint | Método | Archivo | Función |
|---|---|---|---|
| `/api/distancia?origen=...&destino=...` | GET | `app/api/distancia/route.ts` | Calcula km estimados entre dos puntos en Argentina |

**Usado en:** `app/publicar/page.tsx` al crear una carga para calcular `km_estimados` y precio.

### 2.3 GPS / Tracking Live
**No es una API REST separada** — implementado con:
- **Write:** `supabase.from("cargas").update({ lat, lng, velocidad_kmh, gps_actualizado })` cada ~5s desde `viaje-activo/page.tsx`
- **Write:** `supabase.from("usuarios").update({ online, ultima_senal_at, bateria_nivel, bateria_cargando })` heartbeat
- **Read:** Subscripción Realtime `postgres_changes` en `panel-cliente/page.tsx` para recibir actualizaciones de lat/lng en tiempo real
- **Componente:** `MapaTILA.tsx` renderiza el mapa con `@react-google-maps/api`

### 2.4 Chat
**No es una API REST** — implementado con Supabase Realtime:
- **Hook:** `app/hooks/useChatRealtime.ts` — centraliza toda la lógica
- **Canal Realtime:** `postgres_changes` en tabla `mensajes_viaje` filtrado por `viaje_id` y `tipo_chat`
- **Polling fallback:** cada 8s si el canal Realtime falla
- **Tipos de chat:** `viaje` (cliente↔chofer) | `soporte_cliente` (cliente↔admin) | `soporte_chofer` (chofer↔admin)
- **Sonido:** `playChatSound()` → `/sounds/drop.wav` vol 0.45, fallback `/sounds/alerta-viaje.mp3`
- **Toast:** `ChatToast.tsx` — notificación compacta estilo nube amarilla

---

## 3. TABLAS SUPABASE UTILIZADAS

### `usuarios`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | uuid/bigint PK | Identificador único |
| `nombre` | text | Nombre completo |
| `email` | text UNIQUE | Email de acceso |
| `password` | text | ⚠️ TEXTO PLANO — sin hash |
| `rol` | text | `cliente` / `chofer` / `admin` |
| `telefono` | text | |
| `dni` | text | |
| `cuit_cuil` | text | Sensible |
| `licencia` | text | |
| `cnrt_ruta` | text | |
| `patente` | text | Legacy (migrado a `vehiculos`) |
| `vehiculo` | text | Legacy |
| `tipo_vehiculo` | text | |
| `tipo_carroceria` | text | |
| `capacidad_carga` | text | |
| `zona_operativa` | text | |
| `categoria_legal` | text | `A/B/C/D/E` |
| `estado_aprobacion` | text | `pendiente/aprobado/rechazado/suspendido` |
| `estado_validacion` | text | `pendiente/aprobado` |
| `online` | boolean | Estado GPS live |
| `ultima_senal_at` | timestamptz | Última actualización GPS |
| `bateria_nivel` | int | Nivel batería dispositivo |
| `bateria_cargando` | boolean | |
| `vehiculo_activo_id` | bigint FK→vehiculos | Vehículo con el que opera |
| `eliminado` | boolean | Soft delete |
| `acepta_terminos` | boolean | |
| `alias_cbu_cvu` | text | Datos bancarios sensibles |
| `titular_cuenta` | text | |
| `banco_billetera` | text | |
| `metodo_cobro` | text | |
| `antecedentes` | text | |
| `navegador_preferido` | text | `google_maps/waze/maps_apple` |
| `created_at` | timestamptz | |

### `cargas`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint PK | |
| `cliente_id` | text FK→usuarios | Dueño de la carga |
| `chofer_id` | text FK→usuarios | Chofer asignado (null si sin asignar) |
| `origen` | text | Dirección exacta origen |
| `destino` | text | Dirección exacta destino |
| `tipo_carga` | text | Tipo de mercadería |
| `peso` | text | Kilos/toneladas |
| `estado` | text | `pendiente/Chofer asignado/En camino/Carga retirada/En ruta/Descarga completada/Viaje finalizado` |
| `pago_estado` | text | `pendiente_pago/pendiente_proceso/pagado/rechazado` |
| `precio_cliente` | numeric | Precio que paga el cliente |
| `pago_chofer` | numeric | Lo que cobra el chofer |
| `comision_plataforma` | numeric | Comisión TILA |
| `pagado_cliente` | boolean | |
| `mp_payment_id` | text | ID pago Mercado Pago |
| `mp_preference_id` | text | ID preferencia MP |
| `mp_monto` | numeric | Monto en MP |
| `mp_status` | text | Estado raw de MP |
| `lat` | numeric | GPS live — latitud chofer |
| `lng` | numeric | GPS live — longitud chofer |
| `velocidad_kmh` | numeric | Velocidad live |
| `gps_actualizado` | timestamptz | Timestamp último GPS |
| `km_estimados` | numeric | Calculado por API distancia |
| `tracking` | boolean | GPS activo |
| `hora_aceptacion` | timestamptz | |
| `hora_inicio` | timestamptz | |
| `hora_finalizacion` | timestamptz | |
| `oculto_cliente` | boolean | Admin ocultó la carga al cliente |
| `oculto_chofer` | boolean | Admin ocultó la carga al chofer |
| `auto_oculto_at` | timestamptz | |
| `tipo_vehiculo` | text | Tipo requerido |
| `categoria_legal` | text | Categoría habilitación requerida |
| `created_at` | timestamptz | |

### `mensajes_viaje`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint PK | |
| `viaje_id` | bigint FK→cargas | |
| `tipo_chat` | text | `viaje/soporte_cliente/soporte_chofer` |
| `remitente_id` | text FK→usuarios | |
| `remitente_rol` | text | `cliente/chofer/admin` |
| `remitente_nombre` | text | |
| `mensaje` | text | Contenido del mensaje |
| `leido` | boolean | |
| `created_at` | timestamptz | |

### `paradas_viaje`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint PK | |
| `carga_id` | bigint FK→cargas | |
| `direccion` | text | |
| `tipo` | text | `retiro/entrega/parada` |
| `orden` | int | Orden en la ruta |
| `estado` | text | `pendiente/en_curso/completada` |
| `completada_at` | timestamptz | |

### `viaje_evidencias`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint PK | |
| `carga_id` | bigint FK→cargas | |
| `evento` | text | `viaje_aceptado/chofer_en_camino/carga_retirada/en_ruta/descarga_completada/viaje_finalizado` |
| `rol_usuario` | text | |
| `usuario_id` | text FK→usuarios | |
| `estado_viaje` | text | |
| `lat` | numeric | GPS en el momento del evento |
| `lng` | numeric | |
| `nombre_receptor` | text | |
| `recibio_nombre` | text | |
| `entrego_nombre` | text | |
| `tipo_operacion` | text | `carga/descarga` |
| `tipo_carga` | text | |
| `observacion` | text | |
| `foto_url` | text | URL pública Storage |
| `created_at` | timestamptz | |

### `vehiculos`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint PK | |
| `chofer_id` | text FK→usuarios | |
| `marca` | text | |
| `modelo` | text | |
| `anio` | int | |
| `patente` | text | |
| `tipo_vehiculo` | text | |
| `capacidad_kg` | int | |
| `cedula_verde_url` | text | URL Storage |
| `seguro_url` | text | URL Storage |
| `seguro_vencimiento` | text | YYYY-MM-DD |
| `vtv_rto_url` | text | URL Storage |
| `vtv_rto_vencimiento` | text | YYYY-MM-DD |
| `foto_vehiculo_url` | text | URL Storage |
| `estado_validacion` | text | `pendiente/aprobado/rechazado` |
| `activo` | boolean | Vehículo activo del chofer |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `documentacion_chofer`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint PK | |
| `chofer_id` | text FK→usuarios | |
| `tipo` | text | `dni_frente/dni_dorso/licencia/antecedentes_penales/cedula_verde/seguro/vtv_rto/foto_frente/foto_lateral_izquierda/foto_lateral_derecha/foto_trasera` |
| `url` | text | URL pública Storage |
| UNIQUE | (chofer_id, tipo) | No duplicar documentos |

### `billetera_chofer`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint PK | |
| `chofer_id` | text FK→usuarios | |
| `viaje_id` | text FK→cargas | |
| `monto` | numeric | Monto cobrado por el viaje |
| `created_at` | timestamptz | |

### `tarifas_config`
> ⚠️ La tabla `tarifas_config` **no se usa en el código actual**. Las tarifas están hardcodeadas en `app/lib/tarifas.ts` (VEHICULOS, FACTORES_CARGA). Si la tabla existe en Supabase, es legacy o futura.

---

## 4. BUCKETS STORAGE

| Bucket | Acceso | Contenido | Usado en |
|---|---|---|---|
| `documentacion-choferes` | ⚠️ Público (getPublicUrl) | DNI, licencia, antecedentes, seguro, VTV/RTO, cédula verde | `app/lib/vehiculos.ts`, `app/components/SubirDocumentacion.tsx` |
| `vehiculos` | ⚠️ Público (getPublicUrl) | Fotos del vehículo (frente, laterales, trasera) | `app/lib/vehiculos.ts` |

> **Riesgo:** Ambos buckets usan `getPublicUrl` — cualquier persona con el link puede ver documentos sensibles (DNI, licencias). Se recomienda migrar a URLs firmadas (`createSignedUrl`) con vencimiento corto.

---

## 5. VARIABLES DE ENTORNO REQUERIDAS

### En Vercel (Settings → Environment Variables)

```bash
# ── Supabase (SERVIDOR — nunca al bundle cliente)
SUPABASE_URL=https://imbtepvdscdtpxkleihi.supabase.co
SUPABASE_ANON_KEY=<anon key de Supabase Settings > API>
SUPABASE_SERVICE_ROLE_KEY=<service_role key de Supabase Settings > API>

# ── Supabase (CLIENTE — van al bundle JS, solo anon key)
NEXT_PUBLIC_SUPABASE_URL=https://imbtepvdscdtpxkleihi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>

# ── Google Maps
GOOGLE_MAPS_API_KEY=<server-only, para /api/distancia>
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<client-side, para MapaTILA.tsx>

# ── MercadoPago
MERCADOPAGO_ACCESS_TOKEN=<APP_USR-xxxx (producción) o TEST-xxxx (sandbox)>

# ── URL base
NEXT_PUBLIC_BASE_URL=https://tila-logistica.vercel.app
```

### Estado actual del `.env.local`

| Variable | Estado |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | ⚠️ Placeholder — `REEMPLAZAR_CON_TU_TOKEN` |
| `NEXT_PUBLIC_BASE_URL` | ✅ Configurada |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ Placeholder — `REEMPLAZAR_CON_SERVICE_ROLE_KEY` |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Presente (comentada como referencia) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Presente (comentada como referencia) |
| `GOOGLE_MAPS_API_KEY` | ❌ No existe en .env.local |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | ❌ No existe en .env.local |
| `SUPABASE_URL` | ❌ No existe (server-only) |
| `SUPABASE_ANON_KEY` | ❌ No existe (server-only) |

---

## 6. DEPENDENCIAS CRÍTICAS

### Runtime
| Paquete | Versión | Función |
|---|---|---|
| `next` | 16.2.6 | Framework — App Router, Turbopack |
| `react` | 19.2.4 | |
| `@supabase/supabase-js` | ^2.105.4 | DB, Realtime, Storage, Auth |
| `mercadopago` | ^3.1.0 | SDK oficial MP para Node.js |
| `@react-google-maps/api` | ^2.20.8 | Mapa interactivo con GPS live |

### Dev
| Paquete | Versión |
|---|---|
| `typescript` | ^5 |
| `tailwindcss` | ^4 |
| `@tailwindcss/postcss` | ^4 |
| `eslint-config-next` | 16.2.6 |

### Servicios externos requeridos
| Servicio | Función | Configuración |
|---|---|---|
| Supabase | DB PostgreSQL + Realtime + Storage | Dashboard: https://supabase.com/dashboard |
| Mercado Pago | Pagos online | Panel: https://www.mercadopago.com.ar/developers |
| Google Maps Platform | Directions API + Maps JavaScript API | Console: https://console.cloud.google.com |
| Vercel | Hosting + Edge/Node API routes | https://vercel.com/vicente-logistica |

---

## 7. ARCHIVOS CRÍTICOS

### `app/components/ChatAsistencia.tsx`
Motor completo del chat. Soporta dos modos:
- **`modoInline`**: llena el contenedor padre (`h-full w-full flex flex-col`) — el padre debe definir altura explícita
- **Flotante**: ventana fixed `style={{ height: "min(420px, 70vh)" }}` con botón burbuja

Dependencias: `useChatRealtime`, `playChatSound`  
Refs críticos: `mensajesRef` (único scroll target), `autoScrollRef`, `chatVisibleRef`, `silenciadoRef`  
Scroll: `mensajesRef.current.scrollTop = mensajesRef.current.scrollHeight` — nunca `window`, nunca `scrollIntoView`

### `app/hooks/useChatRealtime.ts`
Hook centralizado. Maneja:
- Suscripción Realtime `postgres_changes` a `mensajes_viaje`
- Polling fallback cada 8s
- `marcarLeidos()` automático cuando `chatVisibleRef.current === true`
- Badge de no leídos vía `onNoLeidosChange`
- Sonido vía `silenciadoRef` (stale closure prevention)
- `onNuevoMensaje()` callback para que el componente controle su propio scroll

### `app/components/MapaTILA.tsx`
Mapa Google Maps con:
- GPS live del chofer (marcador actualizado por Realtime)
- Ruta origen→destino
- Paradas intermedias
- Modo soloLectura para cliente
- Requiere `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`

### `app/viaje-activo/page.tsx`
Página GPS del chofer en ruta:
- Publica coordenadas cada ~5s a `cargas.lat/lng`
- Heartbeat de batería y señal a `usuarios`
- Cambios de estado operativo del viaje
- Acceso al viaje por `localStorage.getItem("viajeActivoId")` ⚠️ sin verificar `chofer_id`

### `app/api/mercadopago/webhook/route.ts`
- Recibe POST de Mercado Pago
- Consulta el pago real a la API de MP (idempotente por `mp_payment_id`)
- Actualiza `cargas` con `supabaseAdmin` (service role, bypasa RLS)
- ⚠️ Sin verificación de firma `x-signature`

### `app/panel-cliente/page.tsx`
Contiene `SeguimientoViaje` como función interna (no archivo separado).  
`SeguimientoViaje` = vista fullscreen con mapa + GPS + chat + botón pagar.  
`viajeSeleccionado` controla si se muestra el seguimiento o la lista de viajes.

### `app/admin/page.tsx`
Panel monolítico (~1600 líneas). Contiene:
- Lista de choferes activos con GPS, batería, señal
- Lista de viajes (todos los estados)
- Central de Asistencia (chat flotante único por viaje)
- Gestión de usuarios
- Reportes financieros / billetera
- Módulo `DetalleChofer` (subcomponente interno)
- Módulo `ReportesAdmin` (subcomponente interno)

### `app/panel-chofer/page.tsx`
- Lista de cargas disponibles (filtradas por `tipo_vehiculo` y `categoria_legal`)
- Cargas asignadas activas
- Gestión de vehículos
- Documentación
- Chat con clientes y admin

---

## 8. RIESGOS PARA RESTAURACIÓN

| Riesgo | Gravedad | Detalle |
|---|---|---|
| Contraseñas en texto plano | 🔴 Alta | Login usa `.eq("password", password)` directo. Sin Supabase Auth, restaurar requiere mantener esta lógica o migrar todo el sistema de auth |
| Claves hardcodeadas | 🔴 Alta | `supabase.ts`, `webhook`, `crear-preferencia`, `distancia` tienen URLs/keys en código. Si se rota la anon key de Supabase, el proyecto deja de funcionar sin redeploy |
| `SUPABASE_SERVICE_ROLE_KEY` en placeholder | 🔴 Alta | En producción (Vercel), si esta variable no está configurada, el fallback usa la **anon key** en contexto de service role. Con RLS activo → todos los pagos fallarían silenciosamente |
| `GOOGLE_MAPS_API_KEY` no en variables | 🔴 Alta | `MapaTILA.tsx` recibe string vacío `""` si `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` no está configurada → mapa no carga |
| `NODE_TLS_REJECT_UNAUTHORIZED = "0"` | 🟡 Media | En `distancia/route.ts` línea 1 — deshabilita validación TLS para todo el proceso Node.js |
| Sin middleware de auth | 🟡 Media | Todas las rutas son accesibles a nivel servidor. La protección es 100% cliente (`useProtegerRuta` + localStorage) |
| RLS no verificado | 🔴 Alta | No hay migraciones con políticas RLS en el repo. Si las tablas están sin RLS en Supabase, todos los datos son accesibles sin restricción desde el cliente |
| `SeguimientoViaje` embebido en panel-cliente | 🟢 Baja | No es un archivo separado — está como función dentro de `panel-cliente/page.tsx`. No se puede importar independientemente |
| Tabla `tarifas_config` posiblemente inexistente | 🟢 Baja | Las tarifas están hardcodeadas en `lib/tarifas.ts` — la tabla no se usa en código |
| Buckets Storage públicos | 🟡 Media | DNI, licencias, seguros accesibles con URL directa sin autenticación |
| Webhook sin verificación de firma | 🟡 Media | MP puede recibir notificaciones falsas con payment_id reales |

---

## 9. PROCEDIMIENTO COMPLETO PARA RESTAURAR TILA DESDE CERO

### Paso 1 — Clonar repositorio
```bash
git clone https://github.com/vicente-logistica/tila-logistica.git
cd tila-logistica
npm install
```

### Paso 2 — Configurar Supabase
1. Ir a https://supabase.com/dashboard → Seleccionar o crear proyecto `imbtepvdscdtpxkleihi`
2. Verificar que existen todas las tablas: `usuarios`, `cargas`, `mensajes_viaje`, `paradas_viaje`, `viaje_evidencias`, `vehiculos`, `documentacion_chofer`, `billetera_chofer`
3. Ir a **Settings → API** → copiar:
   - `Project URL` → `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
4. Ejecutar la migración pendiente: `supabase/migrations/20250606_vehiculo_activo_id.sql`
5. Configurar buckets Storage: crear `documentacion-choferes` y `vehiculos` como públicos (o privados con signed URLs)
6. Habilitar Realtime en la tabla `mensajes_viaje` (Supabase → Database → Replication → mensajes_viaje)

### Paso 3 — Configurar Mercado Pago
1. Ir a https://www.mercadopago.com.ar/developers/panel/app
2. Crear o seleccionar aplicación
3. Copiar `Access Token` (producción: `APP_USR-...` / sandbox: `TEST-...`) → `MERCADOPAGO_ACCESS_TOKEN`
4. Configurar webhook URL: `https://tila-logistica.vercel.app/api/mercadopago/webhook`

### Paso 4 — Configurar Google Maps
1. Ir a https://console.cloud.google.com
2. Habilitar: **Maps JavaScript API** + **Directions API**
3. Crear API Key → Copiar a `GOOGLE_MAPS_API_KEY` (server) y `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (client)
4. Restringir la key de cliente a `tila-logistica.vercel.app`

### Paso 5 — Crear `.env.local`
```env
SUPABASE_URL=https://imbtepvdscdtpxkleihi.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
NEXT_PUBLIC_SUPABASE_URL=https://imbtepvdscdtpxkleihi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
GOOGLE_MAPS_API_KEY=<server key>
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<client key>
MERCADOPAGO_ACCESS_TOKEN=<access token>
NEXT_PUBLIC_BASE_URL=https://tila-logistica.vercel.app
```

### Paso 6 — Verificar build local
```bash
npm run build
# Debe terminar con 0 errors, 15 rutas compiladas
```

### Paso 7 — Deploy en Vercel
1. Ir a https://vercel.com/vicente-logistica
2. Conectar repo `vicente-logistica/tila-logistica` (o ya conectado)
3. **Settings → Environment Variables** → cargar todas las variables del Paso 5
4. **Redeploy** desde el último commit (`b78575d`)
5. Verificar en Vercel Functions que los API routes responden

### Paso 8 — Verificar funcionamiento
- [ ] Login con usuario cliente, chofer y admin
- [ ] Panel cliente: lista viajes, botón seguimiento, mapa GPS
- [ ] Panel chofer: ver cargas disponibles, aceptar viaje, GPS live
- [ ] Chat: mensajes en tiempo real entre cliente y chofer
- [ ] Admin: Central de Asistencia, ventana flotante de chat, evidencias
- [ ] Pago: crear preferencia MP, recibir webhook, actualizar estado
- [ ] Sonido: activar chat → escuchar `drop.wav` al recibir mensaje

### Paso 9 — Configurar usuario admin
El admin se identifica por `rol = "admin"` en la tabla `usuarios`. Si no existe:
```sql
-- Ejecutar en Supabase SQL Editor
INSERT INTO usuarios (nombre, email, password, rol, acepta_terminos)
VALUES ('Admin TILA', 'admin@tila.com', '<password>', 'admin', true);
```

---

## 10. ESTADO ACTUAL DEL REPOSITORIO

### Archivos sin commit
```
# Ninguno — working tree limpio al momento de esta auditoría
git status: limpio en rama main, commit b78575d
```

### Claves hardcodeadas detectadas
| Archivo | Línea | Clave | Valor expuesto |
|---|---|---|---|
| `app/lib/supabase.ts` | 3 | Supabase URL | `https://imbtepvdscdtpxkleihi.supabase.co` |
| `app/lib/supabase.ts` | 4 | Supabase Anon Key | `sb_publishable_rpOk0QmsJhg-QsngXIE91w_bqHzl7hQ` |
| `app/api/mercadopago/webhook/route.ts` | 9-10 | Supabase URL + fallback Anon Key | ídem + fallback si no hay service role |
| `app/api/mercadopago/crear-preferencia/route.ts` | 11-12 | Supabase URL + fallback Anon Key | ídem |
| `app/api/distancia/route.ts` | 20 | Google Maps API Key | `AIzaSyB-eO21BtF2EVvtC8p2MGXFVJg7X9xd1nk` |
| `app/api/distancia/route.ts` | 1 | TLS deshabilitado | `NODE_TLS_REJECT_UNAUTHORIZED = "0"` |

### Variables faltantes en Vercel (probable)
Basado en el `.env.local` actual que tiene dos placeholders:

| Variable | Estado en .env.local | Impacto si falta en Vercel |
|---|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | ⚠️ Placeholder | Pagos fallan — API devuelve 500 |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ Placeholder | Webhook usa anon key → con RLS activo los pagos no actualizan la DB |
| `GOOGLE_MAPS_API_KEY` | ❌ No existe | API `/api/distancia` devuelve 500 — no se calculan km ni precio |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | ❌ No existe | Mapa no carga en ningún panel |
| `SUPABASE_URL` (server-only) | ❌ No existe | APIs no pueden conectar a Supabase sin la hardcoded |
| `SUPABASE_ANON_KEY` (server-only) | ❌ No existe | ídem |

> **Nota importante:** el proyecto actualmente funciona en producción porque las claves están **hardcodeadas en el código fuente**. Las variables de entorno son ignoradas en los archivos que tienen fallbacks hardcodeados. Esto es funcional pero inseguro.

---

*Fin del plan — TILA Logística v0.1.0 — 2026-06-12*
