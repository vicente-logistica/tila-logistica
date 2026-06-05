"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import HistorialChofer from "../components/historial-chofer";
import BotonCerrarSesion from "../components/BotonCerrarSesion";
import MapaTILA, { ParadaMapa } from "../components/MapaTILA";

const LABELS = ["A", "B", "C", "D", "E", "F"];
const SOPORTE_WHATSAPP = "5491158689383";
const SOPORTE_EMAIL = "logisticatila@gmail.com";

export default function PanelChoferPage() {
  const { autorizado } = useProtegerRuta("chofer");

  const [cargas, setCargas] = useState<any[]>([]);
  const [paradasPorCarga, setParadasPorCarga] = useState<Record<string, any[]>>({});
  const [indice, setIndice] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [online, setOnline] = useState(false);
  const [vehiculoChofer, setVehiculoChofer] = useState("");
  const [onlineCargado, setOnlineCargado] = useState(false);
  const [mostrarMapa, setMostrarMapa] = useState(false);

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

  // Cerrar mapa al cambiar de viaje
  useEffect(() => {
    setMostrarMapa(false);
  }, [indice]);

  const cargarCargas = async () => {
    setCargando(true);
    try {
      const usuarioGuardado = localStorage.getItem("usuario");
      const usuario = usuarioGuardado ? JSON.parse(usuarioGuardado) : null;
      const vehiculoDelChofer = usuario?.vehiculo || "";
      setVehiculoChofer(usuario?.tipo_vehiculo || usuario?.vehiculo || "No definido");

      const { data, error } = await supabase
        .from("cargas")
        .select("*")
        .or("estado.is.null,estado.eq.pendiente")
        .order("created_at", { ascending: true });

      if (error) { console.log(error); alert("Error al cargar viajes"); setCargando(false); return; }

      const cargasFiltradas = (data || []).filter((carga) => {
        if (!vehiculoDelChofer && !usuario?.tipo_vehiculo) return true;
        if (usuario?.tipo_vehiculo && carga.tipo_vehiculo) {
          const matchTipo = String(carga.tipo_vehiculo).toLowerCase().trim() === String(usuario.tipo_vehiculo).toLowerCase().trim();
          if (usuario?.categoria_legal && carga.categoria_legal) {
            return matchTipo && String(carga.categoria_legal) === String(usuario.categoria_legal);
          }
          return matchTipo;
        }
        if (!vehiculoDelChofer) return true;
        return String(carga.vehiculo || "").toLowerCase().trim().includes(String(vehiculoDelChofer || "").toLowerCase().trim()) ||
          String(vehiculoDelChofer || "").toLowerCase().trim().includes(String(carga.vehiculo || "").toLowerCase().trim());
      });

      setCargas(cargasFiltradas);
      setIndice(0);

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
    setMostrarMapa(false);
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
    localStorage.setItem("viajeActivoId", String(data.id));
    window.location.href = "/viaje-activo";
  };

  const getTipoParadaLabel = (tipo: string) => {
    if (tipo === "retiro") return "📦 Carga / Retiro";
    if (tipo === "entrega") return "🏁 Descarga / Entrega final";
    return "📍 Parada intermedia";
  };

  const cargaActual = online ? cargas[indice] : null;
  const paradasActuales = cargaActual ? (paradasPorCarga[String(cargaActual.id)] || []) : [];

  // Armar array de paradas para MapaTILA
  const paradasParaMapa: ParadaMapa[] = paradasActuales.map((p) => ({
    direccion: p.direccion,
    tipo: p.tipo as "retiro" | "entrega" | "parada",
    estado: "pendiente" as const,
  }));

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

  const BloquesSoporte = () => (
    <div className="mt-5 bg-zinc-800 border border-zinc-700 rounded-2xl p-4">
      <p className="text-zinc-500 text-xs font-black mb-3 text-center">🆘 SOPORTE TILA</p>
      <div className="flex gap-3 justify-center">
        <a href={`https://wa.me/${SOPORTE_WHATSAPP}`} target="_blank" rel="noreferrer"
          className="bg-green-600 hover:bg-green-500 text-white font-black px-4 py-2 rounded-xl text-sm">
          💬 WhatsApp
        </a>
        <a href={`mailto:${SOPORTE_EMAIL}`}
          className="bg-zinc-700 hover:bg-zinc-600 text-white font-black px-4 py-2 rounded-xl text-sm">
          📧 Email
        </a>
      </div>
    </div>
  );

  if (!autorizado) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <h1 className="text-3xl font-black text-yellow-400 animate-pulse">Cargando...</h1>
      </main>
    );
  }

  return (
    <>
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
            <BloquesSoporte />
            <div className="mt-5 flex justify-center">
              <BotonCerrarSesion />
            </div>
          </section>

        ) : (
          <section className="w-full max-w-5xl bg-zinc-900 border-4 border-yellow-400 rounded-3xl p-5 md:p-8 shadow-2xl animate-pulse text-center">
            <BotonOnline />
            <p className="text-pink-500 font-black text-xl md:text-2xl mb-4">🚨 NUEVO VIAJE DISPONIBLE 🚨</p>
            <p className="text-green-400 font-black text-lg md:text-xl mb-6">Vehículo habilitado: {vehiculoChofer || "No definido"}</p>

            {/* Ruta del viaje */}
            {paradasActuales.length > 0 ? (
              <div className="mb-6">
                <h1 className="text-2xl md:text-4xl font-black text-yellow-400 mb-4 leading-tight">Ruta del viaje</h1>
                <div className="flex flex-col gap-2 text-left">
                  {paradasActuales.map((parada, index) => (
                    <div key={parada.id} className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0 ${
                        parada.tipo === "retiro" ? "bg-blue-600 text-white" :
                        parada.tipo === "entrega" ? "bg-green-600 text-white" : "bg-zinc-600 text-white"
                      }`}>
                        {LABELS[index] || index}
                      </span>
                      <div>
                        <p className="text-xs font-black text-zinc-400">{getTipoParadaLabel(parada.tipo)}</p>
                        <p className="text-white text-base font-black">{parada.direccion}</p>
                      </div>
                      {index < paradasActuales.length - 1 && <span className="text-yellow-400 ml-auto">↓</span>}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <h1 className="text-3xl md:text-6xl font-black text-yellow-400 mb-6 leading-tight">
                {cargaActual.origen} → {cargaActual.destino}
              </h1>
            )}

            {/* Detalles del viaje */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-lg md:text-2xl mb-6 text-left">
              <p>🚛 <strong>Vehículo:</strong> {cargaActual.vehiculo || "Sin dato"}</p>
              <p>📍 <strong>Distancia:</strong> {cargaActual.km_estimados ? `${cargaActual.km_estimados} km` : "Sin calcular"}</p>
              <p>⚖️ <strong>Peso:</strong> {cargaActual.peso || "Sin dato"}</p>
              <p>💰 <strong>Ganancia chofer:</strong> ${Number(cargaActual.pago_chofer || 0).toLocaleString()}</p>
              <p>📦 <strong>Tipo:</strong> {cargaActual.tipo_carga || "Sin dato"}</p>
              <p className="md:col-span-2">📝 <strong>Detalles:</strong> {cargaActual.detalles || "Sin detalles"}</p>
            </div>

            {/* ─── Mapa integrado ──────────────────────────────────────────────── */}
            <div className="mb-6">
              <button
                onClick={() => setMostrarMapa(!mostrarMapa)}
                className="w-full bg-zinc-800 hover:bg-zinc-700 border border-yellow-400 text-yellow-400 font-black py-3 rounded-2xl text-sm mb-3 transition"
              >
                {mostrarMapa ? "🗺️ Ocultar mapa del recorrido" : "🗺️ Ver mapa del recorrido"}
              </button>

              {mostrarMapa && (
                <div className="rounded-2xl overflow-hidden border-2 border-yellow-400">
                  <MapaTILA
                    lat={null}
                    lng={null}
                    origen={cargaActual.origen}
                    destino={cargaActual.destino}
                    soloLectura={true}
                    altura="360px"
                    paradas={paradasParaMapa.length >= 2 ? paradasParaMapa : undefined}
                  />
                </div>
              )}
            </div>
            {/* ─── Fin mapa ─────────────────────────────────────────────────────── */}

            {/* Botones aceptar / rechazar */}
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
            <BloquesSoporte />
            <div className="mt-5 flex justify-center">
              <BotonCerrarSesion />
            </div>
            <p className="text-zinc-500 text-center mt-6">Viaje {indice + 1} de {cargas.length}</p>
          </section>
        )}
      </main>

      {/* Historial separado abajo */}
      {autorizado && (
        <div className="bg-black text-white px-4 py-8">
          <div className="max-w-3xl mx-auto">
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h2 className="text-2xl font-black text-yellow-400 mb-6">📋 Mis viajes</h2>
              <HistorialChofer />
            </div>
          </div>
        </div>
      )}
    </>
  );
}