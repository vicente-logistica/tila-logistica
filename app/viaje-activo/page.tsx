"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import MapaTILA, { ParadaMapa } from "../components/MapaTILA";
import ChatAsistencia from "../components/ChatAsistencia";
import { registrarEvidencia, estadoAEvento } from "../lib/evidencias";

// ─── Estados y flujo ──────────────────────────────────────────────────────────
const ESTADOS_ORDEN = [
  { nombre: "En camino",           color: "bg-yellow-400 text-black",  label: "INICIAR VIAJE",          abreNav: true  },
  { nombre: "Carga retirada",      color: "bg-blue-600 text-white",    label: "CARGA RETIRADA",         abreNav: false },
  { nombre: "En ruta",             color: "bg-purple-600 text-white",  label: "INICIAR TRAMO A DESTINO", abreNav: true  },
  { nombre: "Descarga completada", color: "bg-red-600 text-white",     label: "DESCARGA COMPLETADA",    abreNav: false },
  { nombre: "Viaje finalizado",    color: "bg-green-600 text-white",   label: "FINALIZAR VIAJE",        abreNav: false },
];

const LABELS = ["A", "B", "C", "D", "E", "F"];

// ─── Instrucción operativa ────────────────────────────────────────────────────
interface Instruccion { emoji: string; titulo: string; subtitulo: string; colorBorde: string; }

