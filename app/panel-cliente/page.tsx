"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import MapaTILA from "../components/MapaTILA";
import ChatAsistencia from "../components/ChatAsistencia";
import BotonCerrarSesion from "../components/BotonCerrarSesion";

type ParadaMapa = {
  direccion: string;
  tipo: "retiro" | "entrega" | "parada";
  estado: "pendiente" | "en_curso" | "completada";
};

const estadosTracking = [
  { nombre: "Chofer asignado", color: "bg-green-700 text-white border-green-400" },
  { nombre: "En camino", color: "bg-yellow-400 text-black border-yellow-400" },
  { nombre: "Carga retirada", color: "bg-blue-600 text-white border-blue-400" },
  { nombre: "En ruta", color: "bg-zinc-600 text-white border-zinc-400" },
  { nombre: "Descarga completada", color: "bg-red-600 text-white border-red-400" },
  { nombre: "Viaje finalizado", color: "bg-green-500 text-white border-green-300" },
];

const LABELS = ["A", "B", "C", "D", "E", "F"];

const getTipoParadaLabel = (tipo: string) => {
  if (tipo === "retiro") return "📦 Retiro / Carga";
  if (tipo === "entrega") return "🏁 Entrega final";
  return "📍 Parada intermedia";
};

const getEstadoParadaLabel = (estado: string) => {
  if (estado === "completada") return "✅ Completada";
  if (estado === "en_curso") return "🔵 En curso";
  return "⬜ Pendiente";
};

const formatearFecha = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const anio = d.getFullYear();
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${anio} ${hora}:${min}`;
};

const tiempoRelativo = (iso: string | null | undefined) => {
  if (!iso) return null;
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 10) return "hace un momento";
  if (diff < 60) return `hace ${diff} segundos`;
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} minutos`;
  return `hace ${Math.floor(diff / 3600)} horas`;
};

const SOPORTE_WHATSAPP = "5491158689383";
const SOPORTE_EMAIL = "logisticatila@gmail.com";

const Dato = ({ label, valor }: { label: string; valor?: string | null }) => (
  <div className="bg-black rounded-xl p-3">
    <p className="text-zinc-500 text-xs font-black mb-1">{label}</p>
    <p className="text-white font-black text-sm">{valor || "No informado"}</p>
  </div>
);

