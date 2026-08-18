"use client";

import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  DirectionsRenderer,
  Polyline,
} from "@react-google-maps/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// TILA_NAV_DIAG — logger temporal en memoria, ver app/utils/diagLoggerNav.ts. Borrar
// este import junto con el resto de la instrumentación cuando se retire el diagnóstico.
import { diagLog, diagObtenerTexto, diagContarEventos, diagLimpiar } from "../utils/diagLoggerNav";

// "geometry": necesaria para google.maps.geometry.encoding.decodePath — decodifica el
// polyline codificado que devuelve Routes API (calcularRutaNavegacionDireccional), en
// vez de reimplementar el algoritmo de decodificación a mano.
const LIBRARIES: ("places" | "geometry" | "drawing")[] = ["geometry"];

const centroArgentina = { lat: -34.6037, lng: -58.3816 };
const LABELS = ["A", "B", "C", "D", "E", "F"];

// Interruptor de reversión: navegación activa (dispararCalculoNav) usa Routes API
// (calcularRutaNavegacionDireccional, con heading direccional del origen — ver
// construirWaypointOrigenDireccional) en vez de DirectionsService clásico
// (calcularRuta) cuando esto es true. Volver a false revierte sin tocar código, sin
// redeploy de config — un solo commit cambiando este valor. Los otros 3 call-sites de
// calcularRuta (recorrido-chofer antes de aceptar, multietapa de sólo lectura, modo
// simple) NO leen este flag — siguen usando DirectionsService siempre, sin excepción;
// esta migración es exclusiva de navegación activa.
const USAR_ROUTES_API_NAVEGACION = true;

// Zoom y tilt aplicados por "Mi ubicación" al restaurar la cámara de navegación.
// Sólo se fijan una vez, al reactivar el seguimiento — no se reaplican en cada tick
// de GPS. ZOOM subido de 18 a 18.5 — el camión gana protagonismo sin perder demasiada
// visión del camino hacia adelante (un salto entero, a 19, dejaba ver muy poca ruta).
// TILT bajado de 65 a 45: con tilt alto la cámara mira casi al horizonte, lo que hace
// que las fachadas de los edificios 3D (motor vectorial, ver mapId) dominen la pantalla
// en zonas densas como CABA — complementa (no reemplaza) el cambio de estilo "Buildings"
// en Cloud Console (3D → Footprints). No afecta headingInteractionEnabled/setHeading —
// la rotación de la cámara por sentido de marcha queda intacta, tilt y heading son ejes
// independientes en el motor vectorial.
const ZOOM_NAVEGACION = 18.5;
const TILT_NAVEGACION = 45;

// ─── Suavizado de marcador/cámara (interpolación por requestAnimationFrame) ───
// Ventana de animación por cada lectura GPS nueva: nunca más corta que el mínimo (para
// que el movimiento se perciba fluido, no instantáneo) ni más larga que el máximo (para
// no "quedarse atrás" si el GPS entrega fixes seguidos). Se ajusta dentro de ese rango
// según el intervalo real medido entre el fix anterior y el actual — ver animarHaciaPosicion.
// MAX subido de 900 a 3000ms: en conducción real el intervalo entre fixes GPS no es un
// 1Hz perfecto — varía entre ~1 y ~3s. Con el tope en 900ms, cualquier intervalo mayor
// se comprimía en sólo 900ms de movimiento y el resto del intervalo quedaba "congelado"
// (marcador y cámara quietos) hasta el próximo fix — exactamente el patrón de "salto
// cada 1-3 segundos" reportado. Con 3000ms la animación cubre el intervalo real completo
// en casi todos los casos, sin dejar de proteger contra fixes que lleguen más seguido
// (la duración real usada sigue acortándose sola, ver animarHaciaPosicion).
const DURACION_ANIMACION_MIN_MS = 300;
const DURACION_ANIMACION_MAX_MS = 3000;

// pasoAnimacion corre una vez por frame de rAF — en pantallas de 90-120Hz eso es
// escribir center/heading de la cámara hasta ~120 veces por segundo (confirmado con
// evidencia real: moverCamaraPasoAnimPorSeg/eventosCenterPorSeg ~118-119 en la prueba
// en dispositivo). El marcador puede/debe seguir así de fluido, pero la CÁMARA no
// necesita esa frecuencia — cada setCenter dispara su propia transición interna en el
// mapa vectorial, y actualizarla muy por encima de lo perceptible sólo agrega ruido.
// Limitada a 12.5Hz (80ms): dentro del rango 10-15Hz pedido, muy por encima del
// umbral de movimiento fluido percibido por el ojo (~24fps).
const INTERVALO_MIN_CAMARA_MS = 80;

// Misma cadencia que la cámara (12.5Hz) — ver ultimaActualizacionRecorteTsRef en el
// componente: la traza visible se recalcula con la posición INTERPOLADA (la misma que
// ya usa el marcador en cada frame), throtteada a este intervalo, en vez de sólo una
// vez por fix GPS real (~1/seg). Antes de este cambio, entre un fix y el siguiente el
// marcador avanzaba animado mientras la traza quedaba fija en el punto crudo anterior
// — un hueco que crecía y se reseteaba de golpe con cada fix (offset + "colita").
const INTERVALO_MIN_RECORTE_MS = 80;

// Predicción limitada (dead-reckoning acotado): a 80-120km/h, un solo hueco entre fixes
// GPS más largo que DURACION_ANIMACION_MAX_MS ya representa decenas de metros — con la
// duración fija de antes, la animación llegaba al destino y el vehículo quedaba
// congelado el resto del hueco, y el siguiente fix producía un salto de "alcance".
// En vez de eso, pasoAnimacion sigue avanzando más allá del destino usando el último
// heading+velocidad reales conocidos (ver velocidadMPorMsRef), acotado a este máximo —
// pasado este límite sin un fix nuevo, recién ahí se queda quieto de verdad (mejor eso
// que "inventar" posición indefinidamente si el GPS realmente se cortó).
const EXTRAPOLACION_MAX_MS = 2000;

// ─── Look-ahead de cámara (comportamiento tipo Google Maps/Waze) ──────────────
// Mientras se sigue al chofer con rumbo conocido, la cámara no centra exactamente sobre
// el vehículo: centra un poco más adelante, en la dirección de marcha — así se ve más
// camino por delante que por detrás, dando la sensación de "ir mirando hacia adelante"
// en vez de ir literalmente encima del ícono. El marcador del camión sigue estando en
// su posición GPS real exacta; sólo el PUNTO DE CENTRADO de la cámara se desplaza.
// Subido de 50 a 70m junto con el mayor tilt: con la cámara más inclinada e "detrás"
// del camión, hace falta desplazar un poco más el centrado para seguir mostrando
// bastante camino por delante.
const LOOK_AHEAD_METROS = 70;

// Separación (píxeles de pantalla) entre el camión y el borde superior del panel
// flotante inferior — ver puntoConOffsetVerticalPx/calcularOffsetVerticalCamara.
const MARGEN_SOBRE_PANEL_PX = 20;

// ─── Rerouting por desvío real de la ruta (no por distancia recorrida) ────────
// Se mide la distancia real del punto GPS a la polyline vigente (rutaPolylineRef).
// Dos caminos para confirmar desvío:
//  1) Desvío "obvio" (UMBRAL_DESVIO_INMEDIATO_METROS): una sola lectura muy lejos de la
//     ruta ya alcanza — a esa distancia no es ruido de GPS, es un vehículo en otra calle.
//  2) Desvío "moderado" (UMBRAL_DESVIO_RUTA_METROS): exige LECTURAS_CONSECUTIVAS_DESVIO
//     lecturas seguidas por encima del umbral, para no reaccionar a un solo salto de GPS.
// En ambos casos se respeta COOLDOWN_RECALCULO_MS entre recálculos por desvío (evita
// spamear la API de Directions). Valores ajustados para reaccionar rápido en conducción
// real, no son definitivos.
const UMBRAL_DESVIO_RUTA_METROS      = 35;
const UMBRAL_DESVIO_INMEDIATO_METROS = 120;
const LECTURAS_CONSECUTIVAS_DESVIO   = 2;
const COOLDOWN_RECALCULO_MS          = 8000;

// ─── Snap visual del camión sobre la polyline activa ──────────────────────────
// El GPS real (fixValidoActualRef, historial, velocidad/heading) NUNCA se modifica —
// sigue siendo la única fuente para desvío/recálculo. Esto sólo cambia dónde se DIBUJA
// el ícono: mientras la distancia del vehículo al segmento activo (la misma que ya
// calcula elegirSegmentoActivo en cada recorte) esté dentro de este corredor, el ícono
// se posiciona en el punto PROYECTADO sobre la polyline en vez de en la coordenada GPS
// cruda — corrige el offset lateral entre el camión y la calzada dibujada visto en los
// videos. Reutiliza UMBRAL_DESVIO_RUTA_METROS: es exactamente el mismo umbral que ya
// define "todavía sobre esta ruta" para el detector de desvío — no hace falta un
// segundo número arbitrario distinto. Más allá de esto, se asume desvío real y el
// ícono vuelve a mostrarse en su posición GPS real tal cual, sin forzarlo sobre una
// ruta de la que ya se salió.
const UMBRAL_CORREDOR_SNAP_VISUAL_METROS = UMBRAL_DESVIO_RUTA_METROS;

// ─── Validación defensiva de fixes GPS (velocidad + consistencia de rumbo) ────
// No se valida accuracy (page.tsx no la expone todavía). Filtros, en orden:
//  0) Intervalo demasiado corto para confiar en una velocidad calculada (denominador
//     inestable, dtMs < INTERVALO_MIN_VALIDACION_VELOCIDAD_MS): NUNCA se acepta un salto
//     grande sólo porque llegó rápido. Si además la distancia es mínima (ruido de GPS de
//     alta frecuencia, no un fix nuevo real) se acepta pero sin adelantar la base
//     temporal — si la distancia es mayor, se rechaza directo como outlier, sin
//     necesidad de calcular una velocidad implícita para justificarlo.
//  1) Velocidad implícita (con dt ya confiable): techo físico absoluto. Un salto de
//     posición grande con un dt igual de grande (p.ej. GPS mudo en un túnel) da una
//     velocidad implícita baja y se acepta sin problema — sólo se rechaza distancia
//     grande + tiempo corto.
//  2) Consistencia de rumbo: la velocidad sola no alcanza — un salto lateral de varias
//     decenas de metros puede quedar POR DEBAJO del techo de velocidad y aun así ser un
//     fix erróneo (GPS multipath/rebote), si su dirección no coincide ni con el heading
//     que reportó el GPS para ese fix ni con el rumbo de los últimos fixes YA ACEPTADOS
//     (la trayectoria real reciente). Sólo se exige para saltos de cierto tamaño — a
//     pocos metros el rumbo de un salto de GPS es ruido, no señal, incluso con el
//     vehículo detenido. Ver evaluarConsistenciaFix / el useEffect junto a
//     animarHaciaPosicion.
const INTERVALO_MIN_VALIDACION_VELOCIDAD_MS = 300; // debajo de esto, la velocidad implícita no es confiable
const UMBRAL_DUPLICADO_METROS               = 3;   // debajo de esto, con dt corto, se trata como ruido/duplicado
const VELOCIDAD_MAX_FIX_MPS                 = 60;  // ~216 km/h, techo de lo físicamente plausible
const UMBRAL_DISTANCIA_CONSISTENCIA_METROS  = 15;  // por debajo, no se exige coherencia de rumbo
const UMBRAL_INCONSISTENCIA_RUMBO_GRADOS    = 90;  // por encima de esto respecto de AMBAS referencias, se rechaza

// ─── Reenganche controlado de la base de validación ───────────────────────────
// Si la base (ultimoFixValidoRef) quedó anclada a un fix que en realidad no era un GPS
// real y confiable de ESTA sesión (p.ej. la posición previa que trae el viaje desde la
// base de datos, ya desactualizada), todos los fixes reales posteriores se rechazan
// para siempre por velocidad/rumbo — no hay forma de que la base se autocorrija sola.
// Este mecanismo es la salida de emergencia: si pasan muchos segundos sin aceptar
// NINGÚN fix (UMBRAL_MS_SIN_ACEPTAR_PARA_REENGANCHE) y llegan varias lecturas RECHAZADAS
// pero coherentes entre sí (a poca distancia una de la siguiente), se asume que esas
// lecturas son el GPS real y la base vieja la que está mal — se reemplaza la base por
// la última de esas lecturas. Nunca alcanza con una sola lectura rechazada (eso seguiría
// siendo ruido); hacen falta varias seguidas y mutuamente cercanas.
const UMBRAL_MS_SIN_ACEPTAR_PARA_REENGANCHE = 10000; // 10s sin aceptar ningún fix
const UMBRAL_DISTANCIA_REENGANCHE_METROS    = 30;    // candidatos consecutivos deben estar a esta distancia entre sí
const FIXES_REENGANCHE_REQUERIDOS           = 3;     // cantidad de candidatos coherentes seguidos para reemplazar la base

// ─── Bootstrap GPS: fase de adquisición inicial ────────────────────────────────
// Causa confirmada en prueba real: el PRIMER fix de la sesión se convertía en ancla
// PERMANENTE sin mirar su accuracy — si ese primer fix tenía accuracy=43m (posición
// real hasta 43m lejos de la reportada), evaluarConsistenciaFix comparaba TODOS los
// fixes siguientes (aunque tuvieran accuracy=3m, mucho mejores) contra esa base mala,
// y velocidades implícitas de 60-130m/s los rechazaba — no porque el fix nuevo fuera
// malo, sino porque el ANCLA lo era. evaluarConsistenciaFix (velocidad/rumbo) es un
// criterio para RÉGIMEN ESTABLE, donde ya hay una base confiable contra la cual medir
// — no sirve para decidir CUÁL debe ser esa base al arrancar.
// Mientras gpsInicialEstabilizadoRef sea false, el fix se trata como CANDIDATO de
// bootstrap: se puede seguir mostrando en el mapa (marcador/cámara ya funcionan con
// fixValidoActualRef), pero un candidato con mejor accuracy reemplaza directamente al
// anterior (sin pasar por el chequeo de velocidad, que no aplica todavía). Dos vías de
// salida de esta fase, la que ocurra primero:
//  a) un candidato con accuracy <= UMBRAL_ACCURACY_BOOTSTRAP_BUENO_METROS ya alcanza solo;
//  b) FIXES_COHERENTES_PARA_ESTABILIZAR candidatos seguidos, mutuamente cercanos entre
//     sí (aunque ninguno individualmente tenga una accuracy "buena"), confirman que el
//     GPS ya convergió a una posición real y consistente.
const UMBRAL_ACCURACY_BOOTSTRAP_BUENO_METROS = 25;
const FIXES_COHERENTES_PARA_ESTABILIZAR      = 2;
const DISTANCIA_COHERENCIA_BOOTSTRAP_METROS  = 30;

// ─── Progreso monotónico sobre la ruta (compartido entre desvío y recorte visual) ──
// Tolerancia de retroceso del índice de progreso: la búsqueda del punto más cercano
// puede mirar hasta esta cantidad de tramos ANTES del índice actual (no sólo desde él
// en adelante), para no quedar "clavada" si una lectura momentáneamente imprecisa la
// adelantó de más. Nunca es un retroceso grande (toda la ruta), sólo estos tramos.
const VENTANA_ATRAS_SEGMENTOS = 3;

// ─── Selección de segmento activo: ventana en metros + compatibilidad de sentido ──
// Causa confirmada del bug de autopistas divididas/calzadas paralelas: la búsqueda de
// segmento más cercano no tenía techo hacia ADELANTE (sólo hacia atrás, ver
// VENTANA_ATRAS_SEGMENTOS) ni chequeaba sentido de circulación — un punto de la
// calzada CONTRARIA o de una colectora paralela, a pocos metros de distancia
// perpendicular, podía "ganar" la distancia mínima aunque estuviera del otro lado del
// separador central. Ver elegirSegmentoActivo más abajo.
//
// VENTANA_ADELANTE_METROS: en metros, no en cantidad de índices — la densidad de
// steps[].path[] varía mucho (una recta puede ser sólo 2 puntos separados cientos de
// metros; una rampa/curva, muchos puntos juntos), así que un límite fijo de índices
// sería demasiado permisivo en rectas y demasiado restrictivo en curvas. 500m es un
// punto de partida razonado (cubre un intercambiador/rampa típico de 200-400m más
// margen), NO medido con datos reales de producción: la API key de Maps configurada
// en este proyecto está restringida por referrer HTTP (sólo navegador), así que no se
// pudo hacer una llamada a Directions desde este entorno para medir densidad real.
// El log CANDIDATOS_EN_VENTANA que se agrega en esta misma ronda deja evidencia real
// de cuántos puntos entran en la ventana en cada selección, para poder ajustar este
// número con la próxima prueba manejando si hiciera falta.
const VENTANA_ADELANTE_METROS = 500;

// Diferencia angular entre el heading del vehículo y el bearing del segmento
// candidato, por encima de la cual se lo considera "sentido incompatible" (mismo
// criterio de 90° ya usado en evaluarConsistenciaFix — UMBRAL_INCONSISTENCIA_RUMBO_GRADOS
// — para no introducir un segundo número arbitrario distinto sin motivo).
const UMBRAL_DIFERENCIA_ANGULAR_SEGMENTO_GRADOS = 90;

// Techo (metros) de cuánto más lejos que mejorGlobal (el candidato geométricamente más
// cercano, sin filtro de sentido) puede estar mejorCompatible para que el sentido pueda
// reemplazarlo. Causa confirmada real: un heading puntualmente erróneo/ruidoso (accuracy
// 29m, velocidad 3.5m/s) hizo que un candidato compatible por sentido a 435m (90° de
// diferencia, apenas dentro del umbral angular) le ganara a uno geométricamente correcto
// a 3m (122°, fuera del umbral por poco) — saltando el progreso ~435m de golpe,
// irreversible (avanzarIndiceProgreso nunca retrocede), y dejando la ventana de búsqueda
// de los siguientes ticks sin el segmento real donde estaba el vehículo (causa raíz de
// la "cola" + desvíos falsos + recálculo reportados en prueba real). Constante propia,
// NO reutiliza UMBRAL_DESVIO_INMEDIATO_METROS aunque el valor numérico coincida hoy:
// selección de segmento y confirmación de desvío son conceptos distintos — un cambio
// futuro del umbral de desvío no debe alterar accidentalmente esta selección.
const MAX_EXCESO_DISTANCIA_POR_SENTIDO_METROS = 120;

// Heading (GPS real o interpolado) por debajo de esta velocidad NO se usa para
// descartar segmentos por sentido — a paso de hombre o detenido, el heading reportado
// es ruidoso y no representa una dirección de marcha real. ~9 km/h.
const VELOCIDAD_MIN_HEADING_CONFIABLE_MPS = 2.5;

// Fix con accuracy peor que esto (metros) no se usa para reelegir segmento/recorte ni
// para sumar una lectura de desvío ese tick — se vio en una prueba real un fix con
// accuracy=110m que por sí solo ya superaba el propio umbral de desvío (35m), sin que
// el vehículo se hubiera movido. 50m es generoso para no rechazar fixes normales
// (típico 3-15m con cielo despejado, hasta ~30-50m en condiciones marginales) pero
// corta el caso de 110m documentado.
const UMBRAL_ACCURACY_MALA_METROS = 50;

// Techo absoluto de toleranciaOrigen en sembrarProgresoRutaNueva (excepción de siembra
// del índice 0 — ver ese callback). Sin techo, un accuracy alto pero no filtrado ahí
// (a diferencia del efecto de desvío/recorte, que directamente ignoran el fix si
// accuracy > UMBRAL_ACCURACY_MALA_METROS) podía ensanchar la tolerancia hasta el mismo
// orden de magnitud que la separación típica entre calzadas de una autopista dividida o
// una colectora paralela, permitiendo "priorizar" un candidato que en los hechos está
// sobre la calzada incorrecta. Reutiliza UMBRAL_DISTANCIA_CONSISTENCIA_METROS (15m): ya
// es, en este mismo archivo, el criterio de "por debajo de esto, ruido de geometría/GPS,
// no señal real" — mismo valor, en vez de un segundo número arbitrario sin motivo.
const TOPE_TOLERANCIA_ORIGEN_SIEMBRA_METROS = UMBRAL_DISTANCIA_CONSISTENCIA_METROS;

// Dos candidatos NO adyacentes (>2 índices de diferencia — evita disparar por puntos
// vecinos normales de la misma curva) a una distancia perpendicular casi idéntica:
// señal de ambigüedad real entre dos calzadas/ramales distintos, digna de loguear.
const UMBRAL_AMBIGUEDAD_METROS = 5;

// ─── Máquina de estado de maniobra: distancia por recorrido de ruta, 3 niveles ────
// Reemplaza el escaneo de todos los steps por proximidad geodésica directa (causa
// confirmada de maniobras adelantadas/pisadas: la distancia vehículo→step se medía en
// línea recta, no siguiendo la calle, y CUALQUIER step dentro del umbral podía
// calificar en cualquier tick, no sólo el que corresponde según el progreso real).
// Un único "maniobraActualIndex" avanza sólo cuando el progreso sobre la polyline
// (indiceRutaVisibleRef) alcanza el inicio del PRÓXIMO step — nunca por proximidad.
// LEJANO/MEDIO/CERCANO: mismo umbral para giros y salidas ahora (antes tenían
// conjuntos de umbrales separados) — valores pedidos explícitamente, no ajustados a
// ciegas. Si al inicializar una maniobra la distancia real ya es menor a un nivel,
// ese nivel (y los más lejanos) se marca directamente como "ya pasado" sin
// reproducirlo — nunca se anuncian avisos atrasados.
//
// Cada nivel se dispara por CRUCE explícito (distanciaAnterior > umbral && distanciaRuta
// <= umbral, ver el efecto de maniobra/voz), nunca por un timer ni por una velocidad
// supuesta — así queda correcto en todo el rango ~20-250km/h: a 250km/h (~69.4 m/s) un
// solo intervalo entre lecturas GPS puede perfectamente saltar de más de 600m a menos de
// 400m sin haber pasado nunca por un valor "cercano a 600" — el cruce se detecta igual
// porque compara contra el umbral, no contra un valor exacto. Si ese mismo salto cruza
// varios niveles a la vez, se marcan TODOS como consumidos pero se anuncia sólo el más
// cercano (más útil) — ver ese mismo efecto.
const UMBRAL_MANIOBRA_LEJANO_METROS  = 600;
const UMBRAL_MANIOBRA_MEDIO_METROS   = 400;
const UMBRAL_MANIOBRA_CERCANO_METROS = 200;
// "Completada": el progreso sobre la polyline alcanzó el inicio del step SIGUIENTE
// (o el final de la ruta, si es el último step) — no una distancia arbitraria.

// ─── Prioridad y espaciado de anuncios por voz ─────────────────────────────────
// Dos prioridades: "informativo" (p.ej. "Ruta recalculada.") y "maniobra" (giros,
// salidas). Una maniobra SIEMPRE puede interrumpir un informativo sin esperar este
// cooldown — evita silenciar una instrucción real por culpa de un mensaje de cortesía.
// Entre dos anuncios de la MISMA prioridad (dos informativos, o dos maniobras) sí se
// exige este espaciado mínimo, para que no se corten entre sí sin necesidad — si la
// segunda maniobra sigue siendo válida, se reintenta en el próximo tick (no se pierde,
// sólo se posterga).
const COOLDOWN_ANUNCIO_MISMA_PRIORIDAD_MS = 2500;

