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

const LIBRARIES: ("places" | "geometry" | "drawing")[] = [];

const centroArgentina = { lat: -34.6037, lng: -58.3816 };
const LABELS = ["A", "B", "C", "D", "E", "F"];

// Zoom y tilt aplicados por "Mi ubicación" al restaurar la cámara de navegación.
// Sólo se fijan una vez, al reactivar el seguimiento — no se reaplican en cada tick
// de GPS. TILT subido de 45 a 65 (cerca del máximo real de Maps con mapId vectorial)
// para una vista tipo navegador GPS: más "desde atrás, mirando al horizonte" y menos
// cenital. ZOOM subido de 18 a 18.5 — el camión gana protagonismo sin perder demasiada
// visión del camino hacia adelante (un salto entero, a 19, dejaba ver muy poca ruta).
const ZOOM_NAVEGACION = 18.5;
const TILT_NAVEGACION = 65;

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

// ─── Progreso monotónico sobre la ruta (compartido entre desvío y recorte visual) ──
// Tolerancia de retroceso del índice de progreso: la búsqueda del punto más cercano
// puede mirar hasta esta cantidad de tramos ANTES del índice actual (no sólo desde él
// en adelante), para no quedar "clavada" si una lectura momentáneamente imprecisa la
// adelantó de más. Nunca es un retroceso grande (toda la ruta), sólo estos tramos.
const VENTANA_ATRAS_SEGMENTOS = 3;

// Distancia a la que se anuncia por voz una maniobra próxima ("En X metros doblá...").
const UMBRAL_AVISO_MANIOBRA_METROS = 150;

// Salidas/bifurcaciones de autopista (maneuver "ramp-*"/"fork-*") — dos avisos en vez
// de uno, con umbrales propios (no comparten UMBRAL_AVISO_MANIOBRA_METROS): uno lejano
// para dar tiempo a ubicarse en el carril, uno cercano ya casi en la salida.
const UMBRAL_AVISO_SALIDA_LEJANO_METROS  = 200;
const UMBRAL_AVISO_SALIDA_CERCANO_METROS = 65;

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

// Distancia (metros) de un punto al segmento a-b, proyectando sobre un plano local
// equirectangular centrado en el segmento — precisión sobrada para las distancias cortas
// (decenas/cientos de metros) que interesan para detectar desvío de ruta.
const METROS_POR_GRADO_LAT = 111320;
const distanciaPuntoASegmentoMetros = (
  p: google.maps.LatLngLiteral,
  a: google.maps.LatLngLiteral,
  b: google.maps.LatLngLiteral
): number => {
  const metrosPorGradoLng = METROS_POR_GRADO_LAT * Math.cos((a.lat * Math.PI) / 180);
  const px = (p.lng - a.lng) * metrosPorGradoLng, py = (p.lat - a.lat) * METROS_POR_GRADO_LAT;
  const bx = (b.lng - a.lng) * metrosPorGradoLng, by = (b.lat - a.lat) * METROS_POR_GRADO_LAT;
  const largoSegmentoCuadrado = bx * bx + by * by;
  if (largoSegmentoCuadrado === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / largoSegmentoCuadrado));
  return Math.hypot(px - t * bx, py - t * by);
};

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
const construirPolylineDetalladaDesdeRuta = (
  result: google.maps.DirectionsResult
): google.maps.LatLngLiteral[] => {
  const legs = result.routes?.[0]?.legs ?? [];
  const puntos: google.maps.LatLngLiteral[] = [];
  legs.forEach(leg => {
    (leg.steps ?? []).forEach(step => {
      (step.path ?? []).forEach(p => {
        const punto = { lat: p.lat(), lng: p.lng() };
        const anterior = puntos[puntos.length - 1];
        if (!anterior || anterior.lat !== punto.lat || anterior.lng !== punto.lng) {
          puntos.push(punto);
        }
      });
    });
  });
  return puntos;
};

