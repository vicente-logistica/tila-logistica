"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import MapaTILA from "../components/MapaTILA";
import ChatAsistencia from "../components/ChatAsistencia";
import BotonCerrarSesion from "../components/BotonCerrarSesion";
import { labelVehiculo, VehiculoRow } from "../lib/vehiculos";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type ParadaMapa = {
  direccion: string;
  tipo: "retiro" | "entrega" | "parada";
  estado: "pendiente" | "en_curso" | "completada";
};

// "pendiente_pago" se muestra al cliente mientras espera confirmación del pago
const ESTADOS_ACTIVOS   = ["pendiente_pago", "pendiente", "Chofer asignado", "En camino", "Carga retirada", "En ruta", "Descarga completada"];
const ESTADOS_HISTORIAL = ["Viaje finalizado", "cancelado"];

const SOPORTE_WHATSAPP = "5491158689383";
const SOPORTE_EMAIL    = "logisticatila@gmail.com";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const colorEstado = (estado: string) => {
  switch (estado) {
    case "pendiente":           return "bg-zinc-700 text-zinc-300";
    case "Chofer asignado":     return "bg-green-700 text-white";
    case "En camino":           return "bg-yellow-400 text-black";
    case "Carga retirada":      return "bg-blue-600 text-white";
    case "En ruta":             return "bg-purple-600 text-white";
    case "Descarga completada": return "bg-red-600 text-white";
    case "Viaje finalizado":    return "bg-green-500 text-white";
    default:                    return "bg-zinc-800 text-zinc-400";
  }
};

const fmt = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

const relativo = (iso: string | null | undefined) => {
  if (!iso) return "Sin señal";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  return `hace ${Math.floor(diff / 3600)}h`;
};

const vehiculoLabel = (vehiculo: Partial<VehiculoRow> | null | undefined, chofer: any, viaje: any): string => {
  if (vehiculo) return labelVehiculo(vehiculo);
  if (chofer?.vehiculo) return chofer.vehiculo;
  if (viaje?.tipo_vehiculo) return viaje.tipo_vehiculo;
  return "Vehículo pendiente de validación";
};

