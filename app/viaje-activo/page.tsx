"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import MapaTILA, { ParadaMapa } from "../components/MapaTILA";
import ChatAsistencia from "../components/ChatAsistencia";

const ESTADOS_ORDEN = [
  { nombre: "En camino",           color: "bg-yellow-400 text-black",  label: "INICIAR VIAJE" },
  { nombre: "Carga retirada",      color: "bg-blue-600 text-white",    label: "CARGA RETIRADA" },
  { nombre: "En ruta",             color: "bg-purple-600 text-white",  label: "INICIAR TRAMO A DESTINO" },
  { nombre: "Descarga completada", color: "bg-red-600 text-white",     label: "DESCARGA COMPLETADA" },
  { nombre: "Viaje finalizado",    color: "bg-green-600 text-white",   label: "FINALIZAR VIAJE" },
];

const LABELS = ["A", "B", "C", "D", "E", "F"];

const getTipoParadaLabel = (tipo: string) => {
  if (tipo === "retiro")  return "📦 Retiro";
  if (tipo === "entrega") return "🏁 Entrega";
  return "📍 Parada";
};


// ─── Instrucción operativa por estado ────────────────────────────────────────
interface InstruccionViaje {
  emoji: string;
  titulo: string;
  subtitulo: string;
  colorBorde: string;
}

function getInstruccion(
  estado: string,
  paradaActiva: { tipo: string; direccion: string } | null,
  paradas: any[],
  paradaActivaIndex: number
): InstruccionViaje {
  const labelParada =
    paradas.length > 0 && paradaActivaIndex < paradas.length
      ? paradas[paradaActivaIndex]?.tipo === "retiro"
        ? "retiro"
        : paradas[paradaActivaIndex]?.tipo === "entrega"
        ? "entrega"
        : `parada ${String.fromCharCode(65 + paradaActivaIndex)}`
      : null;

  switch (estado) {
    case "Chofer asignado":
      return { emoji: "🚛", titulo: "Iniciá el viaje", subtitulo: "Dirigite al punto de retiro", colorBorde: "border-green-500" };
    case "En camino":
      return { emoji: "📦", titulo: "En camino al retiro", subtitulo: labelParada ? `Llegá al ${labelParada} y confirmá` : "Llegá al retiro y confirmá la carga", colorBorde: "border-yellow-400" };
    case "Carga retirada":
      return { emoji: "✅", titulo: "Carga retirada", subtitulo: "Iniciá el traslado al destino", colorBorde: "border-blue-500" };
    case "En ruta":
      return { emoji: "🏁", titulo: "En ruta al destino", subtitulo: labelParada ? `Dirigite a la ${labelParada}` : "Dirigite al punto de entrega", colorBorde: "border-purple-500" };
    case "Descarga completada":
      return { emoji: "🏆", titulo: "Descarga completada", subtitulo: "Confirmá la finalización del viaje", colorBorde: "border-red-500" };
    case "Viaje finalizado":
      return { emoji: "🎉", titulo: "Viaje finalizado", subtitulo: "Excelente trabajo", colorBorde: "border-green-400" };
    default:
      return { emoji: "🚛", titulo: estado || "Viaje activo", subtitulo: "Seguí las instrucciones", colorBorde: "border-zinc-600" };
  }
}

const esUuidValido = (valor: any) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(valor || ""));

const formatearFecha = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

