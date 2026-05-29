"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";

const estados = [
  { nombre: "En camino", color: "bg-yellow-400 text-black" },
  { nombre: "Carga retirada", color: "bg-blue-600 text-white" },
  { nombre: "En ruta", color: "bg-zinc-600 text-white" },
  { nombre: "Descarga completada", color: "bg-red-600 text-white" },
  { nombre: "Viaje finalizado", color: "bg-green-600 text-white" },
];

const esUuidValido = (valor: any) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(valor || "")
  );
};

export default function ViajeActivoPage() {
  const { autorizado } = useProtegerRuta("chofer");
  const router = useRouter();

  const [viaje, setViaje] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [festejo, setFestejo] = useState(false);
  const [gpsEstado, setGpsEstado] = useState("Esperando GPS...");
  const [ultimaActualizacionGps, setUltimaActualizacionGps] = useState("");
  const [velocidadGps, setVelocidadGps] = useState(0);

  // Flag para detener escritura GPS cuando el viaje ya finalizó
  const viajeTerminado = useRef(false);

  useEffect(() => {
    cargarViajeActivo();
  }, []);

  useEffect(() => {
    if (!viaje?.id) return;

    if (!navigator.geolocation) {
      setGpsEstado("GPS no disponible en este dispositivo");
      return;
    }

    setGpsEstado("Solicitando permiso GPS...");

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        // Si el viaje ya terminó, no seguir escribiendo GPS en Supabase
        if (viajeTerminado.current) return;

        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const velocidad = position.coords.speed
          ? Math.round(position.coords.speed * 3.6)
          : 0;
        const actualizado = new Date().toISOString();

        setGpsEstado("GPS activo");
        setUltimaActualizacionGps(new Date(actualizado).toLocaleTimeString());
        setVelocidadGps(velocidad);

        setViaje((prev: any) =>
          prev
            ? { ...prev, lat, lng, velocidad, gps_actualizado: actualizado }
            : prev
        );

        const { error } = await supabase
          .from("cargas")
          .update({ lat, lng, velocidad, gps_actualizado: actualizado })
          .eq("id", viaje.id);

        if (error) {
          console.log("Error guardando GPS:", error);
          setGpsEstado("Error guardando GPS");
        }
      },
      (error) => {
        console.log("Error GPS:", error);
        if (error.code === 1) setGpsEstado("Permiso GPS denegado");
        else if (error.code === 2) setGpsEstado("Ubicación no disponible");
        else if (error.code === 3) setGpsEstado("GPS demoró demasiado");
        else setGpsEstado("Error GPS");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [viaje?.id]);

  const cargarViajeActivo = async () => {
    const viajeId = localStorage.getItem("viajeActivoId");

    if (!viajeId) {
      router.replace("/panel-chofer");
      return;
    }

    const { data, error } = await supabase
      .from("cargas")
      .select("*")
      .eq("id", viajeId)
      .single();

    if (error) {
      console.log(error);
      alert("Error al cargar viaje");
      return;
    }

    setViaje(data);
    setCargando(false);
  };

  const reproducirFestejo = () => {
    const audio = new Audio("/sounds/alerta-viaje.mp3");
    audio.volume = 1;
    audio.currentTime = 0;
    audio.play().catch((error) => {
      console.log("ERROR AUDIO FESTEJO:", error);
    });
  };

  const acreditarBilletera = async (data: any) => {
    const choferId = data?.chofer_id;
    const viajeId = data?.id;
    const montoGanancia = Number(data?.pago_chofer || viaje?.pago_chofer || 0);

    if (!esUuidValido(choferId)) {
      console.log("Billetera no acreditada: chofer_id inválido", choferId);
      return;
    }

    if (!esUuidValido(viajeId)) {
      console.log("Billetera no acreditada: viaje_id inválido", viajeId);
      return;
    }

    const { data: yaExiste } = await supabase
      .from("billetera_chofer")
      .select("id")
      .eq("viaje_id", viajeId)
      .maybeSingle();

    if (yaExiste) return;

    const { error } = await supabase.from("billetera_chofer").insert([
      {
        chofer_id: choferId,
        viaje_id: viajeId,
        monto: montoGanancia,
      },
    ]);

    if (error) {
      console.log("Error billetera:", error);
      alert("Error billetera: " + error.message);
    }
  };

  const actualizarEstado = async (nuevoEstado: string) => {
    if (!viaje?.id) return;

    if (nuevoEstado === "Viaje finalizado") {
      reproducirFestejo();
    }

    const updateData: any = { estado: nuevoEstado };

    // Al finalizar: apagar tracking y detener escritura GPS
    if (nuevoEstado === "Viaje finalizado") {
      updateData.tracking = false;
      viajeTerminado.current = true;
    }

    const { data, error } = await supabase
      .from("cargas")
      .update(updateData)
      .eq("id", viaje.id)
      .select()
      .single();

    if (error) {
      console.log(error);
      alert("Error al actualizar estado");
      // Si falló, revertir el flag para no bloquear GPS en caso de reintento
      if (nuevoEstado === "Viaje finalizado") {
        viajeTerminado.current = false;
      }
      return;
    }

    setViaje(data);

    if (nuevoEstado === "Viaje finalizado") {
      await acreditarBilletera(data);

      // Borrar solo el ID del viaje — nunca tocar localStorage["usuario"]
      localStorage.removeItem("viajeActivoId");

      setFestejo(true);

      // router.push mantiene la sesión sin recarga completa del browser
      setTimeout(() => {
        router.push("/panel-chofer");
      }, 5000);
    }
  };

  const abrirMapa = () => {
    if (!viaje) return;

    const query =
      viaje.lat && viaje.lng
        ? `${viaje.lat},${viaje.lng}`
        : `${viaje.origen} Argentina`;

    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
      "_blank"
    );
  };

  if (!autorizado) return null;

  if (cargando) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <h1 className="text-4xl font-black text-yellow-400 animate-pulse text-center">
          Cargando viaje activo...
        </h1>
      </main>
    );
  }

  if (festejo) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="bg-green-600 border-4 border-white rounded-3xl p-8 md:p-12 text-center shadow-2xl animate-pulse max-w-2xl">
          <h1 className="text-4xl md:text-6xl font-black mb-6">
            🎉 VIAJE FINALIZADO 🎉
          </h1>

          <div className="text-7xl md:text-8xl mb-6 animate-bounce">
            💼💰
          </div>

          <p className="text-2xl md:text-3xl font-bold mb-4">
            Excelente trabajo chofer 🚛
          </p>

          <p className="text-xl md:text-2xl mb-2">Ganancia del viaje:</p>

          <p className="text-4xl md:text-6xl font-black text-yellow-300 mb-6">
            ${Number(viaje?.pago_chofer || 0).toLocaleString()}
          </p>

          <p className="text-lg md:text-xl">Volviendo al panel chofer...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-6">
      <section className="max-w-5xl mx-auto bg-zinc-900 border-4 border-yellow-400 rounded-3xl p-5 md:p-8 shadow-2xl">