// Distancia mínima de un punto a una polyline, buscando SÓLO desde `indiceDesde` menos
// un pequeño margen de retroceso (VENTANA_ATRAS_SEGMENTOS) hacia adelante — no siempre
// desde el principio de la ruta. Devuelve también el índice del tramo donde se encontró
// la distancia mínima, para que el llamador pueda avanzar su progreso monotónico.
// null si la polyline todavía no tiene al menos 2 puntos (ninguna ruta calculada aún).
// `indiceDesde` en 0 (valor por defecto) reproduce un escaneo completo, útil cuando
// todavía no hay progreso previo (primer GPS de una ruta nueva).
const distanciaMinAPolyline = (
  p: google.maps.LatLngLiteral,
  puntos: google.maps.LatLngLiteral[],
  indiceDesde: number = 0
): { distancia: number; indice: number } | null => {
  if (puntos.length < 2) return null;
  const desde = Math.min(Math.max(indiceDesde - VENTANA_ATRAS_SEGMENTOS, 0), puntos.length - 2);
  let minimo = Infinity, mejorIndice = desde;
  for (let i = desde; i < puntos.length - 1; i++) {
    const d = distanciaPuntoASegmentoMetros(p, puntos[i], puntos[i + 1]);
    if (d < minimo) { minimo = d; mejorIndice = i; }
  }
  return { distancia: minimo, indice: mejorIndice };
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

// Proyección de un punto sobre el segmento a-b: distancia y el punto proyectado (no
// sólo la distancia, a diferencia de distanciaPuntoASegmentoMetros de arriba — se
// necesita el punto para poder recortar la polyline ahí). Función separada a propósito:
// no se reutiliza ni se modifica distanciaPuntoASegmentoMetros, que usa el rerouting real.
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

// Recorta `polyline` para mostrar sólo desde cerca del vehículo hasta el final, con un
// margen de continuidad detrás. `indiceMinimo` es la clave de la monotonía: la búsqueda
// del punto más cercano nunca mira tramos anteriores a él, así que el arranque visible
// nunca "salta" hacia atrás por una lectura de GPS momentáneamente imprecisa — sólo
// puede avanzar o quedarse, nunca retroceder, mientras sea la MISMA ruta (ver el efecto
// de más abajo, que reinicia indiceMinimo a 0 cuando rutaPolylineRef cambia de verdad).
const recortarRutaDesdeVehiculo = (
  polyline: google.maps.LatLngLiteral[],
  posicion: google.maps.LatLngLiteral,
  margenMetros: number,
  indiceMinimo: number
): { puntos: google.maps.LatLngLiteral[]; indice: number } => {
  if (polyline.length < 2) return { puntos: polyline, indice: 0 };
  const desde = Math.min(Math.max(indiceMinimo - VENTANA_ATRAS_SEGMENTOS, 0), polyline.length - 2);
  let mejorIndice = desde, mejorDistancia = Infinity, mejorPunto = polyline[desde];
  for (let i = desde; i < polyline.length - 1; i++) {
    const { distancia, punto } = proyeccionEnSegmento(posicion, polyline[i], polyline[i + 1]);
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia; mejorIndice = i; mejorPunto = punto;
    }
  }
  // Retroceder margenMetros desde el punto más cercano, para continuidad visual — nunca
  // cruza por debajo de `desde` (mismo límite que ya impidió mirar tramos anteriores).
  let restante = margenMetros;
  let indice = mejorIndice;
  let punto = mejorPunto;
  while (restante > 0 && indice > desde) {
    const inicioSegmento = polyline[indice];
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
    indice -= 1;
  }
  // El índice que se devuelve para el próximo tick es el del punto más cercano REAL
  // (mejorIndice), no el retrocedido por el margen — el margen es sólo cosmético.
  return { puntos: [punto, ...polyline.slice(indice + 1)], indice: mejorIndice };
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
  /** Coordenada Y real (viewport, getBoundingClientRect().top) del borde superior del
   *  panel flotante inferior (viaje-activo) — usado sólo en modoNavegacion para que el
   *  camión no quede centrado en la pantalla completa, sino pegado arriba del panel (ver
   *  puntoConOffsetVerticalPx/calcularOffsetVerticalCamara). undefined (por defecto): sin
   *  panel conocido, comportamiento de siempre — centrado, sin offset. */
  panelTopPx?: number;
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
  panelTopPx,
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
  // Velocidad real (metros/milisegundo) entre los últimos dos fixes GPS reales — se
  // recalcula en cada animarHaciaPosicion y sólo se usa para la extrapolación acotada de
  // pasoAnimacion cuando el PRÓXIMO fix tarda más que la animación en curso.
  const velocidadMPorMsRef      = useRef(0);
  const ultimoTickTsRef         = useRef<number | null>(null);
  // Última vez (performance.now()) que pasoAnimacion efectivamente escribió sobre la
  // cámara — gate de frecuencia, ver INTERVALO_MIN_CAMARA_MS. El marcador/
  // posicionVisualActualRef NO pasan por este gate: siguen actualizándose en cada frame.
  const ultimaActualizacionCamaraTsRef = useRef(0);
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

    if (choferMarkerRef.current) {
      choferMarkerRef.current.setPosition({ lat: latActual, lng: lngActual });
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
  }, [modoNavegacion, moverCamara, calcularOffsetVerticalCamara]);
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
    origin: string | google.maps.LatLngLiteral,
    destinationStr: string,
    waypoints: google.maps.DirectionsWaypoint[],
    fallbackPuntos: google.maps.LatLngLiteral[],
    onSuccess?: (result: google.maps.DirectionsResult) => void,
    onSettled?: () => void
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
    diagLog(`[TILA_NAV_DIAG] calcularRuta requestId=${miRequestId} origen=${origenDiag} destino=${destinationStr} waypoints=${waypoints.length} t=${Math.round(performance.now())}`);

    directionsServiceRef.current.route(
      {
        origin,
        destination: `${destinationStr}, Argentina`,
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        diagLog(`[TILA_NAV_DIAG] respuesta Directions requestId=${miRequestId} status=${status} obsoleta=${miRequestId !== rutaRequestIdRef.current} t=${Math.round(performance.now())}`);
        if (miRequestId !== rutaRequestIdRef.current) return; // respuesta obsoleta
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
          const puntosOverview  = (result.routes?.[0]?.overview_path ?? []).map(p => ({ lat: p.lat(), lng: p.lng() }));
          const puntosDetallados = construirPolylineDetalladaDesdeRuta(result);
          rutaPolylineRef.current = puntosDetallados.length >= 2 ? puntosDetallados : puntosOverview;
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
          setDirections(result);
          setPolylinePuntos([]); // limpiar fallback si Directions funcionó
          encuadrarDesdeRuta(result);
          if (onSuccess) onSuccess(result);
        } else {
          // FALLBACK: dibujar Polyline simple con los puntos que tenemos — también sirve
          // como polyline de referencia para medir desvío mientras no haya Directions real.
          rutaPolylineRef.current = fallbackPuntos;
          aplicarPolylineFallback(fallbackPuntos);
        }
        if (onSettled) onSettled();
      }
    );
  }, [aplicarPolylineFallback, encuadrarDesdeRuta]);

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

          calcularRuta(origin, destination, waypoints, fallback);
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

      calcularRuta(originParam, destinoFinal, [], fallback);
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
  // Candidatos a reenganche: fixes RECHAZADOS pero coherentes entre sí, acumulados sólo
  // mientras hace mucho que no se acepta ninguno — ver UMBRAL_MS_SIN_ACEPTAR_PARA_REENGANCHE.
  const candidatosReenganceRef = useRef<google.maps.LatLngLiteral[]>([]);

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

    // Primer fix real de la sesión (todavía no hay base): se acepta incondicionalmente
    // si es finito, y se convierte en la base — no pasa por evaluarConsistenciaFix
    // (que de todos modos ya trata anterior=null como "aceptar", esto sólo lo hace
    // explícito y logueado con su propio tag, como pediste).
    if (!ultimoFixValidoRef.current) {
      ultimoFixValidoRef.current    = nuevo;
      ultimoFixValidoTsRef.current  = ahora;
      fixValidoActualRef.current    = nuevo;
      candidatosReenganceRef.current = [];
      diagLog(`[TILA_NAV_DIAG] gps-bootstrap PRIMER_FIX_ACEPTADO lat=${lat.toFixed(6)} lng=${lng.toFixed(6)} t=${Math.round(performance.now())}`);
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
      if (candidatos.length >= FIXES_REENGANCHE_REQUERIDOS) {
        const baseAnterior = ultimoFixValidoRef.current;
        const distanciaReemplazo = distanciaMetros(baseAnterior, nuevo);
        penultimoFixValidoRef.current = null; // sin tendencia previa confiable tras un reenganche
        ultimoFixValidoRef.current    = nuevo;
        ultimoFixValidoTsRef.current  = ahora;
        fixValidoActualRef.current    = nuevo;
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
  const dispararCalculoNavRef = useRef<() => void>(() => {});

  // Detección de desvío real: lecturas GPS consecutivas por encima de
  // UMBRAL_DESVIO_RUTA_METROS respecto de rutaPolylineRef, más un cooldown mínimo
  // entre recálculos disparados por desvío (cambioDeParadas/primerGps NO respetan
  // este cooldown — son cambios legítimos de la ruta en sí, no "ruido").
  const lecturasFueraDeRutaRef     = useRef(0);
  const ultimoRecalculoDesvioTsRef = useRef(0);

  const dispararCalculoNav = useCallback(() => {
    if (calculandoRutaNavRef.current) {
      recalculoPendienteNavRef.current = true;
      return;
    }
    const latLng = ultimoLatLngConocidoRef.current;
    if (!latLng) return;
    const pendientes = ultimasParadasConocidasRef.current.filter(p => p.estado !== "completada");
    if (pendientes.length === 0) return; // no queda ningún tramo por recorrer

    calculandoRutaNavRef.current    = true;
    diagLog(`[TILA_NAV_DIAG] dispararCalculoNav: calculandoRutaNavRef=true origen=${latLng.lat.toFixed(6)},${latLng.lng.toFixed(6)} t=${Math.round(performance.now())}`);
    paradasPendientesKeyRef.current = pendientes.map(p => p.direccion).join("|");

    const destino   = pendientes[pendientes.length - 1].direccion;
    const waypoints = pendientes.slice(0, -1).map(p => ({ location: `${p.direccion}, Argentina`, stopover: true }));
    const fallback: google.maps.LatLngLiteral[] = [latLng];
    paradasCoords.forEach(c => { if (c) fallback.push(c); });

    calcularRuta({ lat: latLng.lat, lng: latLng.lng }, destino, waypoints, fallback, undefined, () => {
      calculandoRutaNavRef.current = false;
      if (recalculoPendienteNavRef.current) {
        recalculoPendienteNavRef.current = false;
        dispararCalculoNavRef.current();
      }
    });
  }, [calcularRuta, paradasCoords]);
  useEffect(() => {
    dispararCalculoNavRef.current = dispararCalculoNav;
  }, [dispararCalculoNav]);

  useEffect(() => {
    if (!isLoaded || !modoNavegacion || !tieneParadas || modoMultiChofer) return;
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
        dispararCalculoNav();
      }
      return;
    }

    // El desvío sólo se evalúa cuando no hay ya un motivo legítimo distinto para
    // recalcular (cambio de paradas / primer GPS) — evita contar lecturas "fuera de
    // ruta" contra una polyline que de todos modos está por reemplazarse.
    let desvioConfirmado = false;
    if (!cambioDeParadas && !primerGps) {
      // Búsqueda con progreso: sólo desde unos tramos antes del índice compartido en
      // adelante (VENTANA_ATRAS_SEGMENTOS), no la polyline completa desde el principio —
      // evita que un tramo ya recorrido o una calle paralela "gane" la distancia mínima.
      const resultado   = distanciaMinAPolyline(fix, rutaPolylineRef.current, indiceRutaVisibleRef.current);
      const distancia    = resultado?.distancia ?? null;
      const fueraDeRuta = distancia !== null && distancia >= UMBRAL_DESVIO_RUTA_METROS;
      const desvioObvio = distancia !== null && distancia >= UMBRAL_DESVIO_INMEDIATO_METROS;
      if (resultado) indiceRutaVisibleRef.current = resultado.indice;
      lecturasFueraDeRutaRef.current = fueraDeRuta ? lecturasFueraDeRutaRef.current + 1 : 0;
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
      diagLog(`[TILA_NAV_DIAG] desvio-efecto distanciaAPolyline=${distancia === null ? "null" : Math.round(distancia)} lecturasFueraDeRuta=${lecturasFueraDeRutaRef.current} desvioConfirmado=${desvioConfirmado} t=${Math.round(performance.now())}`);
    }

    if (!cambioDeParadas && !primerGps && !desvioConfirmado) return; // nada relevante cambió

    // Al confirmarse un desvío real, se limpia la traza visible YA, antes de pedirle la
    // ruta nueva a Directions — así no queda ningún resto de la ruta anterior dibujado
    // durante el (breve) viaje de ida y vuelta a la API. El efecto de recorte visual
    // vuelve a dibujar en cuanto la ruta nueva aterriza (dispara por el cambio de
    // `directions`/`polylinePuntos`).
    if (desvioConfirmado) setRutaVisibleDesdeVehiculo([]);

    diagLog(`[TILA_NAV_DIAG] desvio-efecto DISPARANDO dispararCalculoNav cambioDeParadas=${cambioDeParadas} primerGps=${primerGps} desvioConfirmado=${desvioConfirmado} t=${Math.round(performance.now())}`);
    primerGpsMultietapaRef.current = true;
    dispararCalculoNav();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, modoNavegacion, tieneParadas, modoMultiChofer, lat, lng, JSON.stringify(paradas?.map(p => ({ d: p.direccion, e: p.estado }))), dispararCalculoNav]);

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

  // ─── Recorte visual de la traza (sólo representación) ──────────────────────
  // Sólo lee rutaPolylineRef.current (no la modifica) y recalcula la porción visible
  // en cada tick de GPS — nada de esto toca calcularRuta/dispararCalculoNav/rerouting,
  // ni la detección de desvío o maniobras (que siguen leyendo rutaPolylineRef completa).
  useEffect(() => {
    if (!modoNavegacion || modoMultiChofer) return;
    // Congela la traza también ante un fix rechazado (mismo criterio que "recálculo en
    // vuelo" más abajo): mejor mantener el último trazo válido que recortar contra una
    // posición GPS descartada por implausible.
    const fix = fixValidoActualRef.current;
    if (!fix) return;
    // Mientras haya un recálculo en vuelo, rutaPolylineRef todavía es la ruta VIEJA (está
    // por reemplazarse) — seguir recortándola contra la posición actual sólo mostraría un
    // trazo cada vez más alejado/incorrecto durante la espera a Directions, mucho más
    // notorio a alta velocidad (el vehículo se aleja más rápido mientras se espera la
    // respuesta). Se congela la última traza ya mostrada; en cuanto la ruta nueva
    // reemplace a rutaPolylineRef, este efecto corre de nuevo (dispara por el cambio de
    // `directions`) y muestra sólo la ruta nueva, nunca una mezcla de ambas.
    if (calculandoRutaNavRef.current) return;
    const polyline = rutaPolylineRef.current;
    if (polyline.length < 2) {
      setRutaVisibleDesdeVehiculo([]);
      return;
    }
    // Ruta realmente nueva (referencia distinta — rutaPolylineRef se reasigna a un
    // array nuevo en cada recálculo, ver calcularRuta) → reinicia el índice monotónico
    // COMPARTIDO (también usado por la detección de desvío, ver ese efecto más arriba).
    if (polyline !== ultimaRutaRefVistaRef.current) {
      ultimaRutaRefVistaRef.current = polyline;
      indiceRutaVisibleRef.current = 0;
      diagLog(`[TILA_NAV_DIAG] recorte-efecto: ruta nueva detectada, indiceRutaVisibleRef reseteado a 0 puntosRuta=${polyline.length} t=${Math.round(performance.now())}`);
    }
    const { puntos, indice } = recortarRutaDesdeVehiculo(
      polyline, fix, MARGEN_RUTA_DETRAS_METROS, indiceRutaVisibleRef.current
    );
    indiceRutaVisibleRef.current = indice;
    setRutaVisibleDesdeVehiculo(puntos);
    diagLog(`[TILA_NAV_DIAG] recorte-efecto: rutaVisibleDesdeVehiculo REEMPLAZADA puntosVisibles=${puntos.length} indice=${indice} primerPunto=${puntos[0] ? `${puntos[0].lat.toFixed(6)},${puntos[0].lng.toFixed(6)}` : "n/a"} t=${Math.round(performance.now())}`);
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
        + `headingGps=${headingValido(heading) ?? "null"} headingCalculado=${diagHeadingCalculadoRef.current ?? "null"} `
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
  const pasosAnunciadosRef   = useRef<Set<number>>(new Set());
  const rutaKeyVozRef        = useRef<string | null>(null);
  // Salidas/bifurcaciones de autopista (maneuver "ramp-*"/"fork-*") — dos avisos por
  // step en vez de uno: 0 = ninguno todavía, 1 = aviso lejano ya dado, 2 = aviso
  // cercano ya dado (no se vuelve a anunciar). Set aparte de pasosAnunciadosRef porque
  // acá cada step puede pasar por dos anuncios, no uno solo.
  const pasosSalidaAvisadosRef = useRef<Map<number, 0 | 1 | 2>>(new Map());

  // "Ruta recalculada" — cualquier cambio de `directions` DESPUÉS del primero (el primer
  // cálculo es el arranque normal del viaje, no un recálculo real).
  useEffect(() => {
    if (!onAnuncioVoz || !modoNavegacion || modoMultiChofer) return;
    if (!directions) return;
    const previa = vozDirectionsPrevRef.current;
    vozDirectionsPrevRef.current = directions;
    if (previa === null || previa === directions) return;
    onAnuncioVoz("Ruta recalculada.");
  }, [directions, modoNavegacion, modoMultiChofer, onAnuncioVoz]);

  // Giros próximos — lee los steps de Directions (datos que calcularRuta ya produce, sin
  // recalcular nada acá) y anuncia una maniobra por vez cuando la posición actual entra
  // dentro de UMBRAL_AVISO_MANIOBRA_METROS de su punto de inicio. Sólo derecha/izquierda —
  // "no quiero mensajes innecesarios". pasosAnunciadosRef se reinicia cuando cambia la
  // ruta vigente, para poder narrar de nuevo tras un recálculo.
  useEffect(() => {
    if (!onAnuncioVoz || !modoNavegacion || modoMultiChofer) return;
    if (!directions || !lat || !lng) return;

    const pasos = (directions.routes?.[0]?.legs ?? []).flatMap(l => l.steps ?? []);
    const rutaKey = `${pasos.length}-${directions.routes?.[0]?.overview_path?.length ?? 0}`;
    if (rutaKeyVozRef.current !== rutaKey) {
      rutaKeyVozRef.current = rutaKey;
      pasosAnunciadosRef.current = new Set();
      pasosSalidaAvisadosRef.current = new Map();
    }

    for (let i = 1; i < pasos.length; i++) {
      const maniobra = pasos[i].maneuver ?? "";
      const esSalida = maniobra.startsWith("ramp-") || maniobra.startsWith("fork-");

      if (esSalida) {
        const estado = pasosSalidaAvisadosRef.current.get(i) ?? 0;
        if (estado >= 2) continue; // ya se dieron los dos avisos para este step
        const inicioPaso = pasos[i].start_location;
        if (!inicioPaso) continue;
        const lado = maniobra.includes("right") ? "derecha" : maniobra.includes("left") ? "izquierda" : null;
        if (!lado) continue;
        const distancia = distanciaMetros({ lat, lng }, { lat: inicioPaso.lat(), lng: inicioPaso.lng() });
        if (estado === 0 && distancia <= UMBRAL_AVISO_SALIDA_LEJANO_METROS) {
          onAnuncioVoz(`En 200 metros, tomá la salida a la ${lado}.`);
          pasosSalidaAvisadosRef.current.set(i, 1);
          break; // una sola maniobra anunciada por tick, evita ráfagas
        } else if (estado === 1 && distancia <= UMBRAL_AVISO_SALIDA_CERCANO_METROS) {
          onAnuncioVoz(`En 65 metros, tomá la salida a la ${lado}.`);
          pasosSalidaAvisadosRef.current.set(i, 2);
          break;
        }
        continue;
      }

      if (pasosAnunciadosRef.current.has(i)) continue;
      const inicioPaso = pasos[i].start_location;
      if (!inicioPaso) continue;
      const distancia = distanciaMetros({ lat, lng }, { lat: inicioPaso.lat(), lng: inicioPaso.lng() });
      if (distancia > UMBRAL_AVISO_MANIOBRA_METROS) continue;

      const metros = Math.round(distancia / 10) * 10;
      if (maniobra.includes("right")) {
        onAnuncioVoz(`En ${metros} metros doblá a la derecha.`);
        pasosAnunciadosRef.current.add(i);
        break; // una sola maniobra anunciada por tick, evita ráfagas
      } else if (maniobra.includes("left")) {
        onAnuncioVoz(`En ${metros} metros girá a la izquierda.`);
        pasosAnunciadosRef.current.add(i);
        break;
      }
    }
  }, [directions, lat, lng, modoNavegacion, modoMultiChofer, onAnuncioVoz]);

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
    animarHaciaPosicion(fix.lat, fix.lng, headingValido(heading));
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
    // Inclinación/rotación por gesto sólo en Viaje Activo — en las vistas de
    // sólo lectura (panel-cliente/panel-chofer) modoNavegacion es false y el
    // mapa queda plano, sin necesidad de ninguna regla de estilo adicional.
    tiltInteractionEnabled: modoNavegacion,
    headingInteractionEnabled: modoNavegacion,
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