// ─── SeguimientoViaje ─────────────────────────────────────────────────────────
function SeguimientoViaje({
  viaje, paradas, choferInfo, vehiculoInfo, usuarioId, usuarioNombre, onCerrar,
}: {
  viaje: any; paradas: any[]; choferInfo: any; vehiculoInfo?: Partial<VehiculoRow> | null;
  usuarioId: string; usuarioNombre: string;
  onCerrar: () => void;
}) {
  const [mostrarChat, setMostrarChat]       = useState(false);
  const [mostrarDetalles, setMostrarDetalles] = useState(false);

  const tieneGps = viaje?.lat != null && viaje?.lng != null;
  const precio   = viaje?.precio_cliente ? Number(viaje.precio_cliente) : null;
  const vLabel   = vehiculoLabel(vehiculoInfo, choferInfo, viaje);

  const paradasParaMapa: ParadaMapa[] = paradas.map(p => ({
    direccion: p.direccion,
    tipo:      p.tipo as "retiro" | "entrega" | "parada",
    estado:    p.estado as "pendiente" | "en_curso" | "completada",
  }));

  // Altura mapa = total - header(56px) - bottom(140px)
  const alturaMapaStr = "calc(100dvh - 196px)";

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ height: "100dvh" }}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900 flex-shrink-0" style={{ height: 56 }}>
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={onCerrar}
            className="text-zinc-400 hover:text-yellow-400 font-black text-sm flex-shrink-0">
            ←
          </button>
          <div className="min-w-0">
            <p className="text-yellow-400 font-black text-sm leading-none">VIAJE #{viaje.id}</p>
            <p className="text-zinc-400 text-xs truncate">{viaje.origen} → {viaje.destino}</p>
          </div>
        </div>
        <span className={`text-xs font-black px-2 py-1 rounded-lg flex-shrink-0 ml-2 ${colorEstado(viaje.estado)}`}>
          {viaje.estado || "Pendiente"}
        </span>
      </div>

      {/* ── MAPA ───────────────────────────────────────────────────────── */}
      <div className="relative flex-shrink-0" style={{ height: alturaMapaStr }}>
        {tieneGps ? (
          <MapaTILA
            lat={Number(viaje.lat)} lng={Number(viaje.lng)}
            origen={viaje.origen} destino={viaje.destino}
            soloLectura={true} altura={alturaMapaStr}
            paradas={paradasParaMapa.length >= 2 ? paradasParaMapa : undefined}
          />
        ) : viaje.origen && viaje.destino ? (
          <MapaTILA
            lat={null} lng={null}
            origen={viaje.origen} destino={viaje.destino}
            soloLectura={true} altura={alturaMapaStr}
            paradas={paradasParaMapa.length >= 2 ? paradasParaMapa : undefined}
          />
        ) : (
          <div className="flex items-center justify-center h-full bg-zinc-900">
            <div className="text-center px-6">
              <p className="text-4xl mb-3">📡</p>
              <p className="text-white font-black">Esperando ubicación del chofer</p>
              <p className="text-zinc-500 text-sm mt-1">El mapa se actualizará automáticamente</p>
            </div>
          </div>
        )}

        {/* Badge chofer flotante sobre el mapa */}
        {choferInfo && tieneGps && (
          <div className="absolute top-2 left-2 right-2 z-10 bg-black/80 backdrop-blur-sm rounded-xl px-3 py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white font-black">🚚 {choferInfo.nombre}</span>
              {viaje.velocidad_kmh != null && (
                <span className="text-yellow-400 font-black">{viaje.velocidad_kmh} km/h</span>
              )}
              <span className="text-zinc-400">{relativo(choferInfo.ultima_senal_at)}</span>
            </div>
          </div>
        )}

        {!tieneGps && (
          <div className="absolute bottom-2 left-2 right-2 z-10 bg-black/80 rounded-xl px-3 py-1.5 text-center">
            <p className="text-zinc-400 text-xs">📡 Esperando GPS del chofer...</p>
          </div>
        )}
      </div>

      {/* ── BOTTOM ─────────────────────────────────────────────────────── */}
      <div className="flex-1 bg-zinc-900 border-t border-zinc-800 px-4 py-3 flex flex-col justify-between" style={{ minHeight: 140 }}>
        {/* Info compacta */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            {choferInfo ? (
              <>
                <p className="text-white font-black text-sm">🚚 {choferInfo.nombre}</p>
                <p className="text-zinc-400 text-xs mt-0.5 truncate">🚛 {vLabel}</p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {tieneGps && viaje.velocidad_kmh != null ? `📍 ${viaje.velocidad_kmh} km/h · ` : ""}
                  🕒 {relativo(choferInfo.ultima_senal_at)}
                </p>
              </>
            ) : (
              <p className="text-zinc-500 text-xs">⏳ Esperando asignación de chofer</p>
            )}
          </div>
          {precio && (
            <div className="flex-shrink-0 text-right">
              <p className="text-zinc-500 text-xs">Valor abonado</p>
              <p className="text-green-400 font-black text-base">${precio.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Botones */}
        <div className="flex gap-2">
          <button type="button"
            onClick={() => { setMostrarChat(v => !v); setMostrarDetalles(false); }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-black transition ${mostrarChat ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
            💬 Chat
          </button>
          <button type="button"
            onClick={() => { setMostrarDetalles(v => !v); setMostrarChat(false); }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-black transition ${mostrarDetalles ? "bg-zinc-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
            📋 Detalles
          </button>
          <button type="button" onClick={onCerrar}
            className="flex-1 py-2.5 rounded-xl text-xs font-black bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition">
            ← Viajes
          </button>
        </div>
      </div>

      {/* ── PANEL CHAT ─────────────────────────────────────────────────── */}
      {mostrarChat && (
        <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[65vh] flex flex-col bg-zinc-900 border-t border-blue-600 rounded-t-3xl">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800 flex-shrink-0">
            <p className="text-blue-400 font-black text-sm">💬 Chat · VIAJE #{viaje.id}</p>
            <button type="button" onClick={() => setMostrarChat(false)} className="text-zinc-400 font-black px-2">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ChatAsistencia viajeId={String(viaje.id)} usuarioId={usuarioId} usuarioRol="cliente" usuarioNombre={usuarioNombre} />
          </div>
        </div>
      )}

      {/* ── PANEL DETALLES ─────────────────────────────────────────────── */}
      {mostrarDetalles && (
        <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[70vh] overflow-y-auto bg-zinc-900 border-t border-zinc-700 rounded-t-3xl">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800 sticky top-0 bg-zinc-900">
            <p className="text-yellow-400 font-black text-sm">📋 VIAJE #{viaje.id}</p>
            <button type="button" onClick={() => setMostrarDetalles(false)} className="text-zinc-400 font-black px-2">✕</button>
          </div>
          <div className="p-4 space-y-3 text-xs">

            {/* Datos del viaje */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-800 rounded-xl p-3 col-span-2">
                <p className="text-zinc-500 font-black mb-1">RECORRIDO</p>
                <p className="text-white font-black">{viaje.origen}</p>
                <p className="text-zinc-400">→ {viaje.destino}</p>
              </div>
              {viaje.tipo_carga && (
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-zinc-500 font-black mb-1">CARGA</p>
                  <p className="text-white">{viaje.tipo_carga}</p>
                </div>
              )}
              {viaje.km_estimados && (
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-zinc-500 font-black mb-1">DISTANCIA</p>
                  <p className="text-white">{viaje.km_estimados} km</p>
                </div>
              )}
              {precio && (
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-zinc-500 font-black mb-1">VALOR</p>
                  <p className="text-green-400 font-black">${precio.toLocaleString()}</p>
                </div>
              )}
              {viaje.created_at && (
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-zinc-500 font-black mb-1">PUBLICADO</p>
                  <p className="text-white">{fmt(viaje.created_at)}</p>
                </div>
              )}
            </div>

            {/* Chofer */}
            {choferInfo && (
              <div className="bg-zinc-800 rounded-xl p-3 space-y-1">
                <p className="text-zinc-500 font-black">CHOFER</p>
                <p className="text-white font-black">{choferInfo.nombre}</p>
                <p className="text-zinc-400">🚛 {vLabel}</p>
                {choferInfo.telefono && <p className="text-zinc-400">📞 {choferInfo.telefono}</p>}
              </div>
            )}

            {/* Paradas */}
            {paradas.length > 0 && (
              <div>
                <p className="text-zinc-500 font-black mb-2">PARADAS</p>
                <div className="space-y-2">
                  {paradas.map((p, i) => (
                    <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                      p.estado === "completada" ? "bg-green-900/30 border-green-700 text-green-400" :
                      p.estado === "en_curso"   ? "bg-yellow-400/10 border-yellow-400 text-yellow-300" :
                      "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${
                        p.estado === "completada" ? "bg-green-500 text-white" :
                        p.estado === "en_curso"   ? "bg-yellow-400 text-black" :
                        "bg-zinc-600 text-zinc-400"
                      }`}>{String.fromCharCode(65+i)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-xs">{p.tipo === "retiro" ? "📦 Retiro" : p.tipo === "entrega" ? "🏁 Entrega" : "📍 Parada"}</p>
                        <p className="truncate">{p.direccion}</p>
                        {p.completada_at && <p className="text-zinc-500">{fmt(p.completada_at)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cronología */}
            <div>
              <p className="text-zinc-500 font-black mb-2">CRONOLOGÍA</p>
              <div className="space-y-1 text-zinc-400">
                {viaje.created_at      && <p>📋 Publicado: {fmt(viaje.created_at)}</p>}
                {viaje.hora_aceptacion && <p>✅ Chofer asignado: <span className="text-green-400">{fmt(viaje.hora_aceptacion)}</span></p>}
                {viaje.hora_inicio     && <p>🚛 En camino: <span className="text-yellow-400">{fmt(viaje.hora_inicio)}</span></p>}
                {viaje.hora_finalizacion && <p>🏆 Finalizado: <span className="text-green-400">{fmt(viaje.hora_finalizacion)}</span></p>}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────
export default function PanelClientePage() {
  const { autorizado } = useProtegerRuta("cliente");

  const [viajes, setViajes]                   = useState<any[]>([]);
  const [paradasPorViaje, setParadasPorViaje] = useState<Record<string, any[]>>({});
  const [choferPorViaje, setChoferPorViaje]   = useState<Record<string, any>>({});
  const [vehiculoPorViaje, setVehiculoPorViaje] = useState<Record<string, Partial<VehiculoRow>>>({});
  const [cargando, setCargando]               = useState(true);
  const [viajeSeleccionado, setViajeSeleccionado] = useState<any>(null);
  const [mostrarHistorial, setMostrarHistorial]   = useState(false);
  const [alerta, setAlerta]                   = useState<string | null>(null);
  const [bannerPago, setBannerPago]           = useState<"ok" | "error" | "pendiente" | null>(null);

  // Leer ?pago= de la URL cuando MP redirige de vuelta (sin useSearchParams para evitar Suspense)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pago = params.get("pago");
    if (pago === "ok" || pago === "error" || pago === "pendiente") {
      setBannerPago(pago as "ok" | "error" | "pendiente");
      // Limpiar el param de la URL sin recargar
      const url = new URL(window.location.href);
      url.searchParams.delete("pago");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const audioRef              = useRef<HTMLAudioElement | null>(null);
  // audioFinalizadoRef es un objeto Audio creado en useEffect — NO elemento DOM
  // así persiste aunque la vista cambie entre SeguimientoViaje / festejo / panel normal
  const audioFinalizadoRef    = useRef<HTMLAudioElement | null>(null);
  const audioDesbloquedoRef   = useRef(false); // guard — desbloquear ambos una sola vez
  const ultimoEstadoRef       = useRef<Record<string, string>>({});
  const festejoClienteRef     = useRef<Set<string>>(new Set()); // IDs ya celebrados — evita repetir por polling
  const [festejoViaje, setFestejoViaje] = useState<any>(null); // viaje que disparó el festejo del cliente

  const usuario = useMemo(() => {
    if (typeof window === "undefined") return null;
    const u = localStorage.getItem("usuario");
    return u ? JSON.parse(u) : null;
  }, []);

  const viajesActivos   = useMemo(() => viajes.filter(v => ESTADOS_ACTIVOS.includes(v.estado || "pendiente")), [viajes]);
  const viajesHistorial = useMemo(() => viajes.filter(v => ESTADOS_HISTORIAL.includes(v.estado)), [viajes]);

  /** Desbloquea ambos audio elements con un play silencioso en el contexto de gesto del usuario.
   *  Llamar en cualquier botón/tap del cliente para que audio.mp3 pueda sonar luego. */
  const desbloquearAudios = useCallback(async () => {
    if (audioDesbloquedoRef.current) return;
    audioDesbloquedoRef.current = true;
    const silentUnlock = async (audio: HTMLAudioElement | null) => {
      if (!audio) return;
      try {
        audio.volume = 0;
        await audio.play();
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
      } catch { /* ignorar — el navegador puede denegar silently */ }
    };
    await Promise.all([silentUnlock(audioRef.current), silentUnlock(audioFinalizadoRef.current)]);
    console.log("[CLIENTE-AUDIO] ambos audios desbloqueados");
  }, []);

  // Crear el objeto Audio de finalizado en el cliente (no en SSR) y pre-cargarlo
  useEffect(() => {
    const af = new Audio("/sounds/alerta-viaje.mp3?v=cliente-final");
    af.preload = "auto";
    af.volume = 1;
    audioFinalizadoRef.current = af;
    return () => { af.pause(); };
  }, []);

  const cargarViajes = async () => {
    if (!usuario?.id) return;
    const { data, error } = await supabase
      .from("cargas").select("*")
      .eq("cliente_id", usuario.id)
      .eq("oculto_cliente", false)
      .order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    const todos = data || [];
    setViajes(todos);

    // Alerta sonora y festejo en cambio de estado
    console.log("[AUDIO-CLIENTE] cargarViajes — total viajes:", todos.length, "— audioRef:", audioRef.current ? "OK" : "NULL");
    todos.forEach(v => {
      const prev   = ultimoEstadoRef.current[String(v.id)];
      const actual = v.estado || "pendiente";
      console.log(`[AUDIO-CLIENTE] viaje ${v.id}: prev="${prev}" actual="${actual}" cambia=${!!prev && prev !== actual}`);
      if (prev && prev !== actual) {
        if (actual === "Viaje finalizado" && !festejoClienteRef.current.has(String(v.id))) {
          // Festejo especial de entrega — una sola vez por viaje
          festejoClienteRef.current.add(String(v.id));
          setFestejoViaje(v);
          // Reproducir via objeto Audio persistente (no depende del DOM ni de la vista activa)
          const af = audioFinalizadoRef.current;
          if (af) {
            console.log("🎉 Intentando sonido finalizado", "cliente");
            af.volume = 1;
            af.currentTime = 0;
            af.play()
              .then(() => console.log("🎉 Sonido finalizado OK", "cliente"))
              .catch(e => console.warn("🎉 Sonido finalizado bloqueado/error", e));
          }
          setTimeout(() => setFestejoViaje(null), 7000);
        } else {
          // Alerta genérica para otros cambios de estado
          console.log(`[AUDIO-CLIENTE] ▶ Reproduciendo alerta para viaje ${v.id}: "${prev}" → "${actual}" — audioRef:`, audioRef.current);
          setAlerta(actual);
          audioRef.current?.play()
            .then(() => console.log("[AUDIO-CLIENTE] ▶ Play OK"))
            .catch(err => console.warn("[AUDIO-CLIENTE] ▶ Play ERROR:", err));
          setTimeout(() => setAlerta(null), 4000);
        }
      }
      ultimoEstadoRef.current[String(v.id)] = actual;
    });

    const ids = todos.map(v => v.id);
    if (ids.length === 0) { setCargando(false); return; }

    // Paradas
    const { data: dp } = await supabase.from("paradas_viaje").select("*").in("carga_id", ids).order("orden", { ascending: true });
    if (dp) {
      const agrup: Record<string, any[]> = {};
      dp.forEach(p => { const k = String(p.carga_id); if (!agrup[k]) agrup[k] = []; agrup[k].push(p); });
      setParadasPorViaje(agrup);
    }

    // Choferes
    const choferIds = [...new Set(todos.filter(v => v.chofer_id && String(v.chofer_id).length > 10).map(v => String(v.chofer_id)))];
    if (choferIds.length > 0) {
      const { data: dc } = await supabase.from("usuarios")
        .select("id, nombre, vehiculo, telefono, bateria_nivel, ultima_senal_at, online, vehiculo_activo_id").in("id", choferIds);
      if (dc) {
        const map: Record<string, any> = {};
        todos.forEach(v => { if (v.chofer_id) { const c = dc.find(ch => ch.id === v.chofer_id); if (c) map[String(v.id)] = c; } });
        setChoferPorViaje(map);

        const vehiculoIds = [...new Set(dc.filter(c => c.vehiculo_activo_id).map(c => c.vehiculo_activo_id))];
        if (vehiculoIds.length > 0) {
          const { data: vehiculos } = await supabase
            .from("vehiculos")
            .select("id, marca, modelo, patente, tipo_vehiculo, anio")
            .in("id", vehiculoIds);
          if (vehiculos) {
            const vMap: Record<string, Partial<VehiculoRow>> = {};
            todos.forEach(v => {
              if (!v.chofer_id) return;
              const chofer = dc.find(ch => ch.id === v.chofer_id);
              if (!chofer?.vehiculo_activo_id) return;
              const veh = vehiculos.find(vh => vh.id === chofer.vehiculo_activo_id);
              if (veh) vMap[String(v.id)] = veh;
            });
            setVehiculoPorViaje(vMap);
          }
        }
      }
    }
    setCargando(false);
  };

  useEffect(() => {
    cargarViajes();
    if (!usuario?.id) return;
    const canal = supabase.channel(`cliente-rt-${usuario.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cargas", filter: `cliente_id=eq.${usuario.id}` }, () => cargarViajes())
      .on("postgres_changes", { event: "*", schema: "public", table: "paradas_viaje" }, () => cargarViajes())
      .subscribe();
    const tick = setInterval(cargarViajes, 5000);
    return () => { supabase.removeChannel(canal); clearInterval(tick); };
  }, [usuario?.id]);

  // Sincronizar viaje seleccionado
  useEffect(() => {
    if (!viajeSeleccionado) return;
    const actualizado = viajes.find(v => v.id === viajeSeleccionado.id);
    if (actualizado) setViajeSeleccionado(actualizado);
  }, [viajes]);

  if (!autorizado) return null;

  // ── Festejo entrega para el cliente ───────────────────────────────────────
  if (festejoViaje) return (
    <main className="min-h-screen bg-black flex items-center justify-center p-6"
      onClick={() => setFestejoViaje(null)}>
      <div className="relative bg-green-950 border-4 border-green-400 rounded-3xl p-8 text-center shadow-2xl max-w-sm w-full overflow-hidden">
        {/* Decoración de fondo */}
        <div className="absolute inset-0 flex flex-wrap items-center justify-center pointer-events-none select-none opacity-10 text-5xl gap-2 p-4">
          {["📦","✅","🎉","📦","✅","🎉","📦","✅","🎉","📦","✅","🎉"].map((e, i) => <span key={i}>{e}</span>)}
        </div>
        {/* Contenido — orientado al cliente */}
        <div className="relative z-10">
          <div className="text-6xl mb-4 animate-bounce">✅</div>
          <h1 className="text-2xl md:text-3xl font-black text-white mb-2 leading-tight">
            Carga entregada con éxito
          </h1>
          <p className="text-lg font-black text-green-400 mb-2">Tu mercadería llegó a destino</p>
          <p className="text-yellow-400 font-black text-base mb-6">¡Gracias por usar TILA!</p>
          {festejoViaje.origen && (
            <p className="text-zinc-400 text-xs mb-4 truncate">
              {festejoViaje.origen} → {festejoViaje.destino}
            </p>
          )}
          <p className="text-zinc-600 text-xs">Tocá para continuar</p>
        </div>
      </div>
    </main>
  );

  if (viajeSeleccionado) return (
    <SeguimientoViaje
      viaje={viajeSeleccionado}
      paradas={paradasPorViaje[String(viajeSeleccionado.id)] || []}
      choferInfo={choferPorViaje[String(viajeSeleccionado.id)]}
      vehiculoInfo={vehiculoPorViaje[String(viajeSeleccionado.id)]}
      usuarioId={usuario?.id || ""}
      usuarioNombre={usuario?.nombre || "Cliente"}
      onCerrar={() => setViajeSeleccionado(null)}
    />
  );

  return (
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    <main className="min-h-screen bg-black text-white p-4 pb-10"
      onClick={desbloquearAudios} onTouchStart={desbloquearAudios}>
      {/* Audio de alerta genérica (cambios de estado) */}
      <audio ref={audioRef} src="/sounds/alerta-viaje.mp3" preload="auto" />
      {/* audioFinalizadoRef es un objeto Audio JS creado en useEffect — no necesita elemento DOM */}

      {/* Alerta cambio de estado */}
      {alerta && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 pointer-events-none">
          <div className="bg-yellow-400 text-black rounded-3xl p-8 text-center shadow-2xl animate-pulse max-w-sm w-full">
            <p className="text-base font-black mb-1">🚨 ACTUALIZACIÓN</p>
            <h2 className="text-3xl font-black">{alerta}</h2>
          </div>
        </div>
      )}

      {/* Banner retorno MercadoPago */}
      {bannerPago && (
        <div className={`mb-4 rounded-2xl px-5 py-4 flex items-center justify-between gap-3 ${
          bannerPago === "ok"        ? "bg-green-800 text-green-100" :
          bannerPago === "pendiente" ? "bg-yellow-700 text-yellow-100" :
                                      "bg-red-800 text-red-100"
        }`}>
          <span className="font-bold text-base">
            {bannerPago === "ok"        ? "✅ Pago confirmado — tu carga está en camino a los choferes." :
             bannerPago === "pendiente" ? "⏳ Pago en proceso — te avisaremos cuando se confirme." :
                                         "❌ El pago no pudo procesarse. Podés reintentarlo desde tu carga."}
          </span>
          <button
            className="text-white/80 text-xl font-black leading-none"
            onClick={() => setBannerPago(null)}
          >×</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-3xl font-black text-yellow-400">Mis viajes</h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            {viajesActivos.length > 0 ? `${viajesActivos.length} activo${viajesActivos.length !== 1 ? "s" : ""}` : "Sin viajes activos"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/publicar" className="bg-yellow-400 text-black font-black px-4 py-2 rounded-xl text-sm">+ Nuevo</Link>
          <BotonCerrarSesion />
        </div>
      </div>

      {/* Soporte */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 mb-5 flex items-center gap-3">
        <p className="text-zinc-400 text-xs font-black flex-1">🆘 Soporte TILA</p>
        <a href={`https://wa.me/${SOPORTE_WHATSAPP}`} target="_blank" rel="noreferrer"
          className="bg-green-600 text-white font-black px-3 py-1.5 rounded-xl text-xs">💬 WhatsApp</a>
        <a href={`mailto:${SOPORTE_EMAIL}`}
          className="bg-zinc-700 text-white font-black px-3 py-1.5 rounded-xl text-xs">📧 Email</a>
      </div>

      {/* Viajes activos */}
      {cargando ? (
        <div className="text-center py-12">
          <p className="text-yellow-400 font-black animate-pulse">Cargando viajes...</p>
        </div>
      ) : viajesActivos.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 text-center mb-6">
          <h2 className="text-2xl font-black mb-2">Sin viajes activos</h2>
          <p className="text-zinc-500 mb-6">Publicá una carga para comenzar.</p>
          <Link href="/publicar" className="inline-block bg-yellow-400 text-black font-black px-8 py-4 rounded-2xl">
            Publicar carga
          </Link>
        </div>
      ) : (
        <div className="space-y-4 mb-6">
          {viajesActivos.map(viaje => {
            const chofer   = choferPorViaje[String(viaje.id)];
            const vehiculo = vehiculoPorViaje[String(viaje.id)];
            const paradas  = paradasPorViaje[String(viaje.id)] || [];
            const tieneGps = viaje.lat != null && viaje.lng != null;
            const vLabel   = vehiculoLabel(vehiculo, chofer, viaje);
            const precio   = viaje.precio_cliente ? Number(viaje.precio_cliente) : null;

            return (
              <div key={viaje.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

                {/* Código + estado */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800">
                  <p className="text-zinc-500 text-xs font-black tracking-widest">VIAJE #{viaje.id}</p>
                  <div className="flex items-center gap-1.5">
                    {/* Badge de pago */}
                    {viaje.pago_estado === "pendiente_pago" && (
                      <span className="text-xs font-black px-2 py-1 rounded-lg bg-orange-950 text-orange-400 border border-orange-700">
                        💳 Pago pendiente
                      </span>
                    )}
                    {viaje.pago_estado === "pagado" && (
                      <span className="text-xs font-black px-2 py-1 rounded-lg bg-green-950 text-green-400">
                        ✅ Pagado
                      </span>
                    )}
                    {(viaje.pago_estado === "rechazado") && (
                      <span className="text-xs font-black px-2 py-1 rounded-lg bg-red-950 text-red-400">
                        ❌ Pago rechazado
                      </span>
                    )}
                    {(viaje.pago_estado === "pendiente_proceso") && (
                      <span className="text-xs font-black px-2 py-1 rounded-lg bg-yellow-950 text-yellow-400">
                        ⏳ Procesando pago
                      </span>
                    )}
                    <span className={`text-xs font-black px-2 py-1 rounded-lg ${colorEstado(viaje.estado || "pendiente")}`}>
                      {viaje.estado === "pendiente_pago" ? "En espera" : viaje.estado || "Pendiente"}
                    </span>
                  </div>
                </div>

                <div className="px-4 pt-3 pb-4 space-y-3">
                  {/* Ruta */}
                  <div>
                    <p className="text-yellow-400 font-black text-base leading-tight truncate">{viaje.origen}</p>
                    <p className="text-zinc-400 text-sm truncate">→ {viaje.destino}</p>
                  </div>

                  {/* Precio */}
                  {precio && (
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500 text-xs">💰 Valor abonado:</span>
                      <span className="text-green-400 font-black text-sm">${precio.toLocaleString()}</span>
                    </div>
                  )}

                  {/* Chofer */}
                  <div className="bg-zinc-800 rounded-xl p-3 space-y-1.5">
                    {chofer ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${chofer.online ? "bg-green-500" : "bg-zinc-600"}`} />
                          <p className="text-white font-black text-sm">🚚 {chofer.nombre}</p>
                        </div>
                        <p className="text-zinc-400 text-xs">🚛 {vLabel}</p>
                        <div className="flex items-center gap-3 text-xs">
                          {tieneGps && viaje.velocidad_kmh != null && (
                            <span className="text-yellow-400 font-black">📍 {viaje.velocidad_kmh} km/h</span>
                          )}
                          <span className="text-zinc-500">🕒 {relativo(chofer.ultima_senal_at)}</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-zinc-500 text-xs">⏳ Esperando asignación de chofer</p>
                    )}
                  </div>

                  {/* Paradas mini solo si hay */}
                  {paradas.length > 0 && (
                    <div className="flex gap-1 overflow-x-auto">
                      {paradas.map((p, i) => (
                        <span key={p.id} className={`flex-shrink-0 text-xs px-2 py-1 rounded-lg font-black ${
                          p.estado === "completada" ? "bg-green-900/50 text-green-400" :
                          p.estado === "en_curso"   ? "bg-yellow-400/20 text-yellow-400" :
                          "bg-zinc-800 text-zinc-600"
                        }`}>{String.fromCharCode(65+i)}</span>
                      ))}
                    </div>
                  )}

                  {/* Fecha */}
                  <p className="text-zinc-600 text-xs">{fmt(viaje.created_at)}{viaje.km_estimados ? ` · ${viaje.km_estimados} km` : ""}</p>

                  {/* Botón: pagar o ver seguimiento */}
                  {viaje.pago_estado === "pendiente_pago" || viaje.pago_estado === "rechazado" ? (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        className="w-full py-3.5 rounded-xl font-black text-sm bg-blue-600 hover:bg-blue-500 text-white active:scale-[0.98] transition"
                        onClick={async () => {
                          try {
                            const payload = {
                              carga_id: viaje.id,
                              monto: viaje.precio_cliente,
                              descripcion: `TILA · ${viaje.origen} → ${viaje.destino}`,
                            };
                            console.log("[PAGO] enviando a crear-preferencia:", payload);
                            const res = await fetch("/api/mercadopago/crear-preferencia", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(payload),
                            });
                            console.log("[PAGO] response status:", res.status);
                            const d = await res.json();
                            console.log("[PAGO] response body:", d);
                            if (d.init_point) {
                              console.log("[PAGO] redirigiendo a:", d.init_point.slice(0, 80));
                              window.location.href = d.init_point;
                            } else {
                              console.error("[PAGO] init_point ausente — body:", d);
                              alert("Error al iniciar el pago. Intentá de nuevo.");
                            }
                          } catch (err) {
                            console.error("[PAGO] error de red / fetch:", err);
                            alert("Error de red al iniciar el pago.");
                          }
                        }}
                      >
                        💳 {viaje.pago_estado === "rechazado" ? "Reintentar pago" : "Pagar ahora"}
                      </button>
                      <p className="text-center text-zinc-400 text-xs leading-snug">
                        Pagar con tarjeta / Mercado Pago<br />
                        <span className="text-zinc-500">Tarjeta de crédito, débito o dinero en Mercado Pago.</span>
                      </p>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setViajeSeleccionado(viaje)}
                      className="w-full py-3.5 rounded-xl font-black text-sm bg-yellow-400 text-black hover:bg-yellow-300 active:scale-[0.98] transition">
                      {viaje.estado === "pendiente" || !viaje.estado
                        ? "📋 Ver publicación"
                        : tieneGps ? "📡 Ver ubicación en vivo" : "👁️ Ver seguimiento"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Historial colapsable */}
      {viajesHistorial.length > 0 && (
        <div className="mb-6">
          <button type="button" onClick={() => setMostrarHistorial(v => !v)}
            className="w-full flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm font-black text-zinc-400 mb-2">
            <span>📋 Historial ({viajesHistorial.length} viaje{viajesHistorial.length !== 1 ? "s" : ""})</span>
            <span>{mostrarHistorial ? "▲" : "▼"}</span>
          </button>
          {mostrarHistorial && (
            <div className="space-y-2">
              {viajesHistorial.map(viaje => {
                const precio = viaje.precio_cliente ? Number(viaje.precio_cliente) : null;
                return (
                  <div key={viaje.id} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-zinc-500 text-xs">VIAJE #{viaje.id}</p>
                      <span className={`text-xs font-black px-2 py-0.5 rounded-lg ${colorEstado(viaje.estado)}`}>{viaje.estado}</span>
                    </div>
                    <p className="text-zinc-300 text-sm font-black truncate">{viaje.origen} → {viaje.destino}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-zinc-600 text-xs">{fmt(viaje.hora_finalizacion || viaje.created_at)}</p>
                      {precio && <p className="text-green-400 text-xs font-black">${precio.toLocaleString()}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </main>
  );
}