export default function PanelClientePage() {
  const { autorizado } = useProtegerRuta("cliente");

  const [viaje, setViaje] = useState<any>(null);
  const [paradas, setParadas] = useState<any[]>([]);
  const [choferInfo, setChoferInfo] = useState<any>(null);
  const [alerta, setAlerta] = useState<string | null>(null);
  const [viajeEliminado, setViajeEliminado] = useState(false);
  const [mapaAmpliado, setMapaAmpliado] = useState(false);
  const ultimoEstadoRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => {}, 10000);
    return () => clearInterval(t);
  }, []);

  const dispararAlerta = (estado: string) => {
    setAlerta(estado);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
    setTimeout(() => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
      setAlerta(null);
    }, 5000);
  };

  const procesarViaje = (nuevoViaje: any) => {
    if (!nuevoViaje) return;
    const nuevoEstado = nuevoViaje.estado || "Chofer asignado";
    const estadoAnterior = ultimoEstadoRef.current;
    setViaje(nuevoViaje);
    if (estadoAnterior && estadoAnterior !== nuevoEstado) dispararAlerta(nuevoEstado);
    ultimoEstadoRef.current = nuevoEstado;
  };

  const cargarViaje = async (viajeId: string) => {
    const { data, error } = await supabase.from("cargas").select("*").eq("id", viajeId).single();
    if (error) {
      localStorage.removeItem("viajeActivoId");
      localStorage.removeItem("viajeActivo");
      setViajeEliminado(true);
      return;
    }
    procesarViaje(data);
    if (data?.chofer_id) {
      const { data: chofer } = await supabase
        .from("usuarios")
        .select("id, nombre, vehiculo, telefono, bateria_nivel, bateria_cargando, ultima_senal_at, online, categoria_legal, tipo_vehiculo, tipo_carroceria, zona_operativa")
        .eq("id", data.chofer_id)
        .single();
      if (chofer) setChoferInfo(chofer);
    }
  };

  const cargarParadas = async (viajeId: string) => {
    const { data, error } = await supabase
      .from("paradas_viaje").select("*").eq("carga_id", Number(viajeId)).order("orden", { ascending: true });
    if (!error && data && data.length > 0) setParadas(data);
  };

  const publicarOtroViaje = () => {
    localStorage.removeItem("viajeActivoId");
    localStorage.removeItem("viajeActivo");
    const usuarioGuardado = localStorage.getItem("usuario");
    const usuario = usuarioGuardado ? JSON.parse(usuarioGuardado) : null;
    if (!usuario?.id || usuario?.rol !== "cliente") { window.location.href = "/"; return; }
    window.location.href = "/publicar";
  };

  useEffect(() => {
    const viajeId = localStorage.getItem("viajeActivoId");
    if (!viajeId) return;
    cargarViaje(viajeId);
    cargarParadas(viajeId);
    const canal = supabase.channel(`tracking-cliente-${viajeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cargas", filter: `id=eq.${viajeId}` },
        (payload) => { console.log("Realtime carga actualizada", payload); cargarViaje(viajeId); })
      .on("postgres_changes", { event: "*", schema: "public", table: "paradas_viaje", filter: `carga_id=eq.${viajeId}` },
        (payload) => { console.log("Realtime parada actualizada", payload); cargarParadas(viajeId); })
      .subscribe((status) => { console.log("Panel cliente realtime status:", status); });
    const intervalo = setInterval(() => { cargarViaje(viajeId); cargarParadas(viajeId); }, 5000);
    return () => { supabase.removeChannel(canal); clearInterval(intervalo); };
  }, []);

  const paradasParaMapa: ParadaMapa[] = useMemo(() => {
    if (paradas.length === 0) return [];
    return paradas.map((p) => ({
      direccion: p.direccion,
      tipo: p.tipo as "retiro" | "entrega" | "parada",
      estado: p.estado as "pendiente" | "en_curso" | "completada",
    }));
  }, [paradas]);

  const viajeId = typeof window !== "undefined" ? localStorage.getItem("viajeActivoId") : null;
  const usuarioChat = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("usuario") || "{}") : {};

  if (!autorizado) return null;

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-6">
      <audio ref={audioRef} src="/sounds/alerta-viaje.mp3" preload="auto" />

      {/* Chat flotante */}
      {viaje && viajeId && usuarioChat?.id && (
        <ChatAsistencia viajeId={viajeId} usuarioId={usuarioChat.id} usuarioRol="cliente" usuarioNombre={usuarioChat.nombre || "Cliente"} />
      )}

      {/* Alerta cambio de estado */}
      {alerta && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
          <div className="bg-yellow-400 text-black rounded-3xl p-10 text-center border-4 border-white animate-pulse shadow-2xl max-w-xl">
            <p className="text-2xl font-black mb-3">🚨 ACTUALIZACIÓN DEL VIAJE 🚨</p>
            <h2 className="text-5xl font-black">{alerta}</h2>
          </div>
        </div>
      )}

      {/* Mapa ampliado */}
      {mapaAmpliado && viaje && (
        <div className="fixed inset-0 z-40 bg-black flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <p className="text-yellow-400 font-black text-lg">🗺️ {viaje.origen} → {viaje.destino}</p>
            <button onClick={() => setMapaAmpliado(false)} className="bg-red-700 hover:bg-red-600 text-white font-black px-5 py-2 rounded-xl">✕ Cerrar mapa</button>
          </div>
          <div className="flex-1">
            <MapaTILA lat={viaje?.lat} lng={viaje?.lng} origen={viaje.origen} destino={viaje.destino}
              soloLectura={true} altura="100%" paradas={paradasParaMapa.length >= 2 ? paradasParaMapa : undefined} />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link href="/" className="text-zinc-400 hover:text-white text-sm">← Volver</Link>
        <div className="flex items-center gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2">
            <span className="text-green-400 font-bold text-sm animate-pulse">● Cliente conectado</span>
          </div>
          <BotonCerrarSesion />
        </div>
      </div>

      <h1 className="text-4xl md:text-5xl font-black text-yellow-400 mb-2">Panel Cliente</h1>
      <p className="text-zinc-400 mb-6 text-sm">Seguimiento de tu carga en tiempo real.</p>

      {/* Soporte */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-6 flex flex-col md:flex-row items-center gap-3">
        <p className="text-zinc-400 text-sm font-black">🆘 Soporte TILA:</p>
        <a href={`https://wa.me/${SOPORTE_WHATSAPP}`} target="_blank" rel="noreferrer"
          className="bg-green-600 hover:bg-green-500 text-white font-black px-4 py-2 rounded-xl text-sm">💬 WhatsApp</a>
        <a href={`mailto:${SOPORTE_EMAIL}`}
          className="bg-zinc-700 hover:bg-zinc-600 text-white font-black px-4 py-2 rounded-xl text-sm">📧 {SOPORTE_EMAIL}</a>
      </div>

      {viajeEliminado ? (
        <div className="bg-zinc-900 border border-red-600 rounded-3xl p-10 text-center">
          <h2 className="text-3xl font-black text-red-400 mb-3">Este viaje ya no está disponible</h2>
          <p className="text-zinc-500 mb-6">El viaje fue cancelado o eliminado.</p>
          <Link href="/publicar" className="inline-block bg-yellow-400 hover:bg-yellow-500 text-black font-black px-8 py-4 rounded-2xl">Publicar carga</Link>
        </div>
      ) : !viaje ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 text-center">
          <h2 className="text-3xl font-black mb-3">No hay viaje activo</h2>
          <p className="text-zinc-500 mb-6">Publicá una carga para comenzar.</p>
          <Link href="/publicar" className="inline-block bg-yellow-400 hover:bg-yellow-500 text-black font-black px-8 py-4 rounded-2xl">Publicar carga</Link>
        </div>
      ) : viaje.estado === "Viaje finalizado" ? (
        <div className="bg-zinc-900 border-4 border-green-500 rounded-3xl p-10 text-center animate-pulse max-w-3xl mx-auto">
          <h2 className="text-6xl font-black text-green-400 mb-4">✅ Viaje finalizado</h2>
          <p className="text-zinc-300 text-2xl mb-3">Tu carga fue entregada correctamente.</p>
          <h3 className="text-4xl font-black text-yellow-400 mb-8">{viaje.origen} → {viaje.destino}</h3>
          <div className="grid gap-4 max-w-md mx-auto">
            <button onClick={publicarOtroViaje} className="bg-yellow-400 hover:bg-yellow-500 text-black font-black px-8 py-4 rounded-2xl">Publicar otro viaje</button>
            <Link href="/" className="bg-zinc-800 hover:bg-zinc-700 text-white font-black px-8 py-4 rounded-2xl">Volver al inicio</Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 max-w-4xl mx-auto">

          {/* Header viaje activo */}
          <div className="bg-zinc-900 border-2 border-yellow-400 rounded-3xl p-6">
            <p className="text-pink-500 font-black text-sm mb-2">🚨 VIAJE EN SEGUIMIENTO</p>
            <h2 className="text-3xl md:text-4xl font-black text-yellow-400 leading-tight">{viaje.origen} → {viaje.destino}</h2>
            <div className="flex flex-wrap gap-2 mt-3">
              {estadosTracking.map((estado) => {
                const activo = viaje.estado === estado.nombre;
                return (
                  <span key={estado.nombre} className={`px-3 py-1 rounded-xl font-black text-xs border transition ${activo ? `${estado.color} scale-105` : "bg-black border-zinc-800 text-zinc-600"}`}>
                    {estado.nombre}
                  </span>
                );
              })}
            </div>
          </div>

          {/* 🚛 El chofer */}
          {choferInfo && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="text-xl font-black text-yellow-400 mb-4">🚛 El chofer</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <Dato label="NOMBRE" valor={choferInfo.nombre} />
                <Dato label="ESTADO" valor={choferInfo.online ? "🟢 Online" : "🔴 Offline"} />
                <Dato label="TELÉFONO" valor={choferInfo.telefono} />
                <Dato label="ZONA OPERATIVA" valor={choferInfo.zona_operativa} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Dato label="CATEGORÍA LEGAL" valor={choferInfo.categoria_legal} />
                <Dato label="TIPO DE VEHÍCULO" valor={choferInfo.tipo_vehiculo || choferInfo.vehiculo} />
                <Dato label="CARROCERÍA" valor={choferInfo.tipo_carroceria} />
              </div>
            </div>
          )}

          {/* 📡 Estado en vivo */}
          {choferInfo && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="text-xl font-black text-yellow-400 mb-4">📡 Estado en vivo</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-black rounded-xl p-3 text-center">
                  <p className="text-zinc-500 text-xs font-black">VELOCIDAD</p>
                  <p className="text-yellow-400 font-black text-lg mt-1">
                    {viaje?.velocidad_kmh != null ? `${viaje.velocidad_kmh} km/h` : "—"}
                  </p>
                </div>
                <div className="bg-black rounded-xl p-3 text-center">
                  <p className="text-zinc-500 text-xs font-black">BATERÍA</p>
                  <p className={`font-black text-lg mt-1 ${
                    choferInfo.bateria_nivel == null ? "text-zinc-500" :
                    choferInfo.bateria_nivel < 20 ? "text-red-400" :
                    choferInfo.bateria_nivel < 50 ? "text-yellow-400" : "text-green-400"
                  }`}>
                    {choferInfo.bateria_nivel != null ? `${choferInfo.bateria_nivel}%` : "—"}
                  </p>
                </div>
                <div className="bg-black rounded-xl p-3 text-center">
                  <p className="text-zinc-500 text-xs font-black">CARGANDO</p>
                  <p className={`font-black text-lg mt-1 ${choferInfo.bateria_cargando ? "text-green-400" : "text-zinc-400"}`}>
                    {choferInfo.bateria_nivel != null ? (choferInfo.bateria_cargando ? "⚡ Sí" : "No") : "—"}
                  </p>
                </div>
                <div className="bg-black rounded-xl p-3 text-center">
                  <p className="text-zinc-500 text-xs font-black">ÚLTIMA SEÑAL</p>
                  <p className="text-blue-400 font-black text-xs mt-1">
                    {tiempoRelativo(choferInfo.ultima_senal_at) || "—"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 📍 La ruta */}
          {paradas.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="text-xl font-black text-yellow-400 mb-4">📍 La ruta</h3>
              <div className="space-y-3">
                {paradas.map((parada, index) => (
                  <div key={parada.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                    parada.estado === "completada" ? "bg-green-900/30 border-green-700" :
                    parada.estado === "en_curso" ? "bg-yellow-400/10 border-yellow-400" :
                    "bg-zinc-800/30 border-zinc-700"
                  }`}>
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0 ${
                      parada.estado === "completada" ? "bg-green-500 text-white" :
                      parada.estado === "en_curso" ? "bg-yellow-400 text-black" : "bg-zinc-700 text-zinc-400"
                    }`}>{LABELS[index] || index}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-zinc-400 text-xs font-black">{getTipoParadaLabel(parada.tipo)}</p>
                      <p className={`font-black text-sm truncate ${
                        parada.estado === "completada" ? "text-green-400" :
                        parada.estado === "en_curso" ? "text-yellow-400" : "text-zinc-300"
                      }`}>{parada.direccion}</p>
                      {parada.completada_at && <p className="text-zinc-500 text-xs">{formatearFecha(parada.completada_at)}</p>}
                    </div>
                    <span className="text-xs flex-shrink-0 text-zinc-400">{getEstadoParadaLabel(parada.estado)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 📦 Tu carga */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <h3 className="text-xl font-black text-yellow-400 mb-4">📦 Tu carga</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Dato label="TIPO DE CARGA" valor={viaje.tipo_carga} />
              <Dato label="PESO" valor={viaje.peso} />
              <Dato label="VEHÍCULO REQUERIDO" valor={viaje.vehiculo} />
              <Dato label="DISTANCIA" valor={viaje.km_estimados ? `${viaje.km_estimados} km` : null} />
              <Dato label="DETALLES" valor={viaje.detalles} />
              <Dato label="PRESENTACIÓN" valor={viaje.presentacion} />
            </div>
          </div>

          {/* 💰 Tarifa */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <h3 className="text-xl font-black text-yellow-400 mb-4">💰 Tarifa</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-black rounded-xl p-4 text-center col-span-2">
                <p className="text-zinc-500 text-xs font-black">PRECIO TOTAL</p>
                <p className="text-3xl font-black text-green-400 mt-1">${Number(viaje.precio_cliente || 0).toLocaleString()}</p>
              </div>
              <Dato label="DISTANCIA" valor={viaje.km_estimados ? `${viaje.km_estimados} km` : null} />
              <Dato label="VEHÍCULO" valor={viaje.vehiculo} />
            </div>
          </div>

          {/* 🕐 Cronología */}
          {(viaje.created_at || viaje.hora_aceptacion || viaje.hora_inicio || viaje.hora_finalizacion) && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="text-xl font-black text-yellow-400 mb-4">🕐 Cronología</h3>
              <div className="space-y-2">
                {viaje.created_at && (
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-zinc-500 flex-shrink-0" />
                    <p className="text-sm"><span className="text-zinc-400 font-black">Publicado:</span> <span className="text-zinc-300">{formatearFecha(viaje.created_at)}</span></p>
                  </div>
                )}
                {viaje.hora_aceptacion && (
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    <p className="text-sm"><span className="text-zinc-400 font-black">Aceptado:</span> <span className="text-green-400">{formatearFecha(viaje.hora_aceptacion)}</span></p>
                  </div>
                )}
                {viaje.hora_inicio && (
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                    <p className="text-sm"><span className="text-zinc-400 font-black">En camino:</span> <span className="text-yellow-400">{formatearFecha(viaje.hora_inicio)}</span></p>
                  </div>
                )}
                {paradas.filter(p => p.completada_at).map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                    <p className="text-sm">
                      <span className="text-zinc-400 font-black">{LABELS[i]} completada:</span>{" "}
                      <span className="text-blue-400">{formatearFecha(p.completada_at)}</span>
                    </p>
                  </div>
                ))}
                {viaje.hora_finalizacion && (
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                    <p className="text-sm"><span className="text-zinc-400 font-black">Finalizado:</span> <span className="text-green-400">{formatearFecha(viaje.hora_finalizacion)}</span></p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mapa y tracking */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <h3 className="text-xl font-black text-yellow-400 mb-4">🗺️ Mapa en vivo</h3>
            {!viaje?.lat || !viaje?.lng ? (
              <div className="bg-zinc-800 rounded-2xl p-5 text-center mb-4">
                <p className="text-zinc-400">📡 Esperando ubicación del chofer...</p>
              </div>
            ) : null}
            <div className="rounded-2xl overflow-hidden border-2 border-yellow-400 mb-4">
              <MapaTILA lat={viaje?.lat} lng={viaje?.lng} origen={viaje.origen} destino={viaje.destino}
                soloLectura={true} altura="360px" paradas={paradasParaMapa.length >= 2 ? paradasParaMapa : undefined} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setMapaAmpliado(true)} className="bg-zinc-800 hover:bg-zinc-700 border border-yellow-400 text-yellow-400 font-black py-3 rounded-2xl text-sm">🔍 Ampliar mapa</button>
              <button onClick={() => { if (viaje?.lat && viaje?.lng) setViaje({ ...viaje }); }} className="bg-zinc-800 hover:bg-zinc-700 border border-green-400 text-green-400 font-black py-3 rounded-2xl text-sm">🚛 Seguir chofer</button>
            </div>
          </div>

        </div>
      )}
    </main>
  );
}