// Distancia geodésica simple (haversine) entre dos puntos, en metros.
const distanciaMetros = (a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral): number => {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

// Heading siempre en el rango 0-359, incluso si el cálculo produce negativos.
const normalizarHeading = (h: number): number => ((h % 360) + 360) % 360;

// Rumbo inicial (bearing) desde el punto a hacia el punto b, en grados 0-359.
// Fallback de heading cuando el GPS no trae uno válido — ver restaurarCamaraNavegacion.
const calcularBearing = (a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral): number => {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizarHeading((Math.atan2(y, x) * 180) / Math.PI);
};

// Un valor de heading GPS válido, o null (nunca NaN/undefined) — usado tanto por la
// animación de cámara como por el punto de partida de cada tramo interpolado.
const headingValido = (h: number | null | undefined): number | null =>
  h !== null && h !== undefined && !Number.isNaN(h) ? h : null;

// Diferencia angular absoluta entre dos rumbos, siempre en el rango 0-180°.
const diferenciaAngularGrados = (a: number, b: number): number =>
  Math.abs(((a - b + 540) % 360) - 180);

// Evalúa si `nuevo` es un fix GPS plausible dado el último fix ACEPTADO (`anterior`,
// con su timestamp) y, si existe, el aceptado antes de ése (`penultimo` — para poder
// calcular el rumbo de la trayectoria reciente real). Filtros en cadena: intervalo
// demasiado corto (duplicado vs. outlier — nunca se acepta un salto grande sólo porque
// llegó rápido), velocidad implícita (techo físico absoluto) y, sólo para saltos de
// cierta distancia, consistencia de rumbo contra el heading que reportó el GPS para
// este fix y/o contra el rumbo de los últimos fixes ya aceptados — si NINGUNA
// referencia disponible coincide con la dirección del salto, se rechaza. Si no hay
// ninguna referencia de rumbo disponible (sin heading y sin fix previo al anterior),
// no se puede evaluar consistencia y se acepta con sólo el filtro de velocidad.
// `actualizarBase` en la respuesta positiva indica si el llamador debe correr
// ultimoFixValidoRef/ultimoFixValidoTsRef a este fix (false sólo para duplicados de
// alta frecuencia, ver más abajo). No decide nada sobre cámara/heading/voz — sólo si
// este fix se usa o se descarta.
const evaluarConsistenciaFix = (
  anterior: google.maps.LatLngLiteral | null,
  anteriorTs: number | null,
  penultimo: google.maps.LatLngLiteral | null,
  nuevo: google.maps.LatLngLiteral,
  ahora: number,
  headingGpsNuevo: number | null
): { aceptado: true; actualizarBase: boolean } | { aceptado: false; motivo: string } => {
  if (!anterior || anteriorTs === null) return { aceptado: true, actualizarBase: true }; // primer fix: nada contra qué comparar

  const dtMs = ahora - anteriorTs;
  const distancia = distanciaMetros(anterior, nuevo);

  if (dtMs < INTERVALO_MIN_VALIDACION_VELOCIDAD_MS) {
    // Intervalo demasiado corto para que una velocidad calculada sea confiable — nunca
    // se acepta un salto grande sólo porque llegó rápido, así que acá NO se calcula
    // velocidad implícita para decidir: sólo se mira la distancia.
    if (distancia <= UMBRAL_DUPLICADO_METROS) {
      // Fix casi idéntico llegado casi de inmediato — ruido/duplicado de alta
      // frecuencia, no información nueva. Se acepta (se puede usar su posición) pero
      // SIN adelantar la base temporal: si se adelantara, una ráfaga de duplicados
      // podría ir "reseteando el reloj" indefinidamente y nunca acumular el dt
      // necesario para poder evaluar velocidad/rumbo contra el próximo fix real.
      return { aceptado: true, actualizarBase: false };
    }
    return {
      aceptado: false,
      motivo: `saltoRapido distancia=${Math.round(distancia)}m dtMs=${dtMs} (< ${INTERVALO_MIN_VALIDACION_VELOCIDAD_MS}ms)`,
    };
  }

  const velocidadImplicita = distancia / (dtMs / 1000);
  if (velocidadImplicita > VELOCIDAD_MAX_FIX_MPS) {
    return {
      aceptado: false,
      motivo: `velocidadImplicita=${velocidadImplicita.toFixed(1)}m/s distancia=${Math.round(distancia)}m dtMs=${dtMs}`,
    };
  }

  if (distancia < UMBRAL_DISTANCIA_CONSISTENCIA_METROS) return { aceptado: true, actualizarBase: true }; // salto chico: el rumbo no es señal confiable

  const rumboSalto = calcularBearing(anterior, nuevo);
  const referencias: number[] = [];
  if (headingGpsNuevo !== null) referencias.push(headingGpsNuevo);
  if (penultimo) referencias.push(calcularBearing(penultimo, anterior));
  if (referencias.length === 0) return { aceptado: true, actualizarBase: true }; // sin heading ni tendencia previa: no se puede evaluar rumbo

  const coincideConAlguna = referencias.some(
    r => diferenciaAngularGrados(rumboSalto, r) <= UMBRAL_INCONSISTENCIA_RUMBO_GRADOS
  );
  if (!coincideConAlguna) {
    return {
      aceptado: false,
      motivo: `rumboInconsistente salto=${Math.round(rumboSalto)}° referencias=[${referencias.map(r => Math.round(r)).join(",")}]° distancia=${Math.round(distancia)}m dtMs=${dtMs}`,
    };
  }
  return { aceptado: true, actualizarBase: true };
};

// Punto a `distanciaM` metros de `origen`, en la dirección `headingGrados` — fórmula
// estándar de "destino por rumbo y distancia" sobre una esfera. Usado para el look-ahead
// de cámara: desplaza el punto de centrado un poco adelante del vehículo, en la
// dirección real de marcha (ver pasoAnimacion/restaurarCamaraNavegacion).
const puntoAdelantado = (
  origen: google.maps.LatLngLiteral,
  headingGrados: number,
  distanciaM: number
): google.maps.LatLngLiteral => {
  const R = 6371000;
  const brng = (headingGrados * Math.PI) / 180;
  const lat1 = (origen.lat * Math.PI) / 180;
  const lng1 = (origen.lng * Math.PI) / 180;
  const angDist = distanciaM / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
};

// Desplaza el CENTRO de la cámara por píxeles de pantalla (no por grados) — técnica
// estándar de Maps JS API: convierte `punto` a coordenadas de mundo (independientes del
// zoom), resta el offset ya escalado por el zoom vigente, y convierte de vuelta a
// LatLng. Se usa para que el camión no quede en el centro geométrico del contenedor del
// mapa, sino más abajo — "corriendo" el centro real de la cámara hacia arriba en la
// misma medida (ver calcularOffsetVerticalCamara, que calcula offsetYPx). null si el
// mapa todavía no tiene proyección/zoom listos (arranque) — el llamador cae a `punto`
// sin offset en ese caso, nunca rompe.
const puntoConOffsetVerticalPx = (
  mapa: google.maps.Map,
  punto: google.maps.LatLngLiteral,
  offsetYPx: number
): google.maps.LatLngLiteral | null => {
  if (offsetYPx === 0) return punto;
  const proyeccion = mapa.getProjection();
  const zoom = mapa.getZoom();
  if (!proyeccion || zoom === undefined) return null;
  const escala = Math.pow(2, zoom);
  const puntoMundo = proyeccion.fromLatLngToPoint(new google.maps.LatLng(punto.lat, punto.lng));
  if (!puntoMundo) return null;
  const nuevoPuntoMundo = new google.maps.Point(puntoMundo.x, puntoMundo.y - offsetYPx / escala);
  const nuevoLatLng = proyeccion.fromPointToLatLng(nuevoPuntoMundo);
  return nuevoLatLng ? { lat: nuevoLatLng.lat(), lng: nuevoLatLng.lng() } : null;
};

// ─── Resolución del tema "Automático" ──────────────────────────────────────
// google.maps.ColorScheme.FOLLOW_SYSTEM (lo que se usaba antes) delega la decisión
// a Google/el WebView — y en el WebView de Capacitor no hay garantía de que
// `prefers-color-scheme` refleje el tema real del sistema operativo, lo que hacía que
// "Automático" terminara comportándose siempre como "Oscuro". Se resuelve explícitamente
// por HORARIO LOCAL únicamente — decisión explícita: no se usa la preferencia del SO
// para esto, porque un dispositivo con "modo oscuro" del sistema activado de forma
// permanente (algo muy común) haría que "Automático" coincidiera con "Noche" a toda
// hora, de día también. HORA_INICIO_NOCHE/HORA_FIN_NOCHE son las únicas dos constantes
// a ajustar si el corte día/noche necesita cambiar.
const HORA_INICIO_NOCHE = 19; // 19:00
const HORA_FIN_NOCHE    = 6;  // 06:00
const resolverTemaAutomatico = (): "dia" | "noche" => {
  const hora = new Date().getHours();
  return hora >= HORA_INICIO_NOCHE || hora < HORA_FIN_NOCHE ? "noche" : "dia";
};

// Interpolación angular por el camino más corto (0-359°) — evita que un giro real de,
// por ejemplo, 350° a 10° (20° reales) se anime como un giro de 340° en sentido contrario,
// que es lo que daría una interpolación lineal ingenua sobre los valores crudos.
const interpolarHeading = (desde: number, hasta: number, t: number): number => {
  const diferencia = ((hasta - desde + 540) % 360) - 180;
  return normalizarHeading(desde + diferencia * t);
};

// Constante de conversión grados↔metros, usada por proyeccionEnSegmento más abajo
// (proyección sobre un plano local equirectangular — precisión sobrada para las
// distancias cortas, decenas/cientos de metros, que interesan acá).
const METROS_POR_GRADO_LAT = 111320;

// Polyline DETALLADA de una respuesta de Directions, concatenando la geometría real de
// cada step (leg.steps[].path[]) en vez de result.routes[0].overview_path. overview_path
// es una versión simplificada (Douglas-Peucker) pensada para dibujar el mapa general a
// bajo zoom — Google NO garantiza que su primer punto coincida con el origen real de la
// ruta: un tramo inicial corto (p.ej. maniobra de entrada a la calle principal) puede
// quedar "suavizado" y el primer punto del overview terminar a varias decenas de metros
// del origen enviado. step.path[], en cambio, es la geometría densa y precisa de cada
// tramo, y su primer punto coincide con legs[0].start_location (el origen real/snapeado).
// Se deduplica el punto de unión entre steps consecutivos (el último punto de un step es
// el mismo que el primero del siguiente) para no dejar segmentos de longitud cero que
// puedan "ganar" espuriamente una búsqueda de distancia mínima.
//
// También devuelve `indicePorStep`: indicePorStep[i] = índice dentro de `puntos` (ya
// deduplicado) donde arranca la geometría del step i (steps de TODOS los legs,
// concatenados en el mismo orden que usa la voz — pasos[i] = ese mismo step). Es un
// subproducto gratis de este mismo recorrido (no hace falta un segundo pase de
// búsqueda): al momento de empezar a procesar el step i, `puntos.length` YA es el
// índice donde van a caer sus puntos, se deduplique o no el primero (si se deduplica
// por ser igual al último punto del step anterior, el SIGUIENTE punto nuevo cae
// exactamente ahí de todos modos). Usado por la máquina de estado de maniobra para
// calcular distancia recorriendo la polyline hasta cada step, sin tener que buscar su
// posición por proximidad geométrica cada vez.
const construirPolylineDetalladaDesdeRuta = (
  result: google.maps.DirectionsResult,
  // Cuántos legs (desde el principio) participan de la navegación — ver
  // legsActivosNavRef: mientras exista una parada tipo "retiro" pendiente, se pasa 1
  // para que el tramo A→B (legs[1]) no entre en NINGUNA estructura de navegación
  // (polyline, indicePorStep, progreso, recorte, desvío, maniobras, voz). undefined =
  // todos los legs (comportamiento de siempre — usado por los demás call-sites de
  // calcularRuta, que no pasan este parámetro).
  legsActivos?: number
): { puntos: google.maps.LatLngLiteral[]; indicePorStep: number[] } => {
  const legs = (result.routes?.[0]?.legs ?? []).slice(0, legsActivos ?? Infinity);
  const puntos: google.maps.LatLngLiteral[] = [];
  const indicePorStep: number[] = [];
  legs.forEach(leg => {
    (leg.steps ?? []).forEach(step => {
      // El primer punto de step.path puede deduplicarse más abajo si coincide con el
      // último punto ya agregado (el step anterior termina justo donde éste arranca —
      // caso normal, casi todos los steps encadenan así). Si eso pasa, puntos.length
      // (sin corregir) apuntaría al SIGUIENTE punto (el primero realmente nuevo de
      // este step), no al punto donde ocurre la maniobra — causa confirmada de
      // calcularDistanciaRutaHastaIndice sumando de más el tramo posterior al giro
      // (ej.: aviso a 190m cuando el giro real estaba a ~70m). Si el primer punto del
      // step NO coincide con el último ya agregado (arranque de leg, o geometría que
      // no encadena exacto), el índice sigue siendo puntos.length, como antes.
      const path = step.path ?? [];
      const primerPath = path[0] ? { lat: path[0].lat(), lng: path[0].lng() } : null;
      const ultimoExistente = puntos[puntos.length - 1];
      const comparteInicio =
        !!primerPath
        && !!ultimoExistente
        && ultimoExistente.lat === primerPath.lat
        && ultimoExistente.lng === primerPath.lng;
      indicePorStep.push(comparteInicio ? puntos.length - 1 : puntos.length);
      path.forEach(p => {
        const punto = { lat: p.lat(), lng: p.lng() };
        const anterior = puntos[puntos.length - 1];
        if (!anterior || anterior.lat !== punto.lat || anterior.lng !== punto.lng) {
          puntos.push(punto);
        }
      });
    });
  });
  return { puntos, indicePorStep };
};

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES API — exclusivo de navegación activa (calcularRutaNavegacionDireccional más
// abajo en el componente). Los otros 3 call-sites de calcularRuta (recorrido-chofer,
// multietapa, simple) siguen usando DirectionsService, sin tocar.
// ═══════════════════════════════════════════════════════════════════════════

// Field mask mínimo — sólo los campos que el adaptador de abajo realmente lee.
// computeRoutes lo exige (sin esto la respuesta viene vacía); pedir sólo lo necesario
// es la recomendación explícita de Google (mejor performance/estabilidad que "*").
const FIELD_MASK_ROUTES_API_NAVEGACION =
  "routes.legs.steps.navigationInstruction,routes.legs.steps.polyline.encodedPolyline,"
  + "routes.legs.steps.startLocation,routes.legs.steps.endLocation,"
  + "routes.legs.startLocation,routes.legs.endLocation";

// Routes API devuelve maniobras en MAYUSCULA_CON_GUION_BAJO (TURN_LEFT, UTURN_RIGHT,
// ...); la máquina de voz ya existente (construirTextoManiobra, lado/esSalida en el
// efecto de maniobras) espera el formato clásico de DirectionsService (minúscula con
// guiones: "turn-left"). Mapeo mecánico, sin lógica — la voz no cambia una línea.
const MANIOBRA_ROUTES_API_A_CLASICA: Record<string, string> = {
  TURN_SLIGHT_LEFT: "turn-slight-left",
  TURN_SHARP_LEFT: "turn-sharp-left",
  UTURN_LEFT: "uturn-left",
  TURN_LEFT: "turn-left",
  TURN_SLIGHT_RIGHT: "turn-slight-right",
  TURN_SHARP_RIGHT: "turn-sharp-right",
  UTURN_RIGHT: "uturn-right",
  TURN_RIGHT: "turn-right",
  STRAIGHT: "straight",
  RAMP_LEFT: "ramp-left",
  RAMP_RIGHT: "ramp-right",
  MERGE: "merge",
  FORK_LEFT: "fork-left",
  FORK_RIGHT: "fork-right",
  FERRY: "ferry",
  FERRY_TRAIN: "ferry-train",
  ROUNDABOUT_LEFT: "roundabout-left",
  ROUNDABOUT_RIGHT: "roundabout-right",
  DEPART: "depart",
  ARRIVE: "arrive",
  NAME_CHANGE: "name-change",
};

interface RoutesApiLatLng { latitude: number; longitude: number }
interface RoutesApiStep {
  navigationInstruction?: { maneuver?: string };
  polyline?: { encodedPolyline?: string };
  startLocation?: { latLng?: RoutesApiLatLng };
  endLocation?: { latLng?: RoutesApiLatLng };
}
interface RoutesApiLeg {
  steps?: RoutesApiStep[];
  startLocation?: { latLng?: RoutesApiLatLng };
  endLocation?: { latLng?: RoutesApiLatLng };
}
interface RoutesApiResponse {
  routes?: { legs?: RoutesApiLeg[] }[];
}

// Waypoint de origen para Routes API — incluye heading SOLO si headingConfiable no es
// null (siempre headingAceptadoRef.current en el call-site real — NUNCA heading crudo/
// rechazado). Sin heading confiable se manda sólo lat/lng, igual que DirectionsService
// siempre hizo (nunca tuvo heading para empezar). Redondeado y normalizado a [0,360) —
// Routes API espera un entero de grados.
// heading va DENTRO de location (hermano de latLng), no del Waypoint — confirmado
// contra la referencia oficial del mensaje Location de Routes API. La versión
// anterior lo ponía como hermano de location (un nivel afuera de donde corresponde),
// candidato fuerte al 400 visto en prueba real (ver ROUTES_API_ERROR).
const construirWaypointOrigenDireccional = (
  fix: google.maps.LatLngLiteral,
  headingConfiable: number | null
) => ({
  location: {
    latLng: { latitude: fix.lat, longitude: fix.lng },
    ...(headingConfiable !== null ? { heading: Math.round(((headingConfiable % 360) + 360) % 360) } : {}),
  },
});

// Adapta la respuesta de Routes API a una forma compatible con
// google.maps.DirectionsResult — SOLO los campos que el resto de MapaTILA ya lee en
// modoNavegacion (construirPolylineDetalladaDesdeRuta, la máquina de voz,
// encuadrarDesdeRuta). Ninguno de esos consumidores cambia: siguen leyendo
// exactamente la misma forma que con DirectionsService. El cast final a
// DirectionsResult es deliberado (duck typing) — cubre sólo los campos realmente
// usados en el camino de navegación, no el shape completo de la API real.
const adaptarRespuestaRoutesAPI = (json: RoutesApiResponse): google.maps.DirectionsResult | null => {
  const ruta = json.routes?.[0];
  if (!ruta) return null;
  const aLatLng = (l?: { latLng?: RoutesApiLatLng }) =>
    l?.latLng ? new google.maps.LatLng(l.latLng.latitude, l.latLng.longitude) : undefined;
  const legs = (ruta.legs ?? []).map(leg => ({
    start_location: aLatLng(leg.startLocation),
    end_location: aLatLng(leg.endLocation),
    steps: (leg.steps ?? []).map(step => ({
      path: step.polyline?.encodedPolyline
        ? google.maps.geometry.encoding.decodePath(step.polyline.encodedPolyline)
        : [],
      maneuver: MANIOBRA_ROUTES_API_A_CLASICA[step.navigationInstruction?.maneuver ?? ""] ?? "",
      start_location: aLatLng(step.startLocation),
      end_location: aLatLng(step.endLocation),
    })),
  }));
  return { routes: [{ legs, overview_path: [] }] } as unknown as google.maps.DirectionsResult;
};

// ─── Selección de segmento activo (compartida por desvío y recorte visual) ────────
// Ver el bloque de constantes junto a VENTANA_ADELANTE_METROS para la explicación
// completa de la causa que esto corrige. Dos defensas, combinadas:
//  1) Ventana hacia ADELANTE acotada en METROS (además de la ya existente hacia atrás,
//     VENTANA_ATRAS_SEGMENTOS) — nunca se evalúa un candidato más allá de
//     VENTANA_ADELANTE_METROS de distancia acumulada real desde el índice actual.
//  2) Compatibilidad de sentido: con heading confiable (ver VELOCIDAD_MIN_HEADING_CONFIABLE_MPS),
//     se descarta cualquier candidato cuyo bearing de segmento difiera del heading del
//     vehículo en más de UMBRAL_DIFERENCIA_ANGULAR_SEGMENTO_GRADOS — la calzada
//     contraria (bearing ~180° opuesto al de marcha) no puede ganar sólo por estar
//     unos metros más cerca. Si NINGÚN candidato de la ventana es compatible (heading
//     real cambiando, p.ej. una maniobra en curso), se cae de vuelta al más cercano
//     sin filtrar — mejor eso que dejar sin ninguna selección.
// Sin heading confiable (detenido, arrancando), el criterio es el de siempre: el más
// cercano dentro de la ventana, sin filtrar por sentido.
interface ResultadoSeleccionSegmento {
  indice: number;
  distancia: number;
  punto: google.maps.LatLngLiteral;
  bearingSegmento: number;
  diferenciaAngular: number | null;
  descartadoPorSentido: boolean;
  saltoIndices: number;
  candidatosEnVentana: number;
  // Candidato geométrico REAL (mejorGlobal) — el más cercano a la posición, SIN filtro de
  // sentido, independiente de si terminó descartado por heading. indice/distancia/punto
  // de arriba siguen siendo el resultado FILTRADO por sentido (elegido), que es lo que
  // corresponde usar para snap/progreso/recorte (ahí el sentido sí importa — evita
  // "pegarse" a la calzada contraria en autopistas divididas). Estos 3 campos son para
  // quien necesite la distancia/posición real a la ruta SIN que ese filtro la infle (ver
  // efecto de desvío y sembrarProgresoRutaNueva).
  distanciaGeometrica: number;
  indiceGeometrico: number;
  puntoGeometrico: google.maps.LatLngLiteral;
}

interface ContextoSeleccionSegmento {
  indiceActual: number;
  headingVehiculo: number | null;
  velocidadVehiculoMps: number | null;
  accuracyMetros: number | null;
  // "siembra": proyección única, síncrona, al aterrizar una ruta nueva (ver
  // sembrarProgresoRutaNueva) — mismo cálculo que "recorte", identificado aparte sólo
  // para que los logs de diagnóstico puedan distinguir el origen.
  origen: "desvio" | "recorte" | "siembra";
  rutaRequestId: number;
}

const elegirSegmentoActivo = (
  polyline: google.maps.LatLngLiteral[],
  posicion: google.maps.LatLngLiteral,
  ctx: ContextoSeleccionSegmento
): ResultadoSeleccionSegmento | null => {
  if (polyline.length < 2) return null;
  const desde = Math.min(Math.max(ctx.indiceActual - VENTANA_ATRAS_SEGMENTOS, 0), polyline.length - 2);

  // Ventana hacia adelante: camina acumulando longitud REAL de cada tramo desde
  // `desde` hasta superar VENTANA_ADELANTE_METROS (o llegar al final de la polyline).
  let hasta = desde;
  let acumuladoMetros = 0;
  while (hasta < polyline.length - 2 && acumuladoMetros < VENTANA_ADELANTE_METROS) {
    acumuladoMetros += distanciaMetros(polyline[hasta], polyline[hasta + 1]);
    hasta++;
  }

  const headingConfiable =
    ctx.headingVehiculo !== null
    && ctx.velocidadVehiculoMps !== null
    && ctx.velocidadVehiculoMps >= VELOCIDAD_MIN_HEADING_CONFIABLE_MPS;

  type Candidato = { indice: number; distancia: number; punto: google.maps.LatLngLiteral; bearing: number };
  const candidatos: Candidato[] = [];
  for (let i = desde; i <= hasta; i++) {
    const { distancia, punto } = proyeccionEnSegmento(posicion, polyline[i], polyline[i + 1]);
    candidatos.push({ indice: i, distancia, punto, bearing: calcularBearing(polyline[i], polyline[i + 1]) });
  }
  if (candidatos.length === 0) return null;

  let mejorGlobal = candidatos[0];
  for (const c of candidatos) if (c.distancia < mejorGlobal.distancia) mejorGlobal = c;

  const esCompatible = (c: Candidato): boolean =>
    !headingConfiable || diferenciaAngularGrados(ctx.headingVehiculo!, c.bearing) <= UMBRAL_DIFERENCIA_ANGULAR_SEGMENTO_GRADOS;

  let mejorCompatible: Candidato | null = null;
  for (const c of candidatos) {
    if (!esCompatible(c)) continue;
    if (!mejorCompatible || c.distancia < mejorCompatible.distancia) mejorCompatible = c;
  }

  const descartadoPorSentido = headingConfiable && !esCompatible(mejorGlobal);

  // El heading puede desempatar entre candidatos geométricamente razonables, pero nunca
  // debe permitir elegir un segmento cientos de metros más lejano que el geométricamente
  // más cercano (mejorGlobal) — ver MAX_EXCESO_DISTANCIA_POR_SENTIDO_METROS. Sólo puede
  // ser true cuando mejorGlobal ya es incompatible (si fuera compatible, sería también
  // el propio mejorCompatible, exceso=0) — mismo caso que descartadoPorSentido, más la
  // condición de distancia.
  const excesoDistanciaCompatible = mejorCompatible !== null
    ? mejorCompatible.distancia - mejorGlobal.distancia
    : null;
  const compatibleDemasiadoLejos = excesoDistanciaCompatible !== null
    && excesoDistanciaCompatible > MAX_EXCESO_DISTANCIA_POR_SENTIDO_METROS;

  const elegido = (headingConfiable && mejorCompatible && !compatibleDemasiadoLejos) ? mejorCompatible : mejorGlobal;
  const diferenciaAngular = headingConfiable ? diferenciaAngularGrados(ctx.headingVehiculo!, elegido.bearing) : null;

  if (compatibleDemasiadoLejos && mejorCompatible) {
    diagLog(
      `[TILA_NAV_DIAG] segmento-activo(${ctx.origen}) CANDIDATO_COMPATIBLE_DEMASIADO_LEJOS `
      + `indiceGlobal=${mejorGlobal.indice} distanciaGlobal=${Math.round(mejorGlobal.distancia)}m `
      + `diferenciaAngularGlobal=${Math.round(diferenciaAngularGrados(ctx.headingVehiculo!, mejorGlobal.bearing))}° `
      + `indiceCompatible=${mejorCompatible.indice} distanciaCompatible=${Math.round(mejorCompatible.distancia)}m `
      + `diferenciaAngularCompatible=${Math.round(diferenciaAngularGrados(ctx.headingVehiculo!, mejorCompatible.bearing))}° `
      + `excesoMetros=${Math.round(excesoDistanciaCompatible!)} `
      + `headingVehiculo=${Math.round(ctx.headingVehiculo!)}° `
      + `accuracy=${ctx.accuracyMetros ?? "n/a"} `
      + `velocidad=${ctx.velocidadVehiculoMps !== null ? ctx.velocidadVehiculoMps.toFixed(1) : "n/a"}m/s `
      + `rutaRequestId=${ctx.rutaRequestId} elegido=global t=${Math.round(performance.now())}`
    );
  }

  // Log SELECTIVO — nunca por cada candidato evaluado (ver requerimiento de no
  // inundar el panel): sólo cuando el más cercano crudo fue rechazado por sentido, o
  // cuando dos candidatos NO adyacentes (>2 índices — descarta vecinos normales de la
  // misma curva) empatan en distancia (ambigüedad real entre calzadas/ramales).
  if (descartadoPorSentido) {
    // Antes este log mezclaba bearing/indice/distancia de mejorGlobal (el descartado)
    // con el diferenciaAngular de elegido (un candidato DISTINTO) en la misma línea, sin
    // distinguirlos — parecía una inconsistencia matemática (headingVehiculo vs
    // bearingSegmento no daba el diferenciaAngular mostrado) cuando en realidad eran dos
    // segmentos distintos. Ahora cada grupo trae SUS propios indice/distancia/bearing/
    // diferenciaAngular, explícitamente etiquetado.
    const diferenciaAngularDescartado = diferenciaAngularGrados(ctx.headingVehiculo!, mejorGlobal.bearing);
    diagLog(
      `[TILA_NAV_DIAG] segmento-activo(${ctx.origen}) DESCARTADO_POR_SENTIDO `
      + `indiceAnterior=${ctx.indiceActual} `
      + `descartado(indice=${mejorGlobal.indice} distancia=${Math.round(mejorGlobal.distancia)}m bearing=${Math.round(mejorGlobal.bearing)}° diferenciaAngular=${Math.round(diferenciaAngularDescartado)}°) `
      + `elegido(indice=${elegido.indice} distancia=${Math.round(elegido.distancia)}m bearing=${Math.round(elegido.bearing)}° diferenciaAngular=${diferenciaAngular !== null ? Math.round(diferenciaAngular) : "n/a"}°) `
      + `headingVehiculo=${Math.round(ctx.headingVehiculo!)}° `
      + `velocidad=${ctx.velocidadVehiculoMps !== null ? ctx.velocidadVehiculoMps.toFixed(1) : "n/a"}m/s `
      + `accuracy=${ctx.accuracyMetros ?? "n/a"} candidatosEnVentana=${candidatos.length} rutaRequestId=${ctx.rutaRequestId} t=${Math.round(performance.now())}`
    );
  }
  const ambiguo = candidatos.find(c =>
    c.indice !== mejorGlobal.indice
    && Math.abs(c.indice - mejorGlobal.indice) > 2
    && Math.abs(c.distancia - mejorGlobal.distancia) <= UMBRAL_AMBIGUEDAD_METROS
  );
  if (ambiguo) {
    diagLog(
      `[TILA_NAV_DIAG] segmento-activo(${ctx.origen}) AMBIGUEDAD `
      + `indiceA=${mejorGlobal.indice} distanciaA=${Math.round(mejorGlobal.distancia)}m `
      + `indiceB=${ambiguo.indice} distanciaB=${Math.round(ambiguo.distancia)}m indiceElegido=${elegido.indice} `
      + `rutaRequestId=${ctx.rutaRequestId} t=${Math.round(performance.now())}`
    );
  }

  return {
    indice: elegido.indice,
    distancia: elegido.distancia,
    punto: elegido.punto,
    bearingSegmento: elegido.bearing,
    diferenciaAngular,
    descartadoPorSentido,
    saltoIndices: elegido.indice - ctx.indiceActual,
    candidatosEnVentana: candidatos.length,
    distanciaGeometrica: mejorGlobal.distancia,
    indiceGeometrico: mejorGlobal.indice,
    puntoGeometrico: mejorGlobal.punto,
  };
};

// Distancia mínima de un punto a la polyline — wrapper delgado sobre
// elegirSegmentoActivo, conserva la firma {distancia, indice} que ya usa el efecto de
// desvío. null si la polyline todavía no tiene al menos 2 puntos.
const distanciaMinAPolyline = (
  p: google.maps.LatLngLiteral,
  puntos: google.maps.LatLngLiteral[],
  indiceDesde: number,
  headingVehiculo: number | null,
  velocidadVehiculoMps: number | null,
  accuracyMetros: number | null,
  rutaRequestId: number
): { distancia: number; indice: number; distanciaGeometrica: number } | null => {
  const resultado = elegirSegmentoActivo(puntos, p, {
    indiceActual: indiceDesde, headingVehiculo, velocidadVehiculoMps, accuracyMetros,
    origen: "desvio", rutaRequestId,
  });
  return resultado
    ? { distancia: resultado.distancia, indice: resultado.indice, distanciaGeometrica: resultado.distanciaGeometrica }
    : null;
};

// ─── Recorte visual de la traza (SOLO representación — rutaPolylineRef sigue intacta
// para rerouting/maniobras/llegada, ver el efecto que usa esto más abajo) ──────────
// Distancia detrás del vehículo que se mantiene visible, para dar continuidad — la
// traza no debe cortar exactamente debajo del ícono del camión. Bajado de 20 a 8:
// con la geometría DETALLADA (steps[].path[], muchos puntos densos y cortos — ver
// construirPolylineDetalladaDesdeRuta) un margen de 20m recorría varios de esos puntos
// cortos en cada tick, y el punto de arranque de la "colita" saltaba de forma visible
// entre ellos en vez de recortar suave — confirmado en prueba real ("colita" que se
// corta por partes y desaparece). Un margen más chico da menos tramos sobre los que
// saltar, sin perder la continuidad visual bajo el ícono.
const MARGEN_RUTA_DETRAS_METROS = 8;

// Proyección de un punto sobre el segmento a-b: distancia y el punto proyectado —
// usada por elegirSegmentoActivo (necesita el punto, no sólo la distancia, para poder
// recortar/dibujar la polyline ahí).
const proyeccionEnSegmento = (
  p: google.maps.LatLngLiteral,
  a: google.maps.LatLngLiteral,
  b: google.maps.LatLngLiteral
): { distancia: number; punto: google.maps.LatLngLiteral } => {
  const metrosPorGradoLng = METROS_POR_GRADO_LAT * Math.cos((a.lat * Math.PI) / 180);
  const px = (p.lng - a.lng) * metrosPorGradoLng, py = (p.lat - a.lat) * METROS_POR_GRADO_LAT;
  const bx = (b.lng - a.lng) * metrosPorGradoLng, by = (b.lat - a.lat) * METROS_POR_GRADO_LAT;
  const largoCuadrado = bx * bx + by * by;
  const t = largoCuadrado === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / largoCuadrado));
  const punto = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  const distancia = Math.hypot(px - t * bx, py - t * by);
  return { distancia, punto };
};

// Distancia SIGUIENDO LA GEOMETRÍA de la polyline entre la posición actual del
// vehículo (posicionActual, sobre el segmento indiceDesde) y el punto donde arranca el
// step de la maniobra (polyline[indiceHasta]) — no geodésica directa. Usada por la
// máquina de estado de maniobra: evita anunciar "faltan 90m" en línea recta cuando la
// calle en realidad da una vuelta y todavía faltan 300m reales por recorrer.
// indiceHasta <= indiceDesde (ya lo pasamos, o coincide) devuelve 0.
const calcularDistanciaRutaHastaIndice = (
  polyline: google.maps.LatLngLiteral[],
  indiceDesde: number,
  posicionActual: google.maps.LatLngLiteral,
  indiceHasta: number
): number => {
  if (indiceHasta <= indiceDesde || indiceDesde + 1 >= polyline.length) return 0;
  const hastaClamp = Math.min(indiceHasta, polyline.length - 1);
  let total = distanciaMetros(posicionActual, polyline[indiceDesde + 1]);
  for (let i = indiceDesde + 1; i < hastaClamp; i++) {
    total += distanciaMetros(polyline[i], polyline[i + 1]);
  }
  return total;
};

// ═══════════════════════════════════════════════════════════════════════════
// NÚCLEO DE PROGRESO — SHADOW (fase de comparación, ver Alternativa 2). Estas dos
// funciones NO están conectadas al camino real todavía — corren en paralelo,
// exclusivamente diagnóstico, desde un único useEffect dedicado (ver más abajo en el
// componente) que se dispara UNA VEZ POR FIX GPS ACEPTADO — nunca desde pasoAnimacion
// (rAF, ~60fps) y nunca con posición interpolada/visual. snapGeometrico/
// decidirProgreso son puras, sin estado propio — todo el estado shadow vive en los
// refs que declara el efecto que las llama.
// ═══════════════════════════════════════════════════════════════════════════

interface SnapGeometricoResultado {
  indice: number;
  punto: google.maps.LatLngLiteral;
  distancia: number;
  bearing: number;
  ambiguo: boolean;
  desempatadoPorHeading: boolean;
}

// Snap PURO — sólo responde "¿cuál es el punto/segmento geométricamente razonable?".
// No escribe progreso, no aplica monotonicidad, no mueve cámara, no decide maniobras.
// Diferencia estructural clave respecto de elegirSegmentoActivo: acá el heading NUNCA
// compite contra un candidato lejano. Sólo desempata DENTRO de un grupo de candidatos
// ya ambiguos entre sí (misma distancia perpendicular, dentro de UMBRAL_AMBIGUEDAD_METROS
// — 5m, el mismo umbral que ya usa elegirSegmentoActivo para detectar ambigüedad real
// entre calzadas/ramales, no un número nuevo). Si el más cercano no tiene ningún otro
// candidato a esa distancia, el heading no participa en absoluto — geométricamente no
// puede haber un "candidato a 435m" ganándole a uno "a 3m": 435m nunca puede estar
// dentro de 5m del más cercano, así que ni siquiera entra al grupo que el heading
// puede desempatar.
const snapGeometrico = (
  polyline: google.maps.LatLngLiteral[],
  posicion: google.maps.LatLngLiteral,
  indiceReferencia: number,
  headingVehiculo: number | null,
  velocidadVehiculoMps: number | null
): SnapGeometricoResultado | null => {
  if (polyline.length < 2) return null;
  // Misma ventana ya validada que usa elegirSegmentoActivo — sin cambios.
  const desde = Math.min(Math.max(indiceReferencia - VENTANA_ATRAS_SEGMENTOS, 0), polyline.length - 2);
  let hasta = desde;
  let acumuladoMetros = 0;
  while (hasta < polyline.length - 2 && acumuladoMetros < VENTANA_ADELANTE_METROS) {
    acumuladoMetros += distanciaMetros(polyline[hasta], polyline[hasta + 1]);
    hasta++;
  }

  type Candidato = { indice: number; distancia: number; punto: google.maps.LatLngLiteral; bearing: number };
  const candidatos: Candidato[] = [];
  for (let i = desde; i <= hasta; i++) {
    const { distancia, punto } = proyeccionEnSegmento(posicion, polyline[i], polyline[i + 1]);
    candidatos.push({ indice: i, distancia, punto, bearing: calcularBearing(polyline[i], polyline[i + 1]) });
  }
  if (candidatos.length === 0) return null;

  let mejor = candidatos[0];
  for (const c of candidatos) if (c.distancia < mejor.distancia) mejor = c;

  const ambiguos = candidatos.filter(c =>
    c.indice !== mejor.indice
    && Math.abs(c.indice - mejor.indice) > 2
    && Math.abs(c.distancia - mejor.distancia) <= UMBRAL_AMBIGUEDAD_METROS
  );

  let elegido = mejor;
  let desempatadoPorHeading = false;
  const headingConfiable =
    headingVehiculo !== null && velocidadVehiculoMps !== null && velocidadVehiculoMps >= VELOCIDAD_MIN_HEADING_CONFIABLE_MPS;

  if (ambiguos.length > 0 && headingConfiable) {
    const grupo = [mejor, ...ambiguos];
    const compatibles = grupo.filter(c => diferenciaAngularGrados(headingVehiculo!, c.bearing) <= UMBRAL_DIFERENCIA_ANGULAR_SEGMENTO_GRADOS);
    if (compatibles.length > 0 && compatibles.length < grupo.length) {
      let mejorCompatible = compatibles[0];
      for (const c of compatibles) if (c.distancia < mejorCompatible.distancia) mejorCompatible = c;
      if (mejorCompatible.indice !== mejor.indice) {
        elegido = mejorCompatible;
        desempatadoPorHeading = true;
      }
    }
  }

  return {
    indice: elegido.indice,
    punto: elegido.punto,
    distancia: elegido.distancia,
    bearing: elegido.bearing,
    ambiguo: ambiguos.length > 0,
    desempatadoPorHeading,
  };
};

interface ProgresoConfirmado {
  indice: number;
  // Proyección real sobre la polyline en el momento en que se confirmó este progreso
  // — ancla para medir el PRÓXIMO avance (no alcanza con el índice: dentro del mismo
  // segmento hace falta el punto exacto para no perder/inflar metros).
  punto: google.maps.LatLngLiteral;
  distanciaAcumulada: number;
  timestamp: number;
}

interface CandidatoPendienteProgreso {
  indice: number;
  punto: google.maps.LatLngLiteral;
  timestampPrimeraLectura: number;
}

interface ResultadoDecisionProgreso {
  progreso: ProgresoConfirmado;
  avanzo: boolean;
  motivo: "avanzo" | "sin_avance" | "salto_no_confirmado" | "salto_confirmado";
}

// Margen de seguridad EXPLÍCITO sobre "distancia = velocidad × tiempo" — no es un
// techo de distancia fijo (exactamente lo que falló en elegirSegmentoActivo: un
// número en metros que no escala con la velocidad real). Declarado como factor, no
// oculto: 3x cubre una aceleración fuerte entre dos fixes GPS (intervalos típicos
// 1-3s, ver DURACION_ANIMACION_MAX_MS) más el margen de error de la velocidad
// instantánea que reporta el GPS. Sin velocidad conocida (arranque), el techo de
// emergencia es VELOCIDAD_MAX_FIX_MPS — constante YA EXISTENTE (evaluarConsistenciaFix),
// no un número nuevo.
const MARGEN_SEGURIDAD_VELOCIDAD_PROGRESO = 3;

// Única puerta de escritura del progreso SHADOW. Recibe EXCLUSIVAMENTE GPS validado
// (gpsValidado) — nunca posición interpolada/visual; eso es responsabilidad exclusiva
// de pasoAnimacion/animarHaciaPosicion, que no tocan esta función.
const decidirProgreso = (
  progresoAnterior: ProgresoConfirmado,
  snap: SnapGeometricoResultado,
  polyline: google.maps.LatLngLiteral[],
  timestampAhora: number,
  velocidadConocidaMps: number | null,
  candidatoPendienteRef: { current: CandidatoPendienteProgreso | null }
): ResultadoDecisionProgreso => {
  // Retrocedió (o quedó en el mismo segmento pero "antes"): nunca es avance real,
  // se trata como jitter — el progreso anterior queda intacto, sin necesitar
  // comparar magnitudes.
  if (snap.indice < progresoAnterior.indice) {
    return { progreso: progresoAnterior, avanzo: false, motivo: "sin_avance" };
  }

  const avanceCandidato = snap.indice === progresoAnterior.indice
    ? distanciaMetros(progresoAnterior.punto, snap.punto)
    : calcularDistanciaRutaHastaIndice(polyline, progresoAnterior.indice, progresoAnterior.punto, snap.indice)
      + distanciaMetros(polyline[snap.indice], snap.punto);

  if (avanceCandidato <= 0) {
    return { progreso: progresoAnterior, avanzo: false, motivo: "sin_avance" };
  }

  const deltaSegundos = Math.max(0, (timestampAhora - progresoAnterior.timestamp) / 1000);
  const techoVelocidad = velocidadConocidaMps !== null && velocidadConocidaMps > 0 ? velocidadConocidaMps : VELOCIDAD_MAX_FIX_MPS;
  const avanceMaximoPlausible = deltaSegundos * techoVelocidad * MARGEN_SEGURIDAD_VELOCIDAD_PROGRESO;

  if (avanceCandidato <= avanceMaximoPlausible) {
    candidatoPendienteRef.current = null;
    return {
      progreso: {
        indice: snap.indice,
        punto: snap.punto,
        distanciaAcumulada: progresoAnterior.distanciaAcumulada + avanceCandidato,
        timestamp: timestampAhora,
      },
      avanzo: true,
      motivo: "avanzo",
    };
  }

  // Salto anómalo: NO se acepta ni se descarta de una — exige confirmación de una
  // segunda lectura coherente con la primera (mismo patrón ya probado en producción
  // para desvío/reenganche de GPS: nunca una sola lectura alcanza para un cambio
  // grande). UMBRAL_DISTANCIA_REENGANCHE_METROS: constante YA EXISTENTE, mismo
  // criterio de "candidatos sucesivos mutuamente cercanos confirman una base nueva".
  const pendiente = candidatoPendienteRef.current;
  const coherenteConPendiente = pendiente !== null
    && distanciaMetros(pendiente.punto, snap.punto) <= UMBRAL_DISTANCIA_REENGANCHE_METROS;

  if (coherenteConPendiente) {
    candidatoPendienteRef.current = null;
    return {
      progreso: {
        indice: snap.indice,
        punto: snap.punto,
        distanciaAcumulada: progresoAnterior.distanciaAcumulada + avanceCandidato,
        timestamp: timestampAhora,
      },
      avanzo: true,
      motivo: "salto_confirmado",
    };
  }

  candidatoPendienteRef.current = { indice: snap.indice, punto: snap.punto, timestampPrimeraLectura: timestampAhora };
  return { progreso: progresoAnterior, avanzo: false, motivo: "salto_no_confirmado" };
};

// TILA_NAV_DIAG — SOLO diagnóstico, no participa de ninguna decisión funcional (snap/
// progreso/recorte siguen usando exclusivamente elegirSegmentoActivo, sin cambios acá).
// Busca el punto más cercano en TODA la polyline recién aplicada, SIN ventana (a
// diferencia de elegirSegmentoActivo, que sólo mira desde el progreso ya confirmado en
// adelante) — para poder ver, apenas aterriza una ruta nueva, si esa polyline ya trae
// geometría por delante del GPS actual o si conserva metros de tramo anterior al punto
// más cercano (ver POLYLINE_ESTADO). indiceMasCercano/metrosAntesDelGps quedan en null
// si la polyline tiene menos de 2 puntos o no hay posición GPS conocida.
const diagnosticarPolylineEstado = (
  polyline: google.maps.LatLngLiteral[],
  gpsActual: google.maps.LatLngLiteral | null
): { indiceMasCercano: number | null; metrosAntesDelGps: number | null } => {
  if (polyline.length < 2 || !gpsActual) return { indiceMasCercano: null, metrosAntesDelGps: null };
  let mejorIndice = 0;
  let mejorDistancia = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const { distancia } = proyeccionEnSegmento(gpsActual, polyline[i], polyline[i + 1]);
    if (distancia < mejorDistancia) { mejorDistancia = distancia; mejorIndice = i; }
  }
  let metrosAntesDelGps = 0;
  for (let i = 0; i < mejorIndice; i++) {
    metrosAntesDelGps += distanciaMetros(polyline[i], polyline[i + 1]);
  }
  return { indiceMasCercano: mejorIndice, metrosAntesDelGps };
};

