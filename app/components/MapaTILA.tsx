"use client";

import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  DirectionsRenderer,
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

  // ── Flags para saber si ya intentamos calcular ruta ──────────────────────
  const rutaCalculadaRef = useRef(false);

  const modoMultiChofer = choferes && choferes.length > 0;
  // tieneParadas = hay array con al menos 2 puntos (multietapa real)
  const tieneParadas    = paradas && paradas.length >= 2;

  const contenedorEstilo = { width: "100%", height: altura, borderRadius: "1rem" };

  // ─── fitBounds — ajusta zoom para mostrar todos los puntos ───────────────
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

  // ─── Color marcador chofer por estado ────────────────────────────────────
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

  // ─── Geocodificar una dirección ───────────────────────────────────────────
  const geocodificar = useCallback(
    (direccion: string, callback: (coords: google.maps.LatLngLiteral | null) => void) => {
      if (!geocoderRef.current) return;
      geocoderRef.current.geocode(
        { address: `${direccion}, Argentina` },
        (results, status) => {
          if (status === "OK" && results?.[0]) {
            const loc = results[0].geometry.location;
            callback({ lat: loc.lat(), lng: loc.lng() });
          } else {
            console.warn(`[MapaTILA] Geocoding falló para "${direccion}": ${status}`);
            callback(null);
          }
        }
      );
    },
    []
  );

  // ─── Calcular ruta con DirectionsService ─────────────────────────────────
  const calcularRuta = useCallback((
    origin: string | google.maps.LatLngLiteral,
    destination: string,
    waypoints: google.maps.DirectionsWaypoint[] = [],
    onSuccess: (result: google.maps.DirectionsResult) => void
  ) => {
    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }
    directionsServiceRef.current.route(
      {
        origin,
        destination: typeof destination === "string" ? `${destination}, Argentina` : destination,
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === "OK" && result) {
          onSuccess(result);
        } else {
          console.warn(`[MapaTILA] DirectionsService falló: ${status}`, { origin, destination, waypoints });
        }
      }
    );
  }, []);

  // ─── Inicializar geocoder al cargar ───────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || modoMultiChofer) return;
    geocoderRef.current = new google.maps.Geocoder();
  }, [isLoaded, modoMultiChofer]);

  // ─── MODO MULTIETAPA: geocodificar paradas + ruta ─────────────────────────
  useEffect(() => {
    if (!isLoaded || !tieneParadas || modoMultiChofer) return;
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();

    rutaCalculadaRef.current = false;

    const coords: (google.maps.LatLngLiteral | null)[] = new Array(paradas!.length).fill(null);
    let pendientes = paradas!.length;

    paradas!.forEach((parada, index) => {
      geocodificar(parada.direccion, (result) => {
        coords[index] = result;
        pendientes--;
        if (pendientes === 0) {
          setParadasCoords([...coords]);

          // Ajustar zoom con todos los puntos geocodificados
          const validos = coords.filter(Boolean) as google.maps.LatLngLiteral[];
          if (lat && lng) validos.push({ lat, lng });
          ajustarZoom(validos);

          // Calcular ruta multietapa
          const origin      = `${paradas![0].direccion}, Argentina`;
          const destination = paradas![paradas!.length - 1].direccion;
          const waypoints   = paradas!.slice(1, -1).map(p => ({
            location: `${p.direccion}, Argentina`,
            stopover: true,
          }));
          calcularRuta(origin, destination, waypoints, (result) => {
            setDirections(result);
            rutaCalculadaRef.current = true;
          });
        }
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, tieneParadas, modoMultiChofer, paradas]);

  // ─── MODO SIMPLE: origen → destino (con o sin lat/lng) ───────────────────
  // Se activa cuando NO hay paradas multietapa y NO es modo multiChofer.
  // Funciona tanto con lat/lng del chofer como sin él (solo strings).
  useEffect(() => {
    if (!isLoaded || tieneParadas || modoMultiChofer) return;
    if (!origen || !destino) return;
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();

    rutaCalculadaRef.current = false;

    // Si tenemos GPS del chofer → ruta desde posición actual a próxima parada
    if (lat && lng && paradaActivaDireccion) {
      calcularRuta(
        { lat, lng },
        paradaActivaDireccion,
        [],
        (result) => {
          setDirections(result);
          rutaCalculadaRef.current = true;
          ajustarZoom([{ lat, lng }]);
        }
      );
      return;
    }

    // Sin GPS (o sin paradaActiva) → geocodificar origen y destino, luego ruta
    let origenResuelto:  google.maps.LatLngLiteral | null = lat && lng ? { lat, lng } : null;
    let destinoResuelto: google.maps.LatLngLiteral | null = null;
    let pendientes = 0;

    const intentarRuta = () => {
      if (pendientes > 0) return;
      const puntos: google.maps.LatLngLiteral[] = [];
      if (origenResuelto)  puntos.push(origenResuelto);
      if (destinoResuelto) puntos.push(destinoResuelto);
      ajustarZoom(puntos);

      const originParam: string | google.maps.LatLngLiteral =
        origenResuelto ?? `${origen}, Argentina`;

      calcularRuta(
        originParam,
        destino,
        [],
        (result) => {
          setDirections(result);
          rutaCalculadaRef.current = true;
        }
      );
    };

    // Solo geocodificar origen si no tenemos GPS
    if (!origenResuelto) {
      pendientes++;
      geocodificar(origen, (coords) => {
        origenResuelto = coords;
        if (coords) setOrigenCoords(coords);
        pendientes--;
        intentarRuta();
      });
    }

    // Siempre geocodificar destino para marcador y fitBounds
    pendientes++;
    geocodificar(destino, (coords) => {
      destinoResuelto = coords;
      if (coords) setDestinoCoords(coords);
      pendientes--;
      intentarRuta();
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, tieneParadas, modoMultiChofer, origen, destino, paradaActivaDireccion, lat, lng]);

  // ─── Actualizar marcador del chofer cuando cambia GPS ────────────────────
  const actualizarMarcadorChofer = useCallback(
    (mapa: google.maps.Map) => {
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
    },
    [lat, lng, modoMultiChofer]
  );

  // Recalcular ruta cuando el chofer se mueve (viaje activo)
  useEffect(() => {
    if (!isLoaded || !lat || !lng || !paradaActivaDireccion || tieneParadas || modoMultiChofer) return;
    calcularRuta(
      { lat, lng },
      paradaActivaDireccion,
      [],
      (result) => setDirections(result)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  const onMapLoad = useCallback(
    (mapa: google.maps.Map) => {
      mapRef.current = mapa;
      if (!modoMultiChofer) actualizarMarcadorChofer(mapa);
    },
    [actualizarMarcadorChofer, modoMultiChofer]
  );

  useEffect(() => {
    if (!mapRef.current || !lat || !lng || modoMultiChofer) return;
    actualizarMarcadorChofer(mapRef.current);
    mapRef.current.panTo({ lat, lng });
  }, [lat, lng, actualizarMarcadorChofer, modoMultiChofer]);

  // ─── fitBounds para admin multiChofer ────────────────────────────────────
  const onMapLoadMulti = useCallback(
    (mapa: google.maps.Map) => {
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
    },
    [choferes]
  );

  // ─── Color marcador parada ────────────────────────────────────────────────
  const colorPorEstado = (estado: string) => {
    if (estado === "completada") return "#22c55e";
    if (estado === "en_curso")   return "#facc15";
    return "#6b7280";
  };

  // ─── Centro inicial ───────────────────────────────────────────────────────
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
    return 10; // zoom intermedio mientras geocodifica
  };

  // ─── Fallbacks ────────────────────────────────────────────────────────────
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
      {/* ── MODO MULTI-CHOFER (admin) ──────────────────────────────────── */}
      {modoMultiChofer && choferes!.map((chofer, index) => (
        <Marker
          key={`chofer-${index}`}
          position={{ lat: chofer.lat, lng: chofer.lng }}
          title={chofer.label ? `${chofer.label}${chofer.estado ? ` — ${chofer.estado}` : ""}` : `Chofer ${index + 1}`}
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

      {/* ── MODO NORMAL: marcadores multietapa ────────────────────────── */}
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

      {/* ── MODO SIMPLE: marcadores origen/destino ────────────────────── */}
      {!modoMultiChofer && !tieneParadas && origenCoords && (
        <Marker
          position={origenCoords}
          title={`Retiro: ${origen}`}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#3b82f6",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          }}
          label={{ text: "A", color: "#ffffff", fontWeight: "bold", fontSize: "12px" }}
        />
      )}
      {!modoMultiChofer && !tieneParadas && destinoCoords && (
        <Marker
          position={destinoCoords}
          title={`Entrega: ${destino}`}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#22c55e",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          }}
          label={{ text: "B", color: "#ffffff", fontWeight: "bold", fontSize: "12px" }}
        />
      )}

      {/* ── Ruta (todos los modos excepto multiChofer) ────────────────── */}
      {!modoMultiChofer && directions && (
        <DirectionsRenderer
          directions={directions}
          options={{
            suppressMarkers: true,
            polylineOptions: {
              strokeColor: "#facc15",
              strokeWeight: 5,
              strokeOpacity: 0.9,
            },
          }}
        />
      )}
    </GoogleMap>
  );
}