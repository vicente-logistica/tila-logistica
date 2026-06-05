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

// ─── Nueva interfaz para múltiples choferes en admin ─────────────────────────
export interface ChoferEnMapa {
  lat: number;
  lng: number;
  label?: string;   // nombre del chofer o ID viaje
  estado?: string;  // estado del viaje para color del marcador
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
  // ─── Prop nueva opcional: múltiples choferes (solo admin) ────────────────
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

  const mapRef = useRef<google.maps.Map | null>(null);
  const choferMarkerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

  const [origenCoords, setOrigenCoords] = useState<google.maps.LatLngLiteral | null>(null);
  const [destinoCoords, setDestinoCoords] = useState<google.maps.LatLngLiteral | null>(null);
  const [paradasCoords, setParadasCoords] = useState<(google.maps.LatLngLiteral | null)[]>([]);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);

  const tieneParadas = paradas && paradas.length >= 2;
  // Modo multi-chofer: cuando se pasa prop choferes con al menos 1 elemento
  const modoMultiChofer = choferes && choferes.length > 0;

  const contenedorEstilo = { width: "100%", height: altura, borderRadius: "1rem" };

  // ─── Color de marcador de chofer según estado del viaje ──────────────────
  const colorChoferPorEstado = (estado?: string): string => {
    switch (estado) {
      case "En camino":           return "#facc15"; // amarillo
      case "Carga retirada":      return "#3b82f6"; // azul
      case "En ruta":             return "#a855f7"; // violeta
      case "Descarga completada": return "#ef4444"; // rojo
      case "Chofer asignado":     return "#22c55e"; // verde
      default:                    return "#facc15"; // amarillo por defecto
    }
  };

  // ─── Geocoding ────────────────────────────────────────────────────────────
  const geocodificar = useCallback(
    (direccion: string, callback: (coords: google.maps.LatLngLiteral | null) => void) => {
      if (!geocoderRef.current) return;
      geocoderRef.current.geocode(
        { address: `${direccion}, Argentina` },
        (results, status) => {
          if (status === "OK" && results && results[0]) {
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

  useEffect(() => {
    if (!isLoaded || tieneParadas || modoMultiChofer) return;
    geocoderRef.current = new google.maps.Geocoder();
    if (origen) geocodificar(origen, setOrigenCoords);
    if (destino) geocodificar(destino, setDestinoCoords);
  }, [isLoaded, origen, destino, tieneParadas, modoMultiChofer, geocodificar]);

  useEffect(() => {
    if (!isLoaded || !tieneParadas || modoMultiChofer) return;
    geocoderRef.current = new google.maps.Geocoder();
    const coords: (google.maps.LatLngLiteral | null)[] = new Array(paradas!.length).fill(null);
    let pendientes = paradas!.length;
    paradas!.forEach((parada, index) => {
      geocodificar(parada.direccion, (result) => {
        coords[index] = result;
        pendientes--;
        if (pendientes === 0) setParadasCoords([...coords]);
      });
    });
  }, [isLoaded, tieneParadas, modoMultiChofer, paradas, geocodificar]);

  // ─── Directions API ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || !paradaActivaDireccion || !lat || !lng) return;
    if (soloLectura || tieneParadas || modoMultiChofer) return;
    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }
    directionsServiceRef.current.route(
      {
        origin: { lat, lng },
        destination: `${paradaActivaDireccion}, Argentina`,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === "OK" && result) setDirections(result);
      }
    );
  }, [isLoaded, paradaActivaDireccion, lat, lng, soloLectura, tieneParadas, modoMultiChofer]);

  useEffect(() => {
    if (!isLoaded || !tieneParadas || modoMultiChofer) return;
    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }
    const origin = `${paradas![0].direccion}, Argentina`;
    const destination = `${paradas![paradas!.length - 1].direccion}, Argentina`;
    const waypoints = paradas!.slice(1, -1).map((p) => ({
      location: `${p.direccion}, Argentina`,
      stopover: true,
    }));
    directionsServiceRef.current.route(
      { origin, destination, waypoints, optimizeWaypoints: false, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (status === "OK" && result) setDirections(result);
      }
    );
  }, [isLoaded, tieneParadas, modoMultiChofer, paradas]);

  // ─── Marcador único del chofer (modo normal) ──────────────────────────────
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
  }, [lat, lng, actualizarMarcadorChofer, modoMultiChofer]);

  useEffect(() => {
    if (!mapRef.current || !lat || !lng || modoMultiChofer) return;
    mapRef.current.panTo({ lat, lng });
  }, [lat, lng, modoMultiChofer]);

  // ─── Color marcador parada ────────────────────────────────────────────────
  const colorPorEstado = (estado: string) => {
    if (estado === "completada") return "#22c55e";
    if (estado === "en_curso")   return "#facc15";
    return "#6b7280";
  };

  // ─── Centro del mapa en modo multi-chofer ────────────────────────────────
  const centroMultiChofer = (): google.maps.LatLngLiteral => {
    if (!choferes || choferes.length === 0) return centroArgentina;
    const latProm = choferes.reduce((a, c) => a + c.lat, 0) / choferes.length;
    const lngProm = choferes.reduce((a, c) => a + c.lng, 0) / choferes.length;
    return { lat: latProm, lng: lngProm };
  };

  // ─── Fallbacks ────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div style={{ height: altura }} className="w-full bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Error al cargar el mapa</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div style={{ height: altura }} className="w-full bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center">
        <p className="text-yellow-400 font-black animate-pulse">Cargando mapa...</p>
      </div>
    );
  }

  const centro = modoMultiChofer
    ? centroMultiChofer()
    : lat && lng
      ? { lat, lng }
      : centroArgentina;

  const zoom = modoMultiChofer
    ? (choferes!.length === 1 ? 13 : 6)
    : lat && lng ? 14 : 6;

  return (
    <GoogleMap
      mapContainerStyle={contenedorEstilo}
      center={centro}
      zoom={zoom}
      options={{
        styles: estiloMapa,
        disableDefaultUI: true,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      }}
      onLoad={onMapLoad}
    >
      {/* ─── MODO MULTI-CHOFER (admin) ─────────────────────────────────── */}
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
          label={{
            text: String(index + 1),
            color: "#000000",
            fontWeight: "bold",
            fontSize: "11px",
          }}
          zIndex={10}
        />
      ))}

      {/* ─── MODO NORMAL — marcadores multietapa ──────────────────────── */}
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
              label={{
                text: LABELS[index] || String(index),
                color: "#ffffff",
                fontWeight: "bold",
                fontSize: "12px",
              }}
            />
          );
        })}

      {/* Marcadores simples origen/destino */}
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

      {/* Ruta */}
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