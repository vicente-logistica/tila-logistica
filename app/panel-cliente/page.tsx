"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import MapaTILA from "../components/MapaTILA";
import ChatAsistencia from "../components/ChatAsistencia";
import ChatToast from "../components/ChatToast";
import BotonCerrarSesion from "../components/BotonCerrarSesion";
import { markChatMessagesAsKnown, notifyChatMessage } from "../utils/chatSound";
import { labelVehiculo, VehiculoRow } from "../lib/vehiculos";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type ParadaMapa = {
  direccion: string;
  tipo: "retiro" | "entrega" | "parada";
  estado: "pendiente" | "en_curso" | "completada";
};

type MensajeChat = {
  id: number;
  viaje_id: number;
  tipo_chat: "viaje" | "soporte_cliente" | "soporte_chofer";
  remitente_id: string;
  remitente_rol: string;
  remitente_nombre: string;
  mensaje: string;
  leido: boolean;
  created_at: string;
};

// "pendiente_pago" se muestra al cliente mientras espera confirmación del pago
const ESTADOS_ACTIVOS   = ["pendiente_pago", "pendiente", "Chofer asignado", "En camino", "Carga retirada", "En ruta", "Descarga completada", "Cancelado por chofer"];
const ESTADOS_HISTORIAL = ["Viaje finalizado", "cancelado", "Cancelado por cliente"];

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
    case "Viaje finalizado":      return "bg-green-500 text-white";
    case "Cancelado por chofer":  return "bg-orange-700 text-white";
    case "Cancelado por cliente": return "bg-zinc-600 text-zinc-300";
    default:                      return "bg-zinc-800 text-zinc-400";
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
  const [mostrarChat, setMostrarChat]           = useState(false);
  const [tipoChatCliente, setTipoChatCliente]   = useState<"viaje" | "soporte_cliente">("viaje");
  const [mostrarDetalles, setMostrarDetalles]   = useState(false);

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
            ← Viajes
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
            🗺 Cerrar mapa
          </button>
        </div>
      </div>

      {/* ── PANEL CHAT — ventana flotante compacta ──────────────────────── */}
      {mostrarChat && (
        <div
          className="fixed bottom-24 right-6 z-40 w-80 bg-zinc-900 border border-blue-600 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          style={{ height: "min(420px, 70vh)" }}
        >
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setTipoChatCliente("viaje")}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition ${tipoChatCliente === "viaje" ? "bg-blue-600 text-white" : "bg-zinc-700 text-zinc-400"}`}>
                💬 Chofer
              </button>
              <button type="button" onClick={() => setTipoChatCliente("soporte_cliente")}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition ${tipoChatCliente === "soporte_cliente" ? "bg-orange-600 text-white" : "bg-zinc-700 text-zinc-400"}`}>
                🛟 Soporte
              </button>
            </div>
            <button type="button" onClick={() => setMostrarChat(false)} className="text-zinc-500 hover:text-white w-7 h-7 flex items-center justify-center">✕</button>
          </div>
          <div className="flex-1 min-h-0">
            <ChatAsistencia
              viajeId={String(viaje.id)}
              usuarioId={usuarioId}
              usuarioRol="cliente"
              usuarioNombre={usuarioNombre}
              tipoChat={tipoChatCliente}
              modoInline
            />
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
  const [bannerPublicado, setBannerPublicado] = useState<string | null>(null); // carga_id recién publicada
  const [pagandoBanner, setPagandoBanner]     = useState(false);
  // Chat por viaje en la lista
  const [chatListaViajeId, setChatListaViajeId]   = useState<string | null>(null);
  const [tipoChatLista, setTipoChatLista]         = useState<"viaje" | "soporte_cliente">("viaje");
  // Refs para que los callbacks de Realtime lean siempre el valor actual (sin stale closure)
  const chatListaViajeIdRef = useRef<string | null>(null);
  const tipoChatListaRef    = useRef<"viaje" | "soporte_cliente">("viaje");
  // No leídos por viaje: { [viajeId]: { viaje: n, soporte_cliente: n } }
  const [noLeidosPorViaje, setNoLeidosPorViaje]   = useState<Record<string, Record<string, number>>>({});
  // Alerta de mensaje nuevo
  const [alertaMensaje, setAlertaMensaje]         = useState<string | null>(null);
  const alertaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Silencio por sector — refs para callbacks
  const [silenciarChatViaje, setSilenciarChatViaje]           = useState(false);
  const [silenciarSoporteCliente, setSilenciarSoporteCliente] = useState(false);
  const [silenciarAlertas, setSilenciarAlertas]               = useState(false);
  const silenciarChatViajeRef     = useRef(false);
  const silenciarSoporteClienteRef = useRef(false);
  const silenciarAlertasRef        = useRef(false);
  // IDs de viajes activos en ref para callbacks (evita stale + evita re-subscribe)
  const viajesActivosIdsRef    = useRef<Set<string>>(new Set());
  // Corte por viaje: server_now del primer fetch exitoso de /api/chat/mensajes
  // para ese viaje. Se fija una sola vez (gateado por baselineHechoRef) y nunca
  // se vuelve a modificar — todo mensaje con created_at posterior es candidato a sonar.
  const corteRef         = useRef<Record<string, string>>({});
  // Viajes que ya recibieron su baseline (mensajes existentes registrados sin
  // sonido, vía markChatMessagesAsKnown). Se marca UNA sola vez por viaje.
  const baselineHechoRef = useRef<Record<string, boolean>>({});

  // Leer params de la URL al montar (sin useSearchParams para evitar Suspense)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pago = params.get("pago");
    const publicado = params.get("publicado");
    const url = new URL(window.location.href);
    if (pago === "ok" || pago === "error" || pago === "pendiente") {
      setBannerPago(pago as "ok" | "error" | "pendiente");
      url.searchParams.delete("pago");
    }
    if (publicado) {
      setBannerPublicado(publicado);
      url.searchParams.delete("publicado");
    }
    if (pago || publicado) window.history.replaceState({}, "", url.toString());
  }, []);

  const audioRef              = useRef<HTMLAudioElement | null>(null);
  const audioDesbloquedoRef   = useRef(false); // true solo después de gesto exitoso del usuario
  const [audioListo, setAudioListo] = useState(false); // controla visibilidad del banner
  const ultimoEstadoRef       = useRef<Record<string, string>>({});
  const primeraVezRef         = useRef(true);  // evita falsos positivos en la primera carga
  const festejoClienteRef     = useRef<Set<string>>(new Set()); // IDs ya celebrados — evita repetir por polling
  const [festejoViaje, setFestejoViaje] = useState<any>(null); // viaje que disparó el festejo del cliente

  const usuario = useMemo(() => {
    if (typeof window === "undefined") return null;
    const u = localStorage.getItem("usuario");
    return u ? JSON.parse(u) : null;
  }, []);

  const viajesActivos   = useMemo(() => viajes.filter(v => ESTADOS_ACTIVOS.includes(v.estado || "pendiente")), [viajes]);
  const viajesHistorial = useMemo(() => viajes.filter(v => ESTADOS_HISTORIAL.includes(v.estado)), [viajes]);

  /** Desbloquea el audio con un play silencioso en el contexto de gesto del usuario. */
  const desbloquearAudios = useCallback(async () => {
    if (audioDesbloquedoRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.volume = 0;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      audioDesbloquedoRef.current = true;
      setAudioListo(true);
    } catch {
      // sin gesto válido — el banner seguirá visible
    }
  }, []);

  // Intentar desbloquear al montar — fallará sin gesto, el banner lo reintentará
  useEffect(() => {
    desbloquearAudios();
  }, [desbloquearAudios]);

  // Sincronizar refs con estados actuales (para que callbacks de Realtime lean sin stale closure)
  useEffect(() => { chatListaViajeIdRef.current     = chatListaViajeId; },     [chatListaViajeId]);
  useEffect(() => { tipoChatListaRef.current        = tipoChatLista; },        [tipoChatLista]);
  useEffect(() => { silenciarChatViajeRef.current      = silenciarChatViaje; },      [silenciarChatViaje]);
  useEffect(() => { silenciarSoporteClienteRef.current = silenciarSoporteCliente; }, [silenciarSoporteCliente]);
  useEffect(() => { silenciarAlertasRef.current        = silenciarAlertas; },        [silenciarAlertas]);
  // Actualizar el set de IDs activos cada vez que cambie la lista de viajes activos
  useEffect(() => {
    viajesActivosIdsRef.current = new Set(viajesActivos.map(v => String(v.id)));
  }, [viajesActivos]);

  const cargarViajes = async () => {
    if (!usuario?.id) return;
    const res = await fetch("/api/cargas/historial-cliente", {
      headers: { "x-user-id": String(usuario.id) },
    });
    if (!res.ok) return;
    const { cargas: todos = [] } = await res.json() as { cargas: any[] };
    setViajes(todos);

    // Primera carga: inicializar baseline sin disparar alertas
    const esPrimeraCarga = primeraVezRef.current;
    if (esPrimeraCarga) {
      primeraVezRef.current = false;
      todos.forEach(v => { ultimoEstadoRef.current[String(v.id)] = v.estado || "pendiente"; });
    }

    if (!esPrimeraCarga) todos.forEach(v => {
      const prev   = ultimoEstadoRef.current[String(v.id)];
      const actual = v.estado || "pendiente";
      if (prev && prev !== actual) {
        if (actual === "Viaje finalizado" && !festejoClienteRef.current.has(String(v.id))) {
          festejoClienteRef.current.add(String(v.id));
          setFestejoViaje(v);
          if (audioDesbloquedoRef.current && !silenciarAlertasRef.current) {
            const a = new Audio("/sounds/alerta-viaje.mp3");
            a.volume = 1;
            a.play().catch(() => {});
          }
          setTimeout(() => setFestejoViaje(null), 7000);
        } else {
          setAlerta(actual);
          if (audioDesbloquedoRef.current && !silenciarAlertasRef.current) {
            const a = new Audio("/sounds/alerta-viaje.mp3");
            a.volume = 1;
            a.play().catch(() => {});
          }
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
        .select("id, nombre, vehiculo, telefono, bateria_nivel, bateria_cargando, ultima_senal_at, online, vehiculo_activo_id").in("id", choferIds);
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

  // ── No leídos: un único detector por viaje, sin efecto separado de "carga inicial" ──
  // (fusiona los dos efectos previos — evita la carrera entre "baseline" y "sonido"
  // que se disparaba cada vez que `viajesActivos` cambiaba de referencia, por ej.
  // en cada ping de GPS del chofer sobre la tabla `cargas`).
  useEffect(() => {
    if (!usuario?.id) return;
    const uid = usuario.id;

    const headers = { "x-user-id": uid };

    // ── Badges: EXCLUSIVAMENTE /api/chat/no-leidos. Ninguna decisión de sonido
    // ni de "es nuevo" se toma acá — solo cuenta lo que sigue sin leer ahora mismo.
    const actualizarBadges = async () => {
      const ids = Array.from(viajesActivosIdsRef.current);
      if (ids.length === 0) return;
      const res = await fetch(`/api/chat/no-leidos?viaje_id=${ids.join(",")}&tipo_chat=viaje,soporte_cliente`, { headers });
      if (!res.ok) return;
      const { porViaje = {} } = await res.json();

      const nuevoConteo: Record<string, Record<string, number>> = {};
      for (const vid of ids) {
        nuevoConteo[vid] = {
          viaje: porViaje[vid]?.viaje?.count ?? 0,
          soporte_cliente: porViaje[vid]?.soporte_cliente?.count ?? 0,
        };
      }
      setNoLeidosPorViaje(nuevoConteo);
    };

    // ── Detección: EXCLUSIVAMENTE /api/chat/mensajes (nunca filtra por leído).
    // Es la única función que decide sonido/alerta, vía notifyChatMessage.
    const detectarNuevos = async () => {
      const ids = Array.from(viajesActivosIdsRef.current);
      if (ids.length === 0) return;
      const res = await fetch(`/api/chat/mensajes?viaje_id=${ids.join(",")}&tipo_chat=viaje,soporte_cliente`, { headers });
      if (!res.ok) return;
      const { porViaje = {}, server_now } = await res.json();

      for (const vid of ids) {
        const mensajesViaje   = porViaje[vid]?.viaje            ?? [];
        const mensajesSoporte = porViaje[vid]?.soporte_cliente   ?? [];

        // Primera vez que vemos este viaje en la sesión: se fija el corte
        // (server_now, nunca más se modifica) y se registra el baseline UNA
        // sola vez — sin sonido.
        if (!baselineHechoRef.current[vid]) {
          corteRef.current[vid] = server_now;
          baselineHechoRef.current[vid] = true;
          const idsBaseline = [...mensajesViaje, ...mensajesSoporte].map((m) => m.id);
          if (idsBaseline.length > 0) markChatMessagesAsKnown(idsBaseline);
          continue;
        }

        const corte = corteRef.current[vid];

        const procesarTipo = (
          mensajes: MensajeChat[],
          tipo: "viaje" | "soporte_cliente",
          silenciarRef: React.MutableRefObject<boolean>,
          textoAlerta: string,
        ) => {
          const nuevos = mensajes.filter(
            (m) => String(m.remitente_id) !== String(uid) && m.created_at > corte,
          );
          let sono = false;
          for (const m of nuevos) {
            if (notifyChatMessage(m.id, { silenciado: silenciarRef.current })) sono = true;
          }
          if (sono) {
            const chatAbierto = chatListaViajeIdRef.current === vid && tipoChatListaRef.current === tipo;
            if (!chatAbierto) {
              if (alertaTimerRef.current) clearTimeout(alertaTimerRef.current);
              setAlertaMensaje(textoAlerta);
              alertaTimerRef.current = setTimeout(() => setAlertaMensaje(null), 4000);
            }
          }
        };

        procesarTipo(mensajesViaje, "viaje", silenciarChatViajeRef, "🚛 Chofer · Nuevo mensaje");
        procesarTipo(mensajesSoporte, "soporte_cliente", silenciarSoporteClienteRef, "🛟 Soporte TILA · Nuevo mensaje");
      }
    };

    const tick = () => { actualizarBadges(); detectarNuevos(); };

    const canalMensajes = supabase
      .channel(`cliente-mensajes-${uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes_viaje" },
        (_payload) => {
          console.log("CHAT ALERT trigger (RLS-safe)");
          tick();
        })
      .subscribe((status) => {
        console.log("CHAT ALERT realtime status", status);
      });

    // Polling fallback por si Realtime no dispara con RLS sin SELECT policy
    const polling = setInterval(tick, 4000);
    tick();

    return () => {
      clearInterval(polling);
      supabase.removeChannel(canalMensajes);
      if (alertaTimerRef.current) clearTimeout(alertaTimerRef.current);
    };
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
      {/* Audio — elemento oculto necesario para unlock en iOS/Safari */}
      <audio ref={audioRef} src="/sounds/alerta-viaje.mp3" preload="auto" />

      {/* ── TOAST MENSAJE NUEVO ──────────────────────────────────────────── */}
      <ChatToast texto={alertaMensaje} />

      {/* Banner activar alertas sonoras — visible hasta que el usuario otorgue permiso */}
      {!audioListo && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center p-3 pointer-events-none">
          <button
            type="button"
            className="pointer-events-auto bg-zinc-900 border border-yellow-500/60 text-yellow-400 font-black text-sm px-5 py-2 rounded-2xl shadow-lg"
            onClick={desbloquearAudios}
          >
            🔊 Activar alertas sonoras
          </button>
        </div>
      )}

      {/* Alerta cambio de estado */}
      {alerta && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 pointer-events-none">
          <div className="bg-yellow-400 text-black rounded-3xl p-8 text-center shadow-2xl animate-pulse max-w-sm w-full">
            <p className="text-base font-black mb-1">🚨 ACTUALIZACIÓN</p>
            <h2 className="text-3xl font-black">{alerta}</h2>
          </div>
        </div>
      )}

      {/* Banner viaje recién publicado — pendiente de pago */}
      {bannerPublicado && (() => {
        const viaje = viajes.find(v => String(v.id) === bannerPublicado);
        return (
          <div className="mb-4 rounded-2xl border-2 border-yellow-400 bg-zinc-900 p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <p className="text-yellow-400 font-black text-sm">✅ Viaje creado</p>
                {viaje && (
                  <p className="text-zinc-300 text-xs mt-0.5 truncate">
                    {viaje.origen} → {viaje.destino}
                  </p>
                )}
                <p className="text-zinc-500 text-xs mt-1">
                  Queda pendiente de pago. Podés pagarlo ahora o después desde el panel.
                </p>
              </div>
              <button type="button" onClick={() => setBannerPublicado(null)}
                className="text-zinc-500 font-black text-lg leading-none flex-shrink-0">×</button>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={pagandoBanner}
                onClick={async () => {
                  const v = viajes.find(vj => String(vj.id) === bannerPublicado);
                  if (!v) { setBannerPublicado(null); return; }
                  setPagandoBanner(true);
                  try {
                    if (!usuario?.id) { alert("Tu sesión expiró. Volvé a iniciar sesión."); setPagandoBanner(false); return; }
                    const res = await fetch("/api/mercadopago/crear-preferencia", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "x-user-id": String(usuario.id) },
                      body: JSON.stringify({
                        carga_id: v.id,
                        monto: v.precio_cliente,
                        descripcion: `TILA · ${v.origen} → ${v.destino}`,
                      }),
                    });
                    const d = await res.json();
                    if (d.init_point) {
                      const { Capacitor } = await import("@capacitor/core");
                      if (Capacitor.isNativePlatform()) {
                        const { Browser } = await import("@capacitor/browser");
                        await Browser.open({ url: d.init_point });
                      } else {
                        window.location.href = d.init_point;
                      }
                    } else { alert("Error al iniciar el pago. Intentá desde la tarjeta del viaje."); }
                  } catch { alert("Error de red al iniciar el pago."); }
                  finally { setPagandoBanner(false); }
                }}
                className="w-full py-3 rounded-xl font-black text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60 transition"
              >
                {pagandoBanner ? "Iniciando pago..." : "💳 Pagar ahora"}
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setBannerPublicado(null)}
                  className="flex-1 py-2.5 rounded-xl font-black text-sm bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition">
                  Pagar después
                </button>
                <button type="button" onClick={() => setBannerPublicado(null)}
                  className="flex-1 py-2.5 rounded-xl font-black text-sm bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition">
                  Ver mis viajes
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 mb-5 flex items-center gap-2 flex-wrap">
        <p className="text-zinc-400 text-xs font-black flex-1">🆘 Soporte TILA</p>
        <a href={`https://wa.me/${SOPORTE_WHATSAPP}`} target="_blank" rel="noreferrer"
          className="bg-green-600 text-white font-black px-3 py-1.5 rounded-xl text-xs">💬 WhatsApp</a>
        <a href={`mailto:${SOPORTE_EMAIL}`}
          className="bg-zinc-700 text-white font-black px-3 py-1.5 rounded-xl text-xs">📧 Email</a>
        <button type="button" onClick={() => setSilenciarChatViaje(v => !v)}
          title={silenciarChatViaje ? "Activar sonido chat chofer" : "Silenciar chat chofer"}
          className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${silenciarChatViaje ? "bg-zinc-700 text-zinc-500" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
          {silenciarChatViaje ? "💬🔕" : "💬🔔"}
        </button>
        <button type="button" onClick={() => setSilenciarSoporteCliente(v => !v)}
          title={silenciarSoporteCliente ? "Activar sonido soporte TILA" : "Silenciar soporte TILA"}
          className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${silenciarSoporteCliente ? "bg-zinc-700 text-zinc-500" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
          {silenciarSoporteCliente ? "🛟🔕" : "🛟🔔"}
        </button>
        <button type="button" onClick={() => setSilenciarAlertas(v => !v)}
          title={silenciarAlertas ? "Activar alertas de viaje" : "Silenciar alertas de viaje"}
          className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${silenciarAlertas ? "bg-zinc-700 text-zinc-500" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
          {silenciarAlertas ? "🔔🔕" : "🔔"}
        </button>
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

                  {/* Aviso cancelación por chofer */}
                  {viaje.estado === "Cancelado por chofer" && (
                    <div className="rounded-xl border border-orange-600 bg-orange-950/60 px-4 py-3">
                      <p className="text-orange-400 font-black text-sm mb-1">⚠️ El chofer canceló el viaje</p>
                      <p className="text-zinc-400 text-xs mb-3">Tu viaje puede volver a quedar disponible para otro chofer.</p>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await fetch("/api/cargas/republicar", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", "x-user-id": String(usuario?.id) },
                            body: JSON.stringify({ carga_id: viaje.id }),
                          });
                          if (!res.ok) {
                            const d = await res.json().catch(() => ({}));
                            alert("No se pudo republicar: " + (d?.error ?? res.status));
                            return;
                          }
                          cargarViajes();
                        }}
                        className="w-full py-2.5 rounded-xl font-black text-sm bg-orange-500 hover:bg-orange-400 text-black transition"
                      >
                        🔄 Buscar nuevo chofer
                      </button>
                    </div>
                  )}

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
                          {chofer.bateria_nivel != null && (
                            <span className="text-green-400">🔋 {chofer.bateria_nivel}%{chofer.bateria_cargando ? " ⚡" : ""}</span>
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

                  {/* Botón seguimiento — visible si hay chofer asignado o viaje no pendiente */}
                  {(viaje.chofer_id || (viaje.estado && viaje.estado !== "pendiente")) && (
                    <button type="button" onClick={() => setViajeSeleccionado(viaje)}
                      className="w-full py-3 rounded-xl font-black text-sm bg-yellow-400 text-black hover:bg-yellow-300 active:scale-[0.98] transition">
                      {tieneGps ? "📡 Ver ubicación del chofer" : "👁️ Ver seguimiento"}
                    </button>
                  )}

                  {/* Botones de chat por viaje */}
                  {viaje.estado && !["pendiente", "pendiente_pago"].includes(viaje.estado) && usuario?.id && (
                    <div className="flex gap-2">
                      <button type="button"
                        onClick={() => {
                          const id = String(viaje.id);
                          if (chatListaViajeId === id && tipoChatLista === "viaje") { setChatListaViajeId(null); }
                          else {
                            setChatListaViajeId(id); setTipoChatLista("viaje");
                            setNoLeidosPorViaje(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), viaje: 0 } }));
                            setAlertaMensaje(null);
                            if (alertaTimerRef.current) clearTimeout(alertaTimerRef.current);
                          }
                        }}
                        className={`relative flex-1 py-2 rounded-xl text-xs font-black transition ${chatListaViajeId === String(viaje.id) && tipoChatLista === "viaje" ? "bg-blue-600 text-white" : (noLeidosPorViaje[String(viaje.id)]?.viaje ?? 0) > 0 ? "bg-blue-900 border border-blue-500 text-blue-300" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
                        💬 Chat con chofer
                        {(noLeidosPorViaje[String(viaje.id)]?.viaje ?? 0) > 0 && !(chatListaViajeId === String(viaje.id) && tipoChatLista === "viaje") && (
                          <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-black rounded-full min-w-5 h-5 flex items-center justify-center px-1 animate-pulse">
                            {noLeidosPorViaje[String(viaje.id)].viaje}
                          </span>
                        )}
                      </button>
                      <button type="button"
                        onClick={() => {
                          const id = String(viaje.id);
                          if (chatListaViajeId === id && tipoChatLista === "soporte_cliente") { setChatListaViajeId(null); }
                          else {
                            setChatListaViajeId(id); setTipoChatLista("soporte_cliente");
                            setNoLeidosPorViaje(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), soporte_cliente: 0 } }));
                            setAlertaMensaje(null);
                            if (alertaTimerRef.current) clearTimeout(alertaTimerRef.current);
                          }
                        }}
                        className={`relative flex-1 py-2 rounded-xl text-xs font-black transition ${chatListaViajeId === String(viaje.id) && tipoChatLista === "soporte_cliente" ? "bg-orange-600 text-white" : (noLeidosPorViaje[String(viaje.id)]?.soporte_cliente ?? 0) > 0 ? "bg-orange-900 border border-orange-500 text-orange-300" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
                        🛟 Soporte TILA
                        {(noLeidosPorViaje[String(viaje.id)]?.soporte_cliente ?? 0) > 0 && !(chatListaViajeId === String(viaje.id) && tipoChatLista === "soporte_cliente") && (
                          <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-black rounded-full min-w-5 h-5 flex items-center justify-center px-1 animate-pulse">
                            {noLeidosPorViaje[String(viaje.id)].soporte_cliente}
                          </span>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Panel chat inline */}
                  {chatListaViajeId === String(viaje.id) && usuario?.id && (
                    <div className="mt-1 border border-zinc-700 rounded-3xl overflow-hidden flex flex-col" style={{ height: 400 }}>
                      <div className="flex-shrink-0 flex gap-2 px-3 pt-2 pb-2 bg-zinc-800 border-b border-zinc-700">
                        <button type="button"
                          onClick={() => { setTipoChatLista("viaje"); setNoLeidosPorViaje(prev => ({ ...prev, [String(viaje.id)]: { ...(prev[String(viaje.id)] ?? {}), viaje: 0 } })); }}
                          className={`px-3 py-1 rounded-xl text-xs font-black transition ${tipoChatLista === "viaje" ? "bg-blue-600 text-white" : "bg-zinc-700 text-zinc-400"}`}>
                          💬 Con chofer
                        </button>
                        <button type="button"
                          onClick={() => { setTipoChatLista("soporte_cliente"); setNoLeidosPorViaje(prev => ({ ...prev, [String(viaje.id)]: { ...(prev[String(viaje.id)] ?? {}), soporte_cliente: 0 } })); }}
                          className={`px-3 py-1 rounded-xl text-xs font-black transition ${tipoChatLista === "soporte_cliente" ? "bg-orange-600 text-white" : "bg-zinc-700 text-zinc-400"}`}>
                          🛟 Soporte TILA
                        </button>
                        <button type="button" onClick={() => setChatListaViajeId(null)} className="ml-auto text-zinc-500 font-black px-2">✕</button>
                      </div>
                      <div className="flex-1 min-h-0">
                        <ChatAsistencia
                          viajeId={String(viaje.id)}
                          usuarioId={usuario.id}
                          usuarioRol="cliente"
                          usuarioNombre={usuario.nombre || "Cliente"}
                          tipoChat={tipoChatLista}
                          modoInline
                        />
                      </div>
                    </div>
                  )}

                  {/* Cancelar viaje — hasta antes de "Carga retirada" */}
                  {["pendiente", "Chofer asignado", "En camino"].includes(viaje.estado) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = window.confirm(
                          viaje.pago_estado === "pagado"
                            ? "¿Cancelar el viaje? Como ya fue pagado, quedará marcado para revisión. El equipo de TILA se contactará con vos."
                            : "¿Cancelar el viaje?"
                        );
                        if (!ok) return;
                        const res = await fetch("/api/cargas/cancelar-cliente", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", "x-user-id": String(usuario?.id) },
                          body: JSON.stringify({ carga_id: viaje.id }),
                        });
                        if (!res.ok) {
                          const d = await res.json().catch(() => ({}));
                          alert("No se pudo cancelar: " + (d?.error ?? res.status));
                          return;
                        }
                        cargarViajes();
                      }}
                      className="w-full py-2.5 rounded-xl font-black text-xs bg-zinc-900 border border-red-800 text-red-400 hover:bg-red-950 transition"
                    >
                      Cancelar viaje
                    </button>
                  )}

                  {/* Botón pagar — solo cuando corresponde */}
                  {(viaje.pago_estado === "pendiente_pago" || viaje.pago_estado === "rechazado") && (() => {
                    const enEjecucion = ["En camino", "Carga retirada", "En ruta", "Descarga completada"].includes(viaje.estado);
                    if (enEjecucion) {
                      return (
                        <div className="flex flex-col gap-2">
                          <div className="rounded-xl border border-orange-700 bg-orange-950/50 px-4 py-3 text-center">
                            <p className="text-orange-400 font-black text-sm">⏳ Pago pendiente del cliente</p>
                            <p className="text-zinc-500 text-xs mt-1">Podés pagarlo ahora o al finalizar el viaje.</p>
                          </div>
                          <button
                            type="button"
                            className="w-full py-3 rounded-xl font-black text-sm bg-zinc-800 border border-blue-600 text-blue-400 hover:bg-blue-950 active:scale-[0.98] transition"
                            onClick={async () => {
                              try {
                                if (!usuario?.id) { alert("Tu sesión expiró. Volvé a iniciar sesión."); return; }
                                const payload = {
                                  carga_id: viaje.id,
                                  monto: viaje.precio_cliente,
                                  descripcion: `TILA · ${viaje.origen} → ${viaje.destino}`,
                                };
                                const res = await fetch("/api/mercadopago/crear-preferencia", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json", "x-user-id": String(usuario.id) },
                                  body: JSON.stringify(payload),
                                });
                                const d = await res.json();
                                if (d.init_point) {
                                  const { Capacitor } = await import("@capacitor/core");
                                  if (Capacitor.isNativePlatform()) {
                                    const { Browser } = await import("@capacitor/browser");
                                    await Browser.open({ url: d.init_point });
                                  } else {
                                    window.location.href = d.init_point;
                                  }
                                } else { alert("Error al iniciar el pago. Intentá de nuevo."); }
                              } catch { alert("Error de red al iniciar el pago."); }
                            }}
                          >
                            💳 Pagar ahora
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="w-full py-3.5 rounded-xl font-black text-sm bg-blue-600 hover:bg-blue-500 text-white active:scale-[0.98] transition"
                          onClick={async () => {
                            try {
                              if (!usuario?.id) { alert("Tu sesión expiró. Volvé a iniciar sesión."); return; }
                              const payload = {
                                carga_id: viaje.id,
                                monto: viaje.precio_cliente,
                                descripcion: `TILA · ${viaje.origen} → ${viaje.destino}`,
                              };
                              const res = await fetch("/api/mercadopago/crear-preferencia", {
                                method: "POST",
                                headers: { "Content-Type": "application/json", "x-user-id": String(usuario.id) },
                                body: JSON.stringify(payload),
                              });
                              const d = await res.json();
                              if (d.init_point) {
                                const { Capacitor } = await import("@capacitor/core");
                                if (Capacitor.isNativePlatform()) {
                                  const { Browser } = await import("@capacitor/browser");
                                  await Browser.open({ url: d.init_point });
                                } else {
                                  window.location.href = d.init_point;
                                }
                              } else {
                                alert("Error al iniciar el pago. Intentá de nuevo.");
                              }
                            } catch {
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
                    );
                  })()}
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