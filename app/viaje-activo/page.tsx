"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import MapaTILA, { ParadaMapa } from "../components/MapaTILA";

const estados = [
  { nombre: "En camino", color: "bg-yellow-400 text-black" },
  { nombre: "Carga retirada", color: "bg-blue-600 text-white" },
  { nombre: "En ruta", color: "bg-zinc-600 text-white" },
  { nombre: "Descarga completada", color: "bg-red-600 text-white" },
  { nombre: "Viaje finalizado", color: "bg-green-600 text-white" },
];

const LABELS = ["A", "B", "C", "D", "E", "F"];

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

  // Paradas multietapa
  const [paradas, setParadas] = useState<any[]>([]);
  const [paradaActivaIndex, setParadaActivaIndex] = useState(0);
  const [confirmandoParada, setConfirmandoParada] = useState(false);

  const viajeTerminado = useRef(false);

  // ─── paradaActiva ─────────────────────────────────────────────────────────

  // Si hay paradas multietapa, usa el array. Si no, calcula desde estado del viaje.
  const paradaActiva = useMemo(() => {
    if (paradas.length > 0) {
      const activa = paradas[paradaActivaIndex];
      if (!activa) return null;
      return {
        tipo: activa.tipo === "retiro" ? "RETIRO" : "ENTREGA",
        direccion: activa.direccion,
      };
    }

    // Fallback: lógica original por estado
    if (!viaje) return null;
    const estadosRetiro = ["Chofer asignado", "En camino"];
    const estadosEntrega = ["Carga retirada", "En ruta"];

    if (estadosRetiro.includes(viaje.estado)) {
      return { tipo: "RETIRO", direccion: viaje.origen };
    }
    if (estadosEntrega.includes(viaje.estado)) {
      return { tipo: "ENTREGA", direccion: viaje.destino };
    }
    return null;
  }, [paradas, paradaActivaIndex, viaje?.estado, viaje?.origen, viaje?.destino]);

  // Paradas mapeadas para MapaTILA
  const paradasParaMapa: ParadaMapa[] = useMemo(() => {
    if (paradas.length === 0) return [];
    return paradas.map((p, index) => ({
      direccion: p.direccion,
      tipo: p.tipo as "retiro" | "entrega" | "parada",
      estado:
        index < paradaActivaIndex
          ? "completada"
          : index === paradaActivaIndex
          ? "en_curso"
          : "pendiente",
    }));
  }, [paradas, paradaActivaIndex]);

  const todasParadasCompletadas = useMemo(() => {
    if (paradas.length === 0) return false;
    return paradaActivaIndex >= paradas.length;
  }, [paradas, paradaActivaIndex]);

  // ─── Carga inicial ────────────────────────────────────────────────────────

  useEffect(() => {
    cargarViajeActivo();
  }, []);

  // ─── GPS ──────────────────────────────────────────────────────────────────

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
          prev ? { ...prev, lat, lng, velocidad, gps_actualizado: actualizado } : prev
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
        if (error.code === 1) setGpsEstado("Permiso GPS denegado");
        else if (error.code === 2) setGpsEstado("Ubicación no disponible");
        else if (error.code === 3) setGpsEstado("GPS demoró demasiado");
        else setGpsEstado("Error GPS");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [viaje?.id]);

  // ─── Funciones ────────────────────────────────────────────────────────────

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

    // Cargar paradas_viaje si existen
    const { data: dataParadas, error: errorParadas } = await supabase
      .from("paradas_viaje")
      .select("*")
      .eq("carga_id", Number(viajeId))
      .order("orden", { ascending: true });

    if (errorParadas) {
      console.warn("Error cargando paradas_viaje:", errorParadas);
    } else if (dataParadas && dataParadas.length > 0) {
      setParadas(dataParadas);
      // Calcular índice activo: primera parada no completada
      const primerNoCompletado = dataParadas.findIndex(
        (p) => p.estado !== "completada"
      );
      setParadaActivaIndex(
        primerNoCompletado === -1 ? dataParadas.length : primerNoCompletado
      );
    }

    setCargando(false);
  };

  const confirmarParadaCompletada = async () => {
    if (confirmandoParada) return;
    if (paradas.length === 0 || paradaActivaIndex >= paradas.length) return;

    const paradaActual = paradas[paradaActivaIndex];
    if (!paradaActual?.id) return;

    setConfirmandoParada(true);

    const { error } = await supabase
      .from("paradas_viaje")
      .update({
        estado: "completada",
        completada_at: new Date().toISOString(),
      })
      .eq("id", paradaActual.id);

    if (error) {
      console.error("Error confirmando parada:", error);
      alert("Error al confirmar parada: " + error.message);
      setConfirmandoParada(false);
      return;
    }

    // Actualizar estado local
    const nuevasParadas = [...paradas];
    nuevasParadas[paradaActivaIndex] = {
      ...paradaActual,
      estado: "completada",
      completada_at: new Date().toISOString(),
    };
    setParadas(nuevasParadas);
    setParadaActivaIndex(paradaActivaIndex + 1);
    setConfirmandoParada(false);
  };

  const reproducirFestejo = () => {
    const audio = new Audio("/sounds/alerta-viaje.mp3");
    audio.volume = 1;
    audio.currentTime = 0;
    audio.play().catch((e) => console.log("ERROR AUDIO FESTEJO:", e));
  };

  const acreditarBilletera = async (data: any) => {
    const choferId = data?.chofer_id;
    const viajeId = data?.id;
    const montoGanancia = Number(data?.pago_chofer || 0);

    console.log("=== ACREDITAR BILLETERA ===");
    console.log("chofer_id:", choferId);
    console.log("viaje_id:", viajeId);
    console.log("pago_chofer:", montoGanancia);

    if (!choferId) { alert("Error billetera: falta chofer_id"); return; }
    if (!esUuidValido(choferId)) { alert("Error billetera: chofer_id inválido → " + choferId); return; }
    if (!viajeId) { alert("Error billetera: falta viaje_id"); return; }
    if (!montoGanancia || montoGanancia <= 0) {
      alert("Error billetera: pago_chofer es 0 o no existe.");
      return;
    }

    const { data: yaExiste, error: errorCheck } = await supabase
      .from("billetera_chofer")
      .select("id")
      .eq("viaje_id", String(viajeId))
      .maybeSingle();

    if (errorCheck) console.log("Error verificando billetera:", errorCheck);
    if (yaExiste) { console.log("Movimiento ya acreditado — viaje_id:", viajeId); return; }

    console.log("Insertando en billetera_chofer...");

    const { error: errorInsert } = await supabase
      .from("billetera_chofer")
      .insert([{ chofer_id: choferId, viaje_id: String(viajeId), monto: montoGanancia }]);

    if (errorInsert) {
      console.log("Error insert billetera:", errorInsert);
      alert("Error al acreditar billetera: " + errorInsert.message);
    } else {
      console.log("✅ Billetera acreditada — monto:", montoGanancia);
    }
  };

  const actualizarEstado = async (nuevoEstado: string) => {
    if (!viaje?.id) return;

    if (nuevoEstado === "Viaje finalizado") reproducirFestejo();

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
      if (nuevoEstado === "Viaje finalizado") viajeTerminado.current = false;
      return;
    }

    setViaje(data);

    if (nuevoEstado === "Viaje finalizado") {
      await acreditarBilletera(data);
      localStorage.removeItem("viajeActivoId");
      setFestejo(true);
      setTimeout(() => router.push("/panel-chofer"), 5000);
    }
  };

  const abrirMapa = () => {
    if (!viaje) return;

    let destination = "";

    if (paradas.length > 0 && paradaActivaIndex < paradas.length) {
      // Multietapa: navegar a la parada activa del array
      destination = `${paradas[paradaActivaIndex].direccion}, Argentina`;
    } else if (paradaActiva) {
      // Fallback: lógica por estado
      destination = `${paradaActiva.direccion}, Argentina`;
    } else {
      destination = `${viaje.destino}, Argentina`;
    }

    const origin = viaje.lat && viaje.lng ? `${viaje.lat},${viaje.lng}` : "";

    const url = origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;

    window.open(url, "_blank");
  };

  // ─── Render ───────────────────────────────────────────────────────────────

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
          <h1 className="text-4xl md:text-6xl font-black mb-6">🎉 VIAJE FINALIZADO 🎉</h1>
          <div className="text-7xl md:text-8xl mb-6 animate-bounce">💼💰</div>
          <p className="text-2xl md:text-3xl font-bold mb-4">Excelente trabajo chofer 🚛</p>
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

        {/* Lista de paradas multietapa */}
        {paradas.length > 0 && (
          <div className="bg-zinc-800 rounded-2xl p-4 mb-6">
            <p className="text-zinc-400 text-sm font-black mb-3">PARADAS DEL VIAJE</p>
            <div className="space-y-2">
              {paradas.map((parada, index) => {
                const esActiva = index === paradaActivaIndex;
                const esCompletada = index < paradaActivaIndex;

                return (
                  <div
                    key={parada.id}
                    className={`flex items-center gap-3 p-3 rounded-xl ${
                      esActiva
                        ? "bg-yellow-400/10 border border-yellow-400"
                        : esCompletada
                        ? "bg-green-900/30 border border-green-700"
                        : "bg-zinc-700/30 border border-zinc-600"
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0 ${
                        esCompletada
                          ? "bg-green-500 text-white"
                          : esActiva
                          ? "bg-yellow-400 text-black"
                          : "bg-zinc-600 text-zinc-400"
                      }`}
                    >
                      {LABELS[index] || index}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`font-black text-sm truncate ${
                        esActiva ? "text-yellow-400" : esCompletada ? "text-green-400" : "text-zinc-400"
                      }`}>
                        {parada.direccion}
                      </p>
                      <p className="text-zinc-500 text-xs capitalize">{parada.tipo}</p>
                    </div>
                    <span className="text-lg flex-shrink-0">
                      {esCompletada ? "✅" : esActiva ? "🔵" : "⬜"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Botón confirmar parada */}
            {!todasParadasCompletadas && paradaActivaIndex < paradas.length && (
              <button
                onClick={confirmarParadaCompletada}
                disabled={confirmandoParada}
                className={`w-full mt-4 font-black text-lg py-4 rounded-2xl transition ${
                  confirmandoParada
                    ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 text-white"
                }`}
              >
                {confirmandoParada
                  ? "Confirmando..."
                  : `✅ Confirmar parada ${LABELS[paradaActivaIndex] || paradaActivaIndex} completada`}
              </button>
            )}

            {todasParadasCompletadas && (
              <div className="mt-4 bg-green-900/40 border border-green-500 rounded-2xl p-4 text-center">
                <p className="text-green-400 font-black">
                  ✅ Todas las paradas completadas — podés finalizar el viaje
                </p>
              </div>
            )}
          </div>
        )}

        {/* GPS stats */}
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

        {/* Mapa */}
        <div className="rounded-3xl overflow-hidden border-2 border-yellow-400 mb-6">
          <MapaTILA
            lat={viaje?.lat}
            lng={viaje?.lng}
            origen={viaje.origen}
            destino={viaje.destino}
            paradaActivaDireccion={paradaActiva?.direccion}
            paradas={paradasParaMapa.length > 0 ? paradasParaMapa : undefined}
          />
        </div>

        <button
          onClick={abrirMapa}
          className="w-full bg-green-600 hover:bg-green-500 text-black font-black text-xl md:text-2xl py-5 rounded-3xl mb-6"
        >
          Abrir en Google Maps
        </button>

        {/* Botones de estado */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {estados.map((estado, index) => {
            const estadoActualIndex = estados.findIndex(
              (e) => e.nombre === viaje.estado
            );

            const habilitado =
              viaje.estado === "Chofer asignado"
                ? index === 0
                : index === estadoActualIndex + 1;

            // Si hay paradas y no están todas completadas, bloquear "Viaje finalizado"
            const bloqueadoPorParadas =
              estado.nombre === "Viaje finalizado" &&
              paradas.length > 0 &&
              !todasParadasCompletadas;

            const activo = habilitado && !bloqueadoPorParadas;

            return (
              <button
                key={estado.nombre}
                disabled={!activo}
                onClick={() => actualizarEstado(estado.nombre)}
                className={`font-black text-lg md:text-xl py-5 rounded-3xl transition ${
                  activo
                    ? `${estado.color} hover:scale-105`
                    : "bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50"
                } ${
                  viaje.estado === estado.nombre
                    ? "ring-4 ring-white animate-pulse"
                    : ""
                }`}
              >
                {estado.nombre.toUpperCase()}
                {bloqueadoPorParadas ? " 🔒" : ""}
              </button>
            );
          })}
        </div>

      </section>
    </main>
  );
}