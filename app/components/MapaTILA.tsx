"use client";

import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  DirectionsRenderer,
  Polyline,
} from "@react-google-maps/api";
import { useCallback, useEffect, useRef, useState } from "react";

const LIBRARIES: ("places" | "geometry" | "drawing")[] = [];

const centroArgentina = { lat: -34.6037, lng: -58.3816 };
const LABELS = ["A", "B", "C", "D", "E", "F"];

// Zoom que ya usaba el seguimiento automático en modoNavegacion (no es un valor nuevo).
// Sólo se aplica cuando el usuario reactiva el seguimiento con el botón "Mi ubicación".
const ZOOM_SEGUIMIENTO = 15;

// Distancia mínima que debe moverse el chofer respecto del origen usado en el último
// cálculo de ruta para considerar que hay un "desvío real y significativo" y volver a
// llamar a Directions. Por debajo de este umbral, un tick de GPS mueve el marcador pero
// nunca recalcula la ruta — evita llamadas innecesarias a Google Maps y parpadeo del trazo.
const UMBRAL_RECALCULO_RUTA_METROS = 300;

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

// Camión con semirremolque visto desde arriba — sin letra, no reemplaza ningún punto
// del recorrido, sólo indica la posición real del chofer.
const construirIconoChofer = (): google.maps.Icon => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="56" viewBox="0 0 36 56">
    <rect x="4" y="20" width="28" height="34" rx="3" fill="#facc15" stroke="#111827" stroke-width="2"/>
    <rect x="2" y="44" width="4" height="6" rx="1" fill="#111827"/>
    <rect x="30" y="44" width="4" height="6" rx="1" fill="#111827"/>
    <rect x="8" y="2" width="20" height="20" rx="3" fill="#facc15" stroke="#111827" stroke-width="2"/>
    <rect x="11" y="5" width="14" height="6" rx="1.5" fill="#111827" opacity="0.55"/>
    <rect x="15" y="19" width="6" height="4" fill="#111827"/>
  </svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  return { url, scaledSize: new google.maps.Size(30, 46), anchor: new google.maps.Point(15, 23) };
};