export default function ViajeActivoPage() {
  const { autorizado } = useProtegerRuta("chofer");
  const router = useRouter();

  const [viaje, setViaje]             = useState<any>(null);
  const [cargando, setCargando]       = useState(true);
  const [festejo, setFestejo]         = useState(false);
  const [gpsEstado, setGpsEstado]     = useState("GPS...");
  const [velocidadGps, setVelocidadGps] = useState(0);
  const [ultimaSenal, setUltimaSenal] = useState("");

  const [bateriaNivel, setBateriaNivel]       = useState<number | null>(null);
  const [bateriaCargando, setBateriaCargando] = useState<boolean | null>(null);
  const [bateriaDisponible, setBateriaDisponible] = useState(false);

  const [paradas, setParadas]                     = useState<any[]>([]);
  const [paradaActivaIndex, setParadaActivaIndex] = useState(0);
  const [confirmandoParada, setConfirmandoParada] = useState(false);

  // ─── UI toggles ──────────────────────────────────────────────────────────
  const [mostrarChat, setMostrarChat]           = useState(false);
  const [mostrarDetalles, setMostrarDetalles]   = useState(false);
  const [mostrarNavegadores, setMostrarNavegadores] = useState(false);
  const [mostrarSoporte, setMostrarSoporte]         = useState(false);
  const [navegadorPreferido, setNavegadorPreferido] = useState<string | null>(null);

  const viajeTerminado = useRef(false);
  const usuarioRef     = useRef<any>(null);

  useEffect(() => {
    const u = localStorage.getItem("usuario");
    if (u) usuarioRef.current = JSON.parse(u);
  }, []);

  // ─── Battery API ──────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        if (!("getBattery" in navigator)) { setBateriaDisponible(false); return; }
        const battery = await (navigator as any).getBattery();
        setBateriaDisponible(true);
        setBateriaNivel(Math.round(battery.level * 100));
        setBateriaCargando(battery.charging);
        battery.addEventListener("levelchange",    () => setBateriaNivel(Math.round(battery.level * 100)));
        battery.addEventListener("chargingchange", () => setBateriaCargando(battery.charging));
      } catch { setBateriaDisponible(false); }
    };
    init();
  }, []);

  useEffect(() => {
    if (!bateriaDisponible || bateriaNivel === null || !usuarioRef.current?.id) return;
    supabase.from("usuarios").update({
      bateria_nivel: bateriaNivel,
      bateria_cargando: bateriaCargando,
      ultima_senal_at: new Date().toISOString(),
    }).eq("id", usuarioRef.current.id).then(() => {});
  }, [bateriaNivel, bateriaCargando, bateriaDisponible]);

  // ─── Lógica de parada activa ──────────────────────────────────────────────
  const paradaActiva = useMemo(() => {
    if (paradas.length > 0) {
      const p = paradas[paradaActivaIndex];
      if (!p) return null;
      return { tipo: p.tipo === "retiro" ? "RETIRO" : "ENTREGA", direccion: p.direccion };
    }
    if (!viaje) return null;
    const estadosRetiro  = ["Chofer asignado", "En camino"];
    const estadosEntrega = ["Carga retirada", "En ruta"];
    if (estadosRetiro.includes(viaje.estado))  return { tipo: "RETIRO",  direccion: viaje.origen };
    if (estadosEntrega.includes(viaje.estado)) return { tipo: "ENTREGA", direccion: viaje.destino };
    return null;
  }, [paradas, paradaActivaIndex, viaje?.estado, viaje?.origen, viaje?.destino]);

  // ─── Destino de ruta según estado — lógica tipo Uber ─────────────────────
  const destinoRuta = useMemo((): string | null => {
    if (!viaje) return null;
    const estado = viaje.estado || "Chofer asignado";
    // Chofer va hacia el punto de retiro
    if (["Chofer asignado", "En camino"].includes(estado)) {
      return paradas.length > 0
        ? paradas.find(p => p.tipo === "retiro")?.direccion ?? viaje.origen
        : viaje.origen;
    }
    // Chofer va hacia la próxima parada o destino final
    if (["Carga retirada", "En ruta"].includes(estado)) {
      if (paradas.length > 0 && paradaActivaIndex < paradas.length) {
        return paradas[paradaActivaIndex].direccion;
      }
      return viaje.destino;
    }
    // Descarga completada — mostrar destino final estático
    if (estado === "Descarga completada") return viaje.destino;
    return null;
  }, [viaje?.estado, viaje?.origen, viaje?.destino, paradas, paradaActivaIndex]);

  const paradasParaMapa: ParadaMapa[] = useMemo(() => {
    if (paradas.length === 0) return [];
    return paradas.map((p, i) => ({
      direccion: p.direccion,
      tipo:      p.tipo as "retiro" | "entrega" | "parada",
      estado:    i < paradaActivaIndex ? "completada" : i === paradaActivaIndex ? "en_curso" : "pendiente",
    }));
  }, [paradas, paradaActivaIndex]);

  const todasParadasCompletadas = useMemo(() =>
    paradas.length > 0 && paradaActivaIndex >= paradas.length,
  [paradas, paradaActivaIndex]);

  // ─── Botón de estado activo según estado actual ───────────────────────────
  const botonActivo = useMemo(() => {
    const estadoActualIdx = ESTADOS_ORDEN.findIndex(e => e.nombre === viaje?.estado);
    if (viaje?.estado === "Chofer asignado") return ESTADOS_ORDEN[0]; // primer paso
    if (estadoActualIdx >= 0 && estadoActualIdx < ESTADOS_ORDEN.length - 1) {
      return ESTADOS_ORDEN[estadoActualIdx + 1];
    }
    if (estadoActualIdx === ESTADOS_ORDEN.length - 1) return ESTADOS_ORDEN[estadoActualIdx];
    return ESTADOS_ORDEN[0];
  }, [viaje?.estado]);

  const bloqueadoPorParadas =
    botonActivo?.nombre === "Viaje finalizado" && paradas.length > 0 && !todasParadasCompletadas;

  // Instrucción operativa actual
  const instruccion = useMemo(() =>
    getInstruccion(viaje?.estado || "", paradaActiva, paradas, paradaActivaIndex),
  [viaje?.estado, paradaActiva, paradas, paradaActivaIndex]);

  // ─── Realtime ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const viajeId = localStorage.getItem("viajeActivoId");
    if (!viajeId) return;
    const canal = supabase.channel(`viaje-activo-rt-${viajeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cargas", filter: `id=eq.${viajeId}` },
        (payload) => { if (payload.new) setViaje(payload.new); })
      .on("postgres_changes", { event: "*", schema: "public", table: "paradas_viaje", filter: `carga_id=eq.${viajeId}` },
        () => {
          supabase.from("paradas_viaje").select("*")
            .eq("carga_id", Number(viajeId)).order("orden", { ascending: true })
            .then(({ data }) => {
              if (data?.length) {
                setParadas(data);
                const idx = data.findIndex(p => p.estado !== "completada");
                setParadaActivaIndex(idx === -1 ? data.length : idx);
              }
            });
        })
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, []);

  useEffect(() => { cargarViajeActivo(); }, []);

  // ─── GPS ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!viaje?.id) return;
    if (!navigator.geolocation) { setGpsEstado("Sin GPS"); return; }
    setGpsEstado("...");
    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        if (viajeTerminado.current) return;
        const lat      = pos.coords.latitude;
        const lng      = pos.coords.longitude;
        const velocidad = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        const now      = new Date().toISOString();
        setGpsEstado("🟢");
        setUltimaSenal(new Date(now).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }));
        setVelocidadGps(velocidad);
        setViaje((prev: any) => prev ? { ...prev, lat, lng, velocidad, gps_actualizado: now } : prev);
        await supabase.from("cargas").update({ lat, lng, velocidad, velocidad_kmh: velocidad, gps_actualizado: now }).eq("id", viaje.id);
        if (usuarioRef.current?.id) {
          await supabase.from("usuarios").update({ ultima_senal_at: now, bateria_nivel: bateriaNivel, bateria_cargando: bateriaCargando }).eq("id", usuarioRef.current.id);
        }
      },
      (err) => {
        if (err.code === 1) setGpsEstado("🔴 Denegado");
        else setGpsEstado("🔴 Error");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [viaje?.id, bateriaNivel, bateriaCargando]);

  const cargarViajeActivo = async () => {
    const viajeId = localStorage.getItem("viajeActivoId");
    if (!viajeId) { router.replace("/panel-chofer"); return; }
    const { data, error } = await supabase.from("cargas").select("*").eq("id", viajeId).single();
    if (error) { alert("Error al cargar viaje"); return; }
    setViaje(data);
    // Cargar navegador preferido del chofer
    const u = localStorage.getItem("usuario");
    if (u) {
      const usuario = JSON.parse(u);
      const { data: perfil } = await supabase
        .from("usuarios").select("navegador_preferido").eq("id", usuario.id).single();
      if (perfil?.navegador_preferido) setNavegadorPreferido(perfil.navegador_preferido);
    }
    const { data: dp } = await supabase.from("paradas_viaje").select("*")
      .eq("carga_id", Number(viajeId)).order("orden", { ascending: true });
    if (dp?.length) {
      setParadas(dp);
      const idx = dp.findIndex(p => p.estado !== "completada");
      setParadaActivaIndex(idx === -1 ? dp.length : idx);
    }
    setCargando(false);
  };

  const confirmarParadaCompletada = async () => {
    if (confirmandoParada || paradaActivaIndex >= paradas.length) return;
    const p = paradas[paradaActivaIndex];
    if (!p?.id) return;
    setConfirmandoParada(true);
    const { error } = await supabase.from("paradas_viaje").update({ estado: "completada", completada_at: new Date().toISOString() }).eq("id", p.id);
    if (error) { alert("Error: " + error.message); setConfirmandoParada(false); return; }
    const nuevas = [...paradas];
    nuevas[paradaActivaIndex] = { ...p, estado: "completada", completada_at: new Date().toISOString() };
    setParadas(nuevas);
    setParadaActivaIndex(paradaActivaIndex + 1);
    setConfirmandoParada(false);
  };

  const acreditarBilletera = async (data: any) => {
    const choferId = data?.chofer_id;
    const viajeId  = data?.id;
    const monto    = Number(data?.pago_chofer || 0);
    if (!choferId || !esUuidValido(choferId) || !viajeId || !monto) return;
    const { data: existe } = await supabase.from("billetera_chofer").select("id").eq("viaje_id", String(viajeId)).maybeSingle();
    if (existe) return;
    await supabase.from("billetera_chofer").insert([{ chofer_id: choferId, viaje_id: String(viajeId), monto }]);
  };

  const actualizarEstado = async (nuevoEstado: string) => {
    if (!viaje?.id) return;
    if (bloqueadoPorParadas) { alert("Completá todas las paradas antes de finalizar"); return; }
    if (nuevoEstado === "Viaje finalizado") {
      new Audio("/sounds/alerta-viaje.mp3").play().catch(() => {});
    }
    const now = new Date().toISOString();
    const upd: any = { estado: nuevoEstado };
    if (nuevoEstado === "En camino")       upd.hora_inicio     = now;
    if (nuevoEstado === "Chofer asignado") upd.hora_aceptacion = now;
    if (nuevoEstado === "Viaje finalizado") {
      upd.tracking = false; upd.hora_finalizacion = now; viajeTerminado.current = true;
    }
    const { data, error } = await supabase.from("cargas").update(upd).eq("id", viaje.id).select().single();
    if (error) { alert("Error al actualizar estado"); viajeTerminado.current = false; return; }
    setViaje(data);

    // ── Navegación automática según nueva etapa ───────────────────────────
    // "En camino": chofer va al retiro
    if (nuevoEstado === "En camino") {
      const destRetiro = paradas.find(p => p.tipo === "retiro")?.direccion ?? viaje.origen;
      handleNavegar(destRetiro);
    }
    // "En ruta": chofer va al destino (después de retirar carga)
    if (nuevoEstado === "En ruta") {
      const destEntrega = paradas.length > 0
        ? (paradas.find((p, i) => i >= paradaActivaIndex && p.tipo !== "retiro")?.direccion ?? viaje.destino)
        : viaje.destino;
      handleNavegar(destEntrega);
    }

    if (nuevoEstado === "Viaje finalizado") {
      await acreditarBilletera(data);
      localStorage.removeItem("viajeActivoId");
      setFestejo(true);
      setTimeout(() => router.push("/panel-chofer"), 5000);
    }
  };

  // ─── Navegación externa ──────────────────────────────────────────────────
  const NAVEGADORES = [
    { id: "google_maps", label: "Google Maps", emoji: "🗺️" },
    { id: "waze",        label: "Waze",        emoji: "📡" },
  ];

  // buildNavUrl — sin origin/ll: el dispositivo usa su propio GPS
  // Google Maps y Waze capturan la ubicación del dispositivo automáticamente
  const buildNavUrl = (navId: string, dest: string): string => {
    const destEnc = encodeURIComponent(dest + ", Argentina");
    if (navId === "waze") {
      return `https://waze.com/ul?q=${destEnc}&navigate=yes`;
    }
    // Google Maps — travelmode=driving, sin origin
    return `https://www.google.com/maps/dir/?api=1&destination=${destEnc}&travelmode=driving`;
  };

  const abrirNavegador = (navId: string, destOverride?: string) => {
    if (!viaje) return;
    const dest = destOverride ?? destinoRuta ?? viaje.destino;
    const url  = buildNavUrl(navId, dest);
    window.open(url, `_nav_${Date.now()}`);
    setMostrarNavegadores(false);
  };

  // Abre el navegador preferido o muestra selector
  // destOverride: forzar un destino específico (ej: al cambiar etapa)
  const handleNavegar = (destOverride?: string) => {
    if (!viaje) return;
    if (viaje.estado === "Descarga completada" || viaje.estado === "Viaje finalizado") return;
    const nav = navegadorPreferido;
    const navValido = nav && nav !== "preguntar_siempre" && nav !== "sygic_truck" && nav !== "tomtom_truck"
      ? nav : null;
    if (!navValido) {
      setMostrarNavegadores(true);
    } else {
      abrirNavegador(navValido, destOverride);
    }
  };

  // ─── Guards ───────────────────────────────────────────────────────────────
  if (!autorizado) return (
    <main className="min-h-screen bg-black flex items-center justify-center">
      <p className="text-yellow-400 font-black text-2xl animate-pulse">Cargando...</p>
    </main>
  );
  if (cargando) return (
    <main className="min-h-screen bg-black flex items-center justify-center">
      <p className="text-yellow-400 font-black text-2xl animate-pulse">Cargando viaje...</p>
    </main>
  );
  if (festejo) return (
    <main className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="bg-green-600 border-4 border-white rounded-3xl p-8 text-center shadow-2xl animate-pulse max-w-xl w-full">
        <h1 className="text-5xl font-black mb-4">🎉 VIAJE FINALIZADO 🎉</h1>
        <div className="text-7xl mb-4 animate-bounce">💼💰</div>
        <p className="text-2xl font-bold mb-2">Excelente trabajo chofer 🚛</p>
        <p className="text-4xl font-black text-yellow-300 mb-4">${Number(viaje?.pago_chofer || 0).toLocaleString()}</p>
        <p className="text-lg">Volviendo al panel...</p>
      </div>
    </main>
  );

  const colorEstadoBadge = () => {
    switch (viaje.estado) {
      case "Chofer asignado":    return "bg-green-600";
      case "En camino":          return "bg-yellow-400 text-black";
      case "Carga retirada":     return "bg-blue-600";
      case "En ruta":            return "bg-purple-600";
      case "Descarga completada": return "bg-red-600";
      case "Viaje finalizado":   return "bg-green-500";
      default:                   return "bg-zinc-700";
    }
  };

  const bateriaBadge = bateriaDisponible && bateriaNivel !== null
    ? `🔋 ${bateriaNivel}%${bateriaCargando ? "⚡" : ""}`
    : null;

  return (
    <main className="fixed inset-0 bg-black overflow-hidden">

      {/* ─── MAPA — ocupa toda la pantalla ─────────────────────────────── */}
      <div className="absolute inset-0" style={{ height: "100dvh", width: "100vw" }}>
        <MapaTILA
          lat={viaje?.lat}
          lng={viaje?.lng}
          origen={viaje.origen}
          destino={viaje.destino}
          paradaActivaDireccion={destinoRuta}
          paradas={paradasParaMapa.length > 0 ? paradasParaMapa : undefined}
          altura="100dvh"
          modoNavegacion={true}
        />
      </div>

      {/* ─── HEADER FLOTANTE ────────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-20 p-3">
        <div className="bg-black/85 backdrop-blur-sm rounded-2xl px-4 py-3 border border-zinc-800">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-yellow-400 font-black text-sm truncate flex-1">
              {viaje.origen} → {viaje.destino}
            </p>
            <span className={`text-xs font-black px-2 py-1 rounded-lg flex-shrink-0 ${colorEstadoBadge()}`}>
              {viaje.estado || "Asignado"}
            </span>
          </div>
          {/* Estado dispositivo en una línea */}
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className={gpsEstado === "🟢" ? "text-green-400" : "text-yellow-400"}>{gpsEstado} GPS</span>
            <span className="text-yellow-400">{velocidadGps} km/h</span>
            {ultimaSenal && <span>{ultimaSenal}</span>}
            {bateriaBadge && <span className={bateriaNivel !== null && bateriaNivel < 20 ? "text-red-400" : "text-zinc-400"}>{bateriaBadge}</span>}
          </div>
        </div>
      </div>

      {/* ─── BOTTOM FLOTANTE — acción principal ─────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-3">
        <div className="bg-black/90 backdrop-blur-sm rounded-3xl p-4 border border-zinc-800 space-y-3">

          {/* Tarjeta instrucción operativa */}
          <div className={`flex items-center gap-3 rounded-2xl px-3 py-2 border ${instruccion.colorBorde} bg-zinc-900/80`}>
            <span className="text-2xl flex-shrink-0">{instruccion.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-white font-black text-sm leading-tight">{instruccion.titulo}</p>
              <p className="text-zinc-400 text-xs truncate">{instruccion.subtitulo}</p>
            </div>
            {paradaActiva && (
              <span className={`text-xs font-black px-2 py-1 rounded-lg flex-shrink-0 ${paradaActiva.tipo === "RETIRO" ? "bg-blue-600 text-white" : "bg-green-600 text-white"}`}>
                {paradaActiva.tipo}
              </span>
            )}
          </div>

          {/* Dirección objetivo */}
          {paradaActiva && (
            <p className="text-zinc-300 text-xs font-black truncate px-1">📍 {paradaActiva.direccion}</p>
          )}

          {/* Confirmar parada si corresponde */}
          {paradas.length > 0 && !todasParadasCompletadas && paradaActivaIndex < paradas.length && (
            <button
              type="button"
              onClick={confirmarParadaCompletada}
              disabled={confirmandoParada}
              className={`w-full py-3 rounded-2xl font-black text-sm transition ${confirmandoParada ? "bg-zinc-700 text-zinc-400" : "bg-blue-600 hover:bg-blue-500 text-white"}`}
            >
              {confirmandoParada ? "Confirmando..." : `✅ Confirmar ${LABELS[paradaActivaIndex] || ""} completada`}
            </button>
          )}

          {/* Botón de estado principal */}
          {botonActivo && (
            <button
              type="button"
              onClick={() => actualizarEstado(botonActivo.nombre)}
              disabled={bloqueadoPorParadas}
              className={`w-full py-4 rounded-2xl font-black text-lg transition ${
                bloqueadoPorParadas
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  : `${botonActivo.color} hover:opacity-90 hover:scale-[1.02]`
              } ${viaje.estado === botonActivo.nombre ? "ring-2 ring-white" : ""}`}
            >
              {botonActivo.label}{bloqueadoPorParadas ? " 🔒" : ""}
            </button>
          )}

          {/* Botones secundarios */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setMostrarChat(v => !v); setMostrarSoporte(false); }}
              className={`flex-1 py-2 rounded-xl text-xs font-black transition ${mostrarChat ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            >
              💬 Chat
            </button>
            <button
              type="button"
              onClick={() => setMostrarDetalles(v => !v)}
              className={`flex-1 py-2 rounded-xl text-xs font-black transition ${mostrarDetalles ? "bg-zinc-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            >
              📋 Detalles
            </button>
            <button
              type="button"
              onClick={() => { setMostrarSoporte(v => !v); setMostrarChat(false); }}
              className={`flex-1 py-2 rounded-xl text-xs font-black transition ${mostrarSoporte ? "bg-orange-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            >
              🛟 Soporte
            </button>
          </div>
        </div>
      </div>

      {/* ─── PANEL CHAT — slide sobre el bottom ────────────────────────── */}
      {mostrarChat && viaje?.id && usuarioRef.current?.id && (
        <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[60vh] overflow-y-auto bg-zinc-900 border-t border-zinc-700 rounded-t-3xl">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800">
            <p className="text-blue-400 font-black text-sm">💬 Chat del viaje</p>
            <button type="button" onClick={() => setMostrarChat(false)} className="text-zinc-400 font-black text-sm">✕</button>
          </div>
          <ChatAsistencia
            viajeId={viaje.id}
            usuarioId={usuarioRef.current.id}
            usuarioRol="chofer"
            usuarioNombre={usuarioRef.current.nombre || "Chofer"}
          />
        </div>
      )}

      {/* ─── PANEL DETALLES — slide sobre el bottom ────────────────────── */}
      {mostrarDetalles && (
        <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[70vh] overflow-y-auto bg-zinc-900 border-t border-zinc-700 rounded-t-3xl">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800">
            <p className="text-yellow-400 font-black text-sm">📋 Detalles del viaje</p>
            <button type="button" onClick={() => setMostrarDetalles(false)} className="text-zinc-400 font-black text-sm">✕</button>
          </div>
          <div className="p-4 space-y-4">

            {/* Paradas */}
            {paradas.length > 0 && (
              <div>
                <p className="text-zinc-500 text-xs font-black mb-2">PARADAS</p>
                <div className="space-y-2">
                  {paradas.map((p, i) => {
                    const esActiva     = i === paradaActivaIndex;
                    const esCompletada = i < paradaActivaIndex;
                    return (
                      <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl ${
                        esActiva ? "bg-yellow-400/10 border border-yellow-400" :
                        esCompletada ? "bg-green-900/30 border border-green-700" :
                        "bg-zinc-800 border border-zinc-700"
                      }`}>
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${
                          esCompletada ? "bg-green-500 text-white" : esActiva ? "bg-yellow-400 text-black" : "bg-zinc-600 text-zinc-400"
                        }`}>{LABELS[i] || i}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-zinc-400 text-xs">{getTipoParadaLabel(p.tipo)}</p>
                          <p className={`font-black text-sm truncate ${esActiva ? "text-yellow-400" : esCompletada ? "text-green-400" : "text-zinc-300"}`}>
                            {p.direccion}
                          </p>
                          {p.completada_at && <p className="text-zinc-500 text-xs">{formatearFecha(p.completada_at)}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cronología */}
            <div>
              <p className="text-zinc-500 text-xs font-black mb-2">CRONOLOGÍA</p>
              <div className="space-y-1 text-xs text-zinc-300">
                {viaje.created_at      && <p>📋 Publicado: {formatearFecha(viaje.created_at)}</p>}
                {viaje.hora_aceptacion && <p>✅ Aceptado: <span className="text-green-400">{formatearFecha(viaje.hora_aceptacion)}</span></p>}
                {viaje.hora_inicio     && <p>🚛 En camino: <span className="text-yellow-400">{formatearFecha(viaje.hora_inicio)}</span></p>}
                {paradas.filter(p => p.completada_at).map((p, i) => (
                  <p key={p.id}>{LABELS[i]} completada: <span className="text-green-400">{formatearFecha(p.completada_at)}</span></p>
                ))}
                {viaje.hora_finalizacion && <p>🏆 Finalizado: <span className="text-green-400">{formatearFecha(viaje.hora_finalizacion)}</span></p>}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ─── PANEL SOPORTE TILA — chofer ↔ admin ──────────────────────── */}
      {mostrarSoporte && viaje?.id && usuarioRef.current?.id && (
        <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[60vh] overflow-y-auto bg-zinc-900 border-t border-orange-600 rounded-t-3xl">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800">
            <div>
              <p className="text-orange-400 font-black text-sm">🛟 Soporte TILA</p>
              <p className="text-zinc-500 text-xs">Problemas operativos · Incidentes · Soporte técnico</p>
            </div>
            <button type="button" onClick={() => setMostrarSoporte(false)} className="text-zinc-400 font-black text-sm px-2">✕</button>
          </div>
          <ChatAsistencia
            viajeId={viaje.id}
            usuarioId={usuarioRef.current.id}
            usuarioRol="chofer"
            usuarioNombre={usuarioRef.current.nombre || "Chofer"}
          />
        </div>
      )}

      {/* ─── MODAL SELECCIÓN NAVEGADOR ────────────────────────────────── */}
      {mostrarNavegadores && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-end p-4">
          <div className="w-full bg-zinc-900 border border-zinc-700 rounded-3xl p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-yellow-400 font-black text-base">🧭 Elegí tu navegador</p>
              <button type="button" onClick={() => setMostrarNavegadores(false)}
                className="text-zinc-400 font-black text-sm px-2">✕</button>
            </div>
            {/* Aviso legal oficial */}
            <div className="bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-400 border border-yellow-700/40">
              ⚠️ TILA no se responsabiliza por el navegador utilizado por el conductor. La elección de ruta, restricciones viales, multas, accesos y decisiones de conducción son responsabilidad exclusiva del conductor.
            </div>
            {/* Destino actual */}
            {(destinoRuta ?? viaje?.destino) && (
              <p className="text-zinc-300 text-xs px-1">📍 Destino: <span className="text-white font-black">{destinoRuta ?? viaje.destino}</span></p>
            )}
            {/* Opciones */}
            <div className="grid grid-cols-2 gap-3">
              {NAVEGADORES.map(nav => (
                <button key={nav.id} type="button" onClick={() => abrirNavegador(nav.id)}
                  className="flex items-center gap-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-2xl px-4 py-4 font-black text-sm text-white transition">
                  <span className="text-2xl">{nav.emoji}</span>
                  <span className="text-left leading-tight">{nav.label}</span>
                </button>
              ))}
            </div>
            <p className="text-zinc-600 text-xs text-center">
              TILA mantiene el tracking interno. La navegación es responsabilidad del conductor.
            </p>
          </div>
        </div>
      )}

    </main>
  );
}