// Texto de voz para la maniobra actual — sólo derecha/izquierda ("no quiero mensajes
// innecesarios"); llamantes ya filtran maniobras sin lado antes de invocar esto.
const construirTextoManiobra = (esSalida: boolean, lado: string, metros: number): string => {
  if (esSalida) return `En ${metros} metros, tomá la salida a la ${lado}.`;
  return lado === "derecha" ? `En ${metros} metros doblá a la derecha.` : `En ${metros} metros girá a la izquierda.`;
};

// Identidad de una maniobra INDEPENDIENTE de su índice dentro de `pasos` — el índice
// dentro del array de steps deja de ser válido apenas hay un recálculo (Directions
// devuelve un array de steps nuevo), pero el tipo de maniobra y la ubicación real de la
// esquina/bifurcación siguen identificando la MISMA maniobra del mundo real aunque haya
// cambiado la cantidad de steps antes de ella. Redondeo a 5 decimales (~1m) para tolerar
// el ruido de precisión entre dos respuestas de Directions para la misma esquina real.
// Usado por la máquina de voz para decidir si un reroute es "la misma maniobra próxima"
// (preserva avisos ya emitidos) o una maniobra realmente distinta (reinicializa).
const claveManiobra = (paso: google.maps.DirectionsStep): string => {
  const lat = paso.start_location?.lat();
  const lng = paso.start_location?.lng();
  return `${paso.maneuver ?? ""}|${lat !== undefined ? lat.toFixed(5) : "?"}|${lng !== undefined ? lng.toFixed(5) : "?"}`;
};

// Recorta `polyline` para mostrar sólo desde el segmento elegido (ver
// elegirSegmentoActivo, que hace la selección real — acá sólo queda el "retroceder
// margenMetros" para el arranque visual, con continuidad). El índice que se devuelve
// para el próximo tick es el del segmento ELEGIDO, no el retrocedido por el margen —
// el margen es sólo cosmético para el dibujo, nunca mueve el progreso real.
const recortarRutaDesdeVehiculo = (
  polyline: google.maps.LatLngLiteral[],
  posicion: google.maps.LatLngLiteral,
  margenMetros: number,
  indiceMinimo: number,
  headingVehiculo: number | null,
  velocidadVehiculoMps: number | null,
  accuracyMetros: number | null,
  rutaRequestId: number
): {
  puntos: google.maps.LatLngLiteral[];
  indice: number;
  // Punto proyectado sobre el segmento activo y su distancia real al vehículo — SIN el
  // retroceso cosmético de margenMetros aplicado más abajo (ése es sólo para que la
  // traza dibujada no corte justo debajo del ícono). Usado para el snap visual del
  // marcador (ver UMBRAL_CORREDOR_SNAP_VISUAL_METROS) — necesita la posición real sobre
  // la calzada, no la retrocedida.
  snapPunto: google.maps.LatLngLiteral | null;
  snapDistancia: number | null;
} => {
  if (polyline.length < 2) return { puntos: polyline, indice: 0, snapPunto: null, snapDistancia: null };
  const resultado = elegirSegmentoActivo(polyline, posicion, {
    indiceActual: indiceMinimo, headingVehiculo, velocidadVehiculoMps, accuracyMetros,
    origen: "recorte", rutaRequestId,
  });
  if (!resultado) return { puntos: polyline, indice: 0, snapPunto: null, snapDistancia: null };

  // Progreso monotónico ANTES del slice: elegirSegmentoActivo puede devolver un índice
  // DETRÁS de indiceMinimo (p.ej. el más cercano compatible por sentido cae en un tramo
  // ya superado — ver DESCARTADO_POR_SENTIDO). avanzarIndiceProgreso (en el call-site)
  // evita que ESE retroceso se guarde para el próximo tick, pero eso no alcanza: si
  // `puntos` se arma con el índice sin proteger, el recorte visual de ESTE tick ya
  // vuelve a mostrar tramo detrás del vehículo antes de que esa protección actúe. Por
  // eso el clamp acá, antes de tocar `indiceDibujo`/`punto` — nunca recortar desde un
  // índice menor al progreso ya confirmado. Cuando clampea, reproyecta la posición
  // sobre el segmento indiceMinimo (mismo criterio geométrico de elegirSegmentoActivo)
  // en vez de reusar resultado.punto, que corresponde al segmento retrocedido.
  const indiceProtegido = Math.max(resultado.indice, indiceMinimo);
  const puntoProtegido = indiceProtegido === resultado.indice
    ? resultado.punto
    : proyeccionEnSegmento(posicion, polyline[indiceProtegido], polyline[indiceProtegido + 1]).punto;

  const desde = Math.min(Math.max(indiceMinimo - VENTANA_ATRAS_SEGMENTOS, 0), polyline.length - 2);
  // Retroceder margenMetros desde el punto protegido, para continuidad visual — nunca
  // cruza por debajo de `desde` (mismo límite que ya impidió mirar tramos anteriores).
  let restante = margenMetros;
  let indiceDibujo = indiceProtegido;
  let punto = puntoProtegido;
  while (restante > 0 && indiceDibujo > desde) {
    const inicioSegmento = polyline[indiceDibujo];
    const largoHastaInicio = distanciaMetros(punto, inicioSegmento);
    if (largoHastaInicio >= restante) {
      const fraccion = restante / largoHastaInicio;
      punto = {
        lat: punto.lat + (inicioSegmento.lat - punto.lat) * fraccion,
        lng: punto.lng + (inicioSegmento.lng - punto.lng) * fraccion,
      };
      restante = 0;
      break;
    }
    restante -= largoHastaInicio;
    punto = inicioSegmento;
    indiceDibujo -= 1;
  }
  return {
    puntos: [punto, ...polyline.slice(indiceDibujo + 1)],
    indice: indiceProtegido,
    snapPunto: resultado.punto,
    snapDistancia: resultado.distancia,
  };
};

export interface ParadaMapa {
  direccion: string;
  tipo: "retiro" | "entrega" | "parada";
  estado: "pendiente" | "en_curso" | "completada";
}

export interface ChoferEnMapa {
  lat: number;
  lng: number;
  label?: string;
  estado?: string;
}

export interface ResumenRutaLeg {
  distanciaTexto: string;
  distanciaMetros: number;
  duracionTexto: string;
  duracionSegundos: number;
}

export interface ResumenRuta {
  hastaRetiro: ResumenRutaLeg;
  retiroAEntrega: ResumenRutaLeg;
  total: ResumenRutaLeg;
}

interface DiagnosticoMapa {
  directionsStatus: string;
  polylineFallback: boolean;
  puntosPolyline: number;
  geocodingOrigen: string;
  geocodingDestino: string;
  tieneParadas: boolean;
  modoActivo: string;
}

interface MapaTILAProps {
  lat?: number | null;
  lng?: number | null;
  /** Rumbo GPS del chofer en grados (0-360). Sólo se usa en modoNavegacion, y sólo
   *  mientras el seguimiento automático esté activo, para orientar la cámara. */
  heading?: number | null;
  /** accuracy (metros) del último fix GPS fresco, si el navegador la reportó. Se usa
   *  únicamente para no reelegir segmento/sumar lectura de desvío con un fix de mala
   *  precisión — ver UMBRAL_ACCURACY_MALA_METROS. No afecta marcador/cámara/heading. */
  accuracy?: number | null;
  origen: string;
  destino: string;
  paradaActivaDireccion?: string | null;
  soloLectura?: boolean;
  altura?: string;
  paradas?: ParadaMapa[];
  choferes?: ChoferEnMapa[];
  mostrarDiagnostico?: boolean;
  modoNavegacion?: boolean;
  /** Antes de aceptar el viaje: arma la ruta chofer → retiro → entrega usando el GPS real. */
  mostrarRutaDesdeChofer?: boolean;
  /** Se dispara con distancias/tiempos por tramo cuando mostrarRutaDesdeChofer resuelve la ruta. */
  onResumenRuta?: (resumen: ResumenRuta) => void;
  /** Estado visual del botón 🔊/🔇 del cluster de controles. Sin esto, el botón no se
   *  renderiza (comportamiento por defecto sin cambios para quien no lo use). */
  vozActiva?: boolean;
  onToggleVoz?: () => void;
  /** Mensaje de texto listo para hablar (giro próximo, ruta recalculada) — MapaTILA sólo
   *  detecta el evento y arma el texto; no sabe si la voz está activa ni cómo reproducirla,
   *  eso lo decide quien la use (ver app/utils/vozNavegacion.ts). */
  onAnuncioVoz?: (mensaje: string) => void;
  /** Corta cualquier locución en curso, YA — se llama al confirmarse un recálculo, antes
   *  de decidir el próximo anuncio (ver app/utils/vozNavegacion.ts: detenerVoz()). Sin
   *  esto (prop no provista), no se corta nada explícitamente al recalcular — sólo el
   *  reemplazo natural que produce la siguiente llamada a onAnuncioVoz. */
  onDetenerVoz?: () => void;
  /** Coordenada Y real (viewport, getBoundingClientRect().top) del borde superior del
   *  panel flotante inferior (viaje-activo) — usado sólo en modoNavegacion para que el
   *  camión no quede centrado en la pantalla completa, sino pegado arriba del panel (ver
   *  puntoConOffsetVerticalPx/calcularOffsetVerticalCamara). undefined (por defecto): sin
   *  panel conocido, comportamiento de siempre — centrado, sin offset. */
  panelTopPx?: number;
  /** false cuando el chofer eligió navegar con Waze/Google (navegadorActivo !== 'tila'
   *  en viaje-activo/page.tsx): TILA deja de actuar como navegador turn-by-turn — no
   *  recalcula ruta de navegación, no evalúa desvío, no avanza la máquina de maniobra,
   *  no anuncia nada por voz. El tracking GPS del viaje (lat/lng/marcador) sigue
   *  funcionando igual; esto NO toca modoNavegacion ni oculta ninguna UI. Por defecto
   *  true: comportamiento sin cambios para quien no provea esta prop. */
  navegacionTilaActiva?: boolean;
}

const formatearDistancia = (metros: number) =>
  metros >= 1000 ? `${(metros / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(metros)} m`;

