"use client";
import { useEffect, useRef, useState } from "react";
import { filtrarCercanas } from "../lib/geo/filtrarCercanas";
import {
  aplicarRespuestaCercanas, derivarEstadoCercanas,
  type EstadoCargasCercanas, type RespuestaCercanas,
} from "../lib/geo/estadoCalculoCercanas";
import { crearCoordinadorCalculo } from "../lib/geo/coordinadorCalculo";

export interface DistanciaCarga {
  id: number;
  dentroRadioInicial: boolean;
  dentroRadioMaximo: boolean;
  hastaCargaKm: number | null;
  hastaCargaTexto: string | null;
  recorridoCargaKm: number | null;
  recorridoCargaTexto: string | null;
  recorridoCargaDuracionTexto: string | null;
  totalKm: number | null;
  totalTexto: string | null;
  totalDuracionTexto: string | null;
  duracionHastaCargaTexto: string | null;
  estado: "ok" | "fuera_de_rango" | "sin_datos_a" | "error_directions";
}

type GpsEstado = "inactivo" | "buscando" | "ok" | "error";

export type { EstadoCargasCercanas };

// Cada cuánto se vuelve a pedir GPS mientras el chofer sigue "online" navegando el
// listado — NO es un watchPosition continuo (gasta batería/CPU de más para este caso de
// uso, que no necesita precisión de navegación en curso, sólo saber en qué zona está).
const REFRESCO_GPS_MS = 2 * 60 * 1000;
// Agrupa cambios de `cargas`/GPS que lleguen pegados (un poll de cargarCargas() y un
// refresco de GPS casi al mismo tiempo) en una sola consulta al endpoint.
const DEBOUNCE_MS = 500;
// Tras una consulta fallida, cada cuánto se reintenta sola (sin esperar a que cambien las
// cargas o el GPS) — mientras tanto el estado es "error_calculo" y no se muestra nada.
const REINTENTO_ERROR_MS = 15 * 1000;

/**
 * Filtra una lista de cargas (ya filtrada por tipo de vehículo, tal cual la entrega
 * cargarCargas() en panel-chofer, SIN modificarla) según la cercanía real del chofer al
 * punto A de cada una. Es una capa DERIVADA, aplicada después — no toca el estado, el
 * polling, el hash ni el fetch de cargarCargas().
 *
 * FAIL-CLOSED (regla de negocio explícita — corrige un fallback anterior que mostraba
 * TODAS las cargas sin filtrar mientras no había GPS/cálculo): mientras no haya una
 * posición GPS confirmada ("ok") Y una respuesta real del endpoint para el conjunto
 * actual de cargas, `cargasVisibles` es SIEMPRE `[]` — nunca `cargas` crudas. Una carga
 * puntual que falle (Directions cayó, o no se pudo geocodificar el punto A) también queda
 * excluida — nunca se inventa un kilómetro ni se asume que está dentro del radio.
 */
