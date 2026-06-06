"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import HistorialChofer from "../components/historial-chofer";
import BotonCerrarSesion from "../components/BotonCerrarSesion";
import MapaTILA, { ParadaMapa } from "../components/MapaTILA";

const LABELS = ["A", "B", "C", "D", "E", "F"];
const SOPORTE_WHATSAPP = "5491158689383";
const SOPORTE_EMAIL    = "logisticatila@gmail.com";

const ESTADOS_ACTIVOS = [
  "Chofer asignado", "En camino", "Carga retirada", "En ruta", "Descarga completada",
];

export default function PanelChoferPage() {
  const { autorizado } = useProtegerRuta("chofer");

  const [cargas, setCargas]                 = useState<any[]>([]);
  const [paradasPorCarga, setParadasPorCarga] = useState<Record<string, any[]>>({});
  const [indice, setIndice]                 = useState(0);
  const [cargando, setCargando]             = useState(true);
  const [online, setOnline]                 = useState(false);
  const [vehiculoChofer, setVehiculoChofer] = useState("");
  const [onlineCargado, setOnlineCargado]   = useState(false);
  const [mostrarMapa, setMostrarMapa]       = useState(false);

  const [viajeActivo, setViajeActivo]               = useState<any>(null);
  const [buscandoViajeActivo, setBuscandoViajeActivo] = useState(true);

  const [audioDesbloqueado, setAudioDesbloqueado] = useState(false);

  // ─── Configuración de navegación ─────────────────────────────────────────
  const [mostrarConfigNav, setMostrarConfigNav] = useState(false);
  const [navegadorPreferido, setNavegadorPreferido] = useState<string | null>(null);
  const [guardandoNav, setGuardandoNav] = useState(false);

  // ─── Refs estables — no causan re-renders ─────────────────────────────────
  const audioRef          = useRef<HTMLAudioElement | null>(null);
  const onlineRef         = useRef(false);
  // ID del último set de cargas — para no re-renderizar si los datos son iguales
  const cargasHashRef     = useRef<string>("");
  // Evitar re-suscripción al canal en cada render
  const canalRef          = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const intervaloRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ids de viajes ya sonados — para no repetir alarma para el mismo viaje
  const viajesSonadosRef  = useRef<Set<string>>(new Set());
  const sonandoRef        = useRef(false);

  useEffect(() => { onlineRef.current = online; }, [online]);

  // ─── Audio ────────────────────────────────────────────────────────────────
  const desbloquearAudio = async () => {
    if (!audioRef.current || audioDesbloqueado) return;
    try {
      audioRef.current.volume = 0;
      await audioRef.current.play();
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 1;
      setAudioDesbloqueado(true);
    } catch (e) { console.warn("[audio] No se pudo desbloquear:", e); }
  };

  const reproducirAlarma = useCallback(() => {
    if (!audioRef.current || sonandoRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.volume = 1;
    audioRef.current.play()
      .then(() => { sonandoRef.current = true; })
      .catch(e => console.warn("[audio] Error:", e));
  }, []);

  const detenerAlarma = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    sonandoRef.current = false;
  }, []);

  // ─── Viaje activo ─────────────────────────────────────────────────────────
  useEffect(() => {
    const buscarViajeActivo = async () => {
      try {
        const u = localStorage.getItem("usuario");
        if (!u) return;
        const usuario = JSON.parse(u);
        if (!usuario?.id) return;
        const { data } = await supabase
          .from("cargas")
          .select("id, origen, destino, estado, pago_chofer")
          .eq("chofer_id", usuario.id)
          .in("estado", ESTADOS_ACTIVOS)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) {
          setViajeActivo(data);
          localStorage.setItem("viajeActivoId", String(data.id));
        }
      } finally {
        setBuscandoViajeActivo(false);
      }
    };
    buscarViajeActivo();
  }, []);

  // ─── Estado online inicial ────────────────────────────────────────────────
  useEffect(() => {
    const iniciar = async () => {
      try {
        const u = localStorage.getItem("usuario");
        if (!u) return;
        const usuario = JSON.parse(u);
        const { data, error } = await supabase
          .from("usuarios")
          .select("online, navegador_preferido")
          .eq("id", usuario.id).single();
        if (!error && data) {
          setOnline(data.online ?? false);
          // Tratar sygic/tomtom heredados como null (no soportados en MVP)
          const nav = data.navegador_preferido;
          const navValido = nav && nav !== "sygic_truck" && nav !== "tomtom_truck" ? nav : null;
          setNavegadorPreferido(navValido);
        }
      } finally {
        setOnlineCargado(true);
      }
    };
    iniciar();
  }, []);

  // ─── cargarCargas con useCallback — referencia estable ───────────────────
  const cargarCargas = useCallback(async () => {
    const u = localStorage.getItem("usuario");
    const usuario = u ? JSON.parse(u) : null;
    const vehiculoDelChofer = usuario?.vehiculo || "";
    setVehiculoChofer(usuario?.tipo_vehiculo || usuario?.vehiculo || "No definido");

    const { data, error } = await supabase
      .from("cargas")
      .select("*")
      .or("estado.is.null,estado.eq.pendiente")
      .order("created_at", { ascending: true });

    if (error) { console.error("Error cargando cargas:", error); return; }

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
      return (
        String(carga.vehiculo || "").toLowerCase().includes(String(vehiculoDelChofer).toLowerCase()) ||
        String(vehiculoDelChofer).toLowerCase().includes(String(carga.vehiculo || "").toLowerCase())
      );
    });

    // ── Evitar re-render si los ids no cambiaron ──────────────────────────
    const nuevoHash = cargasFiltradas.map(c => c.id).join(",");
    if (nuevoHash === cargasHashRef.current) return;
    cargasHashRef.current = nuevoHash;

    // ── Detectar viajes NUEVOS para alarma inmediata ──────────────────────
    if (onlineRef.current) {
      const nuevos = cargasFiltradas.filter(c => !viajesSonadosRef.current.has(String(c.id)));
      if (nuevos.length > 0) {
        nuevos.forEach(c => viajesSonadosRef.current.add(String(c.id)));
        // Solo sonar desde cargarCargas si NO vino del canal realtime (polling)
        // El canal realtime ya disparó la alarma de inmediato
        if (!sonandoRef.current) reproducirAlarma();
      }
    }

    setCargas(cargasFiltradas);
    // Mantener índice válido sin resetear si ya estábamos viendo un viaje
    setIndice(prev => (prev >= cargasFiltradas.length ? 0 : prev));

    if (cargasFiltradas.length > 0) {
      const ids = cargasFiltradas.map(c => c.id);
      const { data: dataParadas } = await supabase
        .from("paradas_viaje").select("*").in("carga_id", ids).order("orden", { ascending: true });
      if (dataParadas) {
        const agrupadas: Record<string, any[]> = {};
        dataParadas.forEach(p => {
          const key = String(p.carga_id);
          if (!agrupadas[key]) agrupadas[key] = [];
          agrupadas[key].push(p);
        });
        setParadasPorCarga(agrupadas);
      }
    }

    setCargando(false);
  }, [reproducirAlarma]);

  // ─── Ref a cargarCargas — para usar en closures sin recrear suscripciones ─
  const cargarCargasRef = useRef(cargarCargas);
  useEffect(() => { cargarCargasRef.current = cargarCargas; }, [cargarCargas]);

  // ─── Suscripción Supabase + polling — se monta UNA sola vez ──────────────
  useEffect(() => {
    cargarCargasRef.current();

    // Canal realtime — INSERT dispara alarma INMEDIATA antes de cargar datos
    canalRef.current = supabase
      .channel("panel-chofer-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cargas" }, () => {
        // Disparar alarma de inmediato — sin esperar cargarCargas
        if (onlineRef.current) reproducirAlarma();
        cargarCargasRef.current();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cargas" }, () => {
        cargarCargasRef.current();
      })
      .subscribe();

    // Polling cada 10s como fallback — no fuente principal
    intervaloRef.current = setInterval(() => {
      cargarCargasRef.current();
    }, 10000);

    return () => {
      if (canalRef.current)    supabase.removeChannel(canalRef.current);
      if (intervaloRef.current) clearInterval(intervaloRef.current);
      detenerAlarma();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ← sin dependencias: se monta UNA vez, usa refs para todo

  // ─── Actualizar online en Supabase ────────────────────────────────────────
  useEffect(() => {
    if (!onlineCargado) return;
    const u = localStorage.getItem("usuario");
    if (!u) return;
    const usuario = JSON.parse(u);
    supabase.from("usuarios").update({ online }).eq("id", usuario.id).then(() => {});
    if (!online) detenerAlarma();
  }, [online, onlineCargado, detenerAlarma]);

  // ─── Cerrar mapa al cambiar de viaje ─────────────────────────────────────
  useEffect(() => { setMostrarMapa(false); }, [indice]);

  // ─── Rechazar ────────────────────────────────────────────────────────────
  const rechazarViaje = () => {
    detenerAlarma();
    setMostrarMapa(false);
    const siguiente = indice + 1;
    if (siguiente < cargas.length) {
      setIndice(siguiente);
      setTimeout(() => reproducirAlarma(), 300);
    } else {
      setIndice(0);
      // Limpiar set de sonados para que si vuelven los mismos viajes suenen
      viajesSonadosRef.current.clear();
      cargarCargasRef.current();
    }
  };

  // ─── Aceptar ─────────────────────────────────────────────────────────────
  const aceptarViaje = async () => {
    if (!online) { alert("Tenés que estar ONLINE para aceptar viajes"); return; }
    const carga = cargas[indice];
    if (!carga?.id) return;
    detenerAlarma();
    const u = localStorage.getItem("usuario");
    const usuario = u ? JSON.parse(u) : null;
    if (!usuario?.id || usuario?.rol !== "chofer") { alert("Sesión inválida: ingresá como chofer"); return; }
    const { data, error } = await supabase
      .from("cargas")
      .update({ estado: "Chofer asignado", chofer_id: usuario.id, tracking: true })
      .eq("estado", "pendiente")
      .eq("id", carga.id)
      .select()
      .single();
    if (error) { alert("Este viaje ya fue tomado por otro chofer"); cargarCargasRef.current(); return; }
    localStorage.setItem("viajeActivoId", String(data.id));
    window.location.href = "/viaje-activo";
  };

  const NAVEGADORES_CONFIG = [
    { id: "google_maps",       label: "Google Maps",     emoji: "🗺️", desc: "Navegador estándar, amplia cobertura" },
    { id: "waze",              label: "Waze",             emoji: "📡", desc: "Tráfico en tiempo real, comunidad activa" },
    { id: "preguntar_siempre", label: "Preguntar siempre", emoji: "❓", desc: "Elegir en cada viaje" },
  ];

  const guardarNavegador = async (navId: string) => {
    setGuardandoNav(true);
    try {
      const u = localStorage.getItem("usuario");
      if (!u) return;
      const usuario = JSON.parse(u);
      const { error } = await supabase
        .from("usuarios")
        .update({ navegador_preferido: navId })
        .eq("id", usuario.id);
      if (!error) setNavegadorPreferido(navId);
    } finally {
      setGuardandoNav(false);
    }
  };

  const retomar = () => {
    if (viajeActivo?.id) localStorage.setItem("viajeActivoId", String(viajeActivo.id));
    window.location.href = "/viaje-activo";
  };

  const getTipoParadaLabel = (tipo: string) => {
    if (tipo === "retiro")  return "📦 Carga / Retiro";
    if (tipo === "entrega") return "🏁 Descarga / Entrega final";
    return "📍 Parada intermedia";
  };

  const cargaActual    = online ? cargas[indice] : null;
  const paradasActuales = cargaActual ? (paradasPorCarga[String(cargaActual.id)] || []) : [];
  const paradasParaMapa: ParadaMapa[] = paradasActuales.map(p => ({
    direccion: p.direccion,
    tipo:      p.tipo as "retiro" | "entrega" | "parada",
    estado:    "pendiente" as const,
  }));

  const BotonOnline = () => (
    <div className="w-full flex justify-center mb-6">
      <button
        type="button"
        onClick={async () => { await desbloquearAudio(); setOnline(v => !v); }}
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
          className="bg-green-600 hover:bg-green-500 text-white font-black px-4 py-2 rounded-xl text-sm">💬 WhatsApp</a>
        <a href={`mailto:${SOPORTE_EMAIL}`}
          className="bg-zinc-700 hover:bg-zinc-600 text-white font-black px-4 py-2 rounded-xl text-sm">📧 Email</a>
      </div>
    </div>
  );

  if (!autorizado) return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <h1 className="text-3xl font-black text-yellow-400 animate-pulse">Cargando...</h1>
    </main>
  );

  return (
    <>
      <main className="min-h-screen bg-black text-white px-4 py-6 flex items-center justify-center">
        <audio ref={audioRef} src="/sounds/alerta-viaje.mp3" loop preload="auto" />

        <div className="w-full max-w-5xl flex flex-col gap-6">

          {/* Chip de sonido — compacto y discreto */}
          {!audioDesbloqueado ? (
            <button type="button" onClick={desbloquearAudio}
              className="self-center bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-300 font-black px-4 py-2 rounded-full text-xs transition flex items-center gap-2">
              🔔 Activar alertas
            </button>
          ) : (
            <div className="self-center flex items-center gap-2 bg-zinc-900 border border-green-700 px-3 py-1.5 rounded-full text-xs text-green-400 font-black">
              🟢 Alertas activas
            </div>
          )}

          {/* Tarjeta viaje activo */}
          {!buscandoViajeActivo && viajeActivo && (
            <div className="bg-green-950 border-4 border-green-400 rounded-3xl p-6 text-center shadow-2xl">
              <p className="text-green-400 font-black text-xs mb-2 tracking-widest">VIAJE EN CURSO</p>
              <h2 className="text-2xl md:text-3xl font-black text-yellow-400 mb-1">
                {viajeActivo.origen} → {viajeActivo.destino}
              </h2>
              <p className="text-zinc-300 text-sm mb-1">
                Estado: <span className="text-green-400 font-black">{viajeActivo.estado}</span>
              </p>
              {viajeActivo.pago_chofer > 0 && (
                <p className="text-zinc-400 text-sm mb-4">
                  Ganancia: <span className="text-yellow-400 font-black">${Number(viajeActivo.pago_chofer).toLocaleString()}</span>
                </p>
              )}
              <button type="button" onClick={retomar}
                className="w-full bg-green-500 hover:bg-green-400 text-black font-black text-xl md:text-2xl py-5 rounded-2xl transition hover:scale-105">
                🚛 Retomar viaje activo
              </button>
            </div>
          )}

          {/* Panel principal */}
          {cargando ? (
            <section className="text-center">
              <BotonOnline />
              <h1 className="text-4xl md:text-5xl font-black text-yellow-400 animate-pulse">Buscando viajes...</h1>
            </section>

          ) : !cargaActual ? (
            <section className="text-center bg-zinc-900 border border-zinc-800 rounded-3xl p-8 md:p-12">
              <BotonOnline />
              <h1 className="text-4xl md:text-6xl font-black text-yellow-400 mb-4">DESPACHO EN TIEMPO REAL</h1>
              <p className="text-green-400 font-black text-lg md:text-xl mb-4">Vehículo habilitado: {vehiculoChofer || "No definido"}</p>
              <p className="text-zinc-400 text-lg md:text-2xl mb-8">
                {online ? "No hay viajes compatibles pendientes por ahora." : "Estás offline. Activá ONLINE para recibir viajes."}
              </p>
              <button type="button" onClick={() => { window.location.href = "/billetera-chofer"; }}
                className="w-full max-w-md bg-zinc-800 border-2 border-yellow-400 hover:bg-zinc-700 text-yellow-400 font-black text-xl py-5 rounded-3xl">
                💼 MI BILLETERA
              </button>
              {/* ─── Configuración de navegación ─────────────────────── */}
              <div className="w-full max-w-md mt-4">
                <button type="button" onClick={() => setMostrarConfigNav(v => !v)}
                  className="w-full flex items-center justify-between bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-3 rounded-2xl text-sm font-black text-zinc-300 transition">
                  <span>⚙️ Configuración de navegación</span>
                  <span>{mostrarConfigNav ? "▲" : "▼"}</span>
                </button>
                {mostrarConfigNav && (
                  <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 mt-2 space-y-3">
                    <p className="text-zinc-400 text-xs font-black">NAVEGADOR PREFERIDO</p>
                    <div className="bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-400 border border-zinc-700">
                      ⚠️ La navegación es responsabilidad del conductor. Utilizá tu navegador profesional preferido.
                      TILA mantiene el tracking interno independientemente del navegador elegido.
                    </div>
                    <div className="space-y-2">
                      {NAVEGADORES_CONFIG.map(nav => (
                        <button key={nav.id} type="button"
                          onClick={() => guardarNavegador(nav.id)}
                          disabled={guardandoNav}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-black transition border ${
                            navegadorPreferido === nav.id
                              ? "bg-yellow-400 text-black border-yellow-400"
                              : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
                          }`}>
                          <span className="text-xl flex-shrink-0">{nav.emoji}</span>
                          <div className="text-left">
                            <p className="leading-tight">{nav.label}</p>
                            <p className={`text-xs font-normal ${navegadorPreferido === nav.id ? "text-black/70" : "text-zinc-500"}`}>{nav.desc}</p>
                          </div>
                          {navegadorPreferido === nav.id && <span className="ml-auto text-black">✓</span>}
                        </button>
                      ))}
                    </div>
                    {navegadorPreferido && navegadorPreferido !== "preguntar_siempre" && (
                      <p className="text-green-400 text-xs text-center font-black">
                        ✓ Se abrirá {NAVEGADORES_CONFIG.find(n => n.id === navegadorPreferido)?.label} al navegar
                      </p>
                    )}
                  </div>
                )}
              </div>

              <BloquesSoporte />
              <div className="mt-5 flex justify-center"><BotonCerrarSesion /></div>
            </section>

          ) : (
            <section className="bg-zinc-900 border-4 border-yellow-400 rounded-3xl p-5 md:p-8 shadow-2xl animate-pulse text-center">
              <BotonOnline />
              <p className="text-pink-500 font-black text-xl md:text-2xl mb-4">🚨 NUEVO VIAJE DISPONIBLE 🚨</p>
              <p className="text-green-400 font-black text-lg md:text-xl mb-6">Vehículo habilitado: {vehiculoChofer || "No definido"}</p>

              {paradasActuales.length > 0 ? (
                <div className="mb-6">
                  <h1 className="text-2xl md:text-4xl font-black text-yellow-400 mb-4 leading-tight">Ruta del viaje</h1>
                  <div className="flex flex-col gap-2 text-left">
                    {paradasActuales.map((parada, index) => (
                      <div key={parada.id} className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0 ${
                          parada.tipo === "retiro" ? "bg-blue-600 text-white" :
                          parada.tipo === "entrega" ? "bg-green-600 text-white" : "bg-zinc-600 text-white"
                        }`}>{LABELS[index] || index}</span>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-lg md:text-2xl mb-6 text-left">
                <p>🚛 <strong>Vehículo:</strong> {cargaActual.vehiculo || "Sin dato"}</p>
                <p>📍 <strong>Distancia:</strong> {cargaActual.km_estimados ? `${cargaActual.km_estimados} km` : "Sin calcular"}</p>
                <p>⚖️ <strong>Peso:</strong> {cargaActual.peso || "Sin dato"}</p>
                <p>💰 <strong>Ganancia chofer:</strong> ${Number(cargaActual.pago_chofer || 0).toLocaleString()}</p>
                <p>📦 <strong>Tipo:</strong> {cargaActual.tipo_carga || "Sin dato"}</p>
                <p className="md:col-span-2">📝 <strong>Detalles:</strong> {cargaActual.detalles || "Sin detalles"}</p>
              </div>

              {/* Mapa del recorrido — integrado en TILA */}
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => setMostrarMapa(v => !v)}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <button type="button" onClick={aceptarViaje} disabled={!online}
                  className={`font-black text-2xl md:text-3xl py-6 rounded-3xl ${online ? "bg-green-600 hover:bg-green-500 text-black" : "bg-zinc-800 text-zinc-500 cursor-not-allowed"}`}>
                  ACEPTAR
                </button>
                <button type="button" onClick={rechazarViaje}
                  className="bg-red-600 hover:bg-red-500 text-white font-black text-2xl md:text-3xl py-6 rounded-3xl">
                  RECHAZAR
                </button>
              </div>

              <button type="button" onClick={() => { window.location.href = "/billetera-chofer"; }}
                className="w-full mt-5 bg-zinc-800 border-2 border-yellow-400 hover:bg-zinc-700 text-yellow-400 font-black text-xl md:text-2xl py-5 rounded-3xl">
                💼 MI BILLETERA
              </button>
              <BloquesSoporte />
              <div className="mt-5 flex justify-center"><BotonCerrarSesion /></div>
              <p className="text-zinc-500 text-center mt-6">Viaje {indice + 1} de {cargas.length}</p>
            </section>
          )}
        </div>
      </main>

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