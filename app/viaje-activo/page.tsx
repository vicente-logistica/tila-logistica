"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import MapaTILA from "../components/MapaTILA";

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

  // Parada activa calculada desde el estado del viaje
  const paradaActiva = useMemo(() => {
    if (!viaje) return null;

    const estadosRetiro = ["Chofer asignado", "En camino"];
    const estadosEntrega = ["Carga retirada", "En ruta"];

    if (estadosRetiro.includes(viaje.estado)) {
      return { tipo: "RETIRO", direccion: viaje.origen };
    }

    if (estadosEntrega.includes(viaje.estado)) {
      return { tipo: "ENTREGA", direccion: viaje.destino };
    }

    return null; // Descarga completada / Viaje finalizado
  }, [viaje?.estado, viaje?.origen, viaje?.destino]);

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
    const montoGanancia = Number(data?.pago_chofer || 0);

    console.log("=== ACREDITAR BILLETERA ===");
    console.log("chofer_id:", choferId);
    console.log("viaje_id:", viajeId);
    console.log("pago_chofer:", montoGanancia);

    if (!choferId) {
      alert("Error billetera: falta chofer_id");
      return;
    }

    if (!esUuidValido(choferId)) {
      alert("Error billetera: chofer_id inválido → " + choferId);
      return;
    }

    if (!viajeId) {
      alert("Error billetera: falta viaje_id");
      return;
    }

    if (!montoGanancia || montoGanancia <= 0) {
      alert("Error billetera: pago_chofer es 0 o no existe. Revisá el precio del viaje.");
      return;
    }

    const { data: yaExiste, error: errorCheck } = await supabase
      .from("billetera_chofer")
      .select("id")
      .eq("viaje_id", String(viajeId))
      .maybeSingle();

    if (errorCheck) {
      console.log("Error verificando billetera:", errorCheck);
    }

    if (yaExiste) {
      console.log("Movimiento ya acreditado — viaje_id:", viajeId);
      return;
    }

    console.log("Insertando en billetera_chofer...");

    const { error: errorInsert } = await supabase
      .from("billetera_chofer")
      .insert([
        {
          chofer_id: choferId,
          viaje_id: String(viajeId),
          monto: montoGanancia,
        },
      ]);

    if (errorInsert) {
      console.log("Error insert billetera:", errorInsert);
      alert("Error al acreditar billetera: " + errorInsert.message);
    } else {
      console.log("✅ Billetera acreditada — monto:", montoGanancia);
    }
  };

  const actualizarEstado = async (nuevoEstado: string) => {
    if (!viaje?.id) return;

    if (nuevoEstado === "Viaje finalizado") {
      reproducirFestejo();
    }

    const updateData: any = { estado: nuevoEstado };

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
      if (nuevoEstado === "Viaje finalizado") {
        viajeTerminado.current = false;
      }
      return;
    }

    setViaje(data);

    if (nuevoEstado === "Viaje finalizado") {
      await acreditarBilletera(data);
      localStorage.removeItem("viajeActivoId");
      setFestejo(true);
      setTimeout(() => {
        router.push("/panel-chofer");
      }, 5000);
    }
  };

  const abrirMapa = () => {
    if (!viaje || !paradaActiva) return;

    const destination = `${paradaActiva.direccion}, Argentina`;
    const origin = viaje.lat && viaje.lng
      ? `${viaje.lat},${viaje.lng}`
      : "";

    const url = origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;

    window.open(url, "_blank");
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
        <p className="text-green-400 font-black text-xl md:text-2xl mb-3 animate-pulse">
          🚛 VIAJE ACTIVO 🚛
        </p>

        <h1 className="text-3xl md:text-5xl font-black text-yellow-400 mb-4 leading-tight">
          {viaje.origen} → {viaje.destino}
        </h1>

        <p className="text-xl md:text-2xl mb-4">
          Estado actual:{" "}
          <span className="text-green-400 font-black">
            {viaje.estado || "Chofer asignado"}
          </span>
        </p>

        {/* Parada activa */}
        {paradaActiva && (
          <div className="bg-black border-2 border-yellow-400 rounded-2xl p-4 mb-6">
            <p className="text-zinc-400 text-sm mb-2">Próxima parada</p>
            <span
              className={`text-xs font-black px-3 py-1 rounded-lg ${
                paradaActiva.tipo === "RETIRO"
                  ? "bg-blue-600 text-white"
                  : "bg-green-600 text-white"
              }`}
            >
              {paradaActiva.tipo}
            </span>
            <p className="text-white font-black text-lg mt-2">
              📍 {paradaActiva.direccion}
            </p>
          </div>
        )}

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
          <MapaTILA lat={viaje?.lat} lng={viaje?.lng} />
        </div>

        <button
          onClick={abrirMapa}
          className="w-full bg-green-600 hover:bg-green-500 text-black font-black text-xl md:text-2xl py-5 rounded-3xl mb-6"
        >
          Abrir en Google Maps
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