export function useCargasCercanas<T extends { id: number }>(
  cargas: T[],
  activo: boolean,
  usuarioId: string | undefined,
  /** cargarCargas() ya trajo la lista real de esta sesión online — ver derivarEstadoCercanas. */
  listaCargada: boolean,
) {
  const [gpsEstado, setGpsEstado] = useState<GpsEstado>("inactivo");
  const gpsRef = useRef<{ lat: number; lng: number } | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [distancias, setDistancias] = useState<Record<number, DistanciaCarga>>({});
  const [calculando, setCalculando] = useState(false);
  // true una vez que llegó al menos una respuesta real (o no había nada que calcular) para
  // el conjunto/posición actual — distingue "todavía no sabemos" de "ya sabemos y es 0".
  const [primeraRespuestaLlegada, setPrimeraRespuestaLlegada] = useState(false);
  // true si la ÚLTIMA consulta al endpoint falló — las distancias ya se limpiaron (ver
  // aplicarRespuestaCercanas) y `reintento` programa una nueva consulta.
  const [errorCalculo, setErrorCalculo] = useState(false);
  const [reintento, setReintento] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Última lista/usuario — el cálculo los lee al CORRER, no al pedirse, así un recálculo
  // pendiente usa siempre el conjunto más reciente.
  const cargasRef = useRef(cargas);
  const usuarioIdRef = useRef(usuarioId);
  useEffect(() => { cargasRef.current = cargas; usuarioIdRef.current = usuarioId; });

  // Un solo request a la vez; lo que se pida durante el vuelo queda pendiente y corre al
  // terminar (ver coordinadorCalculo.ts) — nunca se pierde un cambio de la lista.
  const coordinadorRef = useRef<ReturnType<typeof crearCoordinadorCalculo> | null>(null);
  if (!coordinadorRef.current) {
    coordinadorRef.current = crearCoordinadorCalculo(async () => {
      const gpsActual = gpsRef.current;
      const uid = usuarioIdRef.current;
      const ids = cargasRef.current.map(c => c.id);
      if (!gpsActual || !uid || ids.length === 0) return;
      setCalculando(true);
      let respuesta: RespuestaCercanas<DistanciaCarga> = { ok: false };
      try {
        const res = await fetch("/api/chofer/distancias-cercanas", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-user-id": uid },
          body: JSON.stringify({ lat: gpsActual.lat, lng: gpsActual.lng, cargaIds: ids }),
        });
        if (res.ok) {
          const { resultados } = await res.json() as { resultados: Record<number, DistanciaCarga> };
          respuesta = { ok: true, resultados };
        }
      } catch {
        // error de red / JSON inválido — respuesta queda { ok: false }
      }
      // FAIL-CLOSED real: un fallo LIMPIA las distancias anteriores (nunca se usa una
      // validación vieja como fallback) y marca errorCalculo; un éxito las reemplaza.
      const siguiente = aplicarRespuestaCercanas(respuesta);
      setDistancias(siguiente.distancias);
      setErrorCalculo(siguiente.errorCalculo);
      setCalculando(false);
      setPrimeraRespuestaLlegada(true);
    });
  }

  // ── Adquisición de GPS: una vez al activarse, y refresco periódico mientras siga activo ──
  useEffect(() => {
    if (!activo) {
      setGpsEstado("inactivo");
      setGps(null);
      setDistancias({});
      setPrimeraRespuestaLlegada(false);
      setErrorCalculo(false);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGpsEstado("error"); return; }
    let cancelado = false;
    const pedir = () => {
      setGpsEstado(prev => (prev === "ok" ? prev : "buscando"));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelado) return;
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          gpsRef.current = p;
          setGps(p);
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
    if (!activo || gpsEstado !== "ok" || !gpsRef.current || !usuarioId) return;
    // Sin la lista real de esta sesión todavía, no se calcula ni se da nada por resuelto:
    // una lista vacía acá es "no llegó", no "no hay cargas".
    if (!listaCargada) { setPrimeraRespuestaLlegada(false); return; }
    if (cargas.length === 0) { setErrorCalculo(false); setPrimeraRespuestaLlegada(true); return; } // lista real vacía
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void coordinadorRef.current!.solicitar(); }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [activo, gpsEstado, idsClave, usuarioId, reintento, listaCargada]);

  // ── Reintento automático mientras la última consulta haya fallado ──
  useEffect(() => {
    if (!activo || !errorCalculo) return;
    const t = setTimeout(() => setReintento(n => n + 1), REINTENTO_ERROR_MS);
    return () => clearTimeout(t);
  }, [activo, errorCalculo, reintento]);

  // FAIL-CLOSED: sin GPS confirmado, o con la última consulta fallida, cargasVisibles es
  // SIEMPRE [] (ver filtrarCercanas.ts y aplicarRespuestaCercanas).
  const cargasVisibles = errorCalculo ? [] : filtrarCercanas(cargas, gpsEstado === "ok", distancias);

  const estado = derivarEstadoCercanas(gpsEstado, errorCalculo, calculando, primeraRespuestaLlegada, listaCargada);

  return { cargasVisibles, distancias, gpsEstado, estado, gps };
}