const formatearDuracion = (segundos: number) => {
  const totalMin = Math.round(segundos / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

// ─── Color fijo por letra/orden (no por estado) ────────────────────────────
const COLORES_POR_LETRA: Record<string, string> = {
  A: "#22c55e", // verde
  B: "#facc15", // amarillo
  C: "#ef4444", // rojo
  D: "#3b82f6", // azul
  E: "#a855f7", // violeta
  F: "#f97316", // naranja
};
const colorPorLetra = (letra: string) => COLORES_POR_LETRA[letra] ?? "#6b7280";

const tipoParadaTexto = (tipo: ParadaMapa["tipo"]) => {
  if (tipo === "retiro")  return "Retiro";
  if (tipo === "entrega") return "Entrega";
  return "Parada";
};

// El progreso se ve en el borde/badge, no en el relleno (que queda fijo por letra):
// pendiente = borde fino y opaco (apagado) · en_curso = borde grueso y brillante ·
// completada = check vectorial superpuesto (sin emoji).
const construirIconoParada = (
  letra: string,
  estado: "pendiente" | "en_curso" | "completada",
  forma: "circulo" | "pin"
): google.maps.Icon => {
  const color        = colorPorLetra(letra);
  const strokeWidth  = estado === "en_curso" ? 4 : 2;
  const fillOpacity  = estado === "en_curso" ? 1 : estado === "completada" ? 0.85 : 0.55;
  const check = estado === "completada"
    ? `<circle cx="31" cy="9" r="8" fill="#111827" stroke="#ffffff" stroke-width="1.5"/>
       <path d="M27 9 L29.7 11.7 L34.5 6.5" stroke="#22c55e" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";

  const svg = forma === "pin"
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52">
         <path d="M20 2 C10 2 3 9 3 19 C3 30 20 50 20 50 C20 50 37 30 37 19 C37 9 30 2 20 2 Z"
               fill="${color}" fill-opacity="${fillOpacity}" stroke="#ffffff" stroke-width="${strokeWidth}"/>
         <text x="20" y="24" font-family="Arial, sans-serif" font-size="15" font-weight="bold" fill="#ffffff" text-anchor="middle">${letra}</text>
         ${check}
       </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
         <circle cx="20" cy="20" r="15" fill="${color}" fill-opacity="${fillOpacity}" stroke="#ffffff" stroke-width="${strokeWidth}"/>
         <text x="20" y="25" font-family="Arial, sans-serif" font-size="15" font-weight="bold" fill="#ffffff" text-anchor="middle">${letra}</text>
         ${check}
       </svg>`;

  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  return forma === "pin"
    ? { url, scaledSize: new google.maps.Size(34, 44), anchor: new google.maps.Point(17, 42) }
    : { url, scaledSize: new google.maps.Size(32, 32), anchor: new google.maps.Point(16, 16) };
};

// Sexto rediseño: sólo paleta de color (tamaño/perspectiva/anchor sin cambios) — gris
// grafito (caja/cuerpo) + amarillo TILA (cabina/detalle principal) en vez de azul,
// mejor contraste e identidad visual de marca. Franjas más oscuras sobre el borde
// derecho de cabina y caja simulan una cara lateral en sombra, dando sensación de
// volumen sin ser una ilustración 3D real. Sombra elíptica debajo, en vez de un halo
// claro alrededor de toda la silueta. El "frente" sigue siendo el borde de
// arriba del ícono: como el mapa rota con el heading real (ver pasoAnimacion/
// restaurarCamaraNavegacion, mapa.setHeading), un ícono con orientación fija que
// siempre "mira hacia arriba" ya queda apuntando en la dirección de marcha en pantalla
// — no hace falta rotar el ícono en sí mismo, alcanza con esta convención.
// esNoche: sólo cambia si los faros delanteros se ven encendidos (con halo) o apagados
// (lente gris, sin brillo) — de día apagados, de noche encendidos. Nada más del ícono
// depende de esto. Ver el efecto más abajo que llama a choferMarkerRef.current.setIcon()
// cuando autoResuelto cambia, para que el faro prenda/apague en vivo sin esperar un
// remount del mapa.
const construirIconoChofer = (esNoche: boolean): google.maps.Icon => {
  const colorFaro = esNoche ? "#fef9c3" : "#a1a1aa";
  const strokeFaro = esNoche ? "#fde68a" : "#111827";
  const glowFaros = esNoche
    ? `<circle cx="10.5" cy="2.2" r="4.2" fill="#fde68a" opacity="0.4"/>
       <circle cx="29.5" cy="2.2" r="4.2" fill="#fde68a" opacity="0.4"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="62" viewBox="0 0 40 62">
    <defs>
      <linearGradient id="tilaCajaGrad6" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#71717a"/>
        <stop offset="1" stop-color="#52525b"/>
      </linearGradient>
      <linearGradient id="tilaCabinaGrad6" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#facc15"/>
        <stop offset="1" stop-color="#eab308"/>
      </linearGradient>
    </defs>

    <!-- Sombra de contacto con el suelo — da volumen, no es un halo alrededor de toda la silueta -->
    <ellipse cx="20" cy="57" rx="15" ry="4.5" fill="#000000" opacity="0.3"/>

    <!-- Ejes de ruedas: trasero (semirremolque) y delantero (tracción), oscuros -->
    <rect x="2" y="50" width="5" height="9" rx="1.3" fill="#111827"/>
    <rect x="33" y="50" width="5" height="9" rx="1.3" fill="#111827"/>
    <rect x="2" y="29.5" width="4.5" height="7" rx="1.2" fill="#111827"/>
    <rect x="33.5" y="29.5" width="4.5" height="7" rx="1.2" fill="#111827"/>

    <!-- Caja/semirremolque: gris grafito, con franja lateral derecha más oscura (cara en sombra) -->
    <rect x="5" y="17" width="30" height="35" rx="3" fill="url(#tilaCajaGrad6)" stroke="#111827" stroke-width="1.75"/>
    <rect x="28" y="17" width="7" height="35" rx="3" fill="#000000" opacity="0.3"/>
    <rect x="5" y="28" width="30" height="1" fill="#ffffff" opacity="0.2"/>
    <rect x="5" y="40" width="30" height="1" fill="#ffffff" opacity="0.2"/>

    <!-- Luces traseras — más grandes que antes (5x5.5, era 3.5x3) -->
    <rect x="5" y="47" width="5" height="5.5" rx="1.5" fill="#dc2626" stroke="#fecaca" stroke-width="0.7"/>
    <rect x="30" y="47" width="5" height="5.5" rx="1.5" fill="#dc2626" stroke="#fecaca" stroke-width="0.7"/>

    <rect x="16" y="15" width="8" height="3" fill="#000000"/>

    <!-- Cabina: amarillo TILA, con la misma franja lateral en sombra que la caja -->
    <rect x="8" y="1" width="24" height="21" rx="3.5" fill="url(#tilaCabinaGrad6)" stroke="#111827" stroke-width="1.75"/>
    <rect x="26" y="1" width="6" height="21" rx="3.5" fill="#000000" opacity="0.25"/>
    <rect x="11" y="4" width="18" height="7.5" rx="1.5" fill="#7dd3fc"/>
    <rect x="12" y="4.8" width="7" height="2.2" rx="1" fill="#ffffff" opacity="0.4"/>
    <rect x="5" y="6.5" width="2.5" height="4" rx="1" fill="#111827"/>
    <rect x="32.5" y="6.5" width="2.5" height="4" rx="1" fill="#111827"/>

    <!-- Faros delanteros: halo sólo de noche, lente apagada (gris) de día -->
    ${glowFaros}
    <circle cx="10.5" cy="2.2" r="1.9" fill="${colorFaro}" stroke="${strokeFaro}" stroke-width="0.6"/>
    <circle cx="29.5" cy="2.2" r="1.9" fill="${colorFaro}" stroke="${strokeFaro}" stroke-width="0.6"/>

    <!-- Acento — pequeño detalle en gris grafito sobre la cabina amarilla -->
    <rect x="17" y="0.2" width="6" height="1.8" rx="0.9" fill="#27272a"/>
  </svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  // scaledSize dentro del rango pedido (~64-80px de alto) — 72px. Anchor en el centro
  // geométrico del ícono (23,36 de 46×72) — no en el eje de ruedas traseras como antes:
  // con el anchor corrido hacia abajo, el cuerpo largo del camión (cabina+caja) quedaba
  // visualmente "colgando" hacia un lado del trazo en curvas/bifurcaciones, aunque el
  // punto de anclaje en sí cayera sobre la posición GPS real — confirmado en prueba real
  // (captura: camión corrido a la izquierda del trazo en un desvío de autopista).
  return { url, scaledSize: new google.maps.Size(46, 72), anchor: new google.maps.Point(23, 36) };
};

// ─── Tema del mapa (modoNavegacion) ─────────────────────────────────────────
// Sin persistencia todavía: arranca en "automatico" en cada montaje. El botón cicla
// automatico → dia → noche → automatico. La conversión a google.maps.ColorScheme se
// hace dentro del componente (no acá arriba) porque el objeto `google` sólo existe
// después de que useJsApiLoader termine de cargar el script — exactamente el mismo
// motivo por el que ya existía esa lectura sólo dentro del JSX renderizado tras el
// guard de isLoaded.
type TemaMapa = "automatico" | "dia" | "noche";
const SIGUIENTE_TEMA: Record<TemaMapa, TemaMapa> = { automatico: "dia", dia: "noche", noche: "automatico" };
const ICONO_TEMA: Record<TemaMapa, string> = { automatico: "🌓", dia: "☀️", noche: "🌙" };
const LABEL_TEMA: Record<TemaMapa, string> = { automatico: "Automático", dia: "Claro", noche: "Oscuro" };

export default function MapaTILA({
  lat,
  lng,
  heading,
  accuracy = null,
  origen,
  destino,
  paradaActivaDireccion,
  soloLectura = false,
  altura = "420px",
  paradas,
  choferes,
  mostrarDiagnostico = false,
  modoNavegacion = false,
  mostrarRutaDesdeChofer = false,
  onResumenRuta,
  vozActiva = false,
  onToggleVoz,
  onAnuncioVoz,
  onDetenerVoz,
  panelTopPx,
  navegacionTilaActiva = true,
}: MapaTILAProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: LIBRARIES,
  });

  const mapRef               = useRef<google.maps.Map | null>(null);
  const choferMarkerRef      = useRef<google.maps.Marker | null>(null);
  const geocoderRef          = useRef<google.maps.Geocoder | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

  // ─── Control de cámara en modoNavegacion ──────────────────────────────────
  // siguiendoChoferRef: false por defecto — el usuario tiene control total apenas se muestra
  // la ruta inicial. Sólo pasa a true cuando el usuario presiona "Mi ubicación".
  // encuadreInicialHechoRef: garantiza que el fitBounds/setCenter automático de arranque en
  // modoNavegacion ocurra UNA sola vez. Después de eso, ningún efecto vuelve a mover la cámara
  // por su cuenta — sólo los botones explícitos ("Mi ubicación", "Ver recorrido completo").
  // programaticoRef: true mientras el propio componente mueve la cámara por código, para no
  // confundir esos movimientos con una interacción real del usuario en zoom_changed.
  const siguiendoChoferRef   = useRef(false);
  const encuadreInicialHechoRef = useRef(false);
  const programaticoRef      = useRef(false);
  // Guarda el id del timeout que libera programaticoRef, para poder cancelarlo si
  // llega una nueva llamada a moverCamara() antes de que se cumpla — sin esto, dos
  // movimientos programáticos seguidos podían dejar timeouts superpuestos y liberar
  // programaticoRef en medio de una actualización todavía en curso.
  const programaticoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mismo motivo que programaticoTimeoutRef, pero para restaurandoCamaraRef — cancela el
  // timeout anterior si llega una nueva restauración antes de que se cumpla.
  const restaurandoCamaraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Últimas dos posiciones conocidas — respaldo para calcular un bearing cuando el
  // heading del GPS no está disponible (ver restaurarCamaraNavegacion).
  const historialPosicionRef = useRef<{
    previa: google.maps.LatLngLiteral | null;
    actual: google.maps.LatLngLiteral | null;
  }>({ previa: null, actual: null });
  // Último heading que efectivamente se aplicó a la cámara de navegación — último
  // recurso del fallback de heading; nunca se fuerza 0 por defecto.
  const ultimoHeadingNavegacionRef = useRef<number | null>(null);
  // Espejo en ref del prop panelTopPx — permite que pasoAnimacion/restaurarCamaraNavegacion
  // (callbacks estables) lean siempre el valor MÁS RECIENTE sin tener que ir en sus arrays
  // de dependencias (mismo patrón que autoResueltoRef más abajo).
  const panelTopPxRef = useRef(panelTopPx);
  useEffect(() => { panelTopPxRef.current = panelTopPx; }, [panelTopPx]);
  // Espejo en ref del prop accuracy — mismo patrón que panelTopPxRef, así pasoAnimacion
  // (dentro del loop de rAF, no puede depender de props en su array de deps) lee el
  // valor más reciente sin recrear el callback en cada cambio de accuracy.
  const accuracyRef = useRef(accuracy);
  useEffect(() => { accuracyRef.current = accuracy; }, [accuracy]);
  // true mientras restaurarCamaraNavegacion ("Mi ubicación") está aplicando su propia
  // actualización atómica de cámara — pasoAnimacion y el efecto de panelTopPx NO escriben
  // sobre center/heading mientras esto sea true, para que exista una única autoridad de
  // cámara en cada momento (evita que compitan y produzcan el "viaje" errático reportado).
  const restaurandoCamaraRef = useRef(false);

  // ─── Animación de marcador/cámara (interpolación GPS) ──────────────────────
  // Un único loop de requestAnimationFrame anima marcador y cámara juntos, desde la
  // última posición VISUAL (no la última posición GPS cruda) hacia la nueva — así, si
  // llega un fix nuevo a mitad de una animación, el siguiente tramo continúa desde
  // donde el ojo lo ve, en vez de saltar hacia atrás. Ver animarHaciaPosicion/pasoAnimacion.
  const animacionFrameRef       = useRef<number | null>(null);
  const animacionInicioRef      = useRef<{ lat: number; lng: number; heading: number | null } | null>(null);
  const animacionDestinoRef     = useRef<{ lat: number; lng: number; heading: number | null } | null>(null);
  const animacionInicioTsRef    = useRef(0);
  const animacionDuracionRef    = useRef(DURACION_ANIMACION_MAX_MS);
  const posicionVisualActualRef = useRef<{ lat: number; lng: number; heading: number | null } | null>(null);
  // Último punto proyectado sobre la polyline activa + su distancia real al vehículo —
  // alimentado por el mismo bloque de recorte (throttle INTERVALO_MIN_RECORTE_MS) dentro
  // de pasoAnimacion, reutilizado por el marcador para el snap visual (ver
  // UMBRAL_CORREDOR_SNAP_VISUAL_METROS). null mientras no haya una lectura fresca válida
  // (recién arrancando, ruta recién reemplazada, o el propio recorte se saltó el tick por
  // accuracy mala) — en ese caso el marcador cae de vuelta a la posición GPS real.
  const posicionSnapRutaRef = useRef<{ punto: google.maps.LatLngLiteral; distancia: number } | null>(null);
  // Velocidad real (metros/milisegundo) entre los últimos dos fixes GPS reales — se
  // recalcula en cada animarHaciaPosicion y sólo se usa para la extrapolación acotada de
  // pasoAnimacion cuando el PRÓXIMO fix tarda más que la animación en curso.
  const velocidadMPorMsRef      = useRef(0);
  const ultimoTickTsRef         = useRef<number | null>(null);
  // Última vez (performance.now()) que pasoAnimacion efectivamente escribió sobre la
  // cámara — gate de frecuencia, ver INTERVALO_MIN_CAMARA_MS. El marcador/
  // posicionVisualActualRef NO pasan por este gate: siguen actualizándose en cada frame.
  const ultimaActualizacionCamaraTsRef = useRef(0);
  // Gate de frecuencia gemelo, para el recorte visual de la traza — ver
  // INTERVALO_MIN_RECORTE_MS más arriba y el bloque dentro de pasoAnimacion.
  const ultimaActualizacionRecorteTsRef = useRef(0);
  // Ref-al-callback-más-reciente: permite que pasoAnimacion se re-programe a sí mismo
  // (vía requestAnimationFrame) sin una auto-referencia directa a su propia const (evita
  // el ciclo de declaración) y sin quedar nunca con una versión vieja del closure — mismo
  // patrón ya usado por dispararCalculoNavRef más abajo.
  const pasoAnimacionRef = useRef<() => void>(() => {});

  // ─── Ruta vigente y protección de respuestas de Directions ─────────────────
  // rutaPolylineRef: puntos de la ruta actualmente dibujada (overview_path de Directions,
  // o los puntos del fallback si Directions falló) — es contra esto que se mide el desvío
  // real del chofer (ver el efecto de recálculo multietapa más abajo).
  // rutaRequestIdRef: se incrementa en cada llamada a calcularRuta; la respuesta de
  // Directions sólo se aplica si su id sigue siendo el más reciente al llegar — una
  // respuesta vieja que llega tarde (fuera de orden) se descarta en vez de pisar a una
  // más nueva. Protege a los 4 call-sites de calcularRuta con un solo cambio.
  const rutaPolylineRef = useRef<google.maps.LatLngLiteral[]>([]);
  const rutaRequestIdRef = useRef(0);
  // indicePorStepRef[i] = índice dentro de rutaPolylineRef.current donde arranca la
  // geometría del step i (steps de todos los legs concatenados, mismo orden que la
  // voz) — ver construirPolylineDetalladaDesdeRuta. Se recalcula junto con
  // rutaPolylineRef en cada recálculo, así siempre están sincronizados a la misma
  // generación de ruta.
  const indicePorStepRef = useRef<number[]>([]);
  // Cuántos legs de la respuesta de Directions vigente participan de la navegación —
  // ver construirPolylineDetalladaDesdeRuta. null = todos (sin restricción). Se fija en
  // calcularRuta junto con rutaPolylineRef/indicePorStepRef, así queda sincronizado a la
  // misma generación de ruta; la máquina de voz lo lee para no armar `pasos` con steps
  // de un leg que ya quedó fuera de la polyline/indicePorStep.
  const legsActivosNavRef = useRef<number | null>(null);

  // Espejo en estado de siguiendoChoferRef — sólo para que el botón "Mi ubicación"
  // pueda pintarse distinto según el seguimiento esté activo o pausado. La lógica de
  // cámara sigue leyendo el ref (rápido, síncrono, sin depender del ciclo de render);
  // este setState sólo se dispara cuando el valor realmente cambia, no en cada tick de GPS.
  const [siguiendoActivo, setSiguiendoActivo] = useState(false);
  const actualizarSeguimiento = useCallback((activo: boolean) => {
    if (siguiendoChoferRef.current === activo) return;
    siguiendoChoferRef.current = activo;
    setSiguiendoActivo(activo);
  }, []);

  // Tema del mapa — sólo estado de sesión, sin persistencia (ver comentario junto a
  // TemaMapa más arriba). Empieza en "automatico" en cada montaje del componente.
  // cambiarTema (que necesita leer centroInicial/zoomInicial) se define más abajo,
  // junto a esas declaraciones — ver el comentario largo ahí.
  const [tema, setTema] = useState<TemaMapa>("automatico");
  const camaraSnapshotRef = useRef<{
    center: google.maps.LatLngLiteral;
    zoom: number;
    heading: number;
    tilt: number;
  } | null>(null);

  const [origenCoords,  setOrigenCoords]  = useState<google.maps.LatLngLiteral | null>(null);
  const [destinoCoords, setDestinoCoords] = useState<google.maps.LatLngLiteral | null>(null);
  const [paradasCoords, setParadasCoords] = useState<(google.maps.LatLngLiteral | null)[]>([]);
  const [directions,    setDirections]    = useState<google.maps.DirectionsResult | null>(null);

  // ── Polyline fallback cuando DirectionsService falla ─────────────────────
  const [polylinePuntos, setPolylinePuntos] = useState<google.maps.LatLngLiteral[]>([]);

  // ── Ruta visual recortada (sólo en modoNavegacion) — ver el efecto más abajo que la
  // calcula. rutaPolylineRef (la ruta completa, para rerouting/maniobras) NO se toca acá.
  const [rutaVisibleDesdeVehiculo, setRutaVisibleDesdeVehiculo] = useState<google.maps.LatLngLiteral[]>([]);
  // Índice monotónico: nunca retrocede mientras sea la misma ruta — evita que el
  // arranque visible "salte" hacia atrás por una lectura de GPS momentáneamente
  // imprecisa (ver recortarRutaDesdeVehiculo). Se reinicia sólo cuando rutaPolylineRef
  // apunta a un array distinto (ruta realmente nueva, tras un recálculo).
  const indiceRutaVisibleRef  = useRef(0);
  const ultimaRutaRefVistaRef = useRef<google.maps.LatLngLiteral[] | null>(null);
  // requestId asociado a la última ruta para la que se sincronizó el índice (sólo para
  // el log RUTA_NUEVA_INSTALADA) y requestId de la última generación que ya escribió
  // rutaVisibleDesdeVehiculo al menos una vez (sólo para el log
  // RUTA_VISUAL_PRIMERA_ESCRITURA, evita loguear en cada frame — ver
  // sincronizarIndiceConRuta y el bloque de recorte dentro de pasoAnimacion).
  const ultimaRutaRequestIdVistaRef = useRef<number | null>(null);
  const ultimoRequestIdEscritoRef   = useRef<number | null>(null);

  // Sincroniza el índice compartido con la ruta ACTUAL antes de usarlo — se llama desde
  // el mismo lugar que CONSUME el índice (el bloque de recorte dentro de pasoAnimacion,
  // y el efecto de desvío), nunca depende de que un useEffect de React haya corrido
  // antes. Si `polyline` ya no es la misma referencia que la última vez que se
  // sincronizó, es una ruta realmente nueva (recálculo recién aterrizado, ver
  // rutaPolylineRef en calcularRuta): resetea el índice a 0 ahí mismo, de forma
  // síncrona, ANTES de que nada pueda leer un índice que pertenece a la generación
  // anterior — cierra por diseño la ventana de carrera entre calculandoRutaNavRef
  // (se libera síncrono, dentro del callback de Directions) y el efecto de React que
  // antes hacía este mismo reset (async, corre recién en el próximo render). Llamarla
  // más de una vez para la misma polyline en el mismo tick es seguro: la segunda
  // llamada no encuentra cambio y sólo devuelve el índice ya corregido.
  const sincronizarIndiceConRuta = useCallback((polyline: google.maps.LatLngLiteral[]): number => {
    if (polyline !== ultimaRutaRefVistaRef.current) {
      const requestIdAnterior = ultimaRutaRequestIdVistaRef.current;
      ultimaRutaRefVistaRef.current = polyline;
      ultimaRutaRequestIdVistaRef.current = rutaRequestIdRef.current;
      indiceRutaVisibleRef.current = 0;
      // El snap visual de la generación anterior no tiene sentido contra esta polyline
      // nueva — se descarta acá mismo, síncrono, junto con el reset del índice (mismo
      // motivo que ese reset: nunca dejar que algo de la ruta vieja se siga dibujando/
      // usando después de instalarse una nueva). El marcador cae de vuelta a la posición
      // GPS real hasta que el próximo recorte calcule un snap fresco sobre la ruta nueva.
      posicionSnapRutaRef.current = null;
      diagLog(
        `[TILA_NAV_DIAG] RUTA_NUEVA_INSTALADA requestId=${rutaRequestIdRef.current} `
        + `requestIdAnterior=${requestIdAnterior ?? "n/a"} puntosRuta=${polyline.length} t=${Math.round(performance.now())}`
      );
    }
    return indiceRutaVisibleRef.current;
  }, []);

  // Aplica un candidato de progreso sin permitir que retroceda dentro de la misma
  // generación de ruta. sincronizarIndiceConRuta ya se encarga de resetear a 0 cuando la
  // polyline cambia (ruta realmente nueva) — acá sólo queda impedir que los DOS caminos
  // independientes que escriben este índice (el recorte visual, con la posición
  // interpolada/extrapolada, y el efecto de desvío, con el fix GPS crudo) se pisen hacia
  // atrás entre sí. Causa confirmada del retroceso 6→3→1 visto en producción: ninguno de
  // los dos comparaba el candidato contra el progreso ya confirmado antes de escribir.
  // Con esto, el peor caso posible es un candidato erróneo que NO avanza (se ignora
  // porque Math.max lo descarta) — nunca uno que retrocede el progreso confirmado.
  const avanzarIndiceProgreso = useCallback((nuevoIndice: number): number => {
    indiceRutaVisibleRef.current = Math.max(indiceRutaVisibleRef.current, nuevoIndice);
    return indiceRutaVisibleRef.current;
  }, []);

  // Al aterrizar una ruta nueva (recálculo), siembra el progreso desde la posición GPS
  // REAL actual — no desde el origen que se le envió a Directions, que ya quedó
  // desactualizado durante el viaje de ida y vuelta a la API (el vehículo sigue
  // moviéndose mientras tanto). sincronizarIndiceConRuta ya resetea el índice a 0 y
  // limpia el snap visual apenas detecta la referencia de polyline nueva (síncrono,
  // dentro de esa misma llamada); acá se reemplaza ese 0 crudo por la proyección real,
  // TAMBIÉN síncrono, antes de que nada pueda dibujar un primer frame apuntando hacia
  // atrás del vehículo. Usa fixValidoActualRef (GPS real validado) explícitamente, no la
  // posición visual/interpolada — mismo criterio que el resto del progreso monotónico:
  // el GPS real nunca se toca ni se sustituye por una posición "arreglada".
  // Sin fix real conocido todavía (arranque, o calcularRuta usado fuera de navegación
  // con GPS) no hay nada que sembrar: el índice se queda en el 0 que ya dejó
  // sincronizarIndiceConRuta, y el próximo tick de recorte/desvío lo corrige apenas haya
  // una posición real.
  const sembrarProgresoRutaNueva = useCallback((polyline: google.maps.LatLngLiteral[], requestId: number) => {
    sincronizarIndiceConRuta(polyline);
    const posicionActual = fixValidoActualRef.current;
    if (!posicionActual || polyline.length < 2) return;
    const accuracyDisponible = accuracyRef.current ?? null;
    const resultado = elegirSegmentoActivo(polyline, posicionActual, {
      indiceActual: 0,
      headingVehiculo: headingAceptadoRef.current,
      velocidadVehiculoMps: velocidadMPorMsRef.current > 0 ? velocidadMPorMsRef.current * 1000 : null,
      accuracyMetros: accuracyDisponible,
      origen: "siembra",
      rutaRequestId: requestId,
    });
    if (resultado) {
      // Caso especial: el ARRANQUE de una ruta recién calculada. Directions siempre
      // arranca la ruta prácticamente EN el punto de origen que se le pidió (el GPS real
      // de hace un instante) — si el candidato geométricamente más cercano (sin filtro de
      // sentido) cae justo en ese primer segmento (índice 0) y está a una distancia
      // compatible con el accuracy reportado (mismo criterio que
      // UMBRAL_DISTANCIA_CONSISTENCIA_METROS: por debajo de eso, un bearing puntual raro
      // es ruido de geometría/GPS, no motivo real para descartar el punto), se prioriza
      // sobre el `elegido` filtrado por sentido. Caso confirmado que esto corrige:
      // segmento 0 a 0m descartado por bearing casi opuesto al heading, sembrando el
      // progreso en el índice 1 a 38m — la ruta nueva (pedida para "corregir" un desvío)
      // arrancaba ya adelantada por un descarte espurio. Fuera de este caso puntual
      // (arranque + distancia chica), se respeta el filtro de sentido tal cual — una ruta
      // que realmente arranca en la calzada contraria sigue sin priorizarse acá.
      const toleranciaOrigen = accuracyDisponible !== null
        ? Math.min(accuracyDisponible, TOPE_TOLERANCIA_ORIGEN_SIEMBRA_METROS)
        : TOPE_TOLERANCIA_ORIGEN_SIEMBRA_METROS;
      const priorizarOrigenGeometrico =
        resultado.descartadoPorSentido
        && resultado.indiceGeometrico === 0
        && resultado.distanciaGeometrica <= toleranciaOrigen;

      const indiceSembrado    = priorizarOrigenGeometrico ? resultado.indiceGeometrico : resultado.indice;
      const distanciaSembrada = priorizarOrigenGeometrico ? resultado.distanciaGeometrica : resultado.distancia;

      avanzarIndiceProgreso(indiceSembrado);
      if (priorizarOrigenGeometrico) {
        diagLog(
          `[TILA_NAV_DIAG] PROGRESO_SEMBRADO_ORIGEN_PRIORIZADO requestId=${requestId} `
          + `indiceDescartadoPorSentido=${resultado.indice} distanciaDescartadoPorSentido=${Math.round(resultado.distancia)}m `
          + `distanciaGeometrica=${Math.round(resultado.distanciaGeometrica)}m toleranciaOrigen=${Math.round(toleranciaOrigen)}m t=${Math.round(performance.now())}`
        );
      }
      diagLog(
        `[TILA_NAV_DIAG] PROGRESO_SEMBRADO_RUTA_NUEVA requestId=${requestId} indiceSembrado=${indiceSembrado} `
        + `distanciaAlPunto=${Math.round(distanciaSembrada)}m t=${Math.round(performance.now())}`
      );
    }
  }, [sincronizarIndiceConRuta, avanzarIndiceProgreso]);

  // ── Diagnóstico visible ───────────────────────────────────────────────────
  const [diagnostico, setDiagnostico] = useState<DiagnosticoMapa>({
    directionsStatus: "pendiente",
    polylineFallback: false,
    puntosPolyline: 0,
    geocodingOrigen: "pendiente",
    geocodingDestino: "pendiente",
    tieneParadas: false,
    modoActivo: "iniciando",
  });

  // TILA_NAV_DIAG: estado de la pantalla de diagnóstico temporal — quitar junto con
  // el resto de la instrumentación.
  const [mostrarDiagNav, setMostrarDiagNav] = useState(false);
  const [, setDiagRefrescoTick] = useState(0);

  const modoMultiChofer = choferes && choferes.length > 0;
  const tieneParadas    = paradas && paradas.length >= 2;
  const contenedorEstilo = {
    width: "100%",
    height: altura,
    borderRadius: altura === "100dvh" || altura === "100%" || altura === "100vh" ? "0" : "1rem",
  };

  // ─── Centro/zoom inicial del <GoogleMap> — se calculan UNA sola vez ───────
  // @react-google-maps/api reaplica `map.setCenter()` cada vez que la referencia del prop
  // `center` cambia. Si se recalculara en cada render (como antes), cualquier re-render del
  // componente —incluido cada tick de GPS— forzaba el mapa de vuelta a este punto, sin pasar
  // por siguiendoChoferRef ni por ningún otro control. Por eso acá se usa el inicializador
  // perezoso de useState (corre una única vez, en el primer render, nunca se reasigna después):
  // sólo sirve como placeholder hasta que la ruta real se encuadra vía encuadrarPuntos() más abajo.
  const [centroInicial] = useState<google.maps.LatLngLiteral>(() => {
    if (modoMultiChofer && choferes!.length > 0) {
      const latP = choferes!.reduce((a, c) => a + c.lat, 0) / choferes!.length;
      const lngP = choferes!.reduce((a, c) => a + c.lng, 0) / choferes!.length;
      return { lat: latP, lng: lngP };
    }
    if (lat && lng) return { lat, lng };
    return centroArgentina;
  });
  const [zoomInicial] = useState<number>(() => {
    if (modoMultiChofer) return choferes!.length === 1 ? 13 : 6;
    if (lat && lng) return 14;
    return 10;
  });

  // colorScheme es de sólo-inicialización en la Maps JS API ("This option can only
  // be set when the map is initialized" — @types/google.maps, MapOptions.colorScheme).
  // Cambiar `options.colorScheme` en un render posterior NO hace nada: Google lo
  // ignora en instancias ya construidas. La única forma oficial de aplicar un tema
  // nuevo es destruir y reconstruir la instancia — acá vía `key={tema}` en
  // <GoogleMap>, que fuerza a React a desmontar/montar el mapa de cero.
  //
  // camaraSnapshotRef guarda el centro/zoom/heading/tilt EXACTOS de la instancia
  // vieja justo antes de pedir el remount, para que la instancia nueva nazca ya
  // ubicada ahí — sin esto, el remount volvería a centroInicial/zoomInicial (la
  // posición de arranque del viaje) y se perdería todo el seguimiento acumulado.
  //
  // Lo que NO se toca acá, a propósito: siguiendoChoferRef/siguiendoActivo,
  // encuadreInicialHechoRef y programaticoRef viven en MapaTILA (el padre), no en
  // <GoogleMap> (el hijo que remonta) — sobreviven el remount sin ningún cambio,
  // así que "seguimiento activo/pausado" y "no repetir el encuadre inicial" quedan
  // exactamente como estaban, sin ninguna acción extra de nuestra parte.
  // Snapshot de cámara + limpieza de refs antes de forzar un remount de <GoogleMap> —
  // compartido por cambiarTema (botón manual) y por el recálculo automático de
  // horario más abajo, para no duplicar esta lógica en dos lugares.
  const prepararRemountTema = useCallback(() => {
    if (mapRef.current) {
      const centro = mapRef.current.getCenter();
      camaraSnapshotRef.current = {
        center: centro ? { lat: centro.lat(), lng: centro.lng() } : centroInicial,
        zoom:    mapRef.current.getZoom()    ?? zoomInicial,
        heading: mapRef.current.getHeading() ?? 0,
        tilt:    mapRef.current.getTilt()    ?? 0,
      };
    }
    // Únicamente las refs necesarias para que el mapa y el marcador del chofer se
    // recreen correctamente contra la instancia nueva — mapRef.current en null hace
    // que cualquier intento de mover cámara durante la breve ventana del remount
    // no-opee (moverCamara ya guarda `if (!mapRef.current) return;`), en vez de
    // operar sobre una instancia destruida; choferMarkerRef.current en null hace
    // que asegurarMarcadorChofer cree un marcador nuevo en vez de reusar uno
    // atado al mapa viejo ya destruido.
    diagLog(`[TILA_NAV_DIAG] TEARDOWN marcador (prepararRemountTema) t=${Math.round(performance.now())}`);
    mapRef.current = null;
    choferMarkerRef.current = null;
    // Cancela cualquier animación en vuelo: seguiría escribiendo sobre un marcador/mapa
    // que está a punto de destruirse. onMapLoad reposiciona sin animar en el remount.
    if (animacionFrameRef.current !== null) {
      cancelAnimationFrame(animacionFrameRef.current);
      animacionFrameRef.current = null;
    }
  }, [centroInicial, zoomInicial]);

  const cambiarTema = useCallback(() => {
    prepararRemountTema();
    setTema(t => SIGUIENTE_TEMA[t]);
  }, [prepararRemountTema]);

  // ─── "Automático" en vivo ───────────────────────────────────────────────────
  // autoResuelto guarda el resultado de resolverTemaAutomatico() vigente — se aplica
  // al construir el mapa (colorSchemeActual lo lee, más abajo) y forma parte de la
  // `key` de <GoogleMap> cuando tema==="automatico" (ver el JSX). Sin esto, el mapa
  // se quedaría con el primer resultado para siempre: colorScheme sólo puede fijarse
  // al construir la instancia, y `key={tema}` por sí solo no cambia mientras el chofer
  // no toque el botón — un chequeo periódico es la única forma de que "Automático"
  // reaccione solo al cruzar la hora de corte, sin que el chofer tenga que hacer nada.
  const [autoResuelto, setAutoResuelto] = useState<"dia" | "noche">(() => resolverTemaAutomatico());
  // Espejo en ref del estado — el setInterval de abajo necesita el valor vigente sin
  // depender de él (recrear el interval cada vez que autoResuelto cambia sería más
  // frágil), y así el efecto secundario (prepararRemountTema) puede quedar afuera de
  // cualquier callback de setState, nunca dentro de un updater funcional.
  const autoResueltoRef = useRef<"dia" | "noche">(autoResuelto);
  useEffect(() => { autoResueltoRef.current = autoResuelto; }, [autoResuelto]);

  useEffect(() => {
    if (tema !== "automatico") return;
    const intervalo = setInterval(() => {
      const resuelto = resolverTemaAutomatico();
      if (resuelto === autoResueltoRef.current) return;
      // Efecto secundario primero, afuera de cualquier setter — recién después se
      // actualiza el estado (setAutoResuelto acá es un valor directo, no un updater
      // funcional: no hay ningún efecto secundario adentro de React).
      prepararRemountTema();
      setAutoResuelto(resuelto);
    }, 60000); // 1 minuto — de sobra para no notarse el retraso al cruzar la hora de corte
    return () => clearInterval(intervalo);
  }, [tema, prepararRemountTema]);

  // TILA_NAV_DIAG: contadores de diagnóstico temporal — no cambian ninguna lógica,
  // sólo se leen/incrementan para el heartbeat de instrumentación. Remover junto con
  // el resto del diagnóstico una vez conseguida la evidencia pedida.
  const diagContadoresRef = useRef({
    moverCamaraPasoAnim: 0,
    moverCamaraOtros: 0,
    eventoCenterChanged: 0,
    eventoHeadingChanged: 0,
    eventoZoomChanged: 0,
    eventoTiltChanged: 0,
    eventoIdle: 0,
    marcadorFaltante: 0,
    posicionNoFinita: 0,
  });
  // TILA_NAV_DIAG: valores para el heartbeat de 1s — sólo lectura, ninguno decide nada.
  const diagUltimoHeadingAplicadoRef  = useRef<number | null>(null);
  const diagUltimaFuenteHeadingRef    = useRef<string>("?");
  const diagHeadingCalculadoRef       = useRef<number | null>(null);
  const diagDistanciaGpsVisualRef     = useRef<number | null>(null);
  const diagExtrapolandoRef           = useRef(false);

  // ─── Único punto que puede tocar el mapa imperativamente ──────────────────
  const moverCamara = useCallback((mover: () => void, origen: string = "?") => {
    if (!mapRef.current) return;
    // TILA_NAV_DIAG: sólo cuenta/loguea, no cambia ninguna decisión.
    if (origen === "pasoAnimacion") {
      diagContadoresRef.current.moverCamaraPasoAnim++;
    } else {
      diagContadoresRef.current.moverCamaraOtros++;
      diagLog(`[TILA_NAV_DIAG] moverCamara origen=${origen} t=${Math.round(performance.now())}`);
    }
    // Si ya había un timeout pendiente de una llamada anterior, se cancela: así dos
    // moverCamara() seguidos no dejan timeouts superpuestos que liberen
    // programaticoRef en medio de una actualización todavía en curso.
    if (programaticoTimeoutRef.current !== null) {
      clearTimeout(programaticoTimeoutRef.current);
    }
    programaticoRef.current = true;
    mover();
    // 150ms (antes 0ms): el evento heading_changed/zoom_changed/tilt_changed que
    // Google dispara como consecuencia de este mismo cambio programático no está
    // garantizado a llegar antes de la próxima vuelta del event loop — con 0ms,
    // programaticoRef podía volver a false antes de que ese eco llegara, y el
    // listener lo tomaba como gesto manual y cancelaba el seguimiento recién activado.
    programaticoTimeoutRef.current = setTimeout(() => {
      programaticoRef.current = false;
      programaticoTimeoutRef.current = null;
    }, 150);
  }, []);

  // Limpieza del timeout pendiente y del frame de animación al desmontar — evita
  // setState/mutación de refs de un componente ya desmontado si el usuario navega
  // justo después de un movimiento de cámara o a mitad de una animación de posición.
  useEffect(() => {
    return () => {
      if (programaticoTimeoutRef.current !== null) {
        clearTimeout(programaticoTimeoutRef.current);
      }
      if (restaurandoCamaraTimeoutRef.current !== null) {
        clearTimeout(restaurandoCamaraTimeoutRef.current);
      }
      if (animacionFrameRef.current !== null) {
        cancelAnimationFrame(animacionFrameRef.current);
      }
    };
  }, []);

  // Matemática pura de encuadre (fitBounds / setCenter+zoom14) — no decide POR SÍ SOLA si debe
  // ejecutarse; eso lo deciden encuadrarPuntos/encuadrarPuntosForzado.
  const aplicarEncuadre = useCallback((puntos: google.maps.LatLngLiteral[]) => {
    if (puntos.length === 0) return;
    if (puntos.length === 1) {
      mapRef.current!.setCenter(puntos[0]);
      mapRef.current!.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    puntos.forEach(p => bounds.extend(p));
    mapRef.current!.fitBounds(bounds, { top: 60, right: 40, bottom: 60, left: 40 });
  }, []);

  // Encuadre automático de ruta. En modoNavegacion se ejecuta UNA sola vez (la primera vez que
  // hay puntos suficientes); después de eso, ningún cambio de ruta/GPS vuelve a mover la cámara.
  // Fuera de modoNavegacion (paneles de sólo lectura) se sigue aplicando en cada actualización,
  // igual que antes.
  const encuadrarPuntos = useCallback((puntos: google.maps.LatLngLiteral[]) => {
    // El chequeo de mapRef va antes de marcar encuadreInicialHechoRef: si el mapa todavía no
    // está listo, no se "quema" el único intento automático — el próximo tick de GPS reintenta.
    if (puntos.length === 0 || !mapRef.current) return;
    if (modoNavegacion) {
      if (encuadreInicialHechoRef.current) return;
      encuadreInicialHechoRef.current = true;
    }
    moverCamara(() => aplicarEncuadre(puntos), "encuadrarPuntos");
  }, [modoNavegacion, moverCamara, aplicarEncuadre]);

  // Encuadre bajo demanda — botón "Ver recorrido completo". Ignora el flag de una-sola-vez
  // porque es una acción explícita del usuario, no un recentrado automático.
  const encuadrarPuntosForzado = useCallback((puntos: google.maps.LatLngLiteral[]) => {
    if (puntos.length === 0) return;
    moverCamara(() => aplicarEncuadre(puntos), "encuadrarPuntosForzado");
  }, [moverCamara, aplicarEncuadre]);

  // Cuánto desplazar (en píxeles de pantalla) el centro real de la cámara para que el
  // camión no quede en el centro geométrico del contenedor del mapa, sino pegado arriba
  // del panel flotante inferior — como un navegador GPS real. Usa el RECTÁNGULO REAL del
  // contenedor del mapa (getBoundingClientRect, no sólo su alto) y la posición REAL del
  // borde superior del panel (panelTopPxRef — ver el efecto que la sincroniza, medida en
  // el padre con getBoundingClientRect también) para calcular el área visible efectiva:
  //   visibleTop    = mapRect.top
  //   visibleBottom = panelTopPx (el panel puede no empezar exactamente en el borde
  //                   inferior del contenedor del mapa; por eso no alcanza con restar
  //                   sólo una altura, hace falta la posición real).
  // El objetivo es "justo arriba del panel, con margen" — clamp para que NUNCA quede por
  // encima del propio borde superior del mapa (cortado) ni, si el panel es muy alto,
  // vuelva a caer cerca del centro (eso fue exactamente el bug: preferir "cerca del
  // centro" antes que "arriba del panel" dejaba al camión tapado cuando el panel crecía).
  // Sin panelTopPx conocido (undefined): 0 — sin offset, centrado, comportamiento de siempre.
  const calcularOffsetVerticalCamara = useCallback((): number => {
    if (!mapRef.current) return 0;
    const panelTop = panelTopPxRef.current;
    if (panelTop === undefined) return 0;
    const mapRect = mapRef.current.getDiv().getBoundingClientRect();
    if (mapRect.height <= 0) return 0;
    const visibleTop = mapRect.top;
    const yObjetivo = Math.max(visibleTop + MARGEN_SOBRE_PANEL_PX, panelTop - MARGEN_SOBRE_PANEL_PX);
    const centroMapaY = mapRect.top + mapRect.height / 2;
    return yObjetivo - centroMapaY;
  }, []);

  // ─── Paso de animación (un solo loop de rAF para marcador + cámara) ───────
  // Interpola linealmente lat/lng entre animacionInicioRef y animacionDestinoRef (a
  // las distancias de dos fixes GPS consecutivos, decenas de metros, una interpolación
  // lineal es indistinguible de una esférica) y el heading por el camino angular más
  // corto. Cada frame: 1) actualiza el marcador siempre; 2) mueve la cámara sólo si
  // corresponde (en modoNavegacion, sólo mientras siguiendoChoferRef sea true — en
  // vistas de sólo lectura, siempre, igual que el comportamiento previo). A propósito
  // NO toca zoom ni tilt acá: esos quedan estables durante el seguimiento (los fija
  // restaurarCamaraNavegacion una única vez, al reactivarse).
  const pasoAnimacion = useCallback(() => {
    const inicio  = animacionInicioRef.current;
    const destino = animacionDestinoRef.current;
    if (!inicio || !destino || !mapRef.current) {
      animacionFrameRef.current = null;
      return;
    }
    const ahora = performance.now();
    const msTranscurridos = ahora - animacionInicioTsRef.current;

    let latActual: number, lngActual: number, headingActual: number | null;

    if (msTranscurridos <= animacionDuracionRef.current) {
      // Interpolación normal entre el último fix real conocido y el actual.
      const t = Math.min(1, msTranscurridos / animacionDuracionRef.current);
      latActual = inicio.lat + (destino.lat - inicio.lat) * t;
      lngActual = inicio.lng + (destino.lng - inicio.lng) * t;
      if (destino.heading === null) {
        headingActual = inicio.heading;
      } else if (inicio.heading === null) {
        headingActual = destino.heading;
      } else {
        headingActual = interpolarHeading(inicio.heading, destino.heading, t);
      }
    } else {
      // Ya se llegó al destino real y el PRÓXIMO fix todavía no llegó — predicción
      // limitada (ver EXTRAPOLACION_MAX_MS): seguir avanzando con el último rumbo y
      // velocidad reales conocidos, en vez de congelarse a esperar.
      const msExtrapolados = Math.min(msTranscurridos - animacionDuracionRef.current, EXTRAPOLACION_MAX_MS);
      headingActual = destino.heading ?? inicio.heading;
      if (velocidadMPorMsRef.current > 0 && headingActual !== null) {
        const distanciaExtra = velocidadMPorMsRef.current * msExtrapolados;
        const puntoExtra = puntoAdelantado({ lat: destino.lat, lng: destino.lng }, headingActual, distanciaExtra);
        latActual = puntoExtra.lat;
        lngActual = puntoExtra.lng;
      } else {
        latActual = destino.lat;
        lngActual = destino.lng;
      }
    }

    // TILA_NAV_DIAG: no cambia ninguna decisión, sólo alimenta el heartbeat.
    diagExtrapolandoRef.current = msTranscurridos > animacionDuracionRef.current;
    const ultimoGpsRealDiag = historialPosicionRef.current.actual;
    if (ultimoGpsRealDiag) {
      diagDistanciaGpsVisualRef.current = distanciaMetros(ultimoGpsRealDiag, { lat: latActual, lng: lngActual });
    }
    if (!Number.isFinite(latActual) || !Number.isFinite(lngActual)) {
      diagContadoresRef.current.posicionNoFinita++;
      diagLog(`[TILA_NAV_DIAG] ALERTA posición no finita lat=${latActual} lng=${lngActual} t=${Math.round(performance.now())}`);
    }

    posicionVisualActualRef.current = { lat: latActual, lng: lngActual, heading: headingActual };

    // Snap visual: el ÍCONO se dibuja proyectado sobre la polyline activa mientras el
    // vehículo esté dentro de un corredor razonable de la ruta (ver
    // UMBRAL_CORREDOR_SNAP_VISUAL_METROS) — el GPS real (posicionVisualActualRef, arriba,
    // usado por cámara/animación/desvío) no se toca. posicionSnapRutaRef se recalcula en
    // el bloque de recorte más abajo, a su misma cadencia (INTERVALO_MIN_RECORTE_MS) —
    // acá simplemente se reutiliza el último valor fresco. Fuera de modoNavegacion, o sin
    // un snap fresco todavía (arranque, ruta recién reemplazada, tick de accuracy mala),
    // el ícono se dibuja en su posición GPS real tal cual, sin forzarlo.
    const snapVisual = modoNavegacion ? posicionSnapRutaRef.current : null;
    const posicionMarcador = (snapVisual && snapVisual.distancia <= UMBRAL_CORREDOR_SNAP_VISUAL_METROS)
      ? snapVisual.punto
      : { lat: latActual, lng: lngActual };

    if (choferMarkerRef.current) {
      choferMarkerRef.current.setPosition(posicionMarcador);
    } else {
      // TILA_NAV_DIAG: evidencia directa de "el marcador desaparece" — si esto se ve en
      // logcat durante la prueba, el marcador realmente no existe en ese momento.
      diagContadoresRef.current.marcadorFaltante++;
      diagLog(`[TILA_NAV_DIAG] ALERTA choferMarkerRef.current es null en pasoAnimacion t=${Math.round(performance.now())}`);
    }

    if (modoNavegacion) {
      // Mientras restaurarCamaraNavegacion ("Mi ubicación") está aplicando su propia
      // actualización atómica, este tick NO toca la cámara — evita la doble escritura
      // que producía el "viaje" errático de zoom/encuadre reportado.
      if (
        siguiendoChoferRef.current
        && !restaurandoCamaraRef.current
        && ahora - ultimaActualizacionCamaraTsRef.current >= INTERVALO_MIN_CAMARA_MS
      ) {
        ultimaActualizacionCamaraTsRef.current = ahora;
        // Look-ahead: si hay rumbo válido, la cámara centra un poco adelante del
        // vehículo (en su dirección real de marcha), no exactamente sobre él — el
        // marcador ya se posicionó arriba en la coordenada GPS real, sin desplazar.
        const centroCamara = headingActual !== null
          ? puntoAdelantado({ lat: latActual, lng: lngActual }, headingActual, LOOK_AHEAD_METROS)
          : { lat: latActual, lng: lngActual };
        moverCamara(() => {
          // Desplaza el centro real hacia arriba en pantalla, para que el camión
          // (en centroCamara) quede pegado arriba del panel, no en el centro geométrico.
          const centroFinal = puntoConOffsetVerticalPx(
            mapRef.current!, centroCamara, calcularOffsetVerticalCamara()
          ) ?? centroCamara;
          mapRef.current!.setCenter(centroFinal);
          if (headingActual !== null) {
            mapRef.current!.setHeading(headingActual);
            ultimoHeadingNavegacionRef.current = headingActual;
            // TILA_NAV_DIAG
            diagUltimoHeadingAplicadoRef.current = headingActual;
            diagUltimaFuenteHeadingRef.current = "pasoAnimacion";
          }
        }, "pasoAnimacion");
      }

      // Traza visible: recortada con la MISMA posición interpolada de este frame (no
      // con el último fix crudo) y throtteada a la misma cadencia que la cámara — así
      // el arranque de la línea se mueve en sincronía con el marcador en vez de quedar
      // fijo entre un fix GPS y el siguiente. sincronizarIndiceConRuta corre ACÁ MISMO,
      // justo antes de leer el índice — no depende de que ningún useEffect lo haya
      // corregido de antemano, así nunca puede dibujar la polyline nueva con el índice
      // de la generación anterior (ver el comentario largo junto a esa función).
      if (
        !calculandoRutaNavRef.current
        && ahora - ultimaActualizacionRecorteTsRef.current >= INTERVALO_MIN_RECORTE_MS
      ) {
        ultimaActualizacionRecorteTsRef.current = ahora;
        const polyline = rutaPolylineRef.current;
        const requestIdDeEstaEscritura = rutaRequestIdRef.current;
        const accuracyActualRecorte = accuracyRef.current ?? null;
        const accuracyMalaRecorte = accuracyActualRecorte !== null && accuracyActualRecorte > UMBRAL_ACCURACY_MALA_METROS;
        // Fix de mala precisión: se congela el recorte este tick (no se reelige
        // segmento ni se redibuja) en vez de arriesgarse a saltar a otra calzada con
        // una posición poco confiable — ver UMBRAL_ACCURACY_MALA_METROS.
        if (polyline.length >= 2 && !accuracyMalaRecorte) {
          const indiceSincronizado = sincronizarIndiceConRuta(polyline);
          const { puntos, indice, snapPunto, snapDistancia } = recortarRutaDesdeVehiculo(
            polyline, { lat: latActual, lng: lngActual }, MARGEN_RUTA_DETRAS_METROS, indiceSincronizado,
            headingActual, velocidadMPorMsRef.current > 0 ? velocidadMPorMsRef.current * 1000 : null,
            accuracyActualRecorte, requestIdDeEstaEscritura
          );
          // Defensivo: todo este bloque es síncrono (nada puede reasignar
          // rutaPolylineRef en el medio), así que esta condición siempre debería ser
          // verdadera — se deja como guarda explícita en vez de asumirlo.
          if (rutaPolylineRef.current === polyline) {
            // avanzarIndiceProgreso, no asignación cruda: este camino usa la posición
            // INTERPOLADA/EXTRAPOLADA (puede sobrepasar momentáneamente la calzada real
            // en una curva) — nunca puede hacer retroceder el progreso ya confirmado por
            // el otro escritor (el efecto de desvío, con GPS crudo). Ver avanzarIndiceProgreso.
            avanzarIndiceProgreso(indice);
            posicionSnapRutaRef.current = (snapPunto && snapDistancia !== null)
              ? { punto: snapPunto, distancia: snapDistancia }
              : null;
            if (ultimoRequestIdEscritoRef.current !== requestIdDeEstaEscritura) {
              ultimoRequestIdEscritoRef.current = requestIdDeEstaEscritura;
              diagLog(`[TILA_NAV_DIAG] RUTA_VISUAL_PRIMERA_ESCRITURA requestId=${requestIdDeEstaEscritura} puntosVisibles=${puntos.length} t=${Math.round(performance.now())}`);
            }
            setRutaVisibleDesdeVehiculo(puntos);
          } else {
            diagLog(`[TILA_NAV_DIAG] RUTA_VISUAL_ESCRITURA_DESCARTADA requestId=${requestIdDeEstaEscritura} t=${Math.round(performance.now())}`);
          }
        }
      }
    } else {
      moverCamara(() => { mapRef.current!.setCenter({ lat: latActual, lng: lngActual }); }, "pasoAnimacion-lectura");
    }

    // Sigue animando durante la interpolación normal Y durante la ventana de
    // extrapolación acotada — recién más allá de eso (ningún fix nuevo llegó en todo
    // ese tiempo) se corta el loop y el vehículo se queda quieto de verdad.
    if (msTranscurridos < animacionDuracionRef.current + EXTRAPOLACION_MAX_MS) {
      animacionFrameRef.current = requestAnimationFrame(() => pasoAnimacionRef.current());
    } else {
      animacionFrameRef.current = null;
    }
  }, [modoNavegacion, moverCamara, calcularOffsetVerticalCamara, sincronizarIndiceConRuta, avanzarIndiceProgreso]);
  useEffect(() => {
    pasoAnimacionRef.current = pasoAnimacion;
  }, [pasoAnimacion]);

  // ─── Dispara una animación hacia una nueva posición GPS ───────────────────
  // Reemplaza el salto instantáneo (setPosition/setCenter directo) por una interpolación
  // de DURACION_ANIMACION_MIN_MS a MAX_MS, ajustada según el intervalo real entre este
  // fix y el anterior. El punto de partida es la posición VISUAL actual (no la última
  // posición GPS cruda), para que un fix nuevo a mitad de una animación continúe suave
  // desde donde el ojo lo ve, en vez de saltar hacia atrás al último punto "oficial".
  const animarHaciaPosicion = useCallback((latDestino: number, lngDestino: number, headingDestino: number | null) => {
    const ahora = performance.now();
    const intervaloReal = ultimoTickTsRef.current === null ? null : ahora - ultimoTickTsRef.current;
    ultimoTickTsRef.current = ahora;

    const origen = posicionVisualActualRef.current ?? { lat: latDestino, lng: lngDestino, heading: headingDestino };

    // Velocidad real (metros/ms) entre la última posición visual y este fix — sólo se
    // recalcula con intervalos reales (>100ms, para no amplificar ruido de fixes casi
    // simultáneos) y sólo se usa como respaldo si el PRÓXIMO fix tarda (ver pasoAnimacion).
    if (intervaloReal !== null && intervaloReal > 100) {
      const distanciaReal = distanciaMetros(origen, { lat: latDestino, lng: lngDestino });
      velocidadMPorMsRef.current = distanciaReal / intervaloReal;
    }

    const duracion = Math.min(DURACION_ANIMACION_MAX_MS, Math.max(DURACION_ANIMACION_MIN_MS, intervaloReal ?? DURACION_ANIMACION_MAX_MS));

    // TILA_NAV_DIAG: heading calculado por bearing entre los dos últimos fixes GPS REALES
    // (no se usa para nada, sólo se loguea/guarda para comparar contra el heading crudo y
    // el heading finalmente aplicado). historialPosicionRef ya se actualizó antes de
    // llamar a esta función (ver el efecto que la invoca).
    const { previa: gpsPrevioDiag, actual: gpsActualDiag } = historialPosicionRef.current;
    let headingCalculadoDiag: number | null = null;
    if (gpsPrevioDiag && gpsActualDiag) {
      const distGpsDiag = distanciaMetros(gpsPrevioDiag, gpsActualDiag);
      if (distGpsDiag >= 3) headingCalculadoDiag = calcularBearing(gpsPrevioDiag, gpsActualDiag);
    }
    diagHeadingCalculadoRef.current = headingCalculadoDiag;
    diagLog(
      `[TILA_NAV_DIAG] fixGPS lat=${latDestino.toFixed(6)} lng=${lngDestino.toFixed(6)} `
      + `headingCrudo=${headingDestino ?? "null"} headingCalculado=${headingCalculadoDiag ?? "null"} `
      + `intervaloRealMs=${intervaloReal ?? "null"} velocidadMs=${(velocidadMPorMsRef.current * 1000).toFixed(2)} `
      + `t=${Math.round(ahora)}`
    );

    animacionInicioRef.current  = origen;
    animacionDestinoRef.current = { lat: latDestino, lng: lngDestino, heading: headingDestino };
    animacionInicioTsRef.current = ahora;
    animacionDuracionRef.current = duracion;

    // Cancela cualquier animación anterior todavía en vuelo antes de arrancar la nueva —
    // nunca dos loops de rAF compitiendo por el mismo marcador/cámara.
    if (animacionFrameRef.current !== null) {
      cancelAnimationFrame(animacionFrameRef.current);
    }
    animacionFrameRef.current = requestAnimationFrame(() => pasoAnimacionRef.current());
  }, []);

  // ─── Aplicar polyline fallback con los puntos disponibles ─────────────────
  const aplicarPolylineFallback = useCallback((puntos: google.maps.LatLngLiteral[]) => {
    const validos = puntos.filter(Boolean);
    if (validos.length < 2) return;
    setPolylinePuntos(validos);
    setDiagnostico(d => ({ ...d, polylineFallback: true, puntosPolyline: validos.length }));
    // En modoNavegacion el encuadre inicial lo hace exclusivamente el efecto dedicado más abajo.
    if (!modoNavegacion) encuadrarPuntos(validos);
  }, [modoNavegacion, encuadrarPuntos]);

  // ─── Color chofer ─────────────────────────────────────────────────────────
  const colorChoferPorEstado = (estado?: string): string => {
    switch (estado) {
      case "En camino":           return "#facc15";
      case "Carga retirada":      return "#3b82f6";
      case "En ruta":             return "#a855f7";
      case "Descarga completada": return "#ef4444";
      case "Chofer asignado":     return "#22c55e";
      default:                    return "#facc15";
    }
  };

  // ─── Geocodificar ─────────────────────────────────────────────────────────
  const geocodificar = useCallback(
    (direccion: string, callback: (coords: google.maps.LatLngLiteral | null) => void) => {
      if (!geocoderRef.current) { callback(null); return; }
      geocoderRef.current.geocode(
        { address: `${direccion}, Argentina` },
        (results, status) => {
          if (status === "OK" && results?.[0]) {
            const loc = results[0].geometry.location;
            callback({ lat: loc.lat(), lng: loc.lng() });
          } else {
            callback(null);
          }
        }
      );
    },
    []
  );

  // ─── Encuadrar usando las coordenadas que ya trae Directions ──────────────
  // Evita depender del Geocoding API (puede estar deshabilitado en el proyecto de Google
  // Cloud) para el encuadre inicial: Directions ya resuelve origen/paradas/destino como
  // parte de calcular la ruta, así que reusamos esos puntos en lugar de re-geocodificar.
  const encuadrarDesdeRuta = useCallback((result: google.maps.DirectionsResult) => {
    const legs = result.routes?.[0]?.legs;
    if (!legs || legs.length === 0) return;
    const puntos: google.maps.LatLngLiteral[] = [];
    if (legs[0].start_location) {
      puntos.push({ lat: legs[0].start_location.lat(), lng: legs[0].start_location.lng() });
    }
    legs.forEach(leg => {
      if (leg.end_location) puntos.push({ lat: leg.end_location.lat(), lng: leg.end_location.lng() });
    });
    encuadrarPuntos(puntos);
  }, [encuadrarPuntos]);

  // ─── Calcular ruta con DirectionsService ──────────────────────────────────
  // onSettled (opcional) se llama SIEMPRE al terminar, haya éxito o fallback — a
  // diferencia de onSuccess, que sólo se llama si Directions respondió OK. Los
  // llamadores existentes (recorrido antes de aceptar, multietapa de sólo lectura,
  // modo simple) no lo pasan, así que su comportamiento no cambia.
  const calcularRuta = useCallback((
    // TILA_NAV_DIAG: identifica INEQUÍVOCAMENTE, en los logs, cuál de los call-sites
    // disparó esta invocación (diagnóstico puro — no participa de ninguna decisión
    // funcional, ver CALCULAR_RUTA_ENTRADA/RESPUESTA/APLICADA más abajo).
    motivo: string,
    origin: string | google.maps.LatLngLiteral,
    destinationStr: string,
    waypoints: google.maps.DirectionsWaypoint[],
    fallbackPuntos: google.maps.LatLngLiteral[],
    onSuccess?: (result: google.maps.DirectionsResult) => void,
    onSettled?: () => void,
    // Ver legsActivosNavRef / construirPolylineDetalladaDesdeRuta: sólo lo pasa
    // dispararCalculoNav (navegación activa) cuando hay una parada tipo "retiro"
    // pendiente. Los demás call-sites no lo pasan → sin restricción, igual que hoy.
    legsActivos?: number
  ) => {
    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }
    // Id de esta llamada — si al llegar la respuesta ya no es la más reciente (se disparó
    // otro cálculo mientras ésta estaba en vuelo), se descarta en vez de aplicarse: evita
    // que una respuesta lenta/fuera de orden pise a una más nueva.
    const miRequestId = ++rutaRequestIdRef.current;
    setDiagnostico(d => ({ ...d, directionsStatus: "calculando..." }));

    // TILA_NAV_DIAG: origen/destino EXACTOS enviados a Directions para este pedido.
    const origenDiag = typeof origin === "string" ? origin : `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`;
    diagLog(
      `[TILA_NAV_DIAG] CALCULAR_RUTA_ENTRADA requestId=${miRequestId} motivo=${motivo} `
      + `origen=${origenDiag} destino=${destinationStr} waypoints=${waypoints.length} legsActivos=${legsActivos ?? "n/a"} `
      + `t=${Math.round(performance.now())}`
    );

    directionsServiceRef.current.route(
      {
        origin,
        destination: `${destinationStr}, Argentina`,
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        // obsoleta=true: se disparó OTRO calcularRuta (de cualquier motivo/origen — es
        // un único contador compartido, rutaRequestIdRef) mientras ésta estaba en vuelo.
        // Protección existente contra fuera-de-orden: por diseño no importa si ESTA
        // respuesta llega antes o después que la de la llamada más nueva — lo único que
        // importa es si rutaRequestIdRef.current YA fue adelantado por esa llamada más
        // nueva para cuando ESTA respuesta se procesa. Si sí, se descarta acá, siempre,
        // sin excepción — nunca puede pisar un resultado más nuevo ya aplicado.
        diagLog(`[TILA_NAV_DIAG] CALCULAR_RUTA_RESPUESTA requestId=${miRequestId} motivo=${motivo} status=${status} obsoleta=${miRequestId !== rutaRequestIdRef.current} t=${Math.round(performance.now())}`);
        if (miRequestId !== rutaRequestIdRef.current) return; // respuesta obsoleta
        diagLog(`[TILA_NAV_DIAG] CALCULAR_RUTA_APLICADA requestId=${miRequestId} motivo=${motivo} requestActual=${rutaRequestIdRef.current} t=${Math.round(performance.now())}`);
        setDiagnostico(d => ({ ...d, directionsStatus: status }));
        // Cualquier ruta nueva que efectivamente se aplica (éxito o fallback) reinicia
        // la ventana de gracia del detector de desvío — el cooldown pasa a contarse
        // desde que la ruta ATERRIZÓ, no desde que se detectó el desvío original. Sin
        // esto, el propio delay de red hacía que la posición (ya más adelante para
        // cuando la respuesta llega) pareciera "todavía desviada" de la ruta recién
        // calculada y disparara otro recálculo enseguida (ver el gate de arriba).
        lecturasFueraDeRutaRef.current = 0;
        ultimoRecalculoDesvioTsRef.current = Date.now();
        if (status === "OK" && result) {
          // Geometría DETALLADA (steps[].path[]), no overview_path — ver
          // construirPolylineDetalladaDesdeRuta más arriba: overview_path puede arrancar
          // varias decenas de metros lejos del origen real por la simplificación de
          // Google, lo que dejaba la traza nueva "despegada" del vehículo justo después
          // de recalcular. Fallback a overview_path sólo si por algún motivo la ruta no
          // trajera steps (no debería pasar con travelMode DRIVING).
          const habiaRutaAnterior = rutaPolylineRef.current.length >= 2;
          const puntosOverview  = (result.routes?.[0]?.overview_path ?? []).map(p => ({ lat: p.lat(), lng: p.lng() }));
          const { puntos: puntosDetallados, indicePorStep } = construirPolylineDetalladaDesdeRuta(result, legsActivos);
          rutaPolylineRef.current = puntosDetallados.length >= 2 ? puntosDetallados : puntosOverview;
          legsActivosNavRef.current = legsActivos ?? null;
          // indicePorStep sólo es válido si efectivamente se usó la geometría detallada
          // (si por algún motivo se cayó al overview_path, no hay mapeo step→índice
          // confiable — la máquina de estado de maniobra queda sin datos ese caso raro).
          indicePorStepRef.current = puntosDetallados.length >= 2 ? indicePorStep : [];
          // Siembra el progreso desde el GPS real ANTES de que nada más lea el índice —
          // ver sembrarProgresoRutaNueva. Nunca deja el 0 crudo del reset expuesto a un
          // primer frame dibujado hacia atrás del vehículo.
          sembrarProgresoRutaNueva(rutaPolylineRef.current, miRequestId);
          if (habiaRutaAnterior) {
            diagLog(`[TILA_NAV_DIAG] DIRECTIONS_ANTERIOR_LIMPIADO requestId=${miRequestId} t=${Math.round(performance.now())}`);
          }
          const origenLatLng = typeof origin === "string" ? null : origin;
          const primerPuntoNuevo = rutaPolylineRef.current[0] ?? null;
          const distanciaOrigenAPrimerPunto = origenLatLng && primerPuntoNuevo
            ? distanciaMetros(origenLatLng, primerPuntoNuevo)
            : null;
          diagLog(
            `[TILA_NAV_DIAG] rutaPolylineRef REEMPLAZADA (referencia nueva) `
            + `overviewPath=${puntosOverview.length}pts detallada=${puntosDetallados.length}pts `
            + `origenGps=${origenDiag} `
            + `primerPuntoUsado=${primerPuntoNuevo ? `${primerPuntoNuevo.lat.toFixed(6)},${primerPuntoNuevo.lng.toFixed(6)}` : "n/a"} `
            + `distanciaOrigenAPrimerPunto=${distanciaOrigenAPrimerPunto !== null ? `${Math.round(distanciaOrigenAPrimerPunto)}m` : "n/a"} `
            + `requestId=${miRequestId} t=${Math.round(performance.now())}`
          );
          // TILA_NAV_DIAG: ver diagnosticarPolylineEstado — SOLO diagnóstico, no cambia
          // nada de lo que ya se aplicó arriba. gpsActualDiag es la posición GPS más
          // reciente CONOCIDA al momento de aplicar esta ruta (puede no ser exactamente
          // la usada como origen del pedido — el round-trip a Directions toma tiempo).
          const gpsActualDiag = fixValidoActualRef.current ?? ultimoFixValidoRef.current;
          const diagPolyEstado = diagnosticarPolylineEstado(rutaPolylineRef.current, gpsActualDiag);
          const ultimoPuntoDiag = rutaPolylineRef.current[rutaPolylineRef.current.length - 1] ?? null;
          const gpsAPrimerPuntoDiagM = gpsActualDiag && primerPuntoNuevo
            ? distanciaMetros(gpsActualDiag, primerPuntoNuevo)
            : null;
          diagLog(
            `[TILA_NAV_DIAG] POLYLINE_ESTADO requestId=${miRequestId} motivo=${motivo} `
            + `legsTotales=${result.routes?.[0]?.legs?.length ?? "n/a"} legsActivos=${legsActivos ?? "n/a"} `
            + `puntos=${rutaPolylineRef.current.length} `
            + `primerPunto=${primerPuntoNuevo ? `${primerPuntoNuevo.lat.toFixed(6)},${primerPuntoNuevo.lng.toFixed(6)}` : "n/a"} `
            + `ultimoPunto=${ultimoPuntoDiag ? `${ultimoPuntoDiag.lat.toFixed(6)},${ultimoPuntoDiag.lng.toFixed(6)}` : "n/a"} `
            + `gpsActual=${gpsActualDiag ? `${gpsActualDiag.lat.toFixed(6)},${gpsActualDiag.lng.toFixed(6)}` : "n/a"} `
            + `gpsAPrimerPuntoM=${gpsAPrimerPuntoDiagM !== null ? Math.round(gpsAPrimerPuntoDiagM) : "n/a"} `
            + `indiceMasCercano=${diagPolyEstado.indiceMasCercano ?? "n/a"} `
            + `metrosAntesDelGps=${diagPolyEstado.metrosAntesDelGps !== null ? Math.round(diagPolyEstado.metrosAntesDelGps) : "n/a"} `
            + `t=${Math.round(performance.now())}`
          );
          setDirections(result);
          setPolylinePuntos([]); // limpiar fallback si Directions funcionó
          encuadrarDesdeRuta(result);
          if (onSuccess) onSuccess(result);
        } else {
          // FALLBACK: dibujar Polyline simple con los puntos que tenemos — también sirve
          // como polyline de referencia para medir desvío mientras no haya Directions real.
          const habiaRutaAnterior = rutaPolylineRef.current.length >= 2;
          rutaPolylineRef.current = fallbackPuntos;
          sembrarProgresoRutaNueva(rutaPolylineRef.current, miRequestId);
          if (habiaRutaAnterior) {
            diagLog(`[TILA_NAV_DIAG] FALLBACK_ANTERIOR_LIMPIADO requestId=${miRequestId} t=${Math.round(performance.now())}`);
          }
          // TILA_NAV_DIAG: mismo diagnóstico que la rama OK, sin legs (no hay
          // DirectionsResult en el fallback).
          const gpsActualDiagFallback = fixValidoActualRef.current ?? ultimoFixValidoRef.current;
          const diagPolyEstadoFallback = diagnosticarPolylineEstado(rutaPolylineRef.current, gpsActualDiagFallback);
          const primerPuntoFallback = rutaPolylineRef.current[0] ?? null;
          const ultimoPuntoFallback = rutaPolylineRef.current[rutaPolylineRef.current.length - 1] ?? null;
          const gpsAPrimerPuntoFallbackM = gpsActualDiagFallback && primerPuntoFallback
            ? distanciaMetros(gpsActualDiagFallback, primerPuntoFallback)
            : null;
          diagLog(
            `[TILA_NAV_DIAG] POLYLINE_ESTADO requestId=${miRequestId} motivo=${motivo} `
            + `legsTotales=n/a(fallback) legsActivos=${legsActivos ?? "n/a"} puntos=${rutaPolylineRef.current.length} `
            + `primerPunto=${primerPuntoFallback ? `${primerPuntoFallback.lat.toFixed(6)},${primerPuntoFallback.lng.toFixed(6)}` : "n/a"} `
            + `ultimoPunto=${ultimoPuntoFallback ? `${ultimoPuntoFallback.lat.toFixed(6)},${ultimoPuntoFallback.lng.toFixed(6)}` : "n/a"} `
            + `gpsActual=${gpsActualDiagFallback ? `${gpsActualDiagFallback.lat.toFixed(6)},${gpsActualDiagFallback.lng.toFixed(6)}` : "n/a"} `
            + `gpsAPrimerPuntoM=${gpsAPrimerPuntoFallbackM !== null ? Math.round(gpsAPrimerPuntoFallbackM) : "n/a"} `
            + `indiceMasCercano=${diagPolyEstadoFallback.indiceMasCercano ?? "n/a"} `
            + `metrosAntesDelGps=${diagPolyEstadoFallback.metrosAntesDelGps !== null ? Math.round(diagPolyEstadoFallback.metrosAntesDelGps) : "n/a"} `
            + `t=${Math.round(performance.now())}`
          );
          aplicarPolylineFallback(fallbackPuntos);
        }
        if (onSettled) onSettled();
      }
    );
  }, [aplicarPolylineFallback, encuadrarDesdeRuta, sembrarProgresoRutaNueva]);

  // ─── Calcular ruta de NAVEGACIÓN ACTIVA vía Routes API ─────────────────────
  // Exclusivo de dispararCalculoNav (ver USAR_ROUTES_API_NAVEGACION) — los otros 3
  // call-sites de calcularRuta (recorrido-chofer, multietapa, simple) no lo usan y no
  // cambian. Duplica deliberadamente el orquestado de éxito/fallback de calcularRuta
  // en vez de compartirlo — mantiene calcularRuta (DirectionsService) intacto, cero
  // riesgo de regresión en las otras 3 pantallas, y permite revertir esta función sola
  // sin tocar la otra. Comparte rutaRequestIdRef (mismo contador, misma protección
  // contra respuestas fuera de orden que ya usa calcularRuta — ver el chequeo
  // `miRequestId !== rutaRequestIdRef.current`).
  const calcularRutaNavegacionDireccional = useCallback((
    motivo: string,
    fixOrigen: google.maps.LatLngLiteral,
    destinationStr: string,
    waypoints: google.maps.DirectionsWaypoint[],
    fallbackPuntos: google.maps.LatLngLiteral[],
    onSettled?: () => void,
    legsActivos?: number
  ) => {
    const miRequestId = ++rutaRequestIdRef.current;
    // Capturado AHORA (momento del pedido) — headingAceptadoRef.current puede cambiar
    // mientras el request está en vuelo; RUTA_DIRECCIONAL necesita el heading que
    // realmente se mandó, no el que haya en el momento de la respuesta.
    const headingAlPedir = headingAceptadoRef.current;
    setDiagnostico(d => ({ ...d, directionsStatus: "calculando..." }));

    const origenDiag = `${fixOrigen.lat.toFixed(6)},${fixOrigen.lng.toFixed(6)}`;
    diagLog(
      `[TILA_NAV_DIAG] CALCULAR_RUTA_ENTRADA requestId=${miRequestId} motivo=${motivo} `
      + `origen=${origenDiag} destino=${destinationStr} legsActivos=${legsActivos ?? "n/a"} `
      + `via=routesApi headingOrigen=${headingAlPedir ?? "n/a"} t=${Math.round(performance.now())}`
    );

    const aplicarFallback = () => {
      const habiaRutaAnterior = rutaPolylineRef.current.length >= 2;
      rutaPolylineRef.current = fallbackPuntos;
      sembrarProgresoRutaNueva(rutaPolylineRef.current, miRequestId);
      if (habiaRutaAnterior) {
        diagLog(`[TILA_NAV_DIAG] FALLBACK_ANTERIOR_LIMPIADO requestId=${miRequestId} t=${Math.round(performance.now())}`);
      }
      aplicarPolylineFallback(fallbackPuntos);
      if (onSettled) onSettled();
    };

    const body = {
      origin: construirWaypointOrigenDireccional(fixOrigen, headingAlPedir),
      destination: { address: `${destinationStr}, Argentina` },
      intermediates: waypoints.map(w => ({ address: String(w.location) })),
      travelMode: "DRIVE",
      // TRAFFIC_AWARE, no _OPTIMAL: heading ya sube el request al SKU Advanced —
      // no sumar además el costo de _OPTIMAL sin necesidad confirmada en campo.
      routingPreference: "TRAFFIC_AWARE",
      polylineQuality: "HIGH_QUALITY",
      polylineEncoding: "ENCODED_POLYLINE",
    };

    fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
        "X-Goog-FieldMask": FIELD_MASK_ROUTES_API_NAVEGACION,
      },
      body: JSON.stringify(body),
    })
      .then(res => {
        if (res.ok) return res.json();
        // TILA_NAV_DIAG — SOLO diagnóstico: por qué Google devuelve 4xx/5xx. body de
        // `body` (la variable de arriba, el request que se mandó) nunca contiene la
        // API key — eso viaja únicamente en el header X-Goog-Api-Key, jamás en el
        // cuerpo — así que loguearlo tal cual no expone nada sensible.
        return res.text().then(bodyRespuesta => {
          diagLog(`[TILA_NAV_DIAG] ROUTES_API_ERROR status=${res.status} body=${bodyRespuesta}`);
          diagLog(`[TILA_NAV_DIAG] ROUTES_API_REQUEST_ERROR bodyEnviado=${JSON.stringify(body)}`);
          return Promise.reject(new Error(`status ${res.status}`));
        });
      })
      .then((json: RoutesApiResponse) => {
        diagLog(
          `[TILA_NAV_DIAG] CALCULAR_RUTA_RESPUESTA requestId=${miRequestId} motivo=${motivo} status=OK `
          + `obsoleta=${miRequestId !== rutaRequestIdRef.current} via=routesApi t=${Math.round(performance.now())}`
        );
        if (miRequestId !== rutaRequestIdRef.current) return; // respuesta obsoleta
        diagLog(`[TILA_NAV_DIAG] CALCULAR_RUTA_APLICADA requestId=${miRequestId} motivo=${motivo} requestActual=${rutaRequestIdRef.current} via=routesApi t=${Math.round(performance.now())}`);
        setDiagnostico(d => ({ ...d, directionsStatus: "OK" }));
        // Mismo reinicio de ventana de gracia del desvío que calcularRuta — cualquier
        // ruta nueva que efectivamente se aplica reinicia el cooldown desde que
        // ATERRIZÓ, no desde que se detectó el desvío original (ver calcularRuta).
        lecturasFueraDeRutaRef.current = 0;
        ultimoRecalculoDesvioTsRef.current = Date.now();

        const result = adaptarRespuestaRoutesAPI(json);
        if (!result) { aplicarFallback(); return; }

        const habiaRutaAnterior = rutaPolylineRef.current.length >= 2;
        const { puntos: puntosDetallados, indicePorStep } = construirPolylineDetalladaDesdeRuta(result, legsActivos);
        if (puntosDetallados.length < 2) { aplicarFallback(); return; }
        rutaPolylineRef.current = puntosDetallados;
        legsActivosNavRef.current = legsActivos ?? null;
        indicePorStepRef.current = indicePorStep;
        // TILA_NAV_DIAG — SOLO diagnóstico: confirma que indicePorStep realmente
        // apunta al punto de la polyline donde arranca cada step (start_location) —
        // la corrección de comparteInicio en construirPolylineDetalladaDesdeRuta es la
        // que debería dejar distanciaM en ~0. Sólo los primeros 3 steps de la ruta
        // recién instalada, para no inundar el log.
        (result.routes?.[0]?.legs?.flatMap(l => l.steps ?? []) ?? []).slice(0, 3).forEach((paso, i) => {
          const puntoIndice = rutaPolylineRef.current[indicePorStep[i]] ?? null;
          const startLoc = paso.start_location
            ? { lat: paso.start_location.lat(), lng: paso.start_location.lng() }
            : null;
          const distanciaCheck = startLoc && puntoIndice ? distanciaMetros(startLoc, puntoIndice) : null;
          diagLog(
            `[TILA_NAV_DIAG] INDICE_POR_STEP_CHECK requestId=${miRequestId} step=${i} maniobra=${paso.maneuver ?? "?"} `
            + `indicePorStep=${indicePorStep[i] ?? "n/a"} `
            + `startLocation=${startLoc ? `${startLoc.lat.toFixed(6)},${startLoc.lng.toFixed(6)}` : "n/a"} `
            + `puntoEnIndice=${puntoIndice ? `${puntoIndice.lat.toFixed(6)},${puntoIndice.lng.toFixed(6)}` : "n/a"} `
            + `distanciaM=${distanciaCheck !== null ? distanciaCheck.toFixed(1) : "n/a"} t=${Math.round(performance.now())}`
          );
        });
        // Siembra el progreso desde el GPS REAL actual (fixValidoActualRef, dentro de
        // sembrarProgresoRutaNueva) — no desde fixOrigen (el usado al pedir, ya
        // desactualizado durante el round-trip). Ya resuelto, sin cambios acá.
        sembrarProgresoRutaNueva(rutaPolylineRef.current, miRequestId);
        if (habiaRutaAnterior) {
          diagLog(`[TILA_NAV_DIAG] DIRECTIONS_ANTERIOR_LIMPIADO requestId=${miRequestId} t=${Math.round(performance.now())}`);
        }

        // RUTA_DIRECCIONAL: valida si el heading enviado en el origen realmente evitó
        // un primer tramo en sentido contrario — puramente diagnóstico, no decide nada.
        const gpsAlResponder = fixValidoActualRef.current ?? ultimoFixValidoRef.current;
        const bearingInicial = rutaPolylineRef.current.length >= 2
          ? calcularBearing(rutaPolylineRef.current[0], rutaPolylineRef.current[1])
          : null;
        const diferenciaAngularInicial = headingAlPedir !== null && bearingInicial !== null
          ? diferenciaAngularGrados(headingAlPedir, bearingInicial)
          : null;
        const recorridoDuranteRequestM = gpsAlResponder ? distanciaMetros(fixOrigen, gpsAlResponder) : null;
        diagLog(
          `[TILA_NAV_DIAG] RUTA_DIRECCIONAL requestId=${miRequestId} motivo=${motivo} `
          + `headingOrigen=${headingAlPedir ?? "n/a"} bearingInicial=${bearingInicial !== null ? Math.round(bearingInicial) : "n/a"}° `
          + `diferenciaAngular=${diferenciaAngularInicial !== null ? Math.round(diferenciaAngularInicial) : "n/a"}° `
          + `recorridoDuranteRequestM=${recorridoDuranteRequestM !== null ? Math.round(recorridoDuranteRequestM) : "n/a"} `
          + `t=${Math.round(performance.now())}`
        );

        const primerPuntoNuevo = rutaPolylineRef.current[0] ?? null;
        const diagPolyEstado = diagnosticarPolylineEstado(rutaPolylineRef.current, gpsAlResponder);
        const ultimoPuntoDiag = rutaPolylineRef.current[rutaPolylineRef.current.length - 1] ?? null;
        const gpsAPrimerPuntoDiagM = gpsAlResponder && primerPuntoNuevo
          ? distanciaMetros(gpsAlResponder, primerPuntoNuevo)
          : null;
        diagLog(
          `[TILA_NAV_DIAG] POLYLINE_ESTADO requestId=${miRequestId} motivo=${motivo} `
          + `legsTotales=${json.routes?.[0]?.legs?.length ?? "n/a"} legsActivos=${legsActivos ?? "n/a"} puntos=${rutaPolylineRef.current.length} `
          + `primerPunto=${primerPuntoNuevo ? `${primerPuntoNuevo.lat.toFixed(6)},${primerPuntoNuevo.lng.toFixed(6)}` : "n/a"} `
          + `ultimoPunto=${ultimoPuntoDiag ? `${ultimoPuntoDiag.lat.toFixed(6)},${ultimoPuntoDiag.lng.toFixed(6)}` : "n/a"} `
          + `gpsActual=${gpsAlResponder ? `${gpsAlResponder.lat.toFixed(6)},${gpsAlResponder.lng.toFixed(6)}` : "n/a"} `
          + `gpsAPrimerPuntoM=${gpsAPrimerPuntoDiagM !== null ? Math.round(gpsAPrimerPuntoDiagM) : "n/a"} `
          + `indiceMasCercano=${diagPolyEstado.indiceMasCercano ?? "n/a"} `
          + `metrosAntesDelGps=${diagPolyEstado.metrosAntesDelGps !== null ? Math.round(diagPolyEstado.metrosAntesDelGps) : "n/a"} `
          + `via=routesApi t=${Math.round(performance.now())}`
        );

        setDirections(result);
        setPolylinePuntos([]);
        encuadrarDesdeRuta(result);
        if (onSettled) onSettled();
      })
      .catch((err: unknown) => {
        const mensaje = err instanceof Error ? err.message : String(err);
        diagLog(
          `[TILA_NAV_DIAG] CALCULAR_RUTA_RESPUESTA requestId=${miRequestId} motivo=${motivo} status=ERROR(${mensaje}) `
          + `obsoleta=${miRequestId !== rutaRequestIdRef.current} via=routesApi t=${Math.round(performance.now())}`
        );
        if (miRequestId !== rutaRequestIdRef.current) return;
        setDiagnostico(d => ({ ...d, directionsStatus: "ERROR" }));
        lecturasFueraDeRutaRef.current = 0;
        ultimoRecalculoDesvioTsRef.current = Date.now();
        aplicarFallback();
      });
  }, [aplicarPolylineFallback, encuadrarDesdeRuta, sembrarProgresoRutaNueva]);

  // ─── Resumen de distancias/tiempos para mostrarRutaDesdeChofer ────────────
  const informarResumenRuta = useCallback((result: google.maps.DirectionsResult) => {
    if (!onResumenRuta) return;
    const legs = result.routes?.[0]?.legs ?? [];
    if (legs.length < 2) return; // esperamos 2 tramos: chofer→retiro y retiro→entrega
    const aLeg = (l: google.maps.DirectionsLeg): ResumenRutaLeg => ({
      distanciaTexto:   l.distance?.text ?? "",
      distanciaMetros:  l.distance?.value ?? 0,
      duracionTexto:    l.duration?.text ?? "",
      duracionSegundos: l.duration?.value ?? 0,
    });
    const hastaRetiro    = aLeg(legs[0]);
    const retiroAEntrega = aLeg(legs[1]);
    const totalMetros    = hastaRetiro.distanciaMetros + retiroAEntrega.distanciaMetros;
    const totalSegundos  = hastaRetiro.duracionSegundos + retiroAEntrega.duracionSegundos;
    onResumenRuta({
      hastaRetiro,
      retiroAEntrega,
      total: {
        distanciaTexto:   formatearDistancia(totalMetros),
        distanciaMetros:  totalMetros,
        duracionTexto:    formatearDuracion(totalSegundos),
        duracionSegundos: totalSegundos,
      },
    });
  }, [onResumenRuta]);

  // ─── Inicializar geocoder ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || modoMultiChofer) return;
    geocoderRef.current = new google.maps.Geocoder();
  }, [isLoaded, modoMultiChofer]);

  // ─── MODO "recorrido completo" (chofer → retiro → entrega), antes de aceptar ──
  useEffect(() => {
    if (!isLoaded || !mostrarRutaDesdeChofer || modoMultiChofer || tieneParadas) return;
    if (!lat || !lng || !origen || !destino) return;
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();

    setDiagnostico(d => ({ ...d, modoActivo: "recorrido-completo-chofer", tieneParadas: false }));
    setDirections(null);
    setPolylinePuntos([]);

    geocodificar(origen, (origenResuelto) => {
      setDiagnostico(d => ({ ...d, geocodingOrigen: origenResuelto ? "OK" : "FAIL" }));
      if (origenResuelto) setOrigenCoords(origenResuelto);
      geocodificar(destino, (destinoResuelto) => {
        setDiagnostico(d => ({ ...d, geocodingDestino: destinoResuelto ? "OK" : "FAIL" }));
        if (destinoResuelto) setDestinoCoords(destinoResuelto);

        const fallback: google.maps.LatLngLiteral[] = [{ lat, lng }];
        if (origenResuelto)  fallback.push(origenResuelto);
        if (destinoResuelto) fallback.push(destinoResuelto);
        // El encuadre "real" lo hace encuadrarDesdeRuta() cuando Directions responda;
        // fallback sólo se usa si Directions falla (aplicarPolylineFallback).

        calcularRuta(
          "recorrido-chofer",
          { lat, lng },
          destino,
          [{ location: `${origen}, Argentina`, stopover: true }],
          fallback,
          informarResumenRuta
        );
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, mostrarRutaDesdeChofer, modoMultiChofer, tieneParadas, lat, lng, origen, destino]);

  // ─── MODO MULTIETAPA (sólo lectura: panel-cliente / panel-chofer) ─────────
  // En modoNavegacion (Viaje Activo) este efecto NO corre — lo reemplazan los dos
  // efectos dedicados de más abajo, que usan la posición real del chofer como
  // origen y recalculan cuando corresponde (no una única vez al montar).
  useEffect(() => {
    if (!isLoaded || !tieneParadas || modoMultiChofer || modoNavegacion) return;
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();

    setDiagnostico(d => ({ ...d, modoActivo: "multietapa", tieneParadas: true }));
    setDirections(null);
    setPolylinePuntos([]);

    const coords: (google.maps.LatLngLiteral | null)[] = new Array(paradas!.length).fill(null);
    let pendientes = paradas!.length;

    paradas!.forEach((parada, index) => {
      geocodificar(parada.direccion, (result) => {
        coords[index] = result;
        pendientes--;
        if (pendientes === 0) {
          setParadasCoords([...coords]);
          const validos = coords.filter(Boolean) as google.maps.LatLngLiteral[];
          if (lat && lng) validos.unshift({ lat, lng });
          // El encuadre "real" lo hace encuadrarDesdeRuta() cuando Directions responda;
          // validos sólo se usa para armar el fallback si Directions falla.

          const origin      = `${paradas![0].direccion}, Argentina`;
          const destination = paradas![paradas!.length - 1].direccion;
          const waypoints   = paradas!.slice(1, -1).map(p => ({
            location: `${p.direccion}, Argentina`,
            stopover: true,
          }));

          // fallback = todos los puntos geocodificados en orden
          const fallback: google.maps.LatLngLiteral[] = [];
          if (lat && lng) fallback.push({ lat, lng });
          validos.forEach(v => fallback.push(v));

          calcularRuta("multietapa-inicial", origin, destination, waypoints, fallback);
        }
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, tieneParadas, modoMultiChofer, JSON.stringify(paradas?.map(p => p.direccion))]);

  // ─── MODO SIMPLE ──────────────────────────────────────────────────────────
  // En modoNavegacion, el tramo "posición del chofer → parada activa" lo resuelve en
  // exclusiva el efecto dedicado de más abajo (necesita reintentar cuando el GPS llega
  // después del primer render). Acá sólo se evita duplicar esa llamada a Directions.
  useEffect(() => {
    if (!isLoaded || tieneParadas || modoMultiChofer || mostrarRutaDesdeChofer) return;
    if (!origen || !destino) return;
    if (modoNavegacion && lat && lng && paradaActivaDireccion) return;
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();

    setDiagnostico(d => ({
      ...d,
      modoActivo: lat && lng ? "simple-con-gps" : "simple-sin-gps",
      tieneParadas: false,
    }));
    setDirections(null);
    setPolylinePuntos([]);

    let origenResuelto:  google.maps.LatLngLiteral | null = lat && lng ? { lat, lng } : null;
    let destinoResuelto: google.maps.LatLngLiteral | null = null;
    let pendientes = 0;

    const intentarRuta = () => {
      if (pendientes > 0) return;
      const fallback: google.maps.LatLngLiteral[] = [];
      if (origenResuelto)  fallback.push(origenResuelto);
      if (destinoResuelto) fallback.push(destinoResuelto);
      // El encuadre "real" lo hace encuadrarDesdeRuta() cuando Directions responda;
      // fallback sólo se usa si Directions falla (aplicarPolylineFallback).

      const originParam: string | google.maps.LatLngLiteral =
        origenResuelto ?? `${origen}, Argentina`;
      const destinoFinal = paradaActivaDireccion ?? destino;

      calcularRuta("simple", originParam, destinoFinal, [], fallback);
    };

    if (!origenResuelto) {
      pendientes++;
      geocodificar(origen, (coords) => {
        setDiagnostico(d => ({ ...d, geocodingOrigen: coords ? "OK" : "FAIL" }));
        origenResuelto = coords;
        if (coords) setOrigenCoords(coords);
        pendientes--;
        intentarRuta();
      });
    } else {
      setDiagnostico(d => ({ ...d, geocodingOrigen: "GPS" }));
    }

    pendientes++;
    geocodificar(destino, (coords) => {
      setDiagnostico(d => ({ ...d, geocodingDestino: coords ? "OK" : "FAIL" }));
      destinoResuelto = coords;
      if (coords) setDestinoCoords(coords);
      pendientes--;
      intentarRuta();
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, tieneParadas, modoMultiChofer, mostrarRutaDesdeChofer, origen, destino, paradaActivaDireccion, modoNavegacion]);

  // ─── modoNavegacion multietapa: geocodificar paradas (markers + encuadre) ──
  // Sólo depende de las direcciones de las paradas — no cambian durante el viaje
  // (sólo cambia su `estado`), así que este efecto corre una única vez por viaje,
  // nunca en cada tick de GPS. Alimenta `paradasCoords`, usado por los markers,
  // por el encuadre inicial y como fallback si Directions falla.
  useEffect(() => {
    if (!isLoaded || !modoNavegacion || !tieneParadas || modoMultiChofer) return;
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();

    const coords: (google.maps.LatLngLiteral | null)[] = new Array(paradas!.length).fill(null);
    let pendientes = paradas!.length;
    paradas!.forEach((parada, index) => {
      geocodificar(parada.direccion, (result) => {
        coords[index] = result;
        pendientes--;
        if (pendientes === 0) setParadasCoords([...coords]);
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, modoNavegacion, tieneParadas, modoMultiChofer, JSON.stringify(paradas?.map(p => p.direccion))]);

  // ─── modoNavegacion multietapa: calcular ruta chofer → paradas pendientes ──
  // A diferencia del modo de sólo lectura de arriba (que usa paradas[0] como origen
  // porque ahí no hay un chofer en viaje), acá el origen SIEMPRE es la posición real
  // del chofer, y el destino/waypoints salen únicamente de las paradas todavía NO
  // completadas, respetando su orden real. Recalcula cuando: cambia el conjunto de
  // paradas pendientes (se completó una), llega el primer GPS, o el chofer se desvió
  // realmente de la ruta vigente — nunca por sólo haber recorrido distancia mientras
  // sigue sobre la ruta correcta, y nunca por una sola lectura ruidosa (ver más abajo).
  const paradasPendientesKeyRef  = useRef<string | null>(null);
  const primerGpsMultietapaRef   = useRef(false);

  // ─── Validación defensiva de fixes GPS (ver evaluarConsistenciaFix más arriba) ─────
  // ultimoFixValidoRef/ultimoFixValidoTsRef: último fix ACEPTADO y cuándo. penultimoFixValidoRef:
  // el aceptado antes de ése — sólo para poder calcular el rumbo de la trayectoria
  // reciente real (independiente del heading que reporte el GPS). fixValidoActualRef: el
  // resultado del tick de GPS actual (el fix si se aceptó, null si se rechazó) — todo lo
  // que consume GPS (marcador/interpolación, desvío, progreso de ruta, recálculo) lee
  // esto en vez de las props lat/lng crudas.
  const ultimoFixValidoRef    = useRef<google.maps.LatLngLiteral | null>(null);
  const ultimoFixValidoTsRef  = useRef<number | null>(null);
  const penultimoFixValidoRef = useRef<google.maps.LatLngLiteral | null>(null);
  const fixValidoActualRef    = useRef<google.maps.LatLngLiteral | null>(null);
  // Heading del ÚLTIMO fix ACEPTADO por el efecto de validación (bootstrap o
  // evaluarConsistenciaFix) — a diferencia del heading prop crudo, que refleja
  // CUALQUIER fix reportado por el GPS, aceptado o no. Se actualiza EXCLUSIVAMENTE en
  // los mismos puntos donde fixValidoActualRef pasa a un valor no-null (nunca en los
  // rechazos, ver aceptarHeadingDeEsteFix más abajo), siempre con el heading de ESE
  // MISMO tick — nunca el de un tick posterior/rechazado. Causa confirmada de heading
  // ~180° invertido en elegirSegmentoActivo: un fix rechazado (velocidadImplicita/
  // rumboInconsistente) no movía la posición operativa, pero el heading prop crudo
  // (ViajeActivoPage lo actualiza en cada watchPosition, sin saber si MapaTILA aceptó
  // esa posición) sí seguía cambiando — quedando disponible para el próximo fix
  // aceptado, sin relación garantizada con su posición real.
  const headingAceptadoRef    = useRef<number | null>(null);
  // Candidatos a reenganche: fixes RECHAZADOS pero coherentes entre sí, acumulados sólo
  // mientras hace mucho que no se acepta ninguno — ver UMBRAL_MS_SIN_ACEPTAR_PARA_REENGANCHE.
  const candidatosReenganceRef = useRef<google.maps.LatLngLiteral[]>([]);

  // ── Bootstrap GPS: fase de adquisición ──────────────────────────────────────
  // gpsInicialEstabilizadoRef: false mientras la sesión todavía no tiene una base
  // confiable — ver el bloque de constantes junto a UMBRAL_ACCURACY_BOOTSTRAP_BUENO_METROS.
  // Mientras sea false: Directions/desvío/voz permanecen bloqueados (ver los efectos
  // correspondientes más abajo), pero marcador/cámara siguen funcionando con lo que
  // haya en fixValidoActualRef, como pediste ("puede mostrarse el mapa; puede
  // recibirse GPS"). bootstrapMejorAccuracyRef: accuracy del mejor candidato aceptado
  // hasta ahora (null si nunca se recibió accuracy). bootstrapCandidatosCoherentesRef:
  // cadena de candidatos mutuamente cercanos, para la vía de estabilización (b).
  const gpsInicialEstabilizadoRef        = useRef(false);
  const bootstrapMejorAccuracyRef        = useRef<number | null>(null);
  const bootstrapCandidatosCoherentesRef = useRef<google.maps.LatLngLiteral[]>([]);

  // Reset explícito al montar: la base de validación NUNCA debe arrancar desde lat/lng
  // (que en el primer render puede ser la última posición conocida guardada en la base de
  // datos del viaje, no un fix GPS real de ESTA sesión — ver el bug real: la base quedaba
  // anclada a esa posición vieja y todo GPS real posterior se rechazaba para siempre por
  // estar a miles de metros). Los refs ya nacen en null por useRef(null); este efecto lo
  // deja explícito y a salvo de cualquier reutilización de instancia.
  useEffect(() => {
    ultimoFixValidoRef.current    = null;
    ultimoFixValidoTsRef.current  = null;
    penultimoFixValidoRef.current = null;
    candidatosReenganceRef.current = [];
    gpsInicialEstabilizadoRef.current = false;
    bootstrapMejorAccuracyRef.current = null;
    bootstrapCandidatosCoherentesRef.current = [];
  }, []);

  // Corre PRIMERO en cada commit (declarado antes que el resto de los efectos que leen
  // GPS: desvío, recorte visual, marcador/cámara), así fixValidoActualRef ya está
  // actualizado para este tick cuando ellos se ejecutan — React corre los efectos en el
  // orden en que se declaran dentro del componente. Delega la decisión de aceptar/
  // rechazar en evaluarConsistenciaFix (velocidad + rumbo) — no toca cámara/interpolación
  // en sí, sólo decide si este tick se procesa o se ignora por completo (igual que si el
  // GPS no hubiera emitido nada en ese instante — la extrapolación acotada ya cubre esos
  // huecos). El heading que se pasa es el que reportó el GPS PARA ESTE fix (prop `heading`,
  // no se altera ni se usa para nada más acá).
  useEffect(() => {
    if (!lat || !lng) { fixValidoActualRef.current = null; return; }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      fixValidoActualRef.current = null;
      diagLog(`[TILA_NAV_DIAG] gps-validacion RECHAZADO no-finito lat=${lat} lng=${lng}`);
      return;
    }
    const nuevo  = { lat, lng };
    const ahora  = Date.now();

    // Heading de ESTE MISMO fix (mismo tick, mismo closure) — se llama junto a cada
    // asignación de fixValidoActualRef a un valor no-null más abajo, nunca en las ramas
    // de rechazo. heading null en un fix aceptado (GPS sin rumbo confiable: detenido,
    // señal débil) preserva el último heading aceptado conocido en vez de pisarlo con
    // null — mismo criterio que ya usa ViajeActivoPage para headingChofer.
    const aceptarHeadingDeEsteFix = () => {
      const headingDeEsteFix = headingValido(heading);
      if (headingDeEsteFix !== null) headingAceptadoRef.current = headingDeEsteFix;
    };

    // ── Fase de adquisición (bootstrap) ─────────────────────────────────────
    // Mientras no estabilizó, NO pasa por evaluarConsistenciaFix — esa función
    // compara contra una base que acá todavía no confirmamos que sea correcta, así
    // que aplicarla podría rechazar para siempre un fix bueno por culpa de un
    // candidato de bootstrap malo (exactamente el bug real que se está corrigiendo).
    if (!gpsInicialEstabilizadoRef.current) {
      const accuracyActual = accuracyRef.current ?? null;
      const baseBootstrapActual = ultimoFixValidoRef.current;

      if (!baseBootstrapActual) {
        ultimoFixValidoRef.current    = nuevo;
        ultimoFixValidoTsRef.current  = ahora;
        fixValidoActualRef.current    = nuevo;
        aceptarHeadingDeEsteFix();
        bootstrapMejorAccuracyRef.current = accuracyActual;
        bootstrapCandidatosCoherentesRef.current = [nuevo];
        diagLog(`[TILA_NAV_DIAG] GPS_BOOTSTRAP_CANDIDATO primero=true lat=${lat.toFixed(6)} lng=${lng.toFixed(6)} accuracy=${accuracyActual ?? "n/a"} t=${Math.round(performance.now())}`);
      } else {
        // ¿Este candidato tiene mejor accuracy que la base actual de bootstrap?
        // Reemplaza directamente — sin chequeo de velocidad, no aplica todavía.
        const accuracyBaseActual = bootstrapMejorAccuracyRef.current;
        const esMejor = accuracyActual !== null && (accuracyBaseActual === null || accuracyActual < accuracyBaseActual);
        if (esMejor) {
          diagLog(
            `[TILA_NAV_DIAG] GPS_BOOTSTRAP_REEMPLAZADO `
            + `baseAnterior=${baseBootstrapActual.lat.toFixed(6)},${baseBootstrapActual.lng.toFixed(6)} accuracyAnterior=${accuracyBaseActual ?? "n/a"} `
            + `baseNueva=${lat.toFixed(6)},${lng.toFixed(6)} accuracyNueva=${accuracyActual} t=${Math.round(performance.now())}`
          );
          ultimoFixValidoRef.current    = nuevo;
          ultimoFixValidoTsRef.current  = ahora;
          bootstrapMejorAccuracyRef.current = accuracyActual;
        } else {
          diagLog(`[TILA_NAV_DIAG] GPS_BOOTSTRAP_CANDIDATO primero=false lat=${lat.toFixed(6)} lng=${lng.toFixed(6)} accuracy=${accuracyActual ?? "n/a"} t=${Math.round(performance.now())}`);
        }
        // El mapa sigue mostrando el fix crudo de este tick aunque no reemplace la
        // base — "puede recibirse GPS" durante la adquisición.
        fixValidoActualRef.current = nuevo;
        aceptarHeadingDeEsteFix();

        // Vía alternativa de estabilización: varios candidatos SEGUIDOS mutuamente
        // cercanos, aunque ninguno individualmente tenga accuracy "buena".
        const candidatos = bootstrapCandidatosCoherentesRef.current;
        const ultimoCandidato = candidatos[candidatos.length - 1] ?? null;
        const esCoherente = !ultimoCandidato || distanciaMetros(ultimoCandidato, nuevo) <= DISTANCIA_COHERENCIA_BOOTSTRAP_METROS;
        if (!esCoherente) candidatos.length = 0;
        candidatos.push(nuevo);
      }

      const accuracyBuena = bootstrapMejorAccuracyRef.current !== null && bootstrapMejorAccuracyRef.current <= UMBRAL_ACCURACY_BOOTSTRAP_BUENO_METROS;
      const suficientesCoherentes = bootstrapCandidatosCoherentesRef.current.length >= FIXES_COHERENTES_PARA_ESTABILIZAR;
      const baseTrasEsteTick = ultimoFixValidoRef.current;
      if ((accuracyBuena || suficientesCoherentes) && baseTrasEsteTick) {
        // Si estabilizó por coherencia (no por accuracy buena), la base final es el
        // ÚLTIMO candidato de esa cadena — el más reciente conocido, no necesariamente
        // el de mejor accuracy histórica.
        const motivo = accuracyBuena ? "accuracy" : "coherencia";
        const baseFinal = accuracyBuena
          ? baseTrasEsteTick
          : bootstrapCandidatosCoherentesRef.current[bootstrapCandidatosCoherentesRef.current.length - 1];
        ultimoFixValidoRef.current    = baseFinal;
        ultimoFixValidoTsRef.current  = ahora;
        penultimoFixValidoRef.current = null; // arranca limpio el régimen estable
        fixValidoActualRef.current    = baseFinal;
        aceptarHeadingDeEsteFix();
        gpsInicialEstabilizadoRef.current = true;
        diagLog(
          `[TILA_NAV_DIAG] GPS_INICIAL_ESTABILIZADO motivo=${motivo} `
          + `lat=${baseFinal.lat.toFixed(6)} lng=${baseFinal.lng.toFixed(6)} accuracy=${bootstrapMejorAccuracyRef.current ?? "n/a"} t=${Math.round(performance.now())}`
        );
        diagLog(`[TILA_NAV_DIAG] GPS_REGIMEN_ESTABLE t=${Math.round(performance.now())}`);
      }
      return;
    }

    const resultado = evaluarConsistenciaFix(
      ultimoFixValidoRef.current,
      ultimoFixValidoTsRef.current,
      penultimoFixValidoRef.current,
      nuevo,
      ahora,
      headingValido(heading)
    );
    if (!resultado.aceptado) {
      fixValidoActualRef.current = null;
      diagLog(`[TILA_NAV_DIAG] gps-validacion RECHAZADO ${resultado.motivo}`);

      // Reenganche controlado: sólo se evalúa si hace mucho que ningún fix fue aceptado
      // (la base actual es sospechosa de estar mal, no un simple ruido pasajero).
      const msSinAceptar = ultimoFixValidoTsRef.current !== null ? ahora - ultimoFixValidoTsRef.current : Infinity;
      if (msSinAceptar < UMBRAL_MS_SIN_ACEPTAR_PARA_REENGANCHE) {
        candidatosReenganceRef.current = [];
        return;
      }
      const candidatos = candidatosReenganceRef.current;
      const ultimoCandidato = candidatos[candidatos.length - 1] ?? null;
      const esCoherente = !ultimoCandidato || distanciaMetros(ultimoCandidato, nuevo) <= UMBRAL_DISTANCIA_REENGANCHE_METROS;
      if (!esCoherente) candidatos.length = 0; // rompió la cadena — reinicia el conteo desde este fix
      candidatos.push(nuevo);
      diagLog(`[TILA_NAV_DIAG] gps-reenganche candidato n=${candidatos.length}/${FIXES_REENGANCHE_REQUERIDOS} lat=${lat.toFixed(6)} lng=${lng.toFixed(6)} msSinAceptar=${msSinAceptar} t=${Math.round(performance.now())}`);
      const baseAnteriorReenganche = ultimoFixValidoRef.current;
      if (candidatos.length >= FIXES_REENGANCHE_REQUERIDOS && baseAnteriorReenganche) {
        const baseAnterior = baseAnteriorReenganche;
        const distanciaReemplazo = distanciaMetros(baseAnterior, nuevo);
        penultimoFixValidoRef.current = null; // sin tendencia previa confiable tras un reenganche
        ultimoFixValidoRef.current    = nuevo;
        ultimoFixValidoTsRef.current  = ahora;
        fixValidoActualRef.current    = nuevo;
        aceptarHeadingDeEsteFix();
        candidatosReenganceRef.current = [];
        diagLog(
          `[TILA_NAV_DIAG] gps-reenganche BASE_REEMPLAZADA `
          + `baseAnterior=${baseAnterior.lat.toFixed(6)},${baseAnterior.lng.toFixed(6)} `
          + `baseNueva=${lat.toFixed(6)},${lng.toFixed(6)} distancia=${Math.round(distanciaReemplazo)}m t=${Math.round(performance.now())}`
        );
      }
      return;
    }
    // El fix se usa siempre que fue aceptado — sólo cambia si además adelanta la base
    // (ver actualizarBase=false para duplicados de alta frecuencia en evaluarConsistenciaFix).
    fixValidoActualRef.current = nuevo;
    aceptarHeadingDeEsteFix();
    if (resultado.actualizarBase) {
      penultimoFixValidoRef.current = ultimoFixValidoRef.current;
      ultimoFixValidoRef.current    = nuevo;
      ultimoFixValidoTsRef.current  = ahora;
      candidatosReenganceRef.current = []; // ya se aceptó un fix real; no hace falta reenganche
    }
  }, [lat, lng, heading]);

  // Protección contra cálculos simultáneos: mientras calculandoRutaNavRef es true,
  // cualquier disparador nuevo sólo marca recalculoPendienteNavRef en vez de lanzar
  // una segunda llamada a Directions en paralelo. Al terminar la llamada en curso
  // (éxito o fallback) se libera calculandoRutaNavRef y, si quedó un pendiente, se
  // dispara inmediatamente un nuevo cálculo con la posición/paradas MÁS RECIENTES
  // conocidas (ultimoLatLngConocidoRef/ultimasParadasConocidasRef, actualizadas en
  // cada corrida del efecto) — así ningún disparador se pierde y nunca hay dos
  // llamadas en vuelo al mismo tiempo. (La protección contra respuestas fuera de
  // orden es aparte, por requestId, dentro de calcularRuta — ver rutaRequestIdRef.)
  const calculandoRutaNavRef       = useRef(false);
  const recalculoPendienteNavRef   = useRef(false);
  const ultimoLatLngConocidoRef    = useRef<google.maps.LatLngLiteral | null>(null);
  const ultimasParadasConocidasRef = useRef<ParadaMapa[]>([]);
  // Referencia estable a la versión más reciente de dispararCalculoNav — permite que
  // el propio callback se re-invoque a sí mismo al drenar un pendiente sin un
  // auto-referencia directa a la const (evita el ciclo de declaración) y de paso
  // nunca queda con una versión vieja del closure entre renders.
  const dispararCalculoNavRef = useRef<(motivo?: string) => void>(() => {});

  // Detección de desvío real: lecturas GPS consecutivas por encima de
  // UMBRAL_DESVIO_RUTA_METROS respecto de rutaPolylineRef, más un cooldown mínimo
  // entre recálculos disparados por desvío (cambioDeParadas/primerGps NO respetan
  // este cooldown — son cambios legítimos de la ruta en sí, no "ruido").
  const lecturasFueraDeRutaRef     = useRef(0);
  const ultimoRecalculoDesvioTsRef = useRef(0);

  const dispararCalculoNav = useCallback((motivo: string = "navegacion") => {
    if (calculandoRutaNavRef.current) {
      recalculoPendienteNavRef.current = true;
      return;
    }
    const latLng = ultimoLatLngConocidoRef.current;
    if (!latLng) return;
    const pendientes = ultimasParadasConocidasRef.current.filter(p => p.estado !== "completada");
    if (pendientes.length === 0) return; // no queda ningún tramo por recorrer

    calculandoRutaNavRef.current    = true;
    // Causa confirmada de "el vehículo visual se queda atrás durante el recálculo":
    // mientras calculandoRutaNavRef es true, el bloque de recorte dentro de
    // pasoAnimacion (el único que actualiza posicionSnapRutaRef) queda pausado — pero
    // la CÁMARA sigue moviéndose con la posición interpolada real (no depende de este
    // ref). El marcador, en cambio, usa el último snap calculado SI todavía cae dentro
    // de UMBRAL_CORREDOR_SNAP_VISUAL_METROS — y ese snap queda congelado en la ruta
    // VIEJA durante todo el cálculo. Resultado: la cámara avanza, el ícono no, hasta
    // que la ruta nueva aterriza y "salta" al lugar correcto. Invalidar el snap acá
    // mismo hace que el marcador caiga de inmediato a la posición GPS/visual real
    // (mismo fallback que ya usa cuando no hay snap fresco) y la siga sin pausa
    // durante todo el round-trip — se vuelve a snapear solo cuando el próximo recorte
    // (ya con la ruta nueva) calcule uno fresco.
    posicionSnapRutaRef.current = null;
    diagLog(`[TILA_NAV_DIAG] dispararCalculoNav: calculandoRutaNavRef=true origen=${latLng.lat.toFixed(6)},${latLng.lng.toFixed(6)} t=${Math.round(performance.now())}`);
    paradasPendientesKeyRef.current = pendientes.map(p => p.direccion).join("|");

    const destino   = pendientes[pendientes.length - 1].direccion;
    const waypoints = pendientes.slice(0, -1).map(p => ({ location: `${p.direccion}, Argentina`, stopover: true }));
    const fallback: google.maps.LatLngLiteral[] = [latLng];
    paradasCoords.forEach(c => { if (c) fallback.push(c); });

    // Mientras exista una parada tipo "retiro" pendiente, la navegación sólo conoce el
    // tramo GPS→retiro: legs[0]. El tramo retiro→siguiente (legs[1]) queda fuera de toda
    // estructura de navegación hasta que el retiro se confirme completado — ahí
    // cambioDeParadas dispara este mismo callback de nuevo, con el GPS real actual como
    // origen y la respuesta nueva como única fuente de verdad (ver más abajo).
    const legsActivos = pendientes.some(p => p.tipo === "retiro") ? 1 : undefined;

    const onSettledNav = () => {
      calculandoRutaNavRef.current = false;
      if (recalculoPendienteNavRef.current) {
        recalculoPendienteNavRef.current = false;
        // TILA_NAV_DIAG: el motivo ORIGINAL que quedó encolado (cambioDeParadas/
        // primerGps/desvioConfirmado de aquel momento) no se preserva acá — es un
        // simple flag booleano (recalculoPendienteNavRef), no guarda el string. Motivo
        // genérico, deliberado: identifica el patrón "quedó pendiente mientras había
        // uno en vuelo, se drena solo al terminar" sin inventar un dato que no existe.
        dispararCalculoNavRef.current("navegacion-pendiente-drenado");
      }
    };

    // USAR_ROUTES_API_NAVEGACION: ver el flag — interruptor de reversión entre Routes
    // API (heading direccional del origen) y DirectionsService clásico, exclusivo de
    // este call-site. Ningún otro camino de calcularRuta lee este flag.
    if (USAR_ROUTES_API_NAVEGACION) {
      calcularRutaNavegacionDireccional(
        motivo, { lat: latLng.lat, lng: latLng.lng }, destino, waypoints, fallback, onSettledNav, legsActivos
      );
    } else {
      calcularRuta(motivo, { lat: latLng.lat, lng: latLng.lng }, destino, waypoints, fallback, undefined, onSettledNav, legsActivos);
    }
  }, [calcularRuta, calcularRutaNavegacionDireccional, paradasCoords]);
  useEffect(() => {
    dispararCalculoNavRef.current = dispararCalculoNav;
  }, [dispararCalculoNav]);

  useEffect(() => {
    if (!isLoaded || !modoNavegacion || !tieneParadas || modoMultiChofer) return;
    // Bloqueado mientras el GPS no estabilizó (ver GPS_INICIAL_ESTABILIZADO más arriba)
    // — ni Directions inicial ni desvío/recálculo deben arrancar desde un bootstrap
    // todavía dudoso. En cuanto estabiliza, este mismo efecto corre de nuevo en el
    // siguiente tick de GPS y dispara el primer cálculo normalmente.
    if (!gpsInicialEstabilizadoRef.current) return;
    // Waze/Google Maps es el navegador activo: TILA deja de recalcular ruta de
    // navegación por completo (sigue trackeando GPS para el viaje, eso no depende de
    // este efecto). Ver navegacionTilaActiva en MapaTILAProps.
    if (!navegacionTilaActiva) return;
    const fix = fixValidoActualRef.current;
    if (!fix) return; // fix rechazado este tick — ni desvío ni recálculo lo usan

    // Siempre al día, se use o no en este tick — es lo que lee dispararCalculoNav
    // cuando drena un recálculo pendiente después de que termine el que está en vuelo.
    // Se guarda el fix ya VALIDADO — así el origen de un recálculo nunca es un salto
    // de GPS imposible.
    ultimoLatLngConocidoRef.current    = fix;
    ultimasParadasConocidasRef.current = paradas!;

    const pendientes = paradas!.filter(p => p.estado !== "completada");
    if (pendientes.length === 0) return; // no queda ningún tramo por recorrer

    const key = pendientes.map(p => p.direccion).join("|");
    const cambioDeParadas = paradasPendientesKeyRef.current !== key;
    const primerGps       = !primerGpsMultietapaRef.current;

    // Mientras ya haya un recálculo en vuelo, un desvío que se siga detectando en el
    // medio NO dispara uno nuevo en cadena — ésta era la causa real del "bucle de Ruta
    // recalculada": cada recálculo tardaba el viaje de ida y vuelta a Directions, el
    // chofer seguía moviéndose mientras tanto y llegaba a destino todavía "desviado"
    // de la ruta recién aplicada, disparando inmediatamente otro. Cambio de paradas /
    // primer GPS sí se respetan siempre (motivos legítimos que nunca deben perderse —
    // quedan encolados vía dispararCalculoNav/recalculoPendienteNavRef).
    if (calculandoRutaNavRef.current) {
      if (cambioDeParadas || primerGps) {
        diagLog(`[TILA_NAV_DIAG] desvio-efecto: recálculo en vuelo pero cambioDeParadas/primerGps → encola t=${Math.round(performance.now())}`);
        primerGpsMultietapaRef.current = true;
        dispararCalculoNav(`navegacion-encolado(cambioDeParadas=${cambioDeParadas},primerGps=${primerGps})`);
      }
      return;
    }

    // El desvío sólo se evalúa cuando no hay ya un motivo legítimo distinto para
    // recalcular (cambio de paradas / primer GPS) — evita contar lecturas "fuera de
    // ruta" contra una polyline que de todos modos está por reemplazarse.
    let desvioConfirmado = false;
    if (!cambioDeParadas && !primerGps) {
      const accuracyActualDesvio = accuracyRef.current ?? null;
      const accuracyMalaDesvio   = accuracyActualDesvio !== null && accuracyActualDesvio > UMBRAL_ACCURACY_MALA_METROS;
      // Fix de mala precisión: no cuenta para desvío ni mueve el índice/segmento — un
      // solo fix así puede estar, por sí solo, más lejos de la ruta que el propio
      // umbral de desvío, sin que el vehículo se haya movido (ver UMBRAL_ACCURACY_MALA_METROS).
      // No dispara recálculo (desvioConfirmado sigue false) y tampoco resetea el
      // contador de lecturas — simplemente se ignora este tick por completo.
      if (accuracyMalaDesvio) {
        diagLog(`[TILA_NAV_DIAG] desvio-efecto: fix ignorado por accuracy mala accuracy=${Math.round(accuracyActualDesvio!)}m > ${UMBRAL_ACCURACY_MALA_METROS}m t=${Math.round(performance.now())}`);
      } else {
      // Búsqueda con progreso: sólo desde unos tramos antes del índice compartido en
      // adelante (VENTANA_ATRAS_SEGMENTOS), no la polyline completa desde el principio —
      // evita que un tramo ya recorrido o una calle paralela "gane" la distancia mínima.
      // sincronizarIndiceConRuta corre acá también (idempotente: si pasoAnimacion ya
      // sincronizó esta misma polyline en un frame anterior, no hace nada distinto).
      const resultado   = distanciaMinAPolyline(
        fix, rutaPolylineRef.current, sincronizarIndiceConRuta(rutaPolylineRef.current),
        headingAceptadoRef.current, velocidadMPorMsRef.current > 0 ? velocidadMPorMsRef.current * 1000 : null,
        accuracyActualDesvio, rutaRequestIdRef.current
      );
      // distanciaGeometricaReal: distancia mínima REAL a la polyline, sin filtro de
      // sentido — es lo que decide fueraDeRuta/desvioObvio. Causa confirmada de
      // recálculo prematuro: usar distancia (el "elegido" filtrado por sentido) acá podía
      // reportar 38m de un candidato sentido-compatible aunque el punto geométricamente
      // más cercano estuviera a 0m (descartado por bearing puntual anómalo, ver
      // DESCARTADO_POR_SENTIDO) — un desvío que nunca existió. distanciaSegmentoActivo
      // (elegido, sentido-aware) se conserva sólo para el índice de progreso más abajo y
      // para el log comparativo — el sentido SÍ importa ahí (evita "pegarse" a la calzada
      // contraria en autopistas divididas).
      const distanciaGeometricaReal = resultado?.distanciaGeometrica ?? null;
      const distanciaSegmentoActivo = resultado?.distancia ?? null;
      const fueraDeRuta = distanciaGeometricaReal !== null && distanciaGeometricaReal >= UMBRAL_DESVIO_RUTA_METROS;
      const desvioObvio = distanciaGeometricaReal !== null && distanciaGeometricaReal >= UMBRAL_DESVIO_INMEDIATO_METROS;
      // avanzarIndiceProgreso, no asignación cruda: este camino usa el fix GPS real, pero
      // el otro escritor (recorte, posición interpolada) puede haber escrito recién un
      // valor mayor este mismo ciclo — nunca retroceder el progreso ya confirmado. Sigue
      // usando resultado.indice (sentido-aware, no el geométrico) — el progreso real
      // nunca debe "pegarse" a la calzada contraria sólo porque esté unos metros más cerca.
      if (resultado) avanzarIndiceProgreso(resultado.indice);
      lecturasFueraDeRutaRef.current = fueraDeRuta ? lecturasFueraDeRutaRef.current + 1 : 0;
      // Capturado ANTES de un posible reset por confirmación (más abajo) — si no, el log
      // de este mismo tick mostraría 0 (el valor YA reseteado) aunque la confirmación se
      // haya basado en 2+ lecturas reales. Puramente para diagnóstico, no cambia la
      // decisión: la lógica de desvío sigue leyendo/escribiendo lecturasFueraDeRutaRef
      // exactamente igual que antes.
      const lecturasFueraDeRutaParaLog = lecturasFueraDeRutaRef.current;
      // Un desvío obvio (muy lejos de la ruta) no espera las lecturas consecutivas — a
      // esa distancia ya no es ruido de GPS. Un desvío moderado sí necesita confirmarse
      // con varias lecturas seguidas, para no recalcular por un salto aislado.
      if (desvioObvio || lecturasFueraDeRutaRef.current >= LECTURAS_CONSECUTIVAS_DESVIO) {
        const ahora = Date.now();
        if (ahora - ultimoRecalculoDesvioTsRef.current >= COOLDOWN_RECALCULO_MS) {
          desvioConfirmado = true;
          ultimoRecalculoDesvioTsRef.current = ahora;
          lecturasFueraDeRutaRef.current = 0;
        }
      }
      diagLog(
        `[TILA_NAV_DIAG] desvio-efecto distanciaGeométricaReal=${distanciaGeometricaReal === null ? "null" : Math.round(distanciaGeometricaReal)} `
        + `distanciaSegmentoActivo=${distanciaSegmentoActivo === null ? "null" : Math.round(distanciaSegmentoActivo)} `
        + `lecturasFueraDeRuta=${lecturasFueraDeRutaParaLog} desvioConfirmado=${desvioConfirmado} t=${Math.round(performance.now())}`
      );
      }
    }

    if (!cambioDeParadas && !primerGps && !desvioConfirmado) return; // nada relevante cambió

    // Al confirmarse un desvío real, se limpia la traza visible YA, antes de pedirle la
    // ruta nueva a Directions — así no queda ningún resto de la ruta anterior dibujado
    // durante el (breve) viaje de ida y vuelta a la API. pasoAnimacion vuelve a dibujar
    // en cuanto la ruta nueva aterriza y sincronizarIndiceConRuta detecta el cambio.
    if (desvioConfirmado) {
      setRutaVisibleDesdeVehiculo([]);
      diagLog(`[TILA_NAV_DIAG] RUTA_VISUAL_INVALIDADA requestIdAnterior=${rutaRequestIdRef.current} t=${Math.round(performance.now())}`);
    }

    diagLog(`[TILA_NAV_DIAG] desvio-efecto DISPARANDO dispararCalculoNav cambioDeParadas=${cambioDeParadas} primerGps=${primerGps} desvioConfirmado=${desvioConfirmado} t=${Math.round(performance.now())}`);
    primerGpsMultietapaRef.current = true;
    dispararCalculoNav(`navegacion(cambioDeParadas=${cambioDeParadas},primerGps=${primerGps},desvioConfirmado=${desvioConfirmado})`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, modoNavegacion, tieneParadas, modoMultiChofer, navegacionTilaActiva, lat, lng, JSON.stringify(paradas?.map(p => ({ d: p.direccion, e: p.estado }))), dispararCalculoNav, sincronizarIndiceConRuta, avanzarIndiceProgreso]);

  // Estado del progreso SHADOW — exclusivo del efecto de abajo, nadie más los lee.
  // ultimaRutaRefVistaShadowRef: detecta ruta nueva por identidad de referencia,
  // igual criterio que ultimaRutaRefVistaRef (real) pero en su propio ref — nunca
  // comparte ni lee el real, para no acoplar el shadow al sistema que audita.
  const ultimaRutaRefVistaShadowRef = useRef<google.maps.LatLngLiteral[] | null>(null);
  const progresoShadowRef = useRef<ProgresoConfirmado>({ indice: 0, punto: { lat: 0, lng: 0 }, distanciaAcumulada: 0, timestamp: 0 });
  const candidatoPendienteShadowRef = useRef<CandidatoPendienteProgreso | null>(null);

  // ═══════════════════════════════════════════════════════════════════════
  // PROGRESO SHADOW — núcleo nuevo (snapGeometrico + decidirProgreso), fase de
  // comparación. NO escribe indiceRutaVisibleRef, rutaVisibleDesdeVehiculo,
  // posicionSnapRutaRef ni ningún otro estado real — sólo sus propios refs, y sólo
  // para loguear. Deliberadamente en SU PROPIO efecto, separado de:
  //   - pasoAnimacion (rAF ~60fps): esa cadencia es para animación/marcador/cámara/
  //     snap VISUAL, nunca para decidir progreso — decidirProgreso exige GPS
  //     validado, no posición interpolada.
  //   - el efecto de desvío de arriba: tiene su propio gating (calculandoRutaNavRef,
  //     cambioDeParadas/primerGps) que es sobre CUÁNDO RECALCULAR RUTA, ajeno a si
  //     corresponde trackear progreso — mezclar ambos hubiera repetido el mismo
  //     patrón de "dos escritores independientes" que causó el bug real de progreso
  //     que motivó todo este rediseño.
  // Corre una única vez por fix GPS ACEPTADO (fixValidoActualRef no-null en este
  // tick) — la MISMA cadencia, ni más ni menos, que tendría el núcleo nuevo el día
  // que reemplace al viejo.
  useEffect(() => {
    if (!modoNavegacion || modoMultiChofer || !navegacionTilaActiva) return;
    if (!gpsInicialEstabilizadoRef.current) return;
    const fix = fixValidoActualRef.current;
    if (!fix) return; // fix rechazado este tick — el shadow tampoco avanza con él
    const polyline = rutaPolylineRef.current;
    if (polyline.length < 2) return;

    const ahora = Date.now();
    const indiceViejo = indiceRutaVisibleRef.current;

    // Ruta nueva (misma detección por identidad de referencia que sincronizarIndiceConRuta,
    // sin depender de ella ni tocarla): el shadow siembra su propio progreso desde el GPS
    // real actual — mismo criterio conceptual que sembrarProgresoRutaNueva, pero en su
    // propio estado, aislado del real.
    if (polyline !== ultimaRutaRefVistaShadowRef.current) {
      ultimaRutaRefVistaShadowRef.current = polyline;
      candidatoPendienteShadowRef.current = null;
      const snapInicial = snapGeometrico(polyline, fix, 0, headingAceptadoRef.current, velocidadMPorMsRef.current > 0 ? velocidadMPorMsRef.current * 1000 : null);
      progresoShadowRef.current = snapInicial
        ? { indice: snapInicial.indice, punto: snapInicial.punto, distanciaAcumulada: 0, timestamp: ahora }
        : { indice: 0, punto: polyline[0], distanciaAcumulada: 0, timestamp: ahora };
      diagLog(
        `[TILA_NAV_DIAG] PROGRESO_SHADOW_RUTA_NUEVA indiceSembrado=${progresoShadowRef.current.indice} `
        + `gps=${fix.lat.toFixed(6)},${fix.lng.toFixed(6)} t=${Math.round(performance.now())}`
      );
      return; // este tick sólo siembra — recién el próximo evalúa avance
    }

    const snap = snapGeometrico(
      polyline, fix, progresoShadowRef.current.indice,
      headingAceptadoRef.current,
      velocidadMPorMsRef.current > 0 ? velocidadMPorMsRef.current * 1000 : null
    );
    if (!snap) return;

    const resultado = decidirProgreso(
      progresoShadowRef.current, snap, polyline, ahora,
      velocidadMPorMsRef.current > 0 ? velocidadMPorMsRef.current * 1000 : null,
      candidatoPendienteShadowRef
    );
    if (resultado.avanzo) progresoShadowRef.current = resultado.progreso;

    // diferenciaMetros: aproximación diagnóstica (distancia siguiendo la polyline
    // entre el índice que hoy usa el sistema REAL y el que sostiene el shadow) — no
    // se usa para ninguna decisión, sólo para poder leer de un vistazo cuánto
    // divergieron en este tick.
    const indiceMenor = Math.min(indiceViejo, progresoShadowRef.current.indice);
    const indiceMayor = Math.max(indiceViejo, progresoShadowRef.current.indice);
    const diferenciaMetros = indiceMenor === indiceMayor
      ? 0
      : calcularDistanciaRutaHastaIndice(polyline, indiceMenor, polyline[indiceMenor] ?? fix, indiceMayor);

    diagLog(
      `[TILA_NAV_DIAG] PROGRESO_SHADOW viejoIndice=${indiceViejo} nuevoIndice=${progresoShadowRef.current.indice} `
      + `diferenciaMetros=${Math.round(diferenciaMetros)} motivoDiferencia=${resultado.motivo} `
      + `gps=${fix.lat.toFixed(6)},${fix.lng.toFixed(6)} t=${Math.round(performance.now())}`
    );
  }, [lat, lng, heading, modoNavegacion, modoMultiChofer, navegacionTilaActiva]);

  // ─── modoNavegacion: encuadre inicial único ────────────────────────────────
  // Único lugar que hace el fitBounds/setCenter automático de arranque en modoNavegacion.
  // Se ejecuta apenas hay GPS + al menos un punto más de la ruta (parada o destino activo),
  // y sólo una vez (encuadreInicialHechoRef, dentro de encuadrarPuntos). Después de esto la
  // cámara queda completamente libre hasta que el usuario use los botones manuales.
  useEffect(() => {
    if (!modoNavegacion || modoMultiChofer || encuadreInicialHechoRef.current) return;
    if (!lat || !lng) return;
    const puntos: google.maps.LatLngLiteral[] = [{ lat, lng }];
    paradasCoords.forEach(p => { if (p) puntos.push(p); });
    if (destinoCoords) puntos.push(destinoCoords);
    if (puntos.length < 2) return;
    encuadrarPuntos(puntos);
  }, [modoNavegacion, modoMultiChofer, lat, lng, paradasCoords, destinoCoords, encuadrarPuntos]);

  // ─── Recorte visual de la traza: caso "todavía no hay ruta" ────────────────────────
  // El DIBUJO normal (recortarRutaDesdeVehiculo + setRutaVisibleDesdeVehiculo) y la
  // detección de "ruta nueva"/reset de índice ya NO pasan por acá — viven junto al
  // consumo real del índice (sincronizarIndiceConRuta, llamada desde pasoAnimacion y
  // desde el efecto de desvío) para eliminar la ventana de carrera que existía cuando
  // el reset dependía de que este efecto corriera primero. Lo único que sigue siendo
  // exclusivo de acá: limpiar rutaVisibleDesdeVehiculo cuando directamente NO hay
  // ninguna ruta (todavía no llegó la primera, o Directions falló sin fallback) — ese
  // estado no le compete a sincronizarIndiceConRuta, que sólo se llama cuando ya hay
  // una polyline de 2+ puntos.
  useEffect(() => {
    if (!modoNavegacion || modoMultiChofer) return;
    if (!fixValidoActualRef.current) return;
    if (calculandoRutaNavRef.current) return;
    if (rutaPolylineRef.current.length < 2) setRutaVisibleDesdeVehiculo([]);
  }, [lat, lng, directions, polylinePuntos, modoNavegacion, modoMultiChofer]);

  // ─── TILA_NAV_DIAG: heartbeat de diagnóstico (1s) ──────────────────────────
  // Snapshot consolidado de todo lo pedido para el diagnóstico — no lee nada que no
  // exista ya, no cambia ninguna decisión, no toca cámara/marcador/ruta. Quitar junto
  // con el resto de la instrumentación una vez conseguida la evidencia.
  useEffect(() => {
    if (!modoNavegacion || modoMultiChofer) return;
    const contadorPrevio = { ...diagContadoresRef.current };
    const intervalo = setInterval(() => {
      const ahora = performance.now();
      const gpsReal = historialPosicionRef.current.actual;
      const visual = posicionVisualActualRef.current;
      const edadFixMs = ultimoTickTsRef.current === null ? "null" : Math.round(ahora - ultimoTickTsRef.current);
      const c = diagContadoresRef.current;
      const marcador = choferMarkerRef.current;
      diagLog(
        `[TILA_NAV_DIAG] HEARTBEAT `
        + `gpsReal=${gpsReal ? `${gpsReal.lat.toFixed(6)},${gpsReal.lng.toFixed(6)}` : "null"} `
        + `visual=${visual ? `${visual.lat.toFixed(6)},${visual.lng.toFixed(6)}` : "null"} `
        + `distGpsVisualM=${diagDistanciaGpsVisualRef.current === null ? "null" : diagDistanciaGpsVisualRef.current.toFixed(1)} `
        + `edadFixMs=${edadFixMs} extrapolando=${diagExtrapolandoRef.current} `
        + `headingGps=${headingValido(heading) ?? "null"} headingAceptado=${headingAceptadoRef.current ?? "null"} headingCalculado=${diagHeadingCalculadoRef.current ?? "null"} `
        + `headingAplicado=${diagUltimoHeadingAplicadoRef.current ?? "null"}(${diagUltimaFuenteHeadingRef.current}) `
        + `mapHeadingReal=${mapRef.current?.getHeading() ?? "null"} `
        + `siguiendoChofer=${siguiendoChoferRef.current} restaurandoCamara=${restaurandoCamaraRef.current} calculandoRuta=${calculandoRutaNavRef.current} `
        + `marcadorExiste=${!!marcador} marcadorAdjunto=${marcador ? !!marcador.getMap() : "n/a"} `
        + `moverCamaraPasoAnimPorSeg=${c.moverCamaraPasoAnim - contadorPrevio.moverCamaraPasoAnim} `
        + `eventosCenterPorSeg=${c.eventoCenterChanged - contadorPrevio.eventoCenterChanged} `
        + `eventosHeadingPorSeg=${c.eventoHeadingChanged - contadorPrevio.eventoHeadingChanged} `
        + `eventosZoomPorSeg=${c.eventoZoomChanged - contadorPrevio.eventoZoomChanged} `
        + `eventosTiltPorSeg=${c.eventoTiltChanged - contadorPrevio.eventoTiltChanged} `
        + `eventosIdlePorSeg=${c.eventoIdle - contadorPrevio.eventoIdle} `
        + `marcadorFaltanteTotal=${c.marcadorFaltante} posicionNoFinitaTotal=${c.posicionNoFinita} `
        + `t=${Math.round(ahora)}`
      );
      Object.assign(contadorPrevio, c);
    }, 1000);
    return () => clearInterval(intervalo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoNavegacion, modoMultiChofer, heading]);

  // ─── Navegación por voz: giro próximo y ruta recalculada ───────────────────
  // Sólo LEE estado ya existente (directions, lat/lng) — no toca calcularRuta,
  // dispararCalculoNav ni la detección de desvío. Si onAnuncioVoz no viene (nadie la
  // usa), estos efectos no hacen nada.
  const vozDirectionsPrevRef = useRef<google.maps.DirectionsResult | null>(null);
  const rutaKeyVozRef        = useRef<string | null>(null);
  // requestId de la ruta a la que está asociada la maquina de maniobra actual — un
  // anuncio nunca sale al aire si, para cuando se lo va a pronunciar, la ruta vigente
  // (rutaRequestIdRef.current) ya cambió (ver intentarAnunciar).
  const vozRutaRequestIdRef = useRef<number | null>(null);
  // ── Máquina de estado de maniobra ───────────────────────────────────────────
  // maniobraActualIndiceRef: índice ÚNICO (dentro de `pasos`) de la maniobra que se
  // está siguiendo — null hasta inicializarla. Nunca se anuncia ni se evalúa distancia
  // de ningún step que no sea éste. maniobraAvisosEmitidosRef: qué niveles (lejano/
  // medio/cercano) ya se anunciaron PARA LA MANIOBRA ACTUAL — se reinicia cada vez que
  // maniobraActualIndiceRef avanza. ultimoLogDistanciaManiobraTsRef: throttle sólo del
  // log de diagnóstico MANIOBRA_DISTANCIA_RUTA (se recalcula cada tick, pero loguearlo
  // cada tick sería demasiado — no es un evento de transición).
  const maniobraActualIndiceRef      = useRef<number | null>(null);
  const maniobraAvisosEmitidosRef    = useRef<Set<"lejano" | "medio" | "cercano">>(new Set());
  // distanciaRuta de la evaluación ANTERIOR de la maniobra actual — null si esta es la
  // primera evaluación (recién inicializada/avanzada). Habilita el cruce EXPLÍCITO
  // `anterior > umbral && actual <= umbral` en vez de depender implícitamente de que
  // distanciaRuta sólo decrezca tick a tick — necesario para que el sistema sea correcto
  // en todo el rango 20-250km/h sin timers ni velocidad supuesta (ver el bloque de
  // avisos más abajo). Se reinicia junto con maniobraAvisosEmitidosRef, mismo ciclo de
  // vida (una maniobra nueva no hereda el "anterior" de la maniobra previa).
  const maniobraDistanciaAnteriorRef = useRef<number | null>(null);
  // Niveles detectados como "cruzados" (anteriorDist > umbral && distanciaRuta <= umbral)
  // pero todavía NO anunciados por voz — normalmente se anuncia y consume en el mismo
  // tick en que se detecta el cruce, pero si intentarAnunciar lo posterga (cooldown de
  // otra maniobra/informativo), el nivel se queda acá para reintentarse en el próximo
  // tick SIN volver a exigir un cruce nuevo (que ya no ocurriría — distanciaRuta ya bajó
  // del umbral) y sin perderse. Mismo ciclo de vida que maniobraAvisosEmitidosRef.
  const maniobraNivelesPendientesRef = useRef<Set<"lejano" | "medio" | "cercano">>(new Set());
  // Identidad (ver claveManiobra) de la maniobra que apunta maniobraActualIndiceRef —
  // null si no hay ninguna en seguimiento. Permite, tras un recálculo, distinguir "es la
  // misma maniobra real, sólo cambió su índice en el array de steps nuevo" (preserva
  // avisos ya emitidos) de "la próxima maniobra realmente cambió" (sí reinicializa).
  const maniobraClaveActualRef = useRef<string | null>(null);
  const ultimoLogDistanciaManiobraTsRef = useRef(0);
  // Estado del cooldown/prioridad — ver COOLDOWN_ANUNCIO_MISMA_PRIORIDAD_MS.
  const ultimoAnuncioTsRef        = useRef(0);
  const ultimaPrioridadAnuncioRef = useRef<"informativo" | "maniobra" | null>(null);
  const ultimoTextoAnunciadoRef   = useRef<string | null>(null);

  // Único punto que efectivamente llama a onAnuncioVoz — decide si el anuncio sale
  // ahora, se posterga (mismo texto o misma prioridad demasiado seguido) o se descarta
  // (la ruta a la que pertenece ya no es la vigente). Devuelve true si realmente anunció
  // — los llamadores sólo marcan un paso como "ya avisado" cuando esto es true, así un
  // anuncio postergado se reintenta solo en un tick posterior en vez de perderse.
  const intentarAnunciar = useCallback((
    mensaje: string,
    prioridad: "informativo" | "maniobra",
    contexto: string,
    requestIdEsperado: number
  ): boolean => {
    if (requestIdEsperado !== rutaRequestIdRef.current) {
      diagLog(
        `[TILA_NAV_DIAG] VOZ_ANUNCIO_DESCARTADO_RUTA_OBSOLETA requestIdEsperado=${requestIdEsperado} `
        + `requestIdVigente=${rutaRequestIdRef.current} contexto=${contexto} texto="${mensaje}" t=${Math.round(performance.now())}`
      );
      return false;
    }
    const ahora = Date.now();
    if (mensaje === ultimoTextoAnunciadoRef.current && ahora - ultimoAnuncioTsRef.current < COOLDOWN_ANUNCIO_MISMA_PRIORIDAD_MS) {
      diagLog(`[TILA_NAV_DIAG] VOZ_ANUNCIO_DESCARTADO_DUPLICADO contexto=${contexto} texto="${mensaje}" t=${Math.round(performance.now())}`);
      return false;
    }
    // Una maniobra SIEMPRE puede interrumpir un informativo sin esperar el cooldown —
    // sólo dos anuncios de la MISMA prioridad se espacian entre sí.
    const puedeInterrumpirSinEsperar = prioridad === "maniobra" && ultimaPrioridadAnuncioRef.current === "informativo";
    if (!puedeInterrumpirSinEsperar && ahora - ultimoAnuncioTsRef.current < COOLDOWN_ANUNCIO_MISMA_PRIORIDAD_MS) {
      diagLog(`[TILA_NAV_DIAG] VOZ_ANUNCIO_POSTERGADO_COOLDOWN prioridad=${prioridad} contexto=${contexto} texto="${mensaje}" t=${Math.round(performance.now())}`);
      return false;
    }
    onAnuncioVoz!(mensaje);
    ultimoAnuncioTsRef.current = ahora;
    ultimaPrioridadAnuncioRef.current = prioridad;
    ultimoTextoAnunciadoRef.current = mensaje;
    diagLog(`[TILA_NAV_DIAG] VOZ_ANUNCIO requestId=${requestIdEsperado} prioridad=${prioridad} contexto=${contexto} texto="${mensaje}" t=${Math.round(performance.now())}`);
    return true;
  }, [onAnuncioVoz]);

  // "Ruta recalculada" — cualquier cambio de `directions` DESPUÉS del primero (el primer
  // cálculo es el arranque normal del viaje, no un recálculo real). Además de anunciar,
  // es el punto donde se invalida TODO el estado de voz de la generación anterior: se
  // corta cualquier locución en curso YA (onDetenerVoz) y se resetean los pasos
  // anunciados, para que nada de la ruta vieja pueda volver a hablar.
  useEffect(() => {
    if (!onAnuncioVoz || !modoNavegacion || modoMultiChofer) return;
    // Redundante en la práctica (directions no puede existir todavía si el GPS no
    // estabilizó — Directions inicial también está bloqueado, ver el efecto de
    // desvío/recálculo) pero explícito, como pediste.
    if (!gpsInicialEstabilizadoRef.current) return;
    // Waze/Google Maps es el navegador activo: ningún anuncio de TILA puede salir al
    // aire mientras tanto (ver navegacionTilaActiva en MapaTILAProps).
    if (!navegacionTilaActiva) return;
    if (!directions) return;
    const previa = vozDirectionsPrevRef.current;
    vozDirectionsPrevRef.current = directions;
    if (previa === null || previa === directions) return;

    const requestIdAnterior = vozRutaRequestIdRef.current;
    vozRutaRequestIdRef.current = rutaRequestIdRef.current;
    rutaKeyVozRef.current = null; // fuerza también el reset del efecto de maniobras (incluye maniobraActualIndiceRef) si corre en este mismo render

    onDetenerVoz?.();
    diagLog(`[TILA_NAV_DIAG] VOZ_DETENIDA_POR_RECALCULO requestIdAnterior=${requestIdAnterior ?? "n/a"} requestIdNuevo=${rutaRequestIdRef.current} t=${Math.round(performance.now())}`);
    diagLog(`[TILA_NAV_DIAG] VOZ_RUTA_RESET requestId=${rutaRequestIdRef.current} t=${Math.round(performance.now())}`);

    intentarAnunciar("Ruta recalculada.", "informativo", "recalculo", rutaRequestIdRef.current);
  }, [directions, modoNavegacion, modoMultiChofer, navegacionTilaActiva, onAnuncioVoz, onDetenerVoz, intentarAnunciar]);

  // Giros próximos — máquina de estado secuencial de UNA sola maniobra actual
  // (maniobraActualIndiceRef). No escanea todos los steps buscando cuál "califica": sigue
  // el progreso real del vehículo sobre la polyline (indiceRutaVisibleRef) para saber
  // cuándo la maniobra actual terminó y cuál es la siguiente, y calcula la distancia
  // restante caminando esa misma polyline (calcularDistanciaRutaHastaIndice), no en línea
  // recta. Esto garantiza objetivo 8: nunca se anuncia la maniobra siguiente antes de que
  // indiceRutaVisibleRef confirme que la actual quedó atrás.
  useEffect(() => {
    if (!onAnuncioVoz || !modoNavegacion || modoMultiChofer) return;
    if (!gpsInicialEstabilizadoRef.current) return;
    // Waze/Google Maps es el navegador activo: la máquina de maniobra de TILA no
    // avanza ni anuncia nada (ver navegacionTilaActiva en MapaTILAProps).
    if (!navegacionTilaActiva) return;
    if (!directions || !lat || !lng) return;
    const requestIdDeEsteTick = rutaRequestIdRef.current;

    // Restringido a los mismos legs que rutaPolylineRef/indicePorStepRef (ver
    // legsActivosNavRef) — así pasos[i] sigue correspondiendo exactamente a
    // indicePorStep[i]; un step de legs[1] nunca debe poder generar aviso de voz
    // mientras el retiro siga pendiente.
    const legsParaVoz = (directions.routes?.[0]?.legs ?? []).slice(0, legsActivosNavRef.current ?? Infinity);
    const pasos = legsParaVoz.flatMap(l => l.steps ?? []);
    const rutaKey = `${pasos.length}-${directions.routes?.[0]?.overview_path?.length ?? 0}`;
    if (rutaKeyVozRef.current !== rutaKey) {
      const rutaKeyAnterior = rutaKeyVozRef.current;
      rutaKeyVozRef.current = rutaKey;

      // Antes, cualquier cambio de rutaKey (prácticamente TODO recálculo, ya que el
      // array de steps/overview_path casi nunca coincide byte a byte entre dos
      // respuestas de Directions aunque el trayecto real sea casi idéntico) reseteaba
      // ciegamente avisos/pendientes/distanciaAnterior — eso hacía que un reroute
      // equivalente re-anunciara 600/400/200 ya emitidos para la MISMA maniobra real.
      // Ahora, antes de resetear, se busca en `pasos` (la ruta nueva) un step con la
      // misma identidad (claveManiobra) que la maniobra que se venía siguiendo — si
      // existe, es la misma maniobra real y sólo cambió su posición en el array nuevo:
      // se conserva la deduplicación. Si no existe (o no había ninguna maniobra en
      // seguimiento todavía), recién ahí se reinicializa todo, igual que antes.
      const claveAnterior = maniobraClaveActualRef.current;
      const indiceEquivalente = claveAnterior !== null
        ? pasos.findIndex(p => claveManiobra(p) === claveAnterior)
        : -1;

      if (indiceEquivalente !== -1) {
        maniobraActualIndiceRef.current = indiceEquivalente;
        diagLog(
          `[TILA_NAV_DIAG] MANIOBRA_PRESERVADA_TRAS_RECALCULO rutaKeyAnterior=${rutaKeyAnterior ?? "n/a"} `
          + `rutaKeyNueva=${rutaKey} stepNuevo=${indiceEquivalente} avisosConservados=${[...maniobraAvisosEmitidosRef.current].join(",") || "ninguno"} `
          + `t=${Math.round(performance.now())}`
        );
        // avisos/pendientes/distanciaAnterior NO se tocan: sigue siendo la misma
        // maniobra real, los niveles ya anunciados siguen contando como anunciados.
      } else {
        maniobraActualIndiceRef.current = null;
        maniobraAvisosEmitidosRef.current = new Set();
        maniobraNivelesPendientesRef.current = new Set();
        maniobraDistanciaAnteriorRef.current = null;
        maniobraClaveActualRef.current = null;
      }
    }

    const polyline = rutaPolylineRef.current;
    const indicePorStep = indicePorStepRef.current;
    if (polyline.length < 2 || indicePorStep.length === 0) return; // geometría detallada aún no disponible

    // Sincroniza el índice compartido ANTES de leerlo — nunca asumir que el efecto de
    // recorte/desvío ya corrió este mismo commit (no está garantizado por orden de
    // declaración). Sin esto, tras un recálculo, esta máquina podía inicializar/evaluar
    // la maniobra usando un índice todavía de la ruta VIEJA contra los steps/indicePorStep
    // de la ruta NUEVA — causa confirmada de "En 0 metros doblá..." apenas se recalcula
    // (calcularDistanciaRutaHastaIndice devuelve 0 si el índice ya "superó" el step).
    // Idempotente: si esta polyline ya fue sincronizada este tick por otro efecto, no
    // hace nada distinto.
    sincronizarIndiceConRuta(polyline);

    // Inicializa la maniobra actual (si no hay una) buscando el primer step cuyo inicio
    // en la polyline está adelante del progreso real del vehículo — no arranca ciego en
    // el step 1, porque tras un recálculo el vehículo puede aterrizar ya avanzado sobre
    // la ruta nueva.
    if (maniobraActualIndiceRef.current === null) {
      const progresoActual = indiceRutaVisibleRef.current;
      let candidato: number | null = null;
      for (let i = 1; i < pasos.length; i++) {
        const indicePoly = indicePorStep[i] ?? Infinity;
        if (indicePoly >= progresoActual) { candidato = i; break; }
      }
      if (candidato === null) return; // no queda ninguna maniobra por delante
      maniobraActualIndiceRef.current = candidato;
      maniobraClaveActualRef.current = claveManiobra(pasos[candidato]);
      maniobraAvisosEmitidosRef.current = new Set();
      maniobraNivelesPendientesRef.current = new Set();
      maniobraDistanciaAnteriorRef.current = null;
      diagLog(`[TILA_NAV_DIAG] MANIOBRA_ACTUAL_INICIALIZADA requestId=${requestIdDeEsteTick} step=${candidato} maniobra=${pasos[candidato]?.maneuver ?? "?"} t=${Math.round(performance.now())}`);
    }

    const i = maniobraActualIndiceRef.current;
    if (i === null || i >= pasos.length) return;

    // Fin del step actual = inicio del step siguiente en la polyline. Si el progreso real
    // ya lo alcanzó/superó, la maniobra actual quedó atrás — avanza y no evalúa nada más
    // en este tick (el próximo tick de GPS ya ve la maniobra nueva).
    const indiceFinDelStep = indicePorStep[i + 1] ?? (polyline.length - 1);
    if (indiceRutaVisibleRef.current >= indiceFinDelStep) {
      diagLog(`[TILA_NAV_DIAG] MANIOBRA_COMPLETADA requestId=${requestIdDeEsteTick} step=${i} t=${Math.round(performance.now())}`);
      const siguiente = i + 1;
      maniobraActualIndiceRef.current = siguiente;
      maniobraClaveActualRef.current = siguiente < pasos.length ? claveManiobra(pasos[siguiente]) : null;
      maniobraAvisosEmitidosRef.current = new Set();
      maniobraNivelesPendientesRef.current = new Set();
      maniobraDistanciaAnteriorRef.current = null;
      diagLog(`[TILA_NAV_DIAG] MANIOBRA_ACTUAL_AVANCE requestId=${requestIdDeEsteTick} stepAnterior=${i} stepNuevo=${siguiente} t=${Math.round(performance.now())}`);
      return;
    }

    const paso = pasos[i];
    const maniobra = paso.maneuver ?? "";
    const esSalida = maniobra.startsWith("ramp-") || maniobra.startsWith("fork-");
    const lado = maniobra.includes("right") ? "derecha" : maniobra.includes("left") ? "izquierda" : null;

    const distanciaRuta = calcularDistanciaRutaHastaIndice(polyline, indiceRutaVisibleRef.current, { lat, lng }, indicePorStep[i] ?? indiceFinDelStep);

    const ahoraLog = performance.now();
    if (ahoraLog - ultimoLogDistanciaManiobraTsRef.current >= 2000) {
      ultimoLogDistanciaManiobraTsRef.current = ahoraLog;
      diagLog(`[TILA_NAV_DIAG] MANIOBRA_DISTANCIA_RUTA requestId=${requestIdDeEsteTick} step=${i} distanciaM=${Math.round(distanciaRuta)} t=${Math.round(ahoraLog)}`);
    }

    if (!lado) return; // maniobra sin lado anunciable (recto/incorporación/rotonda) — sigue siendo la actual, se completa por progreso, nunca se le habla

    // ─── Avisos por CRUCE real de distancia, no por proximidad simple ────────────────
    // anteriorDist > umbral && distanciaRuta <= umbral: nunca se dispara sólo porque
    // distanciaRuta ya esté por debajo (eso repetiría/lingering a baja velocidad — ya
    // bloqueado además por avisos/pendientes más abajo), sino porque efectivamente
    // CRUZÓ el umbral desde la lectura anterior. anteriorDist === null (primera
    // evaluación de esta maniobra, recién inicializada/avanzada) se trata igual que un
    // cruce — así, si al inicializar ya estamos dentro de un nivel, se anuncia una vez
    // sin esperar un cruce que ya no va a ocurrir.
    // NIVELES ordenado de más cercano a más lejano: si el salto entre dos lecturas GPS
    // (alta velocidad, o baja frecuencia de GPS) cruza varios umbrales de golpe, se
    // detectan TODOS pero sólo se anuncia el más cercano (el más útil) — el resto se
    // consume en silencio, nunca se apilan varias voces seguidas.
    const anteriorDist = maniobraDistanciaAnteriorRef.current;
    maniobraDistanciaAnteriorRef.current = distanciaRuta;

    const avisos = maniobraAvisosEmitidosRef.current;
    const pendientes = maniobraNivelesPendientesRef.current;
    const NIVELES: { nombre: "cercano" | "medio" | "lejano"; umbral: number }[] = [
      { nombre: "cercano", umbral: UMBRAL_MANIOBRA_CERCANO_METROS },
      { nombre: "medio",   umbral: UMBRAL_MANIOBRA_MEDIO_METROS },
      { nombre: "lejano",  umbral: UMBRAL_MANIOBRA_LEJANO_METROS },
    ];
    for (const nivel of NIVELES) {
      if (avisos.has(nivel.nombre) || pendientes.has(nivel.nombre)) continue;
      const cruzo = anteriorDist === null
        ? distanciaRuta <= nivel.umbral
        : anteriorDist > nivel.umbral && distanciaRuta <= nivel.umbral;
      if (cruzo) pendientes.add(nivel.nombre);
    }

    if (pendientes.size > 0) {
      // NIVELES ya está ordenado cercano→lejano: el primero presente en `pendientes` es
      // el más útil para anunciar ahora mismo.
      const masCercano = NIVELES.find(n => pendientes.has(n.nombre))!;
      const metros = Math.round(distanciaRuta / 10) * 10;
      const texto = construirTextoManiobra(esSalida, lado, metros);
      const anunciado = intentarAnunciar(texto, "maniobra", `maniobra-${masCercano.nombre}-step${i}`, requestIdDeEsteTick);
      if (anunciado) {
        // Se anunció el más útil — todo lo pendiente (incluidos niveles más lejanos que
        // cruzaron junto con él, ya superados) se consume junto, de una sola vez.
        const nivelesConsumidos = pendientes.size;
        for (const nombre of pendientes) avisos.add(nombre);
        pendientes.clear();
        diagLog(
          `[TILA_NAV_DIAG] MANIOBRA_AVISO_${masCercano.nombre.toUpperCase()} requestId=${requestIdDeEsteTick} step=${i} `
          + `distanciaM=${Math.round(distanciaRuta)} nivelesCruzadosJuntos=${nivelesConsumidos} t=${Math.round(performance.now())}`
        );
      }
      // Si no se anunció (cooldown de otra prioridad/misma prioridad, ver
      // intentarAnunciar), `pendientes` queda tal cual — se reintenta el mismo nivel más
      // cercano en el próximo tick, sin exigir un cruce nuevo (distanciaRuta ya está
      // por debajo del umbral) y sin perder evidencia de los niveles ya cruzados.
    }
  }, [directions, lat, lng, modoNavegacion, modoMultiChofer, navegacionTilaActiva, onAnuncioVoz, intentarAnunciar, sincronizarIndiceConRuta]);

  // Al volver de navegación externa (Waze/Google) — flanco false→true de
  // navegacionTilaActiva — el tracking GPS nunca se detuvo (fixValidoActualRef siguió
  // actualizándose todo el tiempo), pero Directions/desvío/voz estuvieron congelados: la
  // ruta, el índice de progreso y la fase de estabilización GPS pueden llevar minutos de
  // desactualización silenciosa respecto de por dónde se manejó mientras tanto. Se trata
  // el regreso como una sesión de navegación nueva — mismo reset que al montar, más
  // primerGpsMultietapaRef=false para forzar un recálculo limpio e inmediato (primerGps)
  // en vez de esperar a que el detector de desvío note la deriva acumulada.
  // Inicializado con el valor actual (no false) para no disparar en el primer render —
  // el efecto de montaje ya cubre ese caso.
  const navegacionTilaActivaPrevRef = useRef(navegacionTilaActiva);
  useEffect(() => {
    const estabaActiva = navegacionTilaActivaPrevRef.current;
    navegacionTilaActivaPrevRef.current = navegacionTilaActiva;
    if (estabaActiva || !navegacionTilaActiva) return; // sólo interesa el flanco false→true

    ultimoFixValidoRef.current    = null;
    ultimoFixValidoTsRef.current  = null;
    penultimoFixValidoRef.current = null;
    candidatosReenganceRef.current = [];
    gpsInicialEstabilizadoRef.current = false;
    bootstrapMejorAccuracyRef.current = null;
    bootstrapCandidatosCoherentesRef.current = [];
    rutaPolylineRef.current = [];
    indicePorStepRef.current = [];
    calculandoRutaNavRef.current = false;
    lecturasFueraDeRutaRef.current = 0;
    maniobraActualIndiceRef.current = null;
    maniobraClaveActualRef.current = null;
    maniobraAvisosEmitidosRef.current = new Set();
    maniobraNivelesPendientesRef.current = new Set();
    maniobraDistanciaAnteriorRef.current = null;
    primerGpsMultietapaRef.current = false;
    // El snap visual de la sesión de navegación anterior (si la hubo) no tiene sentido
    // contra el estado recién limpiado — mismo motivo que rutaPolylineRef=[] arriba.
    posicionSnapRutaRef.current = null;
    diagLog(`[TILA_NAV_DIAG] NAV_ESTADO_RESET_POR_REANUDACION t=${Math.round(performance.now())}`);
  }, [navegacionTilaActiva]);

  // ─── Marcador chofer ──────────────────────────────────────────────────────
  // Sólo crea el marcador si todavía no existe — ya NO fija su posición (eso lo hace
  // exclusivamente pasoAnimacion, frame a frame). onMapLoad es la única excepción: ahí
  // sí se posiciona una vez, sin animar, para el primer paint / cada remount de tema.
  const asegurarMarcadorChofer = useCallback((mapa: google.maps.Map): google.maps.Marker => {
    if (!choferMarkerRef.current) {
      diagLog(`[TILA_NAV_DIAG] CREANDO marcador nuevo t=${Math.round(performance.now())}`);
      choferMarkerRef.current = new google.maps.Marker({
        map: mapa,
        icon: construirIconoChofer(autoResuelto === "noche"),
        title: "Posición actual",
        zIndex: 10,
      });
    }
    return choferMarkerRef.current;
  }, [autoResuelto]);

  // Prende/apaga los faros delanteros en vivo (setIcon), sin esperar un remount del
  // mapa — sólo cuando ya hay un marcador creado; si todavía no existe, onMapLoad ya lo
  // va a crear con el valor de autoResuelto vigente en ese momento (ver arriba).
  useEffect(() => {
    if (!choferMarkerRef.current) return;
    choferMarkerRef.current.setIcon(construirIconoChofer(autoResuelto === "noche"));
  }, [autoResuelto]);

  const onMapLoad = useCallback((mapa: google.maps.Map) => {
    diagLog(`[TILA_NAV_DIAG] onMapLoad (mount/remount) t=${Math.round(performance.now())} teniaSnapshot=${!!camaraSnapshotRef.current}`);
    mapRef.current = mapa;
    if (!modoMultiChofer) {
      const marker = asegurarMarcadorChofer(mapa);
      diagLog(`[TILA_NAV_DIAG] asegurarMarcadorChofer devolvió marker existente=${!!choferMarkerRef.current} t=${Math.round(performance.now())}`);
      if (lat && lng) {
        // Posicionamiento instantáneo, sin animar: es el primer paint del mapa (o un
        // remount por cambio de tema) — no hay una posición visual previa desde la cual
        // interpolar. pasoAnimacion recién anima a partir del próximo fix de GPS.
        marker.setPosition({ lat, lng });
        posicionVisualActualRef.current = { lat, lng, heading: headingValido(heading) };
      }
    }

    // Restaurar heading/tilt UNA sola vez, imperativamente, sólo si esta instancia
    // nace de un remount por cambio de tema (cambiarTema dejó un snapshot). No van
    // dentro de `options` porque ese objeto se reconstruye en cada render (ver
    // comentario junto a `opciones` más abajo) y `setOptions` los reaplicaría sin
    // parar, pisando cualquier gesto manual o el heading real de marcha.
    if (camaraSnapshotRef.current) {
      // TILA_NAV_DIAG: esta escritura de heading/tilt NO pasa por moverCamara — se
      // loguea acá aparte porque es el tercer punto que toca el mapa imperativamente.
      diagLog(`[TILA_NAV_DIAG] moverCamara origen=onMapLoad-remount(fuera de moverCamara) heading=${camaraSnapshotRef.current.heading} tilt=${camaraSnapshotRef.current.tilt} t=${Math.round(performance.now())}`);
      mapa.setHeading(camaraSnapshotRef.current.heading);
      mapa.setTilt(camaraSnapshotRef.current.tilt);
    }

    // Solo en modoNavegacion (Viaje Activo) el usuario puede "tomar control" de la cámara.
    // Panel Chofer nunca pasa modoNavegacion=true, así que este bloque no le afecta.
    if (modoNavegacion) {
      mapa.addListener("dragstart", () => {
        actualizarSeguimiento(false);
      });
      mapa.addListener("zoom_changed", () => {
        if (!programaticoRef.current) actualizarSeguimiento(false);
      });
      mapa.addListener("heading_changed", () => {
        if (!programaticoRef.current) actualizarSeguimiento(false);
      });
      mapa.addListener("tilt_changed", () => {
        if (!programaticoRef.current) actualizarSeguimiento(false);
      });

      // TILA_NAV_DIAG: listeners ADICIONALES, sólo para contar — no tocan
      // actualizarSeguimiento ni ninguna otra lógica existente. Sirven para ver si
      // Google dispara MÁS eventos de cámara que las veces que nosotros llamamos a
      // setCenter/setHeading/moveCamera (evidencia de animación interna encadenada).
      mapa.addListener("center_changed", () => { diagContadoresRef.current.eventoCenterChanged++; });
      mapa.addListener("heading_changed", () => { diagContadoresRef.current.eventoHeadingChanged++; });
      mapa.addListener("zoom_changed", () => { diagContadoresRef.current.eventoZoomChanged++; });
      mapa.addListener("tilt_changed", () => { diagContadoresRef.current.eventoTiltChanged++; });
      mapa.addListener("idle", () => { diagContadoresRef.current.eventoIdle++; });
    }
  }, [asegurarMarcadorChofer, lat, lng, heading, modoMultiChofer, modoNavegacion, actualizarSeguimiento]);

  const onMapLoadMulti = useCallback((mapa: google.maps.Map) => {
    mapRef.current = mapa;
    if (!choferes || choferes.length === 0) return;
    if (choferes.length === 1) {
      moverCamara(() => {
        mapa.setCenter({ lat: choferes[0].lat, lng: choferes[0].lng });
        mapa.setZoom(13);
      });
      return;
    }
    moverCamara(() => {
      const bounds = new google.maps.LatLngBounds();
      choferes.forEach(c => bounds.extend({ lat: c.lat, lng: c.lng }));
      mapa.fitBounds(bounds, { top: 60, right: 40, bottom: 60, left: 40 });
    });
  }, [choferes, moverCamara]);

  useEffect(() => {
    if (!mapRef.current || modoMultiChofer) return;
    const fix = fixValidoActualRef.current;
    if (!fix) return; // fix rechazado este tick — no se mueve marcador/cámara con él
    // Historial de posiciones — respaldo para calcular un bearing en
    // restaurarCamaraNavegacion cuando el heading del GPS no esté disponible.
    // Se mantiene al día siempre, con la posición GPS cruda validada (no la
    // interpolada), independientemente de si el seguimiento está activo o pausado.
    historialPosicionRef.current = {
      previa: historialPosicionRef.current.actual,
      actual: fix,
    };
    // El marcador y la cámara (si corresponde) se actualizan juntos, de forma suave,
    // a través del único loop de animación — ya no hay un salto instantáneo acá.
    // headingAceptadoRef (no heading crudo): garantiza que el heading pertenezca al
    // MISMO fix que fix (fixValidoActualRef.current) — un fix rechazado nunca puede
    // aportar su heading acá, aunque heading (prop) ya se haya actualizado con él.
    animarHaciaPosicion(fix.lat, fix.lng, headingAceptadoRef.current);
  }, [lat, lng, heading, modoMultiChofer, animarHaciaPosicion]);

  // ─── Botones de control manual de cámara (solo modoNavegacion) ────────────
  const verRecorridoCompleto = useCallback(() => {
    actualizarSeguimiento(false);
    const puntos: google.maps.LatLngLiteral[] = [];
    if (lat && lng) puntos.push({ lat, lng });
    paradasCoords.forEach(p => { if (p) puntos.push(p); });
    if (destinoCoords) puntos.push(destinoCoords);
    if (puntos.length === 0) return;
    encuadrarPuntosForzado(puntos);
  }, [lat, lng, paradasCoords, destinoCoords, encuadrarPuntosForzado, actualizarSeguimiento]);

  // Única función que reactiva el seguimiento (botón "Mi ubicación"). A diferencia
  // de seguirChofer (que sólo actualiza center/heading tick a tick mientras el
  // seguimiento YA está activo), acá se restablece la cámara de navegación completa
  // de una sola vez — descarta el zoom/tilt/orientación que haya dejado la
  // exploración manual, en una única ventana de moverCamara().
  //
  // Prioridad del heading (nunca se fuerza 0 por defecto):
  //   1) heading GPS real y válido;
  //   2) bearing calculado entre las dos últimas posiciones conocidas, sólo si el
  //      chofer se movió ≥3m entre ellas (evita ruido de GPS estacionario);
  //   3) último heading de navegación que se haya aplicado alguna vez;
  //   4) si no hay ninguno de los anteriores, no se toca el heading de cámara.
  const restaurarCamaraNavegacion = useCallback(() => {
    if (!lat || !lng) return;
    actualizarSeguimiento(true);

    let headingFinal: number | null = null;
    let diagFuenteHeading = "ninguna";
    if (heading !== null && heading !== undefined && !Number.isNaN(heading)) {
      headingFinal = normalizarHeading(heading);
      diagFuenteHeading = "gps";
    } else {
      const { previa, actual } = historialPosicionRef.current;
      if (previa && actual && distanciaMetros(previa, actual) >= 3) {
        headingFinal = calcularBearing(previa, actual);
        diagFuenteHeading = "bearing";
      } else if (ultimoHeadingNavegacionRef.current !== null) {
        headingFinal = ultimoHeadingNavegacionRef.current;
        diagFuenteHeading = "ultimoUsado";
      }
    }
    diagLog(`[TILA_NAV_DIAG] restaurarCamaraNavegacion headingFinal=${headingFinal ?? "null"} fuente=${diagFuenteHeading} t=${Math.round(performance.now())}`);
    diagUltimoHeadingAplicadoRef.current = headingFinal;
    diagUltimaFuenteHeadingRef.current = `restaurarCamaraNavegacion:${diagFuenteHeading}`;

    // Esta es una reposición instantánea y explícita del usuario — no una animación de
    // GPS — así que cancela cualquier interpolación todavía en vuelo (si no, el próximo
    // frame de pasoAnimacion pisaría este reseteo con un valor interpolado viejo) y deja
    // la posición visual sincronizada para que la próxima animación GPS parta de acá.
    if (animacionFrameRef.current !== null) {
      cancelAnimationFrame(animacionFrameRef.current);
      animacionFrameRef.current = null;
    }
    posicionVisualActualRef.current = { lat, lng, heading: headingFinal ?? posicionVisualActualRef.current?.heading ?? null };

    // Mismo look-ahead que pasoAnimacion — centra un poco adelante en la dirección de
    // marcha, no exactamente sobre el vehículo (ver LOOK_AHEAD_METROS/puntoAdelantado).
    const centroCamara = headingFinal !== null
      ? puntoAdelantado({ lat, lng }, headingFinal, LOOK_AHEAD_METROS)
      : { lat, lng };

    // Bloquea a pasoAnimacion y al efecto de panelTopPx mientras esta restauración está
    // en curso — una única autoridad de cámara a la vez. Se libera solo, con timeout
    // (mismo patrón que programaticoTimeoutRef): 600ms alcanza de sobra para el vuelo
    // que hace moveCamera, incluso con cambios grandes de zoom/tilt/heading a la vez.
    if (restaurandoCamaraTimeoutRef.current !== null) {
      clearTimeout(restaurandoCamaraTimeoutRef.current);
    }
    restaurandoCamaraRef.current = true;
    restaurandoCamaraTimeoutRef.current = setTimeout(() => {
      restaurandoCamaraRef.current = false;
      restaurandoCamaraTimeoutRef.current = null;
    }, 600);

    moverCamara(() => {
      const centroFinal = puntoConOffsetVerticalPx(
        mapRef.current!, centroCamara, calcularOffsetVerticalCamara()
      ) ?? centroCamara;
      // Una sola llamada atómica (moveCamera) en vez de setCenter/setZoom/setTilt/
      // setHeading por separado: con mapas vectoriales (tilt 3D), llamar a esos setters
      // uno por uno hace que Google anime cada propiedad como un "vuelo" independiente —
      // con un cambio grande de zoom/tilt/heading a la vez (típico al volver de "Ver
      // recorrido completo" o del encuadre inicial, muy alejado, a la vista de
      // navegación), eso producía el alejamiento-y-vuelta reportado. moveCamera aplica
      // las cuatro propiedades como una única transición coordinada.
      if (headingFinal !== null) {
        ultimoHeadingNavegacionRef.current = headingFinal;
      }
      mapRef.current!.moveCamera({
        center: centroFinal,
        zoom: ZOOM_NAVEGACION,
        tilt: TILT_NAVEGACION,
        heading: headingFinal ?? mapRef.current!.getHeading() ?? 0,
      });
    }, "restaurarCamaraNavegacion");
  }, [lat, lng, heading, moverCamara, actualizarSeguimiento, calcularOffsetVerticalCamara]);

  // Reaplica el centrado con offset ya mismo cuando cambia panelTopPx (expandir/minimizar,
  // cambio de orientación, resize — lo que sea que haya movido el borde superior del
  // panel), sin esperar al próximo tick de GPS. Sólo actúa si ya se está siguiendo al
  // chofer, hay una posición visual conocida, y NO hay una restauración de cámara en
  // curso (restaurandoCamaraRef) — si no, no hace nada (el próximo
  // restaurarCamaraNavegacion/pasoAnimacion ya van a leer el panelTopPxRef actualizado).
  useEffect(() => {
    if (!modoNavegacion || !siguiendoChoferRef.current || !mapRef.current) return;
    if (restaurandoCamaraRef.current) return;
    const posicion = posicionVisualActualRef.current;
    if (!posicion) return;
    const centroCamara = posicion.heading !== null
      ? puntoAdelantado({ lat: posicion.lat, lng: posicion.lng }, posicion.heading, LOOK_AHEAD_METROS)
      : { lat: posicion.lat, lng: posicion.lng };
    moverCamara(() => {
      const centroFinal = puntoConOffsetVerticalPx(
        mapRef.current!, centroCamara, calcularOffsetVerticalCamara()
      ) ?? centroCamara;
      mapRef.current!.setCenter(centroFinal);
    }, "panelTopPx-efecto");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelTopPx, modoNavegacion, moverCamara, calcularOffsetVerticalCamara]);

  // Este useMemo debe ejecutarse SIEMPRE, incluso mientras el script de Maps
  // todavía no cargó (isLoaded === false). Antes vivía después de los dos
  // `return` de carga/error de más abajo, por lo que en el render con
  // isLoaded=false el componente cortaba ahí y nunca llegaba a este hook, y en
  // el render siguiente (isLoaded=true) sí lo ejecutaba: distinta cantidad de
  // hooks entre renders del mismo componente → React tira "Rendered more
  // hooks than during the previous render". Por eso colorSchemeActual sólo lee
  // google.maps.* cuando isLoaded es true; si no, cae a undefined.
  //
  // Memoizado: @react-google-maps/api decide si llama a map.setOptions(...) comparando
  // la REFERENCIA del objeto `options` contra la del render anterior (ver
  // applyUpdaterToNextProps en su código fuente). Un objeto literal inline sería una
  // referencia nueva en cada render — y como lat/lng/heading cambian en cada tick de
  // GPS, eso disparaba setOptions() constantemente. Con useMemo, la referencia sólo
  // cambia cuando cambia modoNavegacion o colorSchemeActual (las únicas dependencias
  // reales), así que setOptions() deja de ejecutarse en cada render. heading/tilt NO
  // van acá — ver el comentario en onMapLoad de por qué se aplican ahí en cambio.
  // "automatico" ya NO usa FOLLOW_SYSTEM (ver resolverTemaAutomatico arriba: en el
  // WebView de Capacitor terminaba siempre en oscuro) — se resuelve explícitamente a
  // LIGHT o DARK por horario. Lee `autoResuelto` (el estado, actualizado por el efecto
  // de arriba) en vez de llamar a resolverTemaAutomatico() acá directamente: así el
  // valor efectivamente aplicado siempre coincide con el que forma parte de la `key`
  // de <GoogleMap> más abajo — ambos deben ir sincronizados al mismo valor.
  const colorSchemeActual = isLoaded
    ? ((tema === "dia" || (tema === "automatico" && autoResuelto === "dia"))
        ? google.maps.ColorScheme.LIGHT
        : google.maps.ColorScheme.DARK)
    : undefined;

  const opciones = useMemo<google.maps.MapOptions>(() => ({
    disableDefaultUI: true,
    // Redundante con el pinch-to-zoom (gestureHandling "greedy") en la vista de
    // navegación a pantalla completa — igual que Google Maps/Waze/Uber Driver no
    // muestran botones +/- durante la conducción. Se mantiene en las vistas de
    // sólo lectura (panel-cliente/panel-chofer), donde sí es una ayuda útil.
    zoomControl: !modoNavegacion,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
    // El control de rotación propio de Google quedaría redundante con nuestro
    // propio botón "Mi ubicación" (que ya centra + reorienta) — se apaga en
    // todos los modos; en los modos sin tiltInteractionEnabled ni aparecería.
    rotateControl: false,
    // Sin utilidad en una app táctil dentro de un WebView — quita el enlace
    // "Keyboard shortcuts" de la fila de atribución.
    keyboardShortcuts: false,
    // Evita que tocar un ícono de comercio/POI ajeno abra la tarjeta info nativa
    // de Google en medio de la conducción; no afecta a los paneles de sólo lectura.
    clickableIcons: !modoNavegacion,
    // Mapa vectorial (mapId de Google Cloud) — el estilo ("TILA Vector Base")
    // vive en Cloud Console, ya no en un array `styles` local: con mapId
    // presente, Google ignora `styles` por completo.
    mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
    colorScheme: colorSchemeActual,
    // Inclinación/rotación manual HABILITADAS — igual que pan/zoom, el gesto corta el
    // seguimiento automático (ver heading_changed/tilt_changed en onMapLoad, ya gateados
    // por programaticoRef: sólo actualizarSeguimiento(false) si el cambio no vino de
    // nuestro propio código) y sólo el botón "Mi ubicación" (restaurarCamaraNavegacion)
    // los retoma. Antes iban en false para evitar rotación accidental durante la
    // conducción, pero eso también bloqueaba la rotación manual intencional — la cámara
    // automática (pasoAnimacion/restaurarCamaraNavegacion) sigue usando
    // setTilt/setHeading/moveCamera por código, que no pasa por estos flags.
    tiltInteractionEnabled: true,
    headingInteractionEnabled: true,
    // Arrastre/zoom libres, sin el modo cooperativo (que exigiría dos dedos
    // incluso para arrastrar) en esta vista de mapa a pantalla completa.
    gestureHandling: "greedy",
  }), [modoNavegacion, colorSchemeActual]);

  // ─── Traza de la ruta: doble capa (casing oscuro + línea amarilla firme) ──
  // Mismo motivo que `opciones` arriba para memoizar: options nuevo en cada render
  // dispara setOptions() en cada tick de GPS aunque los valores no cambien. Deps vacías
  // porque los colores/anchos son constantes — nunca cambia la referencia.
  // DirectionsRenderer no soporta un trazo de dos colores nativamente, así que se
  // renderizan dos instancias con la misma `directions`/`path`: una más gruesa y oscura
  // debajo (zIndex 1) y una más angosta y amarilla encima (zIndex 2) — sigue siendo UNA
  // sola ruta/decisión de datos, sólo con dos trazos visuales para más contraste.
  // Casing: sólo un halo sutil (antes 16/0.5, mucho más marcado) para que la línea
  // amarilla sea la protagonista y se sigan leyendo los nombres de calle debajo.
  // Principal: color/grosor/opacidad ajustados a spec (#FFD54F, 16px, 0.65).
  const rutaCasingOptions = useMemo<google.maps.PolylineOptions>(() => ({
    strokeColor: "#18181b",
    strokeWeight: 20,
    strokeOpacity: 0.3,
    zIndex: 1,
  }), []);
  const rutaPrincipalOptions = useMemo<google.maps.PolylineOptions>(() => ({
    strokeColor: "#FFD54F",
    strokeWeight: 16,
    strokeOpacity: 0.65,
    zIndex: 2,
  }), []);
  const directionsCasingOptions = useMemo<google.maps.DirectionsRendererOptions>(() => ({
    suppressMarkers: true,
    // Sin esto, la librería hace su propio fitBounds cada vez que cambia `directions`,
    // moviendo la cámara por fuera de moverCamara()/siguiendoChoferRef.
    preserveViewport: true,
    polylineOptions: rutaCasingOptions,
  }), [rutaCasingOptions]);
  const directionsPrincipalOptions = useMemo<google.maps.DirectionsRendererOptions>(() => ({
    suppressMarkers: true,
    preserveViewport: true,
    polylineOptions: rutaPrincipalOptions,
  }), [rutaPrincipalOptions]);

  // ─── Fallbacks de carga ───────────────────────────────────────────────────
  if (loadError) return (
    <div style={{ height: altura }} className="w-full bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center">
      <p className="text-zinc-500 text-sm">Error al cargar el mapa</p>
    </div>
  );

  if (!isLoaded) return (
    <div style={{ height: altura }} className="w-full bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center">
      <p className="text-yellow-400 font-black animate-pulse">Cargando mapa...</p>
    </div>
  );

  return (
    <div style={{ width: "100%", position: "relative" }}>
      <GoogleMap
        // key: única forma oficial de aplicar un colorScheme nuevo (ver el comentario
        // largo junto a cambiarTema) — al cambiar, React desmonta esta instancia y
        // monta una nueva. Cuando tema==="automatico" se suma autoResuelto a la key:
        // sin esto, el efecto que detecta el cruce de horario podría actualizar
        // autoResuelto (y por lo tanto colorSchemeActual) sin que la key cambiara, y el
        // remount nunca ocurriría. center/zoom usan el snapshot capturado justo antes
        // del remount para no perder la posición actual; heading/tilt se restauran
        // aparte, en onMapLoad (ver ahí el porqué). En el primer montaje (sin snapshot
        // todavía) center/zoom caen a centroInicial/zoomInicial.
        key={tema === "automatico" ? `automatico-${autoResuelto}` : tema}
        mapContainerStyle={contenedorEstilo}
        center={camaraSnapshotRef.current?.center ?? centroInicial}
        zoom={camaraSnapshotRef.current?.zoom ?? zoomInicial}
        options={opciones}
        onLoad={modoMultiChofer ? onMapLoadMulti : onMapLoad}
      >
        {/* Multi-chofer admin */}
        {modoMultiChofer && choferes!.map((chofer, index) => (
          <Marker
            key={`chofer-${index}`}
            position={{ lat: chofer.lat, lng: chofer.lng }}
            title={chofer.label ?? `Chofer ${index + 1}`}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: colorChoferPorEstado(chofer.estado),
              fillOpacity: 1,
              strokeColor: "rgba(0,0,0,0.4)",
              strokeWeight: 14,
            }}
            label={{ text: String(index + 1), color: "#000000", fontWeight: "bold", fontSize: "10px" }}
            zIndex={10}
          />
        ))}

        {/* Marcadores multietapa — círculo para retiro/parada, pin para entrega */}
        {!modoMultiChofer && tieneParadas &&
          paradas!.map((parada, index) => {
            const coords = paradasCoords[index];
            if (!coords) return null;
            const letra = LABELS[index] || String(index);
            const forma = parada.tipo === "entrega" ? "pin" : "circulo";
            return (
              <Marker
                key={index}
                position={coords}
                title={`${letra} · ${tipoParadaTexto(parada.tipo)}: ${parada.direccion}`}
                icon={construirIconoParada(letra, parada.estado, forma)}
              />
            );
          })}

        {/* Marcadores simples — sin tramos explícitos: A retiro (círculo), B entrega (pin) */}
        {!modoMultiChofer && !tieneParadas && origenCoords && (
          <Marker
            position={origenCoords}
            title={`A · Retiro: ${origen}`}
            icon={construirIconoParada("A", "pendiente", "circulo")}
          />
        )}
        {!modoMultiChofer && !tieneParadas && destinoCoords && (
          <Marker
            position={destinoCoords}
            title={paradaActivaDireccion ? `Objetivo: ${paradaActivaDireccion}` : `Entrega: ${destino}`}
            icon={construirIconoParada(modoNavegacion ? "●" : "B", "pendiente", "pin")}
          />
        )}

        {/* Ruta en modoNavegacion: recortada visualmente desde cerca del vehículo hasta
            el destino (rutaVisibleDesdeVehiculo — rutaPolylineRef sigue completa para
            rerouting/maniobras/llegada, esto es sólo representación). DirectionsRenderer
            no admite dibujar un tramo parcial de su propio resultado, por eso acá se usa
            Polyline directamente, con la misma doble capa (casing oscuro + línea amarilla). */}
        {!modoMultiChofer && modoNavegacion && rutaVisibleDesdeVehiculo.length >= 2 && (
          <>
            <Polyline path={rutaVisibleDesdeVehiculo} options={rutaCasingOptions} />
            <Polyline path={rutaVisibleDesdeVehiculo} options={rutaPrincipalOptions} />
          </>
        )}

        {/* Fuera de modoNavegacion (paneles de sólo lectura): ruta completa, sin cambios —
            doble capa vía DirectionsRenderer. */}
        {!modoMultiChofer && !modoNavegacion && directions && (
          <>
            <DirectionsRenderer
              key={`dir-casing-${directions.request?.origin?.toString()}`}
              directions={directions}
              options={directionsCasingOptions}
            />
            <DirectionsRenderer
              key={`dir-principal-${directions.request?.origin?.toString()}`}
              directions={directions}
              options={directionsPrincipalOptions}
            />
          </>
        )}

        {/* Polyline fallback fuera de modoNavegacion — siempre dibuja si Directions falla */}
        {!modoMultiChofer && !modoNavegacion && !directions && polylinePuntos.length >= 2 && (
          <>
            <Polyline path={polylinePuntos} options={rutaCasingOptions} />
            <Polyline path={polylinePuntos} options={rutaPrincipalOptions} />
          </>
        )}
      </GoogleMap>

      {/* Controles manuales de cámara — solo en modoNavegacion (Viaje Activo) */}
      {modoNavegacion && (
        <div
          className="absolute right-3 z-20 flex flex-col gap-2"
          style={{ top: "50%", transform: "translateY(-50%)" }}
        >
          <button
            type="button"
            onClick={verRecorridoCompleto}
            title="Ver recorrido completo"
            aria-label="Ver recorrido completo"
            className="w-11 h-11 rounded-full bg-black/85 border border-yellow-400 text-yellow-400 flex items-center justify-center text-lg shadow-lg active:scale-95 transition"
          >
            🗺️
          </button>
          <button
            type="button"
            onClick={restaurarCamaraNavegacion}
            title={siguiendoActivo ? "Siguiendo tu ubicación" : "Volver a mi ubicación"}
            aria-label={siguiendoActivo ? "Siguiendo tu ubicación — tocá para recentrar" : "Volver a mi ubicación"}
            aria-pressed={siguiendoActivo}
            className={`w-11 h-11 rounded-full border flex items-center justify-center text-lg shadow-lg active:scale-95 transition ${
              siguiendoActivo
                ? "bg-yellow-400 border-yellow-400 text-black"
                : "bg-black/85 border-yellow-400 text-yellow-400"
            }`}
          >
            📍
          </button>
          <button
            type="button"
            onClick={cambiarTema}
            title={`Tema: ${LABEL_TEMA[tema]} — tocá para ${LABEL_TEMA[SIGUIENTE_TEMA[tema]]}`}
            aria-label={`Tema del mapa: ${LABEL_TEMA[tema]}. Tocá para cambiar a ${LABEL_TEMA[SIGUIENTE_TEMA[tema]]}`}
            className="w-11 h-11 rounded-full bg-black/85 border border-yellow-400 text-yellow-400 flex items-center justify-center text-lg shadow-lg active:scale-95 transition"
          >
            {ICONO_TEMA[tema]}
          </button>
          {onToggleVoz && (
            <button
              type="button"
              onClick={onToggleVoz}
              title={vozActiva ? "Voz activada — tocá para silenciar" : "Voz silenciada — tocá para activar"}
              aria-label={vozActiva ? "Silenciar navegación por voz" : "Activar navegación por voz"}
              aria-pressed={vozActiva}
              className="w-11 h-11 rounded-full bg-black/85 border border-yellow-400 text-yellow-400 flex items-center justify-center text-lg shadow-lg active:scale-95 transition"
            >
              {vozActiva ? "🔊" : "🔇"}
            </button>
          )}
          {/* TILA_NAV_DIAG: botón temporal — abre la pantalla de diagnóstico en memoria.
              Quitar junto con el resto de la instrumentación. */}
          <button
            type="button"
            onClick={() => setMostrarDiagNav(true)}
            title="Diagnóstico de navegación"
            aria-label="Abrir diagnóstico de navegación"
            className="w-11 h-11 rounded-full bg-pink-600 border border-pink-300 text-white flex items-center justify-center text-lg shadow-lg active:scale-95 transition"
          >
            🐞
          </button>
        </div>
      )}

      {/* TILA_NAV_DIAG: pantalla de diagnóstico — texto seleccionable de todo lo
          registrado en memoria, copiar y descargar. Temporal, quitar junto con el
          resto de la instrumentación. */}
      {mostrarDiagNav && (
        <div className="absolute inset-0 z-50 bg-black/95 flex flex-col p-3">
          <div className="flex items-center justify-between mb-2 gap-2">
            <p className="text-yellow-400 font-black text-sm">
              🐞 Diagnóstico navegación — {diagContarEventos()} eventos
            </p>
            <button
              type="button"
              onClick={() => setMostrarDiagNav(false)}
              className="text-zinc-300 font-black text-sm px-3 py-1 rounded-lg bg-zinc-800"
            >
              Cerrar ✕
            </button>
          </div>
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(diagObtenerTexto());
                } catch {
                  // Sin Clipboard API disponible — el textarea de abajo sigue
                  // permitiendo seleccionar todo y copiar a mano.
                }
              }}
              className="flex-1 bg-yellow-400 text-black font-black text-xs py-2 rounded-lg"
            >
              Copiar todo
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([diagObtenerTexto()], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `tila_nav_diag_${Date.now()}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              className="flex-1 bg-zinc-700 text-white font-black text-xs py-2 rounded-lg"
            >
              Descargar .txt
            </button>
            <button
              type="button"
              onClick={() => { diagLimpiar(); setDiagRefrescoTick(t => t + 1); }}
              className="flex-1 bg-red-700 text-white font-black text-xs py-2 rounded-lg"
            >
              Limpiar
            </button>
          </div>
          <textarea
            readOnly
            value={diagObtenerTexto()}
            className="flex-1 w-full bg-zinc-900 text-zinc-200 text-[10px] font-mono p-2 rounded-lg border border-zinc-700 resize-none"
            onFocus={e => e.currentTarget.select()}
          />
        </div>
      )}

      {/* ── Diagnóstico visible — solo cuando mostrarDiagnostico=true ──────── */}
      {mostrarDiagnostico && (
        <div className="mt-2 bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-xs font-mono space-y-1">
          <p className="text-zinc-400 font-black mb-1">🔍 DIAGNÓSTICO MAPA</p>
          <p><span className="text-zinc-500">modo:</span> <span className="text-yellow-400">{diagnostico.modoActivo}</span></p>
          <p><span className="text-zinc-500">directions status:</span> <span className={diagnostico.directionsStatus === "OK" ? "text-green-400" : "text-red-400"}>{diagnostico.directionsStatus}</span></p>
          <p><span className="text-zinc-500">directions state:</span> <span className={directions ? "text-green-400" : "text-red-400"}>{directions ? `OK (${directions.routes?.length ?? 0} rutas)` : "null"}</span></p>
          <p><span className="text-zinc-500">polyline fallback:</span> <span className={diagnostico.polylineFallback ? "text-yellow-400" : "text-zinc-500"}>{diagnostico.polylineFallback ? `sí (${diagnostico.puntosPolyline} pts)` : "no"}</span></p>
          <p><span className="text-zinc-500">geocoding origen:</span> <span className={diagnostico.geocodingOrigen === "OK" || diagnostico.geocodingOrigen === "GPS" ? "text-green-400" : "text-red-400"}>{diagnostico.geocodingOrigen}</span></p>
          <p><span className="text-zinc-500">geocoding destino:</span> <span className={diagnostico.geocodingDestino === "OK" ? "text-green-400" : "text-red-400"}>{diagnostico.geocodingDestino}</span></p>
          <p><span className="text-zinc-500">tiene paradas:</span> <span className="text-zinc-300">{String(diagnostico.tieneParadas)}</span></p>
          <p><span className="text-zinc-500">lat/lng:</span> <span className="text-zinc-300">{lat ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : "null"}</span></p>
          <p><span className="text-zinc-500">origen:</span> <span className="text-zinc-300">{origen || "—"}</span></p>
          <p><span className="text-zinc-500">destino:</span> <span className="text-zinc-300">{destino || "—"}</span></p>
          <p><span className="text-zinc-500">paradaActiva:</span> <span className="text-zinc-300">{paradaActivaDireccion || "—"}</span></p>
          <p><span className="text-zinc-500">paradas count:</span> <span className="text-zinc-300">{paradas?.length ?? 0}</span></p>
        </div>
      )}
    </div>
  );
}

