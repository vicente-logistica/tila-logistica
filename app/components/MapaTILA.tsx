"use client";

import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";

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
  height: "360px",
  borderRadius: "1rem",
};

const centroArgentina = { lat: -34.6037, lng: -58.3816 };

interface MapaTILAProps {
  lat?: number | null;
  lng?: number | null;
}

export default function MapaTILA({ lat, lng }: MapaTILAProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
  });

  if (loadError) {
    return (
      <div className="w-full h-[360px] bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Error al cargar el mapa</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-[360px] bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center">
        <p className="text-yellow-400 font-black animate-pulse">Cargando mapa...</p>
      </div>
    );
  }

  const centro =
    lat && lng ? { lat, lng } : centroArgentina;

  return (
    <GoogleMap
      mapContainerStyle={contenedorEstilo}
      center={centro}
      zoom={lat && lng ? 15 : 6}
      options={{
        styles: estiloMapa,
        disableDefaultUI: true,
        zoomControl: false,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      }}
    />
  );
}