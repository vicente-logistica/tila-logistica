// Configuración centralizada de radios de cercanía para el listado de cargas del chofer.
// Único lugar donde viven estos números — no repetirlos en ningún otro archivo.
export const RADIO_INICIAL_KM = 35;
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

// ── Expansión 35 → 50 (NO implementada todavía a propósito) ────────────────────────────
// RADIO_MAXIMO_KM ya está centralizado y el prefiltro geográfico (ver route.ts) usa este
// valor como límite exterior — o sea que una carga entre 35 y 50km YA se calcula y cachea
// hoy, sólo que no se ofrece (dentroRadioInicial=false). El día que se defina el criterio
// real de expansión (después de cuánto tiempo sin ofertas pasar de 35 a 50 — 5/10/20min,
// o algún otro disparador), el cambio queda acotado a UNA función nueva de decisión (algo
// como `radioEfectivoKm(minutosSinOfertas: number): number`) que el endpoint consulte para
// elegir qué campo (dentroRadioInicial vs dentroRadioMaximo) usar como corte — no hace
// falta tocar el prefiltro, el caché, ni el cálculo de distancias en sí.
