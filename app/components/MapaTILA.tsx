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

// Labels A, B, C, D, E, F para marcadores de paradas
const LABELS = ["A", "B", "C", "D", "E", "F"];

export interface ParadaMapa {
  direccion: string;
  tipo: "retiro" | "entrega" | "parada";
  estado: "pendiente" | "en_curso" | "completada";
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
}: MapaTILAProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: LIBRARIES,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const choferMarkerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

  // Coords geocodificadas para paradas simples (sin array de paradas)
  const [origenCoords, setOrigenCoords] = useState<google.maps.LatLngLiteral | null>(null);
  const [destinoCoords, setDestinoCoords] = useState<google.maps.LatLngLiteral | null>(null);

  // Coords geocodificadas para array de paradas multietapa
  const [paradasCoords, setParadasCoords] = useState<(google.maps.LatLngLiteral | null)[]>([]);

  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);

  const tieneParadas = paradas && paradas.length >= 2;

  const contenedorEstilo = {
    width: "100%",
    height: altura,
    borderRadius: "1rem",
  };

  // ─── Geocoding ────────────────────────────────────────────────────────────

  const geocodificar = useCallback(
    (
      direccion: string,
      callback: (coords: google.maps.LatLngLiteral | null) => void
    ) => {
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

  // Geocodificar origen/destino simples (cuando no hay array de paradas)
  useEffect(() => {
    if (!isLoaded || tieneParadas) return;

    geocoderRef.current = new google.maps.Geocoder();

    if (origen) geocodificar(origen, setOrigenCoords);
    if (destino) geocodificar(destino, setDestinoCoords);
  }, [isLoaded, origen, destino, tieneParadas, geocodificar]);

  // Geocodificar array de paradas multietapa
  useEffect(() => {
    if (!isLoaded || !tieneParadas) return;

    geocoderRef.current = new google.maps.Geocoder();

    const coords: (google.maps.LatLngLiteral | null)[] = new Array(paradas!.length).fill(null);
    let pendientes = paradas!.length;

    paradas!.forEach((parada, index) => {
      geocodificar(parada.direccion, (result) => {
        coords[index] = result;
        pendientes--;
        if (pendientes === 0) {
          setParadasCoords([...coords]);
        }
      });
    });
  }, [isLoaded, tieneParadas, paradas, geocodificar]);

  // ─── Directions API ───────────────────────────────────────────────────────

  // Ruta simple A→B (sin paradas)
  useEffect(() => {
    if (!isLoaded || !paradaActivaDireccion || !lat || !lng) return;
    if (soloLectura || tieneParadas) return;

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
  }, [isLoaded, paradaActivaDireccion, lat, lng, soloLectura, tieneParadas]);

  // Ruta multietapa A→B→C→D con waypoints — usa direcciones de texto directamente
  useEffect(() => {
    if (!isLoaded || !tieneParadas) return;

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
      {
        origin,
        destination,
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === "OK" && result) setDirections(result);
      }
    );
  }, [isLoaded, tieneParadas, paradas]);

  // ─── Marcador del chofer ──────────────────────────────────────────────────

  const actualizarMarcadorChofer = useCallback(
    (mapa: google.maps.Map) => {
      if (!lat || !lng) return;

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
    [lat, lng]
  );

  const onMapLoad = useCallback(
    (mapa: google.maps.Map) => {
      mapRef.current = mapa;
      actualizarMarcadorChofer(mapa);
    },
    [actualizarMarcadorChofer]
  );

  useEffect(() => {
    if (!mapRef.current || !lat || !lng) return;
    actualizarMarcadorChofer(mapRef.current);
  }, [lat, lng, actualizarMarcadorChofer]);

  useEffect(() => {
    if (!mapRef.current || !lat || !lng) return;
    mapRef.current.panTo({ lat, lng });
  }, [lat, lng]);

  // ─── Color de marcador según estado ──────────────────────────────────────

  const colorPorEstado = (estado: string) => {
    if (estado === "completada") return "#22c55e"; // verde
    if (estado === "en_curso") return "#facc15";   // amarillo
    return "#6b7280";                               // gris pendiente
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div
        style={{ height: altura }}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center"
      >
        <p className="text-zinc-500 text-sm">Error al cargar el mapa</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div
        style={{ height: altura }}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center"
      >
        <p className="text-yellow-400 font-black animate-pulse">Cargando mapa...</p>
      </div>
    );
  }

  const centro = lat && lng ? { lat, lng } : centroArgentina;

  return (
    <GoogleMap
      mapContainerStyle={contenedorEstilo}
      center={centro}
      zoom={lat && lng ? 14 : 6}
      options={{
        styles: estiloMapa,
        disableDefaultUI: true,
        zoomControl: false,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      }}
      onLoad={onMapLoad}
    >
      {/* Marcadores multietapa A, B, C, D */}
      {tieneParadas &&
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

      {/* Marcadores simples origen/destino (cuando no hay array de paradas) */}
      {!tieneParadas && origenCoords && (
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

      {!tieneParadas && destinoCoords && (
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
      {directions && (
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