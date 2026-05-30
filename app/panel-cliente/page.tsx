"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import MapaTILA from "../components/MapaTILA";

const estadosTracking = [
  { nombre: "Chofer asignado", color: "bg-green-700 text-white border-green-400" },
  { nombre: "En camino", color: "bg-yellow-400 text-black border-yellow-400" },
  { nombre: "Carga retirada", color: "bg-blue-600 text-white border-blue-400" },
  { nombre: "En ruta", color: "bg-zinc-600 text-white border-zinc-400" },
  { nombre: "Descarga completada", color: "bg-red-600 text-white border-red-400" },
  { nombre: "Viaje finalizado", color: "bg-green-500 text-white border-green-300" },
];

export default function PanelClientePage() {
  const { autorizado } = useProtegerRuta("cliente");

  const [viaje, setViaje] = useState<any>(null);
  const [alerta, setAlerta] = useState<string | null>(null);
  const [viajeEliminado, setViajeEliminado] = useState(false);
  const ultimoEstadoRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const dispararAlerta = (estado: string) => {
    setAlerta(estado);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }

    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setAlerta(null);
    }, 5000);
  };

  const procesarViaje = (nuevoViaje: any) => {
    if (!nuevoViaje) return;

    const nuevoEstado = nuevoViaje.estado || "Chofer asignado";
    const estadoAnterior = ultimoEstadoRef.current;

    setViaje(nuevoViaje);

    if (estadoAnterior && estadoAnterior !== nuevoEstado) {
      dispararAlerta(nuevoEstado);
    }

    ultimoEstadoRef.current = nuevoEstado;
  };

  const cargarViaje = async (viajeId: string) => {
    const { data, error } = await supabase
      .from("cargas")
      .select("*")
      .eq("id", viajeId)
      .single();

    if (error) {
      console.log(error);
      localStorage.removeItem("viajeActivoId");
      localStorage.removeItem("viajeActivo");
      setViajeEliminado(true);
      return;
    }

    procesarViaje(data);
  };

  const publicarOtroViaje = () => {
    localStorage.removeItem("viajeActivoId");
    localStorage.removeItem("viajeActivo");

    const usuarioGuardado = localStorage.getItem("usuario");
    const usuario = usuarioGuardado ? JSON.parse(usuarioGuardado) : null;

    if (!usuario?.id || usuario?.rol !== "cliente") {
      window.location.href = "/";
      return;
    }

    window.location.href = "/publicar";
  };

  useEffect(() => {
    const viajeId = localStorage.getItem("viajeActivoId");

    if (!viajeId) return;

    cargarViaje(viajeId);

    const canal = supabase
      .channel("tracking-cliente")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cargas",
          filter: `id=eq.${viajeId}`,
        },
        () => {
          cargarViaje(viajeId);
        }
      )
      .subscribe();

    const intervalo = setInterval(() => {
      cargarViaje(viajeId);
    }, 5000);

    return () => {
      supabase.removeChannel(canal);
      clearInterval(intervalo);
    };
  }, []);

  if (!autorizado) return null;

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <audio ref={audioRef} src="/sounds/alerta-viaje.mp3" preload="auto" />

      {alerta && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
          <div className="bg-yellow-400 text-black rounded-3xl p-10 text-center border-4 border-white animate-pulse shadow-2xl max-w-xl">
            <p className="text-2xl font-black mb-3">
              🚨 ACTUALIZACIÓN DEL VIAJE 🚨
            </p>
            <h2 className="text-5xl font-black">{alerta}</h2>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-8">
        <Link href="/" className="text-zinc-400 hover:text-white">
          ← Volver
        </Link>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-3">
          <span className="text-green-400 font-bold animate-pulse">
            Cliente conectado
          </span>
        </div>
      </div>

      <h1 className="text-5xl font-black text-yellow-400 mb-2">
        Panel Cliente
      </h1>

      <p className="text-zinc-400 mb-8">
        Seguimiento de tu carga en tiempo real.
      </p>

      {viajeEliminado ? (
        <div className="bg-zinc-900 border border-red-600 rounded-3xl p-10 text-center">
          <h2 className="text-3xl font-black text-red-400 mb-3">
            Este viaje ya no está disponible
          </h2>

          <p className="text-zinc-500 mb-6">
            El viaje fue cancelado o eliminado. Podés publicar uno nuevo.
          </p>

          <Link
            href="/publicar"
            className="inline-block bg-yellow-400 hover:bg-yellow-500 text-black font-black px-8 py-4 rounded-2xl"
          >
            Publicar carga
          </Link>
        </div>
      ) : !viaje ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 text-center">
          <h2 className="text-3xl font-black mb-3">
            No hay viaje activo cargado
          </h2>

          <p className="text-zinc-500 mb-6">
            Primero el chofer debe aceptar una carga.
          </p>

          <Link
            href="/publicar"
            className="inline-block bg-yellow-400 hover:bg-yellow-500 text-black font-black px-8 py-4 rounded-2xl"
          >
            Publicar carga
          </Link>
        </div>
      ) : viaje.estado === "Viaje finalizado" ? (
        <div className="bg-zinc-900 border-4 border-green-500 rounded-3xl p-10 text-center animate-pulse max-w-3xl mx-auto">
          <h2 className="text-6xl font-black text-green-400 mb-4">
            ✅ Viaje finalizado
          </h2>

          <p className="text-zinc-300 text-2xl mb-3">
            Tu carga fue entregada correctamente.
          </p>

          <h3 className="text-4xl font-black text-yellow-400 mb-8">
            {viaje.origen} → {viaje.destino}
          </h3>

          <div className="grid gap-4 max-w-md mx-auto">
            <button
              onClick={publicarOtroViaje}
              className="bg-yellow-400 hover:bg-yellow-500 text-black font-black px-8 py-4 rounded-2xl"
            >
              Publicar otro viaje
            </button>

            <Link
              href="/"
              className="bg-zinc-800 hover:bg-zinc-700 text-white font-black px-8 py-4 rounded-2xl"
            >
              Volver al inicio
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-6">
          <div className="bg-zinc-900 border-2 border-yellow-400 rounded-3xl p-8 animate-pulse">
            <p className="text-pink-500 font-black text-xl mb-3">
              🚨 VIAJE EN SEGUIMIENTO 🚨
            </p>

            <h2 className="text-4xl font-black text-yellow-400">
              {viaje.origen} → {viaje.destino}
            </h2>

            <p className="text-zinc-400 mt-3">
              Estado actual:{" "}
              <span className="text-green-400 font-black">
                {viaje.estado || "Chofer asignado"}
              </span>
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
            <h3 className="text-3xl font-black text-yellow-400 mb-4">
              Datos del viaje
            </h3>

            <div className="space-y-3 text-xl">
              <p>🚚 <strong>Vehículo:</strong> {viaje.vehiculo || "Pendiente"}</p>
              <p>
                📍 <strong>Distancia:</strong>{" "}
                {viaje.km_estimados
                  ? `${viaje.km_estimados} km`
                  : "Sin calcular"}
              </p>
              <p>⚖️ <strong>Peso:</strong> {viaje.peso || "Pendiente"}</p>
              <p>📦 <strong>Tipo:</strong> {viaje.tipo_carga || "Pendiente"}</p>
              <p>
                💰 <strong>Precio estimado total:</strong>{" "}
                ${Number(viaje.precio_cliente || 0).toLocaleString()}
              </p>
              <p>📝 <strong>Detalles:</strong> {viaje.detalles || "Sin detalles"}</p>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <h3 className="text-3xl font-black text-yellow-400 mb-4">
              Tracking de carga
            </h3>

            {/* Mapa interno TILA — sin iframe, sin parpadeo */}
            <div className="rounded-2xl overflow-hidden border-2 border-yellow-400">
              <MapaTILA
                lat={viaje?.lat}
                lng={viaje?.lng}
                origen={viaje.origen}
                destino={viaje.destino}
                soloLectura={true}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-6">
              {estadosTracking.map((estado) => {
                const activo = viaje.estado === estado.nombre;

                return (
                  <div
                    key={estado.nombre}
                    className={`rounded-2xl p-4 text-center font-black border transition ${
                      activo
                        ? `${estado.color} scale-105 animate-pulse`
                        : "bg-black border-zinc-800 text-zinc-500"
                    }`}
                  >
                    {estado.nombre}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}