function getInstruccion(estado: string, paradas: any[], idx: number): Instruccion {
  const label = paradas.length > 0 && idx < paradas.length
    ? paradas[idx]?.tipo === "retiro" ? "retiro"
    : paradas[idx]?.tipo === "entrega" ? "entrega"
    : `parada ${String.fromCharCode(65 + idx)}`
    : null;
  switch (estado) {
    case "Chofer asignado":    return { emoji: "🚚", titulo: "Iniciá el viaje",         subtitulo: "Dirigite al punto de retiro",                                      colorBorde: "border-green-500"  };
    case "En camino":          return { emoji: "📍", titulo: "Punto de retiro",          subtitulo: label ? `Llegá al ${label} y confirmá` : "Llegá al lugar de carga", colorBorde: "border-yellow-400" };
    case "Carga retirada":     return { emoji: "🚛", titulo: "Carga retirada",           subtitulo: "Dirigite al destino de entrega",                                   colorBorde: "border-blue-500"   };
    case "En ruta":            return { emoji: "🏁", titulo: "En ruta al destino",       subtitulo: label ? `Dirigite a la ${label}` : "Dirigite al punto de entrega",  colorBorde: "border-purple-500" };
    case "Descarga completada":return { emoji: "✅", titulo: "Descarga completada",      subtitulo: "Confirmá la finalización del viaje",                               colorBorde: "border-red-500"    };
    case "Viaje finalizado":   return { emoji: "🎉", titulo: "Viaje finalizado",         subtitulo: "Excelente trabajo",                                                colorBorde: "border-green-400"  };
    default:                   return { emoji: "🚛", titulo: estado || "Viaje activo",   subtitulo: "Seguí las instrucciones",                                          colorBorde: "border-zinc-600"   };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const esUuidValido = (v: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));
const fmt = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

// ─── Aviso legal ──────────────────────────────────────────────────────────────
const AVISO_LEGAL = "TILA no se responsabiliza por el navegador utilizado por el conductor. La elección de ruta, restricciones viales, multas, accesos, desvíos y decisiones de conducción son responsabilidad exclusiva del conductor.";

// ─── Sonido finalización — función sincrónica pura, fuera del componente ──────
// Al estar fuera del componente, no hay closures ni async que interfieran con el
// user-gesture token del browser. Se llama DIRECTO desde el onClick del botón.
function reproducirFinalizadoChofer() {
  console.log("🎉 CLICK FINALIZAR: intentando audio");
  const audio = new Audio("/sounds/alerta-viaje.mp3?v=final");
  audio.volume = 1;
  audio.currentTime = 0;
  audio.loop = false;
  audio.play()
    .then(() => console.log("🎉 CLICK FINALIZAR: audio OK"))
    .catch(err => console.warn("🎉 CLICK FINALIZAR: audio ERROR", err));
}

export default function ViajeActivoPage() {
  const { autorizado } = useProtegerRuta("chofer");
  const router = useRouter();

  const [viaje, setViaje]             = useState<any>(null);
  const [cargando, setCargando]       = useState(true);
  const [festejo, setFestejo]         = useState(false);
  const [gpsEstado, setGpsEstado]     = useState("GPS...");
  const [velocidadGps, setVelocidadGps] = useState(0);
  const [bateriaNivel, setBateriaNivel]     = useState<number | null>(null);
  const [bateriaCargando, setBateriaCargando] = useState<boolean | null>(null);
  const [bateriaDisponible, setBateriaDisponible] = useState(false);
  const [ultimaSenal, setUltimaSenal] = useState("");

  const [paradas, setParadas]                     = useState<any[]>([]);
  const [paradaActivaIndex, setParadaActivaIndex] = useState(0);
  const [confirmandoParada, setConfirmandoParada] = useState(false);

  // UI
  const [mostrarChat, setMostrarChat]         = useState(false);
  const [mostrarDetalles, setMostrarDetalles] = useState(false);
  const [mostrarSoporte, setMostrarSoporte]   = useState(false);
  // Contadores de no leídos por canal
  const [noLeidosViaje, setNoLeidosViaje]           = useState(0);
  const [noLeidosSoporte, setNoLeidosSoporte]       = useState(0);
  const [mostrarNavSel, setMostrarNavSel]     = useState(false);
  const [destNavPendiente, setDestNavPendiente] = useState<string | null>(null);
  const [navegadorPreferido, setNavegadorPreferido] = useState<string | null>(null);

  // Modal evidencia de carga
  const [modalCarga, setModalCarga]               = useState(false);
  const [cargaEntrego, setCargaEntrego]           = useState("");
  const [cargaTipoCarga, setCargaTipoCarga]       = useState("");
  const [cargaObsv, setCargaObsv]                 = useState("");
  const [cargaFoto, setCargaFoto]                 = useState<File | null>(null);
  const [cargaSubiendo, setCargaSubiendo]         = useState(false);

  // Modal evidencia de descarga (entrega)
  const [modalEntrega, setModalEntrega]           = useState(false);
  const [entregaReceptor, setEntregaReceptor]     = useState("");
  const [entregaTipoCarga, setEntregaTipoCarga]   = useState("");
  const [entregaObservacion, setEntregaObservacion] = useState("");
  const [entregaFoto, setEntregaFoto]             = useState<File | null>(null);
  const [entregaSubiendo, setEntregaSubiendo]     = useState(false);

  const viajeTerminado       = useRef(false);
  const usuarioRef           = useRef<any>(null);
  const festejoSonadoRef     = useRef(false);
  const finalizadoAudioRef   = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const u = localStorage.getItem("usuario");
    if (u) usuarioRef.current = JSON.parse(u);
  }, []);

  useEffect(() => {
    finalizadoAudioRef.current = new Audio("/sounds/alerta-viaje.mp3?v=final");
    finalizadoAudioRef.current.preload = "auto";
    finalizadoAudioRef.current.volume = 1;
    finalizadoAudioRef.current.loop = false;
    return () => {
      finalizadoAudioRef.current?.pause();
      finalizadoAudioRef.current = null;
    };
  }, []);

  // ─── Battery ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        if (!("getBattery" in navigator)) { setBateriaDisponible(false); return; }
        const bat = await (navigator as any).getBattery();
        setBateriaDisponible(true);
        setBateriaNivel(Math.round(bat.level * 100));
        setBateriaCargando(bat.charging);
        bat.addEventListener("levelchange",    () => setBateriaNivel(Math.round(bat.level * 100)));
        bat.addEventListener("chargingchange", () => setBateriaCargando(bat.charging));
      } catch { setBateriaDisponible(false); }
    };
    init();
  }, []);

  useEffect(() => {
    if (!bateriaDisponible || bateriaNivel === null || !usuarioRef.current?.id) return;
    supabase.from("usuarios").update({ bateria_nivel: bateriaNivel, bateria_cargando: bateriaCargando, ultima_senal_at: new Date().toISOString() })
      .eq("id", usuarioRef.current.id).then(() => {});
  }, [bateriaNivel, bateriaCargando, bateriaDisponible]);

  // ─── Parada activa ────────────────────────────────────────────────────────
  const paradaActiva = useMemo(() => {
    if (paradas.length > 0) {
      const p = paradas[paradaActivaIndex];
      if (!p) return null;
      return { tipo: p.tipo === "retiro" ? "RETIRO" : "ENTREGA", direccion: p.direccion };
    }
    if (!viaje) return null;
    if (["Chofer asignado","En camino"].includes(viaje.estado))  return { tipo: "RETIRO",  direccion: viaje.origen  };
    if (["Carga retirada","En ruta"].includes(viaje.estado))     return { tipo: "ENTREGA", direccion: viaje.destino };
    return null;
  }, [paradas, paradaActivaIndex, viaje?.estado, viaje?.origen, viaje?.destino]);

  // ─── destinoRuta para MapaTILA ────────────────────────────────────────────
  const destinoRuta = useMemo((): string | null => {
    if (!viaje) return null;
    const estado = viaje.estado || "Chofer asignado";
    if (["Chofer asignado","En camino"].includes(estado)) {
      return paradas.length > 0
        ? (paradas.find(p => p.tipo === "retiro")?.direccion ?? viaje.origen)
        : viaje.origen;
    }
    if (["Carga retirada","En ruta"].includes(estado)) {
      if (paradas.length > 0 && paradaActivaIndex < paradas.length) return paradas[paradaActivaIndex].direccion;
      return viaje.destino;
    }
    if (estado === "Descarga completada") return viaje.destino;
    return null;
  }, [viaje?.estado, viaje?.origen, viaje?.destino, paradas, paradaActivaIndex]);

  const paradasParaMapa: ParadaMapa[] = useMemo(() =>
    paradas.map((p, i) => ({
      direccion: p.direccion,
      tipo:      p.tipo as "retiro" | "entrega" | "parada",
      estado:    i < paradaActivaIndex ? "completada" : i === paradaActivaIndex ? "en_curso" : "pendiente",
    })),
  [paradas, paradaActivaIndex]);

  const todasParadasCompletadas = useMemo(() => paradas.length > 0 && paradaActivaIndex >= paradas.length, [paradas, paradaActivaIndex]);

  // ─── Botón activo ─────────────────────────────────────────────────────────
  const botonActivo = useMemo(() => {
    if (!viaje?.estado || viaje.estado === "Chofer asignado") return ESTADOS_ORDEN[0];
    const idx = ESTADOS_ORDEN.findIndex(e => e.nombre === viaje.estado);
    if (idx >= 0 && idx < ESTADOS_ORDEN.length - 1) return ESTADOS_ORDEN[idx + 1];
    if (idx === ESTADOS_ORDEN.length - 1) return ESTADOS_ORDEN[idx];
    return ESTADOS_ORDEN[0];
  }, [viaje?.estado]);

  const bloqueadoPorParadas = botonActivo?.nombre === "Viaje finalizado" && paradas.length > 0 && !todasParadasCompletadas;

  const instruccion = useMemo(() => getInstruccion(viaje?.estado || "", paradas, paradaActivaIndex), [viaje?.estado, paradas, paradaActivaIndex]);

  // ─── Realtime ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const viajeId = localStorage.getItem("viajeActivoId");
    if (!viajeId) return;
    const canal = supabase.channel(`viaje-activo-rt-${viajeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cargas", filter: `id=eq.${viajeId}` },
        (payload) => { if (payload.new) setViaje(payload.new); })
      .on("postgres_changes", { event: "*", schema: "public", table: "paradas_viaje", filter: `carga_id=eq.${viajeId}` },
        () => {
          supabase.from("paradas_viaje").select("*").eq("carga_id", Number(viajeId)).order("orden", { ascending: true })
            .then(({ data }) => {
              if (data?.length) {
                setParadas(data);
                const i = data.findIndex(p => p.estado !== "completada");
                setParadaActivaIndex(i === -1 ? data.length : i);
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
    const wid = navigator.geolocation.watchPosition(
      async (pos) => {
        if (viajeTerminado.current) return;
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        const vel = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        const now = new Date().toISOString();
        setGpsEstado("🟢"); setVelocidadGps(vel);
        setUltimaSenal(new Date(now).toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" }));
        setViaje((prev: any) => prev ? { ...prev, lat, lng, velocidad: vel, gps_actualizado: now } : prev);
        await supabase.from("cargas").update({ lat, lng, velocidad: vel, velocidad_kmh: vel, gps_actualizado: now }).eq("id", viaje.id);
        if (usuarioRef.current?.id) {
          await supabase.from("usuarios").update({ ultima_senal_at: now, bateria_nivel: bateriaNivel, bateria_cargando: bateriaCargando }).eq("id", usuarioRef.current.id);
        }
      },
      (err) => { setGpsEstado(err.code === 1 ? "🔴 Denegado" : "🔴 Error"); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, [viaje?.id, bateriaNivel, bateriaCargando]);

  const cargarViajeActivo = async () => {
    const viajeId = localStorage.getItem("viajeActivoId");
    if (!viajeId) { router.replace("/panel-chofer"); return; }
    const { data, error } = await supabase.from("cargas").select("*").eq("id", viajeId).single();
    if (error) { alert("Error al cargar viaje"); return; }
    setViaje(data);
    const { data: dp } = await supabase.from("paradas_viaje").select("*").eq("carga_id", Number(viajeId)).order("orden", { ascending: true });
    if (dp?.length) {
      setParadas(dp);
      const i = dp.findIndex(p => p.estado !== "completada");
      setParadaActivaIndex(i === -1 ? dp.length : i);
    }
    const u = localStorage.getItem("usuario");
    if (u) {
      const usuario = JSON.parse(u);
      const { data: perfil } = await supabase.from("usuarios").select("navegador_preferido").eq("id", usuario.id).single();
      if (perfil?.navegador_preferido) setNavegadorPreferido(perfil.navegador_preferido);
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
    const nuevoIndice = paradaActivaIndex + 1;
    setParadaActivaIndex(nuevoIndice);
    setConfirmandoParada(false);
    // Navegar automáticamente al próximo objetivo
    if (nuevoIndice < paradas.length) {
      iniciarNavegacion(paradas[nuevoIndice].direccion);
    } else {
      iniciarNavegacion(viaje.destino);
    }
  };

  const acreditarBilletera = async (data: any) => {
    const choferId = data?.chofer_id, viajeId = data?.id, monto = Number(data?.pago_chofer || 0);
    if (!choferId || !esUuidValido(choferId) || !viajeId || !monto) return;
    const { data: existe } = await supabase.from("billetera_chofer").select("id").eq("viaje_id", String(viajeId)).maybeSingle();
    if (existe) return;
    await supabase.from("billetera_chofer").insert([{ chofer_id: choferId, viaje_id: String(viajeId), monto }]);
  };

  // ─── Navegación externa ───────────────────────────────────────────────────
  const buildNavUrl = (navId: string, dest: string): string => {
    const enc = encodeURIComponent(dest + ", Argentina");
    if (navId === "waze") return `https://waze.com/ul?q=${enc}&navigate=yes`;
    return `https://www.google.com/maps/dir/?api=1&destination=${enc}&travelmode=driving`;
  };

  const abrirNavegador = (navId: string, dest: string) => {
    window.open(buildNavUrl(navId, dest), `_nav_${Date.now()}`);
    setMostrarNavSel(false);
    setDestNavPendiente(null);
  };

  // Abre navegador o muestra selector
  const iniciarNavegacion = (dest: string) => {
    const nav = navegadorPreferido;
    const valido = nav && nav !== "preguntar_siempre" && nav !== "sygic_truck" && nav !== "tomtom_truck" ? nav : null;
    if (valido) {
      abrirNavegador(valido, dest);
    } else {
      setDestNavPendiente(dest);
      setMostrarNavSel(true);
    }
  };

  // ─── Actualizar estado + navegación automática ────────────────────────────
  // skipEvidencia=true cuando el modal ya registró la evidencia manualmente
  const actualizarEstado = async (nuevoEstado: string, skipEvidencia = false) => {
    if (!viaje?.id) return;
    if (bloqueadoPorParadas) { alert("Completá todas las paradas antes de finalizar"); return; }

    const now = new Date().toISOString();
    const upd: any = { estado: nuevoEstado };
    if (nuevoEstado === "En camino")        upd.hora_inicio      = now;
    if (nuevoEstado === "Chofer asignado")  upd.hora_aceptacion  = now;
    if (nuevoEstado === "Viaje finalizado") { upd.tracking = false; upd.hora_finalizacion = now; viajeTerminado.current = true; }
    const { data, error } = await supabase.from("cargas").update(upd).eq("id", viaje.id).select().single();
    if (error) { alert("Error al actualizar estado"); viajeTerminado.current = false; return; }
    setViaje(data);

    // ── Evidencia automática — se omite si el modal ya la registró ───────────
    if (!skipEvidencia) {
      const evento = estadoAEvento(nuevoEstado);
      if (evento) {
        registrarEvidencia(supabase, viaje.id, evento, {
          usuarioId:   usuarioRef.current?.id,
          estadoViaje: nuevoEstado,
          lat:         viaje.lat ?? null,
          lng:         viaje.lng ?? null,
        });
      }
    }

    // Navegación automática en transiciones que abren mapa
    if (nuevoEstado === "En camino") {
      const dest = paradas.find(p => p.tipo === "retiro")?.direccion ?? viaje.origen;
      iniciarNavegacion(dest);
    }
    if (nuevoEstado === "En ruta") {
      const dest = paradas.length > 0
        ? (paradas.find((p, i) => i >= paradaActivaIndex && p.tipo !== "retiro")?.direccion ?? viaje.destino)
        : viaje.destino;
      iniciarNavegacion(dest);
    }

    if (nuevoEstado === "Viaje finalizado") {
      await acreditarBilletera(data);
      localStorage.removeItem("viajeActivoId");
      setFestejo(true);
      setTimeout(() => router.push("/panel-chofer"), 5000);
    }
  };

  // ─── Helper: subir foto a storage ────────────────────────────────────────
  const subirFotoEvidencia = async (file: File, prefijo: string): Promise<string | undefined> => {
    try {
      const ext  = file.name.split(".").pop() || "jpg";
      const path = `evidencias/${viaje.id}/${prefijo}_${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("documentacion-choferes")
        .upload(path, file, { upsert: true });
      if (uploadErr) { console.warn("[EVIDENCIA] Error subiendo foto:", uploadErr.message); return undefined; }
      const { data: urlData } = supabase.storage.from("documentacion-choferes").getPublicUrl(path);
      return urlData.publicUrl;
    } catch (e: any) {
      console.warn("[EVIDENCIA] Excepción subiendo foto:", e?.message);
      return undefined;
    }
  };

  // ─── Confirmar carga (modal) ──────────────────────────────────────────────
  const confirmarCarga = async () => {
    setCargaSubiendo(true);
    const fotoUrl = cargaFoto ? await subirFotoEvidencia(cargaFoto, "carga") : undefined;

    await registrarEvidencia(supabase, viaje.id, "carga_retirada", {
      usuarioId:     usuarioRef.current?.id,
      estadoViaje:   "Carga retirada",
      lat:           viaje.lat ?? null,
      lng:           viaje.lng ?? null,
      tipoOperacion: "carga",
      tipoCarga:     cargaTipoCarga.trim() || undefined,
      entregaNombre: cargaEntrego.trim() || undefined,
      observacion:   cargaObsv.trim() || undefined,
      fotoUrl,
    });

    setCargaSubiendo(false);
    setModalCarga(false);
    setCargaEntrego(""); setCargaTipoCarga(""); setCargaObsv(""); setCargaFoto(null);
    actualizarEstado("Carga retirada", true); // skip evidencia automática — ya registrada
  };

  // ─── Confirmar descarga (modal) ───────────────────────────────────────────
  const confirmarEntrega = async () => {
    setEntregaSubiendo(true);
    const fotoUrl = entregaFoto ? await subirFotoEvidencia(entregaFoto, "descarga") : undefined;

    await registrarEvidencia(supabase, viaje.id, "descarga_completada", {
      usuarioId:      usuarioRef.current?.id,
      estadoViaje:    "Descarga completada",
      lat:            viaje.lat ?? null,
      lng:            viaje.lng ?? null,
      tipoOperacion:  "descarga",
      tipoCarga:      entregaTipoCarga.trim() || undefined,
      recibioNombre:  entregaReceptor.trim() || undefined,
      observacion:    entregaObservacion.trim() || undefined,
      fotoUrl,
    });

    setEntregaSubiendo(false);
    setModalEntrega(false);
    setEntregaReceptor(""); setEntregaTipoCarga(""); setEntregaObservacion(""); setEntregaFoto(null);
    actualizarEstado("Descarga completada", true); // skip evidencia automática — ya registrada
  };

  // ─── Guards ───────────────────────────────────────────────────────────────
  if (!autorizado) return <main className="min-h-screen bg-black flex items-center justify-center"><p className="text-yellow-400 font-black text-2xl animate-pulse">Cargando...</p></main>;
  if (cargando)    return <main className="min-h-screen bg-black flex items-center justify-center"><p className="text-yellow-400 font-black text-2xl animate-pulse">Cargando viaje...</p></main>;
  if (festejo)     return (
    <main className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="relative bg-green-950 border-4 border-green-400 rounded-3xl p-8 text-center shadow-2xl max-w-xl w-full overflow-hidden">
        {/* Decoración de fondo */}
        <div className="absolute inset-0 flex flex-wrap items-center justify-center pointer-events-none select-none opacity-10 text-6xl gap-2 p-4">
          {["💼","💰","🎉","🌟","💼","💰","🎉","🌟","💼","💰","🎉","🌟"].map((e, i) => <span key={i}>{e}</span>)}
        </div>
        {/* Contenido — orientado al chofer */}
        <div className="relative z-10">
          <div className="text-7xl mb-3 animate-bounce">💼</div>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-2">🎉 VIAJE FINALIZADO 🎉</h1>
          <p className="text-2xl font-black text-yellow-400 mb-6">¡Felicitaciones!</p>
          <div className="bg-green-900 border border-green-500 rounded-2xl px-6 py-4 mb-4 inline-block">
            <p className="text-zinc-400 text-xs font-black mb-1">GANANCIA ACREDITADA</p>
            <p className="text-4xl font-black text-green-400">${Number(viaje?.pago_chofer || 0).toLocaleString()}</p>
          </div>
          <p className="text-zinc-300 text-lg font-bold mb-1">Excelente trabajo 🚛</p>
          <p className="text-zinc-500 text-sm">Volviendo al panel...</p>
        </div>
      </div>
    </main>
  );

  const colorEstadoBadge = (): string => {
    const c: Record<string,string> = {
      "Chofer asignado": "bg-green-600", "En camino": "bg-yellow-400 text-black",
      "Carga retirada": "bg-blue-600", "En ruta": "bg-purple-600",
      "Descarga completada": "bg-red-600", "Viaje finalizado": "bg-green-500",
    };
    return c[viaje.estado] || "bg-zinc-700";
  };

  return (
    <main className="fixed inset-0 bg-black overflow-hidden">

      {/* ─── MAPA ────────────────────────────────────────────────────────── */}
      <div className="absolute inset-0" style={{ height: "100dvh", width: "100vw" }}>
        <MapaTILA
          lat={viaje?.lat} lng={viaje?.lng}
          origen={viaje.origen} destino={viaje.destino}
          paradaActivaDireccion={destinoRuta}
          paradas={paradasParaMapa.length > 0 ? paradasParaMapa : undefined}
          altura="100dvh"
          modoNavegacion={true}
        />
      </div>

      {/* ─── HEADER FLOTANTE ─────────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-20 p-3 pointer-events-none">
        <div className="bg-black/85 backdrop-blur-sm rounded-2xl px-4 py-2 flex items-center justify-between gap-2">
          <p className="text-yellow-400 font-black text-sm truncate flex-1">
            {viaje.origen} → {viaje.destino}
          </p>
          <span className={`text-xs font-black px-2 py-1 rounded-lg flex-shrink-0 ${colorEstadoBadge()}`}>
            {viaje.estado || "Asignado"}
          </span>
        </div>
      </div>

      {/* ─── BOTTOM FLOTANTE ─────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-3">
        <div className="bg-black/92 backdrop-blur-sm rounded-3xl px-4 pt-3 pb-4 border border-zinc-800 space-y-2">

          {/* Instrucción corta + dirección */}
          <div className="px-1">
            <p className="text-zinc-400 text-xs">{instruccion.subtitulo}</p>
            {paradaActiva && (
              <p className="text-white font-black text-sm truncate">{paradaActiva.direccion}</p>
            )}
          </div>

          {/* Confirmar parada */}
          {paradas.length > 0 && !todasParadasCompletadas && paradaActivaIndex < paradas.length && (
            <button type="button" onClick={confirmarParadaCompletada} disabled={confirmandoParada}
              className={`w-full py-3 rounded-2xl font-black text-sm transition ${confirmandoParada ? "bg-zinc-700 text-zinc-400" : "bg-blue-600 hover:bg-blue-500 text-white"}`}>
              {confirmandoParada ? "Confirmando..." : `✅ Confirmar parada ${LABELS[paradaActivaIndex] || ""}`}
            </button>
          )}

          {/* Aviso pago pendiente — solo informativo, no bloquea */}
          {viaje.pago_estado && viaje.pago_estado !== "pagado" && (
            <div className={`w-full px-3 py-2 rounded-xl text-xs font-black text-center ${
              viaje.pago_estado === "rechazado" ? "bg-red-900/60 text-red-300 border border-red-700" :
              "bg-orange-900/60 text-orange-300 border border-orange-700"
            }`}>
              {viaje.pago_estado === "rechazado"
                ? "❌ Pago rechazado — el cliente debe reintentar"
                : "💳 Pago pendiente del cliente"}
            </div>
          )}

          {/* Botón principal */}
          {botonActivo && (
            <button
              type="button"
              disabled={bloqueadoPorParadas}
              className={`w-full py-4 rounded-2xl font-black text-lg transition ${
                bloqueadoPorParadas ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : `${botonActivo.color} hover:opacity-90 active:scale-[0.98]`
              }`}
              onClick={() => {
                if (botonActivo?.nombre === "Viaje finalizado") {
                  console.log("FINALIZAR CLICK");
                  const audio = finalizadoAudioRef.current;
                  console.log("audioRef", audio);
                  if (audio) {
                    audio.pause();
                    audio.currentTime = 0;
                    audio.play()
                      .then(() => { console.log("FINALIZADO PLAY OK"); })
                      .catch((err) => { console.error("FINALIZADO PLAY ERROR", err); });
                  }
                }
                // "Carga retirada" abre modal de evidencia de carga
                if (botonActivo?.nombre === "Carga retirada") {
                  setModalCarga(true);
                  return;
                }
                // "Descarga completada" abre modal de evidencia de descarga
                if (botonActivo?.nombre === "Descarga completada") {
                  setModalEntrega(true);
                  return;
                }
                actualizarEstado(botonActivo.nombre);
              }}
            >
              {botonActivo.label}{bloqueadoPorParadas ? " 🔒" : ""}
            </button>
          )}

          {/* Secundarios — solo íconos */}
          <div className="flex gap-2 pt-1">
            <button type="button"
              onClick={() => { setMostrarChat(v => !v); setMostrarSoporte(false); setMostrarDetalles(false); if (!mostrarChat) setNoLeidosViaje(0); }}
              className={`relative flex-1 py-2 rounded-xl text-lg transition ${mostrarChat ? "bg-blue-600" : noLeidosViaje > 0 ? "bg-blue-900 border border-blue-500" : "bg-zinc-800 hover:bg-zinc-700"}`}>
              💬
              {noLeidosViaje > 0 && !mostrarChat && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-black rounded-full min-w-5 h-5 flex items-center justify-center px-1 animate-pulse">
                  {noLeidosViaje}
                </span>
              )}
            </button>
            <button type="button"
              onClick={() => { setMostrarDetalles(v => !v); setMostrarChat(false); setMostrarSoporte(false); }}
              className={`flex-1 py-2 rounded-xl text-lg transition ${mostrarDetalles ? "bg-zinc-600" : "bg-zinc-800 hover:bg-zinc-700"}`}>
              📋
            </button>
            <button type="button"
              onClick={() => { setMostrarSoporte(v => !v); setMostrarChat(false); setMostrarDetalles(false); if (!mostrarSoporte) setNoLeidosSoporte(0); }}
              className={`relative flex-1 py-2 rounded-xl text-lg transition ${mostrarSoporte ? "bg-orange-600" : noLeidosSoporte > 0 ? "bg-orange-900 border border-orange-500" : "bg-zinc-800 hover:bg-zinc-700"}`}>
              🛟
              {noLeidosSoporte > 0 && !mostrarSoporte && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-black rounded-full min-w-5 h-5 flex items-center justify-center px-1 animate-pulse">
                  {noLeidosSoporte}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ─── PANEL CHAT CLIENTE (viaje operativo) ───────────────────────── */}
      {mostrarChat && viaje?.id && usuarioRef.current?.id && (
        <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[65vh] flex flex-col bg-zinc-900 border-t border-blue-600 rounded-t-3xl">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800 flex-shrink-0">
            <div>
              <p className="text-blue-400 font-black text-sm">💬 Chat del viaje</p>
              <p className="text-zinc-500 text-xs">VIAJE #{viaje.id}</p>
            </div>
            <button type="button" onClick={() => setMostrarChat(false)} className="text-zinc-400 font-black px-2">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ChatAsistencia viajeId={viaje.id} usuarioId={usuarioRef.current.id} usuarioRol="chofer" usuarioNombre={usuarioRef.current.nombre || "Chofer"} tipoChat="viaje" modoInline onNoLeidosChange={setNoLeidosViaje} />
          </div>
        </div>
      )}

      {/* ─── PANEL SOPORTE TILA (privado chofer ↔ admin) ────────────────── */}
      {mostrarSoporte && viaje?.id && usuarioRef.current?.id && (
        <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[65vh] flex flex-col bg-zinc-900 border-t border-orange-600 rounded-t-3xl">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800 flex-shrink-0">
            <div>
              <p className="text-orange-400 font-black text-sm">🚛 Soporte chofer</p>
              <p className="text-zinc-500 text-xs">Problemas operativos · Incidentes · Soporte técnico</p>
            </div>
            <button type="button" onClick={() => setMostrarSoporte(false)} className="text-zinc-400 font-black px-2">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ChatAsistencia viajeId={viaje.id} usuarioId={usuarioRef.current.id} usuarioRol="chofer" usuarioNombre={usuarioRef.current.nombre || "Chofer"} tipoChat="soporte_chofer" modoInline onNoLeidosChange={setNoLeidosSoporte} />
          </div>
        </div>
      )}

      {/* ─── PANEL DETALLES ──────────────────────────────────────────────── */}
      {mostrarDetalles && (
        <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[70vh] overflow-y-auto bg-zinc-900 border-t border-zinc-700 rounded-t-3xl">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800 sticky top-0 bg-zinc-900">
            <p className="text-yellow-400 font-black text-sm">📋 VIAJE #{viaje.id}</p>
            <button type="button" onClick={() => setMostrarDetalles(false)} className="text-zinc-400 font-black px-2">✕</button>
          </div>
          <div className="p-4 space-y-4 text-xs">

            {/* Info del viaje */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-800 rounded-xl p-3"><p className="text-zinc-500 font-black mb-1">ORIGEN</p><p className="text-white font-black">{viaje.origen}</p></div>
              <div className="bg-zinc-800 rounded-xl p-3"><p className="text-zinc-500 font-black mb-1">DESTINO</p><p className="text-white font-black">{viaje.destino}</p></div>
              <div className="bg-zinc-800 rounded-xl p-3"><p className="text-zinc-500 font-black mb-1">CARGA</p><p className="text-white">{viaje.tipo_carga || "—"}</p></div>
              <div className="bg-zinc-800 rounded-xl p-3"><p className="text-zinc-500 font-black mb-1">DISTANCIA</p><p className="text-white">{viaje.km_estimados ? `${viaje.km_estimados} km` : "—"}</p></div>
              <div className="bg-zinc-800 rounded-xl p-3"><p className="text-zinc-500 font-black mb-1">GPS</p><p className={gpsEstado === "🟢" ? "text-green-400 font-black" : "text-yellow-400"}>{gpsEstado} · {velocidadGps} km/h</p></div>
              <div className="bg-zinc-800 rounded-xl p-3"><p className="text-zinc-500 font-black mb-1">BATERÍA</p>
                <p className={!bateriaDisponible ? "text-zinc-500" : bateriaNivel !== null && bateriaNivel < 20 ? "text-red-400 font-black" : "text-green-400 font-black"}>
                  {!bateriaDisponible ? "—" : bateriaNivel !== null ? `${bateriaNivel}%${bateriaCargando ? " ⚡" : ""}` : "..."}
                </p>
              </div>
            </div>

            {/* Paradas */}
            {paradas.length > 0 && (
              <div>
                <p className="text-zinc-500 font-black mb-2">PARADAS</p>
                <div className="space-y-2">
                  {paradas.map((p, i) => {
                    const activa = i === paradaActivaIndex, comp = i < paradaActivaIndex;
                    return (
                      <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border ${activa ? "bg-yellow-400/10 border-yellow-400" : comp ? "bg-green-900/30 border-green-700" : "bg-zinc-800 border-zinc-700"}`}>
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${comp ? "bg-green-500 text-white" : activa ? "bg-yellow-400 text-black" : "bg-zinc-600 text-zinc-400"}`}>{LABELS[i] || i}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-zinc-400">{p.tipo === "retiro" ? "📦 Retiro" : p.tipo === "entrega" ? "🏁 Entrega" : "📍 Parada"}</p>
                          <p className={`font-black truncate ${activa ? "text-yellow-400" : comp ? "text-green-400" : "text-zinc-300"}`}>{p.direccion}</p>
                          {p.completada_at && <p className="text-zinc-500">{fmt(p.completada_at)}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cronología */}
            <div>
              <p className="text-zinc-500 font-black mb-2">CRONOLOGÍA</p>
              <div className="space-y-1 text-zinc-300">
                {viaje.created_at      && <p>📋 Publicado: {fmt(viaje.created_at)}</p>}
                {viaje.hora_aceptacion && <p>✅ Aceptado: <span className="text-green-400">{fmt(viaje.hora_aceptacion)}</span></p>}
                {viaje.hora_inicio     && <p>🚛 En camino: <span className="text-yellow-400">{fmt(viaje.hora_inicio)}</span></p>}
                {paradas.filter(p => p.completada_at).map((p, i) => (
                  <p key={p.id}>{LABELS[i]} completada: <span className="text-green-400">{fmt(p.completada_at)}</span></p>
                ))}
                {viaje.hora_finalizacion && <p>🏆 Finalizado: <span className="text-green-400">{fmt(viaje.hora_finalizacion)}</span></p>}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ─── MODAL SELECTOR NAVEGADOR ────────────────────────────────────── */}
      {mostrarNavSel && destNavPendiente && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-end p-4">
          <div className="w-full bg-zinc-900 border border-zinc-700 rounded-3xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-yellow-400 font-black">🧭 Elegí tu navegador</p>
              <button type="button" onClick={() => { setMostrarNavSel(false); setDestNavPendiente(null); }} className="text-zinc-400 font-black px-2">✕</button>
            </div>
            {/* Aviso legal */}
            <div className="bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-400 border border-yellow-700/40">
              ⚠️ {AVISO_LEGAL}
            </div>
            <p className="text-zinc-300 text-xs px-1">📍 <span className="text-white font-black">{destNavPendiente}</span></p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => abrirNavegador("google_maps", destNavPendiente)}
                className="flex items-center justify-center gap-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-2xl px-4 py-4 font-black text-sm text-white transition">
                🗺️ Google Maps
              </button>
              <button type="button" onClick={() => abrirNavegador("waze", destNavPendiente)}
                className="flex items-center justify-center gap-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-2xl px-4 py-4 font-black text-sm text-white transition">
                📡 Waze
              </button>
            </div>
            <p className="text-zinc-600 text-xs text-center">TILA mantiene el tracking interno independientemente del navegador elegido.</p>
          </div>
        </div>
      )}

      {/* ─── MODAL EVIDENCIA DE CARGA ────────────────────────────────────── */}
      {modalCarga && (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-end justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-yellow-400 font-black text-base">📦 Evidencia de carga</p>
              <button type="button" onClick={() => setModalCarga(false)} className="text-zinc-500 font-black text-lg px-2">✕</button>
            </div>

            <div>
              <label className="text-zinc-400 text-xs font-black mb-1 block">¿Quién entregó la carga?</label>
              <input type="text" value={cargaEntrego} onChange={e => setCargaEntrego(e.target.value)}
                placeholder="Nombre (opcional)"
                className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-yellow-400" />
            </div>

            <div>
              <label className="text-zinc-400 text-xs font-black mb-1 block">Tipo de carga</label>
              <input type="text" value={cargaTipoCarga} onChange={e => setCargaTipoCarga(e.target.value)}
                placeholder="Ej: pallets, electrodomésticos... (opcional)"
                className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-yellow-400" />
            </div>

            <div>
              <label className="text-zinc-400 text-xs font-black mb-1 block">Observación</label>
              <textarea value={cargaObsv} onChange={e => setCargaObsv(e.target.value)}
                placeholder="Sin novedad, carga incompleta... (opcional)"
                rows={2}
                className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-yellow-400 resize-none" />
            </div>

            <div>
              <label className="text-zinc-400 text-xs font-black mb-1 block">📷 Foto de carga (opcional)</label>
              <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition ${
                cargaFoto ? "border-green-600 bg-green-950/30" : "border-zinc-700 bg-zinc-800 hover:border-zinc-500"
              }`}>
                <span className="text-sm font-black text-zinc-300">
                  {cargaFoto ? `✅ ${cargaFoto.name}` : "📁 Seleccionar foto"}
                </span>
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={e => setCargaFoto(e.target.files?.[0] ?? null)} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button type="button" disabled={cargaSubiendo}
                onClick={() => {
                  setModalCarga(false);
                  registrarEvidencia(supabase, viaje.id, "carga_retirada", {
                    usuarioId: usuarioRef.current?.id, estadoViaje: "Carga retirada",
                    lat: viaje.lat ?? null, lng: viaje.lng ?? null, tipoOperacion: "carga",
                  });
                  actualizarEstado("Carga retirada", true);
                }}
                className="py-3 rounded-2xl font-black text-sm bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition">
                Omitir
              </button>
              <button type="button" onClick={confirmarCarga} disabled={cargaSubiendo}
                className="py-3 rounded-2xl font-black text-sm bg-yellow-400 text-black hover:bg-yellow-300 transition disabled:opacity-50">
                {cargaSubiendo ? "Guardando..." : "Confirmar carga"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL EVIDENCIA DE DESCARGA ─────────────────────────────────── */}
      {modalEntrega && (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-end justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-yellow-400 font-black text-base">📦 Evidencia de descarga</p>
              <button type="button" onClick={() => setModalEntrega(false)} className="text-zinc-500 font-black text-lg px-2">✕</button>
            </div>

            <div>
              <label className="text-zinc-400 text-xs font-black mb-1 block">¿Quién recibió la carga?</label>
              <input type="text" value={entregaReceptor} onChange={e => setEntregaReceptor(e.target.value)}
                placeholder="Nombre del receptor (opcional)"
                className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-yellow-400" />
            </div>

            <div>
              <label className="text-zinc-400 text-xs font-black mb-1 block">Tipo de carga</label>
              <input type="text" value={entregaTipoCarga} onChange={e => setEntregaTipoCarga(e.target.value)}
                placeholder="Ej: pallets, electrodomésticos... (opcional)"
                className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-yellow-400" />
            </div>

            <div>
              <label className="text-zinc-400 text-xs font-black mb-1 block">Observación</label>
              <textarea value={entregaObservacion} onChange={e => setEntregaObservacion(e.target.value)}
                placeholder="Ej: entregado en portería, sin novedad... (opcional)"
                rows={2}
                className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-yellow-400 resize-none" />
            </div>

            <div>
              <label className="text-zinc-400 text-xs font-black mb-1 block">📷 Foto de descarga (opcional)</label>
              <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition ${
                entregaFoto ? "border-green-600 bg-green-950/30" : "border-zinc-700 bg-zinc-800 hover:border-zinc-500"
              }`}>
                <span className="text-sm font-black text-zinc-300">
                  {entregaFoto ? `✅ ${entregaFoto.name}` : "📁 Seleccionar foto"}
                </span>
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={e => setEntregaFoto(e.target.files?.[0] ?? null)} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button type="button" disabled={entregaSubiendo}
                onClick={() => {
                  setModalEntrega(false);
                  registrarEvidencia(supabase, viaje.id, "descarga_completada", {
                    usuarioId: usuarioRef.current?.id, estadoViaje: "Descarga completada",
                    lat: viaje.lat ?? null, lng: viaje.lng ?? null, tipoOperacion: "descarga",
                  });
                  actualizarEstado("Descarga completada", true);
                }}
                className="py-3 rounded-2xl font-black text-sm bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition">
                Omitir
              </button>
              <button type="button" onClick={confirmarEntrega} disabled={entregaSubiendo}
                className="py-3 rounded-2xl font-black text-sm bg-yellow-400 text-black hover:bg-yellow-300 transition disabled:opacity-50">
                {entregaSubiendo ? "Guardando..." : "Confirmar descarga"}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}