<div className="flex justify-end mb-5">
  <button
    onClick={() => {
      localStorage.clear();
      window.location.href = "/login";
    }}
    className="bg-red-700 hover:bg-red-600 border border-red-500 hover:border-red-400 text-white font-black text-sm px-5 py-3 rounded-2xl shadow-xl transition-all duration-200"
  >
    ⛔ CERRAR SESIÓN
  </button>
</div>
        <p className="text-green-400 font-black text-xl md:text-2xl mb-3 animate-pulse">
          🚛 VIAJE ACTIVO 🚛
        </p>

        <h1 className="text-3xl md:text-5xl font-black text-yellow-400 mb-4 leading-tight">
          {viaje.origen} → {viaje.destino}
        </h1>

        <p className="text-xl md:text-2xl mb-6">
          Estado actual:{" "}
          <span className="text-green-400 font-black">
            {viaje.estado || "Chofer asignado"}
          </span>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-black border border-green-500 rounded-2xl p-4 text-center">
            <p className="text-zinc-400 text-sm">Estado GPS</p>
            <p className="text-green-400 font-black mt-2">{gpsEstado}</p>
          </div>

          <div className="bg-black border border-yellow-400 rounded-2xl p-4 text-center">
            <p className="text-zinc-400 text-sm">Velocidad</p>
            <p className="text-yellow-400 font-black mt-2">{velocidadGps} km/h</p>
          </div>

          <div className="bg-black border border-blue-400 rounded-2xl p-4 text-center">
            <p className="text-zinc-400 text-sm">Última actualización</p>
            <p className="text-blue-400 font-black mt-2">
              {ultimaActualizacionGps || "Sin datos"}
            </p>
          </div>
        </div>

        <div className="rounded-3xl overflow-hidden border-2 border-yellow-400 mb-6">
          <iframe
            title="Mapa de ubicación del viaje activo"
            src={
              viaje?.lat && viaje?.lng
                ? `https://www.google.com/maps?q=${viaje.lat},${viaje.lng}&z=15&output=embed`
                : `https://www.google.com/maps?q=${encodeURIComponent(
                    `${viaje.origen} Argentina`
                  )}&output=embed`
            }
            width="100%"
            height="360"
            loading="lazy"
          />
        </div>

        <button
          onClick={abrirMapa}
          className="w-full bg-green-600 hover:bg-green-500 text-black font-black text-xl md:text-2xl py-5 rounded-3xl mb-6"
        >
          INICIAR NAVEGACIÓN / ABRIR GPS
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {estados.map((estado, index) => {
            const estadoActualIndex = estados.findIndex(
              (e) => e.nombre === viaje.estado
            );

            const habilitado =
              viaje.estado === "Chofer asignado"
                ? index === 0
                : index === estadoActualIndex + 1;

            return (
              <button
                key={estado.nombre}
                disabled={!habilitado}
                onClick={() => actualizarEstado(estado.nombre)}
                className={`font-black text-lg md:text-xl py-5 rounded-3xl transition ${
                  habilitado
                    ? `${estado.color} hover:scale-105`
                    : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50"
                } ${
                  viaje.estado === estado.nombre
                    ? "ring-4 ring-white animate-pulse"
                    : ""
                }`}
              >
                {estado.nombre.toUpperCase()}
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}