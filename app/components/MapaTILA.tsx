"use client";

import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  DirectionsRenderer,
} from "@react-google-maps/api";
import { useEffect, useRef, useState } from "react";

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

const contenedorEstilo = {
  width: "100%",
  height: "420px",
  borderRadius: "1rem",
};

const centroArgentina = { lat: -34.6037, lng: -58.3816 };

interface MapaTILAProps {
  lat?: number | null;
  lng?: number | null;
  origen: string;
  destino: string;
  paradaActivaDireccion?: string | null;
  soloLectura?: boolean;
}

export default function MapaTILA({
  lat,
  lng,
  origen,
  destino,
  paradaActivaDireccion,
  soloLectura = false,
}: MapaTILAProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: LIBRARIES,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const choferMarkerRef = useRef<google.maps.Marker | null>(null);
  const [origenCoords, setOrigenCoords] = useState<google.maps.LatLngLiteral | null>(null);
  const [destinoCoords, setDestinoCoords] = useState<google.maps.LatLngLiteral | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

  // Geocodificar origen y destino una sola vez al cargar
  useEffect(() => {
    if (!isLoaded || !origen || !destino) return;

    geocoderRef.current = new google.maps.Geocoder();

    const geocodificar = (direccion: string, callback: (coords: google.maps.LatLngLiteral) => void) => {
      geocoderRef.current!.geocode(
        { address: `${direccion}, Argentina` },
        (results, status) => {
          if (status === "OK" && results && results[0]) {
            const loc = results[0].geometry.location;
            callback({ lat: loc.lat(), lng: loc.lng() });
          }
        }
      );
    };

    geocodificar(origen, setOrigenCoords);
    geocodificar(destino, setDestinoCoords);
  }, [isLoaded, origen, destino]);

  // Calcular ruta solo en modo chofer — no necesario para el cliente
  useEffect(() => {
    if (!isLoaded || !paradaActivaDireccion || !lat || !lng) return;
    if (soloLectura) return;

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
        if (status === "OK" && result) {
          setDirections(result);
        }
      }
    );
  }, [isLoaded, paradaActivaDireccion, lat, lng]);

  // Actualizar marcador del chofer sin recargar el mapa
  useEffect(() => {
    if (!isLoaded || !lat || !lng || !mapRef.current) return;

    if (!choferMarkerRef.current) {
      choferMarkerRef.current = new google.maps.Marker({
        map: mapRef.current,
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
  }, [isLoaded, lat, lng]);

  const onMapLoad = (map: google.maps.Map) => {
    mapRef.current = map;
  };

  if (loadError) {
    return (
      <div className="w-full h-[420px] bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Error al cargar el mapa</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-[420px] bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center">
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
      {/* Marcador origen — azul */}
      {origenCoords && (
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
          label={{
            text: "A",
            color: "#ffffff",
            fontWeight: "bold",
            fontSize: "12px",
          }}
        />
      )}

      {/* Marcador destino — verde */}
      {destinoCoords && (
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
          label={{
            text: "B",
            color: "#ffffff",
            fontWeight: "bold",
            fontSize: "12px",
          }}
        />
      )}

      {/* Ruta hacia parada activa */}
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