// ─── Estado del módulo de navegación ────────────────────────────────────────
// Implementado: interpolación continua de marcador/cámara (pasoAnimacion, sin saltos
// perceptibles de tick); look-ahead de cámara (LOOK_AHEAD_METROS/puntoAdelantado — centra
// un poco adelante del vehículo en su rumbo real, no exactamente sobre él); rerouting por
// desvío real con dos velocidades (obvio = 1 lectura, moderado = confirmación por varias
// lecturas), no por distancia recorrida; traza recortada de doble capa; navegación por voz
// (giro próximo derecha/izquierda + "ruta recalculada", vía onAnuncioVoz — "llegaste al
// destino" se dispara desde viaje-activo/page.tsx, que es quien sabe cuándo llega el viaje);
// tema Automático por horario, reactivo en vivo. Zoom y tilt siguen sin animar tick a tick
// (sólo los fija restaurarCamaraNavegacion una vez, al reactivar el seguimiento) — a
// propósito, no pedido.
//
// Deliberadamente NO implementado (fuera de alcance, no pedido):
//   - vehículo en el tercio inferior de la pantalla (requeriría desplazar el centro visual
//     vía screen-space, con map.getProjection(), en vez del look-ahead geográfico actual);
//   - zoom adaptativo según velocidad/contexto (ciudad/ruta/autopista);
//   - cambios de POI (eso vive en Google Cloud Console, no en este archivo — ver
//     app/docs/google-maps.md para qué categorías se pueden controlar ahí).
//
// Tema "Automático": resuelve LIGHT/DARK explícitamente por HORARIO LOCAL únicamente
// (resolverTemaAutomatico — sin preferencia del sistema operativo, ver el comentario
// junto a esa función). Reacciona en vivo: un chequeo cada 1 minuto (autoResuelto +
// autoResueltoRef) detecta el cruce de HORA_INICIO_NOCHE/HORA_FIN_NOCHE y fuerza un
// remount (autoResuelto forma parte de la `key` de <GoogleMap> cuando tema==="automatico")
// — no hace falta que el chofer toque el botón ni reinstale la app.