export default function MapaTILA({
  lat,
  lng,
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

  const [origenCoords,  setOrigenCoords]  = useState<google.maps.LatLngLiteral | null>(null);
  const [destinoCoords, setDestinoCoords] = useState<google.maps.LatLngLiteral | null>(null);
  const [paradasCoords, setParadasCoords] = useState<(google.maps.LatLngLiteral | null)[]>([]);
  const [directions,    setDirections]    = useState<google.maps.DirectionsResult | null>(null);

  // ── Polyline fallback cuando DirectionsService falla ─────────────────────
  const [polylinePuntos, setPolylinePuntos] = useState<google.maps.LatLngLiteral[]>([]);

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

  // ─── Único punto que puede tocar el mapa imperativamente ──────────────────
  const moverCamara = useCallback((mover: () => void) => {
    if (!mapRef.current) return;
    programaticoRef.current = true;
    mover();
    setTimeout(() => { programaticoRef.current = false; }, 0);
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
    moverCamara(() => aplicarEncuadre(puntos));
  }, [modoNavegacion, moverCamara, aplicarEncuadre]);

  // Encuadre bajo demanda — botón "Ver recorrido completo". Ignora el flag de una-sola-vez
  // porque es una acción explícita del usuario, no un recentrado automático.
  const encuadrarPuntosForzado = useCallback((puntos: google.maps.LatLngLiteral[]) => {
    if (puntos.length === 0) return;
    moverCamara(() => aplicarEncuadre(puntos));
  }, [moverCamara, aplicarEncuadre]);

  // Seguimiento GPS del chofer en modoNavegacion — sólo mueve la cámara mientras
  // siguiendoChoferRef sea true (arranca en false; lo activa el botón "Mi ubicación").
  const seguirChofer = useCallback((latChofer: number, lngChofer: number) => {
    if (!siguiendoChoferRef.current) return;
    moverCamara(() => {
      mapRef.current!.setCenter({ lat: latChofer, lng: lngChofer });
      if (mapRef.current!.getZoom() !== ZOOM_SEGUIMIENTO) mapRef.current!.setZoom(ZOOM_SEGUIMIENTO);
    });
  }, [moverCamara]);

  // Seguimiento continuo en vistas de sólo lectura (panel-cliente/admin, preview de panel-chofer)
  // — comportamiento sin cambios respecto al actual: el punto del chofer siempre se sigue.
  const seguirEnVistaLectura = useCallback((latChofer: number, lngChofer: number) => {
    moverCamara(() => { mapRef.current!.panTo({ lat: latChofer, lng: lngChofer }); });
  }, [moverCamara]);

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
    setDiagnostico(d => ({ ...d, directionsStatus: "calculando..." }));

    directionsServiceRef.current.route(
      {
        origin,
        destination: `${destinationStr}, Argentina`,
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        setDiagnostico(d => ({ ...d, directionsStatus: status }));
        if (status === "OK" && result) {
          setDirections(result);
          setPolylinePuntos([]); // limpiar fallback si Directions funcionó
          encuadrarDesdeRuta(result);
          if (onSuccess) onSuccess(result);
        } else {
          // FALLBACK: dibujar Polyline simple con los puntos que tenemos
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
  // paradas pendientes (se completó una), llega el primer GPS, o el chofer recorrió
  // más de UMBRAL_RECALCULO_RUTA_METROS desde el origen del último cálculo — esto
  // último es distancia recorrida, no detección de desvío: se repite aunque el
  // chofer esté siguiendo la ruta correctamente. Nunca en cada tick mínimo de GPS.
  const paradasPendientesKeyRef  = useRef<string | null>(null);
  const primerGpsMultietapaRef   = useRef(false);
  const origenUltimoCalculoRef   = useRef<google.maps.LatLngLiteral | null>(null);

  // Protección contra cálculos simultáneos: mientras calculandoRutaNavRef es true,
  // cualquier disparador nuevo sólo marca recalculoPendienteNavRef en vez de lanzar
  // una segunda llamada a Directions en paralelo. Al terminar la llamada en curso
  // (éxito o fallback) se libera calculandoRutaNavRef y, si quedó un pendiente, se
  // dispara inmediatamente un nuevo cálculo con la posición/paradas MÁS RECIENTES
  // conocidas (ultimoLatLngConocidoRef/ultimasParadasConocidasRef, actualizadas en
  // cada corrida del efecto) — así ningún disparador se pierde y nunca hay dos
  // llamadas en vuelo al mismo tiempo.
  const calculandoRutaNavRef       = useRef(false);
  const recalculoPendienteNavRef   = useRef(false);
  const ultimoLatLngConocidoRef    = useRef<google.maps.LatLngLiteral | null>(null);
  const ultimasParadasConocidasRef = useRef<ParadaMapa[]>([]);
  // Referencia estable a la versión más reciente de dispararCalculoNav — permite que
  // el propio callback se re-invoque a sí mismo al drenar un pendiente sin un
  // auto-referencia directa a la const (evita el ciclo de declaración) y de paso
  // nunca queda con una versión vieja del closure entre renders.
  const dispararCalculoNavRef = useRef<() => void>(() => {});

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
    paradasPendientesKeyRef.current = pendientes.map(p => p.direccion).join("|");
    origenUltimoCalculoRef.current  = latLng;

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
    if (!lat || !lng) return;

    // Siempre al día, se use o no en este tick — es lo que lee dispararCalculoNav
    // cuando drena un recálculo pendiente después de que termine el que está en vuelo.
    ultimoLatLngConocidoRef.current    = { lat, lng };
    ultimasParadasConocidasRef.current = paradas!;

    const pendientes = paradas!.filter(p => p.estado !== "completada");
    if (pendientes.length === 0) return; // no queda ningún tramo por recorrer

    const key = pendientes.map(p => p.direccion).join("|");
    const cambioDeParadas    = paradasPendientesKeyRef.current !== key;
    const primerGps          = !primerGpsMultietapaRef.current;
    const origenPrevio       = origenUltimoCalculoRef.current;
    const desvioSignificativo =
      !!origenPrevio && distanciaMetros(origenPrevio, { lat, lng }) >= UMBRAL_RECALCULO_RUTA_METROS;

    if (!cambioDeParadas && !primerGps && !desvioSignificativo) return; // nada relevante cambió

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

  // ─── Marcador chofer ──────────────────────────────────────────────────────
  const actualizarMarcadorChofer = useCallback((mapa: google.maps.Map) => {
    if (!lat || !lng || modoMultiChofer) return;
    if (!choferMarkerRef.current) {
      choferMarkerRef.current = new google.maps.Marker({
        map: mapa,
        icon: construirIconoChofer(),
        title: "Posición actual",
        zIndex: 10,
      });
    }
    choferMarkerRef.current.setPosition({ lat, lng });
  }, [lat, lng, modoMultiChofer]);

  const onMapLoad = useCallback((mapa: google.maps.Map) => {
    mapRef.current = mapa;
    if (!modoMultiChofer) actualizarMarcadorChofer(mapa);

    // Solo en modoNavegacion (Viaje Activo) el usuario puede "tomar control" de la cámara.
    // Panel Chofer nunca pasa modoNavegacion=true, así que este bloque no le afecta.
    if (modoNavegacion) {
      mapa.addListener("dragstart", () => {
        actualizarSeguimiento(false);
      });
      mapa.addListener("zoom_changed", () => {
        if (!programaticoRef.current) actualizarSeguimiento(false);
      });
    }
  }, [actualizarMarcadorChofer, modoMultiChofer, modoNavegacion, actualizarSeguimiento]);

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
    if (!mapRef.current || !lat || !lng || modoMultiChofer) return;
    // El marcador del chofer SIEMPRE se actualiza — el seguimiento de posición nunca se pierde,
    // se desacopla únicamente el movimiento de la cámara.
    actualizarMarcadorChofer(mapRef.current);
    if (modoNavegacion) {
      seguirChofer(lat, lng);
    } else {
      seguirEnVistaLectura(lat, lng);
    }
  }, [lat, lng, actualizarMarcadorChofer, modoMultiChofer, modoNavegacion, seguirChofer, seguirEnVistaLectura]);

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

  const volverAMiUbicacion = useCallback(() => {
    if (!lat || !lng) return;
    actualizarSeguimiento(true);
    seguirChofer(lat, lng);
  }, [lat, lng, seguirChofer, actualizarSeguimiento]);

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
        mapContainerStyle={contenedorEstilo}
        center={centroInicial}
        zoom={zoomInicial}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          // Mapa vectorial (mapId de Google Cloud) — el estilo ("TILA Vector Base")
          // vive en Cloud Console, ya no en un array `styles` local: con mapId
          // presente, Google ignora `styles` por completo. colorScheme sigue la
          // preferencia del sistema (claro/oscuro); todavía no hay selector propio
          // ni persistencia — eso queda para una etapa posterior.
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
          colorScheme: google.maps.ColorScheme.FOLLOW_SYSTEM,
          // Inclinación/rotación por gesto sólo en Viaje Activo — en las vistas de
          // sólo lectura (panel-cliente/panel-chofer) modoNavegacion es false y el
          // mapa queda plano, sin necesidad de ninguna regla de estilo adicional.
          tiltInteractionEnabled: modoNavegacion,
          headingInteractionEnabled: modoNavegacion,
          // Arrastre/zoom libres, sin el modo cooperativo (que exigiría dos dedos
          // incluso para arrastrar) en esta vista de mapa a pantalla completa.
          gestureHandling: "greedy",
        }}
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

        {/* Ruta Directions (principal) */}
        {!modoMultiChofer && directions && (
          <DirectionsRenderer
            key={`dir-${directions.request?.origin?.toString()}`}
            directions={directions}
            options={{
              suppressMarkers: true,
              // Sin esto, la librería hace su propio fitBounds cada vez que cambia `directions`,
              // moviendo la cámara por fuera de moverCamara()/siguiendoChoferRef.
              preserveViewport: true,
              polylineOptions: { strokeColor: "#facc15", strokeWeight: 5, strokeOpacity: 0.9 },
            }}
          />
        )}

        {/* Polyline fallback — siempre dibuja si Directions falla */}
        {!modoMultiChofer && !directions && polylinePuntos.length >= 2 && (
          <Polyline
            path={polylinePuntos}
            options={{
              strokeColor: "#facc15",
              strokeWeight: 4,
              strokeOpacity: 0.8,
              geodesic: true,
            }}
          />
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
            onClick={volverAMiUbicacion}
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
