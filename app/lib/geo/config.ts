// Radio de matching POR DEFECTO (km). El radio vigente es configurable desde Panel Admin
// (configuracion_plataforma.radio_matching_km, ver app/lib/configuracionRadio.ts); este
// valor sólo se usa como respaldo y como parámetro por defecto.
export const RADIO_INICIAL_KM = 35;
// Ya NO es una barrera del matching: el prefiltro Haversine y la decisión final usan el
// radio vigente. Queda sólo como segundo argumento de interpretarLegs en usos que ignoran
// esa bandera (desgloseRecorrido).
export const RADIO_MAXIMO_KM = 50;

// Cuánto tiempo se reutiliza sin volver a pedir el geocode de una dirección (el punto A
// de una carga no cambia nunca una vez publicada: ver app/publicar/page.tsx, la fila
// tipo="retiro" de paradas_viaje siempre usa `origen.trim()` tal cual quedó al publicar)
// y cuánto se reutiliza una distancia vial ya calculada para un (chofer, carga) — acá sí
// conviene un TTL corto, porque el chofer se mueve. Ambos son cachés EN MEMORIA del
// proceso (ver app/api/chofer/distancias-cercanas/route.ts) — se pierden en un cold start
// de la función serverless, pero igual reducen mucho las llamadas a Google mientras la
// instancia sigue caliente (el caso normal bajo tráfico moderado, con varios choferes
// consultando repetidamente el mismo conjunto de cargas pendientes).
export const TTL_GEOCODE_MS   = 24 * 60 * 60 * 1000; // 24h — una dirección no se mueve
export const TTL_DISTANCIA_MS = 3  * 60 * 1000;      // 3min — el chofer sí se mueve

// Redondeo del GPS del chofer para la clave de caché de distancias — evita recalcular una
// ruta completa por cada metro de jitter del GPS mientras el chofer está básicamente
// quieto navegando el listado. 3 decimales ≈ 111m de resolución en latitud.
export const DECIMALES_CACHE_GPS = 3;

// Cuántas llamadas a Directions se permiten en simultáneo por request — evita disparar
// decenas de llamadas a Google a la vez si hubiera muchos candidatos tras el prefiltro.
export const CONCURRENCIA_MAXIMA_DIRECTIONS = 4;

// ── Costo con radios grandes ───────────────────────────────────────────────────────────
// El prefiltro Haversine usa el radio vigente: cuanto más grande el radio, más cargas pasan
// a la etapa de distancia real y más llamadas a Google Directions se hacen (una por carga
// candidata por chofer y posición, con caché de TTL_DISTANCIA_MS). No cambia qué cargas se
// ofrecen — sólo costo y latencia.
