"use client";

import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * "Vuelta a Casa" — panel SÓLO de visualización dentro de viaje-activo. Consulta
 * GET /api/chofer/oportunidades-vuelta al abrirse y cada 2 min mientras está abierto.
 * No tiene ACEPTAR / RESERVAR / ASIGNAR y no toca mapa, navegación, GPS ni estados.
 * Falla aislado: errores de red → texto propio; errores de render → ErrorBoundary (se
 * oculta) — el viaje activo sigue igual.
 */

const REFRESCO_MS = 2 * 60 * 1000;

interface Oportunidad {
  carga_id: number;
  retiro: string;
  destino: string;
  km_hasta_retiro: number;
  km_nuevo_viaje: number | null;
  km_acerca_a_casa: number;
  km_restantes_a_casa: number;
  estado: string;
}
interface Respuesta {
  ok: boolean;
  activo: boolean;
  motivo?: string;
  destino_regreso?: string;
  km_restantes_hasta_destino?: number;
  inicio_km?: number;
  oportunidades: Oportunidad[];
}

const km = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("es-AR")} km`);

function mensajeInactivo(r: Respuesta): string {
  switch (r.motivo) {
    case "deshabilitada": return "Vuelta a Casa está desactivada por ahora.";
    case "lejos_del_destino":
      return `Te faltan ~${km(r.km_restantes_hasta_destino)} para llegar a destino. Vamos a buscar oportunidades cuando falten ${km(r.inicio_km)} o menos.`;
    case "sin_gps": return "Esperando tu ubicación GPS para saber cuánto falta al destino.";
    default: return "No encontramos oportunidades de vuelta por ahora.";
  }
}

function Contenido({ cargaId, usuarioId, obtenerGps, onCerrar }: Props) {
  const [estado, setEstado] = useState<{ tipo: "cargando" } | { tipo: "ok"; r: Respuesta } | { tipo: "error" }>({ tipo: "cargando" });
  const pedido = useRef(0);

  const buscar = useCallback(async () => {
    const miPedido = ++pedido.current;
    try {
      const gps = obtenerGps();
      const q = new URLSearchParams({ carga_id: String(cargaId) });
      if (gps) { q.set("lat", String(gps.lat)); q.set("lng", String(gps.lng)); }
      const res = await fetch(`/api/chofer/oportunidades-vuelta?${q}`, { headers: { "x-user-id": usuarioId } });
      const json = await res.json().catch(() => null);
      if (miPedido !== pedido.current) return;
      if (!res.ok || !json?.ok || !Array.isArray(json.oportunidades)) { setEstado({ tipo: "error" }); return; }
      setEstado({ tipo: "ok", r: json });
    } catch {
      if (miPedido === pedido.current) setEstado({ tipo: "error" });
    }
  }, [cargaId, usuarioId, obtenerGps]);

  useEffect(() => {
    void buscar();
    const t = setInterval(() => { void buscar(); }, REFRESCO_MS);
    return () => { clearInterval(t); pedido.current++; };
  }, [buscar]);

  const r = estado.tipo === "ok" ? estado.r : null;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[70vh] overflow-y-auto bg-zinc-900 border-t border-zinc-700 rounded-t-3xl">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800 sticky top-0 bg-zinc-900">
        <p className="text-green-400 font-black text-sm">🏠 VUELTA A CASA</p>
        <button type="button" onClick={onCerrar} className="text-zinc-400 font-black px-2">✕</button>
      </div>
      <div className="p-4 space-y-3 text-xs">
        {r?.destino_regreso && (
          <div className="bg-zinc-800 rounded-xl p-3">
            <p className="text-zinc-500 font-black mb-1">DESTINO DE REGRESO</p>
            <p className="text-white font-black">{r.destino_regreso}</p>
          </div>
        )}
        {estado.tipo === "cargando" && <p className="text-zinc-400 bg-zinc-800 rounded-xl p-3 animate-pulse">Buscando oportunidades de vuelta…</p>}
        {estado.tipo === "error" && <p className="text-zinc-400 bg-zinc-800 rounded-xl p-3">No pudimos buscar oportunidades ahora. Se reintenta en unos minutos.</p>}
        {r && !r.activo && <p className="text-zinc-400 bg-zinc-800 rounded-xl p-3">{mensajeInactivo(r)}</p>}
        {r && r.activo && r.oportunidades.length === 0 && (
          <p className="text-zinc-400 bg-zinc-800 rounded-xl p-3">No encontramos oportunidades de vuelta por ahora.</p>
        )}
        {r && r.activo && r.oportunidades.map((o) => (
          <div key={o.carga_id} className="bg-zinc-800 rounded-xl p-3 space-y-1 border border-green-700/40">
            <p className="text-green-400 font-black">{o.estado}</p>
            <p><span className="text-zinc-500 font-black">Retiro: </span><span className="text-white font-black">{o.retiro}</span></p>
            <p><span className="text-zinc-500 font-black">Destino: </span><span className="text-white font-black">{o.destino}</span></p>
            <p><span className="text-zinc-500">Km aproximados hasta retiro: </span><span className="text-yellow-400 font-black">{km(o.km_hasta_retiro)}</span></p>
            <p><span className="text-zinc-500">Km del nuevo viaje: </span><span className="text-white font-black">{km(o.km_nuevo_viaje)}</span></p>
            <p><span className="text-zinc-500">Cómo contribuye al regreso: </span>
              <span className="text-green-400 font-black">te acerca ~{km(o.km_acerca_a_casa)} a casa</span>
              <span className="text-zinc-500"> (quedarías a ~{km(o.km_restantes_a_casa)})</span></p>
          </div>
        ))}
        {r && r.activo && r.oportunidades.length > 0 && (
          <p className="text-zinc-600">Distancias aproximadas. Solo informativo: estas cargas no se pueden aceptar ni reservar desde acá.</p>
        )}
      </div>
    </div>
  );
}

interface Props {
  cargaId: number | string;
  usuarioId: string;
  obtenerGps: () => { lat: number; lng: number } | null;
  onCerrar: () => void;
}

class AislarErrores extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };
  static getDerivedStateFromError() { return { fallo: true }; }
  componentDidCatch(error: unknown) { console.error("[VueltaACasaPanel] error aislado:", error); }
  render() { return this.state.fallo ? null : this.props.children; }
}

export default function VueltaACasaPanel(props: Partial<Props> & { onCerrar: () => void }) {
  if (!props.cargaId || !props.usuarioId || !props.obtenerGps) return null;
  return (
    <AislarErrores>
      <Contenido cargaId={props.cargaId} usuarioId={props.usuarioId} obtenerGps={props.obtenerGps} onCerrar={props.onCerrar} />
    </AislarErrores>
  );
}
