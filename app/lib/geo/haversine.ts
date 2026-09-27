export interface PuntoGeo {
  lat: number;
  lng: number;
}

/**
 * Distancia geodésica (línea recta sobre la esfera terrestre) entre dos puntos, en
 * kilómetros. Uso EXCLUSIVO: prefiltro barato de cercanía en
 * app/api/chofer/distancias-cercanas/route.ts, para descartar candidatos obviamente
 * lejanos ANTES de gastar una llamada a Directions. Nunca se devuelve ni se muestra al
 * chofer como kilometraje final — el número que ve siempre sale de los legs de Directions
 * (distancia vial real, no línea recta).
 *
 * Implementación independiente de la de app/components/MapaTILA.tsx (misma fórmula
 * matemática, duplicada a propósito en vez de importar de ese archivo — ver la auditoría
 * de esta etapa: se prefiere no acoplar este helper a MapaTILA).
 */
export function distanciaHaversineKm(a: PuntoGeo, b: PuntoGeo): number {
  const R = 6371; // radio medio de la Tierra, en km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Validación de formato/rango de una coordenada GPS recibida en un request — usada antes
 * de aceptar un lat/lng como "posición real del chofer" (por ej. en /api/cargas/aceptar,
 * donde un lat/lng inválido debe rechazar la aceptación en vez de intentar geocodificar o
 * calcular una distancia con basura).
 */
export function esCoordenadaValida(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}
