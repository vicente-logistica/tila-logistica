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

const estiloMapa = [
  { elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a1a" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2d2d2d" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#374151" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#4b5563" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2937" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#111827" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

const centroArgentina = { lat: -34.6037, lng: -58.3816 };
const LABELS = ["A", "B", "C", "D", "E", "F"];

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
}

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
}: MapaTILAProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: LIBRARIES,
  });

  const mapRef               = useRef<google.maps.Map | null>(null);
  const choferMarkerRef      = useRef<google.maps.Marker | null>(null);
  const geocoderRef          = useRef<google.maps.Geocoder | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

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

  // ─── fitBounds ────────────────────────────────────────────────────────────
  const ajustarZoom = useCallback((puntos: google.maps.LatLngLiteral[]) => {
    if (!mapRef.current || puntos.length === 0) return;
    if (puntos.length === 1) {
      mapRef.current.setCenter(puntos[0]);
      mapRef.current.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    puntos.forEach(p => bounds.extend(p));
    mapRef.current.fitBounds(bounds, { top: 60, right: 40, bottom: 60, left: 40 });
  }, []);

  // ─── Aplicar polyline fallback con los puntos disponibles ─────────────────
  const aplicarPolylineFallback = useCallback((puntos: google.maps.LatLngLiteral[]) => {
    const validos = puntos.filter(Boolean);
    if (validos.length < 2) return;
    setPolylinePuntos(validos);
    setDiagnostico(d => ({ ...d, polylineFallback: true, puntosPolyline: validos.length }));
    ajustarZoom(validos);
  }, [ajustarZoom]);

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

  // ─── Calcular ruta con DirectionsService ──────────────────────────────────
  const calcularRuta = useCallback((
    origin: string | google.maps.LatLngLiteral,
    destinationStr: string,
    waypoints: google.maps.DirectionsWaypoint[],
    fallbackPuntos: google.maps.LatLngLiteral[],
    onSuccess?: (result: google.maps.DirectionsResult) => void
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
          if (onSuccess) onSuccess(result);
        } else {
          // FALLBACK: dibujar Polyline simple con los puntos que tenemos
          aplicarPolylineFallback(fallbackPuntos);
        }
      }
    );
  }, [aplicarPolylineFallback]);

  // ─── Inicializar geocoder ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || modoMultiChofer) return;
    geocoderRef.current = new google.maps.Geocoder();
  }, [isLoaded, modoMultiChofer]);

  // ─── MODO MULTIETAPA ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || !tieneParadas || modoMultiChofer) return;
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
          ajustarZoom(validos);

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
  useEffect(() => {
    if (!isLoaded || tieneParadas || modoMultiChofer) return;
    if (!origen || !destino) return;
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();

    setDiagnostico(d => ({
      ...d,
      modoActivo: lat && lng ? "simple-con-gps" : "simple-sin-gps",
      tieneParadas: false,
    }));
    setDirections(null);
    setPolylinePuntos([]);

    // Con GPS + paradaActiva → ruta directa desde posición del chofer
    if (lat && lng && paradaActivaDireccion) {
      geocodificar(paradaActivaDireccion, (paradaCoords) => {
        setDiagnostico(d => ({ ...d, geocodingDestino: paradaCoords ? "OK" : "FAIL" }));
        const fallback: google.maps.LatLngLiteral[] = [{ lat: lat!, lng: lng! }];
        if (paradaCoords) fallback.push(paradaCoords);
        calcularRuta({ lat, lng }, paradaActivaDireccion, [], fallback);
        ajustarZoom(fallback);
        if (paradaCoords) setDestinoCoords(paradaCoords);
      });
      return;
    }

    // Sin GPS → geocodificar origen y destino
    let origenResuelto:  google.maps.LatLngLiteral | null = lat && lng ? { lat, lng } : null;
    let destinoResuelto: google.maps.LatLngLiteral | null = null;
    let pendientes = 0;

    const intentarRuta = () => {
      if (pendientes > 0) return;
      const fallback: google.maps.LatLngLiteral[] = [];
      if (origenResuelto)  fallback.push(origenResuelto);
      if (destinoResuelto) fallback.push(destinoResuelto);
      ajustarZoom(fallback);

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
  }, [isLoaded, tieneParadas, modoMultiChofer, origen, destino, paradaActivaDireccion]);

  // ─── Actualizar ruta cuando el chofer se mueve ────────────────────────────
  const prevLatRef = useRef<number | null>(null);
  const prevLngRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isLoaded || !lat || !lng || !paradaActivaDireccion || tieneParadas || modoMultiChofer) return;
    // Solo recalcular si la posición cambió más de ~50 metros
    if (prevLatRef.current !== null) {
      const dlat = Math.abs(lat - (prevLatRef.current ?? 0));
      const dlng = Math.abs(lng - (prevLngRef.current ?? 0));
      if (dlat < 0.0005 && dlng < 0.0005) return;
    }
    prevLatRef.current = lat;
    prevLngRef.current = lng;

    const fallback: google.maps.LatLngLiteral[] = [{ lat, lng }];
    geocodificar(paradaActivaDireccion, (coords) => {
      if (coords) fallback.push(coords);
      calcularRuta({ lat, lng }, paradaActivaDireccion, [], fallback);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  // ─── Marcador chofer ──────────────────────────────────────────────────────
  const actualizarMarcadorChofer = useCallback((mapa: google.maps.Map) => {
    if (!lat || !lng || modoMultiChofer) return;
    if (!choferMarkerRef.current) {
      choferMarkerRef.current = new google.maps.Marker({
        map: mapa,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 7,
          fillColor: "#facc15",
          fillOpacity: 1,
          strokeColor: "#000000",
          strokeWeight: 2,
        },
        title: "Chofer",
        zIndex: 10,
      });
    }
    choferMarkerRef.current.setPosition({ lat, lng });
  }, [lat, lng, modoMultiChofer]);

  const onMapLoad = useCallback((mapa: google.maps.Map) => {
    mapRef.current = mapa;
    if (!modoMultiChofer) actualizarMarcadorChofer(mapa);
  }, [actualizarMarcadorChofer, modoMultiChofer]);

  const onMapLoadMulti = useCallback((mapa: google.maps.Map) => {
    mapRef.current = mapa;
    if (!choferes || choferes.length === 0) return;
    if (choferes.length === 1) {
      mapa.setCenter({ lat: choferes[0].lat, lng: choferes[0].lng });
      mapa.setZoom(13);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    choferes.forEach(c => bounds.extend({ lat: c.lat, lng: c.lng }));
    mapa.fitBounds(bounds, { top: 60, right: 40, bottom: 60, left: 40 });
  }, [choferes]);

  useEffect(() => {
    if (!mapRef.current || !lat || !lng || modoMultiChofer) return;
    actualizarMarcadorChofer(mapRef.current);
    mapRef.current.panTo({ lat, lng });
  }, [lat, lng, actualizarMarcadorChofer, modoMultiChofer]);

  // ─── Color parada ─────────────────────────────────────────────────────────
  const colorPorEstado = (estado: string) => {
    if (estado === "completada") return "#22c55e";
    if (estado === "en_curso")   return "#facc15";
    return "#6b7280";
  };

  const centroInicial = (): google.maps.LatLngLiteral => {
    if (modoMultiChofer && choferes!.length > 0) {
      const latP = choferes!.reduce((a, c) => a + c.lat, 0) / choferes!.length;
      const lngP = choferes!.reduce((a, c) => a + c.lng, 0) / choferes!.length;
      return { lat: latP, lng: lngP };
    }
    if (lat && lng) return { lat, lng };
    return centroArgentina;
  };

  const zoomInicial = () => {
    if (modoMultiChofer) return choferes!.length === 1 ? 13 : 6;
    if (lat && lng)      return 14;
    return 10;
  };

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
    <div style={{ width: "100%" }}>
      <GoogleMap
        mapContainerStyle={contenedorEstilo}
        center={centroInicial()}
        zoom={zoomInicial()}
        options={{
          styles: estiloMapa,
          disableDefaultUI: true,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
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
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 8,
              fillColor: colorChoferPorEstado(chofer.estado),
              fillOpacity: 1,
              strokeColor: "#000000",
              strokeWeight: 2,
            }}
            label={{ text: String(index + 1), color: "#000000", fontWeight: "bold", fontSize: "11px" }}
            zIndex={10}
          />
        ))}

        {/* Marcadores multietapa */}
        {!modoMultiChofer && tieneParadas &&
          paradas!.map((parada, index) => {
            const coords = paradasCoords[index];
            if (!coords) return null;
            return (
              <Marker
                key={index}
                position={coords}
                title={`${LABELS[index] || index}: ${parada.direccion}`}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 11,
                  fillColor: colorPorEstado(parada.estado),
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 2,
                }}
                label={{ text: LABELS[index] || String(index), color: "#ffffff", fontWeight: "bold", fontSize: "12px" }}
              />
            );
          })}

        {/* Marcadores simples */}
        {!modoMultiChofer && !tieneParadas && origenCoords && (
          <Marker
            position={origenCoords}
            title={`Retiro: ${origen}`}
            icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#3b82f6", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 }}
            label={{ text: "A", color: "#ffffff", fontWeight: "bold", fontSize: "12px" }}
          />
        )}
        {!modoMultiChofer && !tieneParadas && destinoCoords && (
          <Marker
            position={destinoCoords}
            title={`Entrega: ${destino}`}
            icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#22c55e", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 }}
            label={{ text: "B", color: "#ffffff", fontWeight: "bold", fontSize: "12px" }}
          />
        )}

        {/* Ruta Directions (principal) */}
        {!modoMultiChofer && directions && (
          <DirectionsRenderer
            key={`dir-${directions.request?.origin?.toString()}`}
            directions={directions}
            options={{
              suppressMarkers: true,
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