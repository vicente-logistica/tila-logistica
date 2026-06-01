"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";

const LABELS = ["A", "B", "C", "D", "E", "F"];

export default function PanelChoferPage() {
  const { autorizado } = useProtegerRuta("chofer");

  const [cargas, setCargas] = useState<any[]>([]);
  const [paradasPorCarga, setParadasPorCarga] = useState<Record<string, any[]>>({});
  const [indice, setIndice] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [online, setOnline] = useState(false);
  const [vehiculoChofer, setVehiculoChofer] = useState("");
  const [onlineCargado, setOnlineCargado] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const iniciarPanel = async () => {
      try {
        const usuarioGuardado = localStorage.getItem("usuario");
        if (!usuarioGuardado) { setOnlineCargado(true); return; }
        const usuario = JSON.parse(usuarioGuardado);
        const { data, error } = await supabase
          .from("usuarios")
          .select("online")
          .eq("id", usuario.id)
          .single();
        if (!error && data) setOnline(data.online ?? false);
      } catch (error) {
        console.log(error);
      } finally {
        setOnlineCargado(true);
      }
    };
    iniciarPanel();
  }, []);

  useEffect(() => {
    cargarCargas();
    const canal = supabase
      .channel("panel-chofer-cargas")
      .on("postgres_changes", { event: "*", schema: "public", table: "cargas" }, () => cargarCargas())
      .subscribe();
    return () => { supabase.removeChannel(canal); detenerAlarma(); };
  }, []);

  useEffect(() => {
    if (!onlineCargado) return;
    actualizarEstadoOnline(online);
  }, [online, onlineCargado]);

  useEffect(() => {
    if (online && cargas.length > 0) iniciarAlarma();
    else detenerAlarma();
  }, [online, cargas, indice]);

  const cargarCargas = async () => {
    setCargando(true);
    try {
      const usuarioGuardado = localStorage.getItem("usuario");
      const usuario = usuarioGuardado ? JSON.parse(usuarioGuardado) : null;
      const vehiculoDelChofer = usuario?.vehiculo || "";
      setVehiculoChofer(vehiculoDelChofer);

      const { data, error } = await supabase
        .from("cargas")
        .select("*")
        .or("estado.is.null,estado.eq.pendiente")
        .order("created_at", { ascending: true });

      if (error) { console.log(error); alert("Error al cargar viajes"); setCargando(false); return; }

      const cargasFiltradas = (data || []).filter((carga) => {
        if (!vehiculoDelChofer) return true;
        return String(carga.vehiculo || "").toLowerCase().trim() === String(vehiculoDelChofer || "").toLowerCase().trim();
      });

      setCargas(cargasFiltradas);
      setIndice(0);

      // Cargar paradas para cada carga filtrada
      if (cargasFiltradas.length > 0) {
        const ids = cargasFiltradas.map((c) => c.id);
        const { data: dataParadas } = await supabase
          .from("paradas_viaje")
          .select("*")
          .in("carga_id", ids)
          .order("orden", { ascending: true });

        if (dataParadas) {
          const agrupadas: Record<string, any[]> = {};
          dataParadas.forEach((p) => {
            const key = String(p.carga_id);
            if (!agrupadas[key]) agrupadas[key] = [];
            agrupadas[key].push(p);
          });
          setParadasPorCarga(agrupadas);
        }
      }

      setCargando(false);
    } catch (error) {
      console.log(error);
      setCargando(false);
    }
  };

  const iniciarAlarma = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  };

  const detenerAlarma = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  };

  const actualizarEstadoOnline = async (estado: boolean) => {
    try {
      const usuarioGuardado = localStorage.getItem("usuario");
      if (!usuarioGuardado) return;
      const usuario = JSON.parse(usuarioGuardado);
      await supabase.from("usuarios").update({ online: estado }).eq("id", usuario.id);
    } catch (error) { console.log(error); }
  };

  const rechazarViaje = () => {
    detenerAlarma();
    if (indice < cargas.length - 1) setIndice(indice + 1);
    else { setIndice(0); cargarCargas(); }
  };

  const aceptarViaje = async () => {
    if (!online) { alert("Tenés que estar ONLINE para aceptar viajes"); return; }
    const carga = cargas[indice];
    if (!carga?.id) return;
    detenerAlarma();
    const usuarioGuardado = localStorage.getItem("usuario");
    const usuario = usuarioGuardado ? JSON.parse(usuarioGuardado) : null;
    if (!usuario?.id || usuario?.rol !== "chofer") { alert("Sesión inválida: ingresá como chofer"); return; }
    const { data, error } = await supabase
      .from("cargas")
      .update({ estado: "Chofer asignado", chofer_id: usuario.id, tracking: true })
      .eq("estado", "pendiente")
      .eq("id", carga.id)
      .select()
      .single();
    if (error) { console.log(error); alert("Este viaje ya fue tomado por otro chofer"); cargarCargas(); return; }
    localStorage.setItem("viajeActivoId", data.id);
    window.location.href = "/viaje-activo";
  };

  const cerrarSesion = () => { localStorage.clear(); window.location.href = "/login"; };

  const cargaActual = online ? cargas[indice] : null;
  const paradasActuales = cargaActual ? (paradasPorCarga[String(cargaActual.id)] || []) : [];

  const BotonOnline = () => (
    <div className="w-full flex justify-center mb-6">
      <button
        onClick={() => setOnline(!online)}
        className={`px-8 py-4 rounded-3xl font-black text-xl md:text-2xl shadow-2xl transition ${online ? "bg-green-500 text-black" : "bg-red-600 text-white"}`}
      >
        {online ? "🟢 ONLINE" : "🔴 OFFLINE"}
      </button>
    </div>
  );

  if (!autorizado) return null;

  return (
    <main className="min-h-screen bg-black text-white px-4 py-6 flex items-center justify-center">
      <audio ref={audioRef} src="/sounds/alerta-viaje.mp3" loop preload="auto" />

      {cargando ? (
        <section className="w-full max-w-xl text-center">
          <BotonOnline />
          <h1 className="text-4xl md:text-5xl font-black text-yellow-400 animate-pulse">Buscando viajes...</h1>
        </section>
      ) : !cargaActual ? (
        <section className="w-full max-w-3xl text-center bg-zinc-900 border border-zinc-800 rounded-3xl p-8 md:p-12">
          <BotonOnline />
          <h1 className="text-4xl md:text-6xl font-black text-yellow-400 mb-4">DESPACHO EN TIEMPO REAL</h1>
          <p className="text-green-400 font-black text-lg md:text-xl mb-4">Vehículo habilitado: {vehiculoChofer || "No definido"}</p>
          <p className="text-zinc-400 text-lg md:text-2xl mb-8">
            {online ? "No hay viajes compatibles pendientes por ahora." : "Estás offline. Activá ONLINE para recibir viajes."}
          </p>
          <button onClick={() => { window.location.href = "/billetera-chofer"; }} className="w-full max-w-md bg-zinc-800 border-2 border-yellow-400 hover:bg-zinc-700 text-yellow-400 font-black text-xl py-5 rounded-3xl">
            💼 MI BILLETERA
          </button>
          <div className="mt-5 flex justify-center">
            <button onClick={cerrarSesion} className="bg-red-700 hover:bg-red-600 border border-red-500 text-white font-black text-lg px-8 py-3 rounded-2xl">
              ⛔ CERRAR SESIÓN
            </button>
          </div>
        </section>
      ) : (
        <section className="w-full max-w-5xl bg-zinc-900 border-4 border-yellow-400 rounded-3xl p-5 md:p-8 shadow-2xl animate-pulse text-center">
          <BotonOnline />
          <p className="text-pink-500 font-black text-xl md:text-2xl mb-4">🚨 NUEVO VIAJE DISPONIBLE 🚨</p>
          <p className="text-green-400 font-black text-lg md:text-xl mb-6">Vehículo habilitado: {vehiculoChofer || "No definido"}</p>

          {/* Ruta multietapa si hay paradas, sino origen → destino */}
          {paradasActuales.length > 0 ? (
            <div className="mb-6">
              <h1 className="text-2xl md:text-4xl font-black text-yellow-400 mb-4 leading-tight">
                Ruta del viaje
              </h1>
              <div className="flex flex-wrap justify-center items-center gap-2 text-lg md:text-2xl font-black">
                {paradasActuales.map((parada, index) => (
                  <span key={parada.id} className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-xl text-sm font-black ${
                      parada.tipo === "retiro" ? "bg-blue-600 text-white" :
                      parada.tipo === "entrega" ? "bg-green-600 text-white" :
                      "bg-zinc-600 text-white"
                    }`}>
                      {LABELS[index] || index}
                    </span>
                    <span className="text-white text-base">{parada.direccion}</span>
                    {index < paradasActuales.length - 1 && <span className="text-yellow-400">→</span>}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <h1 className="text-3xl md:text-6xl font-black text-yellow-400 mb-6 leading-tight">
              {cargaActual.origen} → {cargaActual.destino}
            </h1>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-lg md:text-2xl mb-8 text-left">
            <p>🚛 <strong>Vehículo:</strong> {cargaActual.vehiculo || "Sin dato"}</p>
            <p>📍 <strong>Distancia:</strong> {cargaActual.km_estimados ? `${cargaActual.km_estimados} km` : "Sin calcular"}</p>
            <p>⚖️ <strong>Peso:</strong> {cargaActual.peso || "Sin dato"}</p>
            <p>💰 <strong>Ganancia chofer:</strong> ${Number(cargaActual.pago_chofer || 0).toLocaleString()}</p>
            <p>📦 <strong>Tipo:</strong> {cargaActual.tipo_carga || "Sin dato"}</p>
            <p className="md:col-span-2">📝 <strong>Detalles:</strong> {cargaActual.detalles || "Sin detalles"}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <button onClick={aceptarViaje} disabled={!online} className={`font-black text-2xl md:text-3xl py-6 rounded-3xl ${online ? "bg-green-600 hover:bg-green-500 text-black" : "bg-zinc-800 text-zinc-500 cursor-not-allowed"}`}>
              ACEPTAR
            </button>
            <button onClick={rechazarViaje} className="bg-red-600 hover:bg-red-500 text-white font-black text-2xl md:text-3xl py-6 rounded-3xl">
              RECHAZAR
            </button>
          </div>

          <button onClick={() => { window.location.href = "/billetera-chofer"; }} className="w-full mt-5 bg-zinc-800 border-2 border-yellow-400 hover:bg-zinc-700 text-yellow-400 font-black text-xl md:text-2xl py-5 rounded-3xl">
            💼 MI BILLETERA
          </button>
          <div className="mt-5 flex justify-center">
            <button onClick={cerrarSesion} className="bg-red-700 hover:bg-red-600 border border-red-500 text-white font-black text-lg px-8 py-3 rounded-2xl">
              ⛔ CERRAR SESIÓN
            </button>
          </div>
          <p className="text-zinc-500 text-center mt-6">Viaje {indice + 1} de {cargas.length}</p>
        </section>
      )}
    </main>
  );
}