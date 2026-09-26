"use client";
import { useEffect, useRef, useState } from "react";

export interface DistanciaCarga {
  id: number;
  dentroRadioInicial: boolean;
  dentroRadioMaximo: boolean;
  hastaCargaKm: number | null;
  hastaCargaTexto: string | null;
  recorridoCargaKm: number | null;
  recorridoCargaTexto: string | null;
  totalKm: number | null;
  totalTexto: string | null;
  duracionHastaCargaTexto: string | null;
  estado: "ok" | "fuera_de_rango" | "sin_datos_a" | "error_directions";
}

type GpsEstado = "inactivo" | "buscando" | "ok" | "error";

// Cada cuánto se vuelve a pedir GPS mientras el chofer sigue "online" navegando el
// listado — NO es un watchPosition continuo (gasta batería/CPU de más para este caso de
// uso, que no necesita precisión de navegación en curso, sólo saber en qué zona está).
const REFRESCO_GPS_MS = 2 * 60 * 1000;
// Agrupa cambios de `cargas`/GPS que lleguen pegados (un poll de cargarCargas() y un
// refresco de GPS casi al mismo tiempo) en una sola consulta al endpoint.
const DEBOUNCE_MS = 500;

/**
 * Filtra y enriquece una lista de cargas (ya filtrada por tipo de vehículo, tal cual la
 * entrega cargarCargas() en panel-chofer, SIN modificarla) según la cercanía del chofer
 * al punto A de cada una. Es una capa DERIVADA, aplicada después — no toca el estado, el
 * polling, el hash ni la alarma de sonido de cargarCargas().
 *
 * Fallback deliberado (ver PASO 10 — casos especiales, "no romper la pantalla"): si no
 * hay GPS todavía, o el endpoint falla por completo (sin red, etc.), `cargasVisibles`
 * devuelve `cargas` SIN filtrar — el comportamiento idéntico al de antes de que existiera
 * esta función. Nunca deja al chofer sin nada que ver por un problema de permisos o de
 * red transitorio. Una carga puntual que falle (Directions cayó para ESA dirección, o no
 * se pudo geocodificar el punto A) sí queda excluida de "cercanas" — por diseño, nunca se
 * inventa un kilómetro ni se asume que está dentro del radio sin poder confirmarlo.
 */
export function useCargasCercanas<T extends { id: number }>(cargas: T[], activo: boolean, usuarioId: string | undefined) {
  const [gpsEstado, setGpsEstado] = useState<GpsEstado>("inactivo");
  const gpsRef = useRef<{ lat: number; lng: number } | null>(null);
  const [distancias, setDistancias] = useState<Record<number, DistanciaCarga>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enVueloRef = useRef(false);

  // ── Adquisición de GPS: una vez al activarse, y refresco periódico mientras siga activo ──
  useEffect(() => {
    if (!activo) { setGpsEstado("inactivo"); return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGpsEstado("error"); return; }
    let cancelado = false;
    const pedir = () => {
      setGpsEstado(prev => (prev === "ok" ? prev : "buscando"));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelado) return;
          gpsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setGpsEstado("ok");
        },
        () => { if (!cancelado) setGpsEstado("error"); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    };
    pedir();
    const tick = setInterval(pedir, REFRESCO_GPS_MS);
    return () => { cancelado = true; clearInterval(tick); };
  }, [activo]);

  const idsClave = cargas.map(c => c.id).join(",");

  useEffect(() => {
    if (!activo || gpsEstado !== "ok" || !gpsRef.current || !usuarioId || cargas.length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (enVueloRef.current) return; // evita solapar si el debounce dispara mientras otra sigue en vuelo
      enVueloRef.current = true;
      try {
        const gps = gpsRef.current!;
        const res = await fetch("/api/chofer/distancias-cercanas", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-user-id": usuarioId },
          body: JSON.stringify({ lat: gps.lat, lng: gps.lng, cargaIds: cargas.map(c => c.id) }),
        });
        if (!res.ok) return; // fallback: cargasVisibles sigue devolviendo lo que tenía hasta ahora
        const { resultados } = await res.json() as { resultados: Record<number, DistanciaCarga> };
        setDistancias(resultados ?? {});
      } catch {
        // silencioso — mismo fallback: no romper la pantalla por un error de red puntual
      } finally {
        enVueloRef.current = false;
      }
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [activo, gpsEstado, idsClave, usuarioId]);

  // Sin GPS, o todavía sin ninguna respuesta del endpoint (primer render/en vuelo, o
  // falló por completo) → no filtrar nada, mismo comportamiento que antes de esta función.
  const sinDatosTodavia = gpsEstado !== "ok" || Object.keys(distancias).length === 0;
  const cargasVisibles = sinDatosTodavia
    ? cargas
    : cargas.filter(c => distancias[c.id]?.dentroRadioInicial === true);

  return { cargasVisibles, distancias, gpsEstado };
}
