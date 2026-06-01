"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import BotonCerrarSesion from "../components/BotonCerrarSesion";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import ChatAsistencia from "../components/ChatAsistencia";

const ESTADOS_VIAJE = [
  "Chofer asignado", "En camino", "Carga retirada",
  "En ruta", "Descarga completada", "Viaje finalizado",
];
const ESTADOS_ACTIVOS = [
  "Chofer asignado", "En camino", "Carga retirada", "En ruta", "Descarga completada",
];
const LABELS = ["A", "B", "C", "D", "E", "F"];

const colorEstado = (estado: string) => {
  switch (estado) {
    case "Chofer asignado": return "bg-green-700 text-white";
    case "En camino": return "bg-yellow-400 text-black";
    case "Carga retirada": return "bg-blue-600 text-white";
    case "En ruta": return "bg-zinc-600 text-white";
    case "Descarga completada": return "bg-red-600 text-white";
    case "Viaje finalizado": return "bg-green-500 text-white";
    default: return "bg-zinc-800 text-white";
  }
};

const colorAprobacion = (estado: string) => {
  switch (estado) {
    case "aprobado": return "bg-green-600 text-white";
    case "activo": return "bg-green-600 text-white";
    case "rechazado": return "bg-red-700 text-white";
    case "suspendido": return "bg-orange-600 text-white";
    default: return "bg-yellow-400 text-black";
  }
};

const getTipoParadaLabel = (tipo: string) => {
  if (tipo === "retiro") return "📦 Carga / Retiro";
  if (tipo === "entrega") return "🏁 Descarga / Entrega final";
  return "📍 Parada intermedia";
};

const getEstadoParadaLabel = (estado: string) => {
  if (estado === "completada") return "✅ Completada";
  if (estado === "en_curso") return "🔵 En curso";
  return "⬜ Pendiente";
};

const generarPasswordTemporal = () => {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `TILA-${num}`;
};

const tiempoRelativo = (iso: string | null | undefined) => {
  if (!iso) return null;
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 30) return { texto: "🟢 Online", color: "text-green-400" };
  if (diff < 120) return { texto: "🟡 Conectado", color: "text-yellow-400" };
  return { texto: "🔴 Posible pérdida de señal", color: "text-red-400" };
};

const colorBateria = (nivel: number | null) => {
  if (nivel === null) return "text-zinc-500";
  if (nivel < 20) return "text-red-400";
  if (nivel < 50) return "text-yellow-400";
  return "text-green-400";
};

const emojiBateria = (nivel: number | null) => {
  if (nivel === null) return "🔋";
  if (nivel < 20) return "🔴";
  if (nivel < 50) return "🟡";
  return "🟢";
};

// ─── Tarjeta usuario unificada ────────────────────────────────────────────────

const TarjetaUsuario = ({
  usuario,
  esUnicoAdmin,
  usuarioActualId,
  onActualizar,
  onResetPassword,
  onEliminar,
  onRestaurar,
}: {
  usuario: any;
  esUnicoAdmin: boolean;
  usuarioActualId: string;
  onActualizar: (id: string, campo: string, valor: string) => void;
  onResetPassword: (id: string, nombre: string) => void;
  onEliminar: (id: string, nombre: string, esAdmin: boolean) => void;
  onRestaurar: (id: string) => void;
}) => {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(usuario.nombre || "");
  const [email, setEmail] = useState(usuario.email || "");
  const [telefono, setTelefono] = useState(usuario.telefono || "");
  const [dni, setDni] = useState(usuario.dni || "");

  const guardarEdicion = async () => {
    const { error } = await supabase
      .from("usuarios")
      .update({ nombre, email, telefono, dni })
      .eq("id", usuario.id);
    if (error) { alert("Error al guardar: " + error.message); return; }
    setEditando(false);
  };

  const estaEliminado = usuario.eliminado === true;
  const esSelf = usuario.id === usuarioActualId;

  return (
    <div className={`border rounded-2xl p-5 ${estaEliminado ? "border-red-900 bg-red-950/20 opacity-60" : "border-zinc-800 bg-black"}`}>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-1 rounded-lg text-xs font-black ${
            usuario.rol === "admin" ? "bg-purple-600 text-white" :
            usuario.rol === "chofer" ? "bg-blue-600 text-white" :
            "bg-zinc-600 text-white"
          }`}>{usuario.rol?.toUpperCase()}</span>
          <span className={`px-2 py-1 rounded-lg text-xs font-black ${colorAprobacion(usuario.estado_aprobacion || "pendiente")}`}>
            {(usuario.estado_aprobacion || "pendiente").toUpperCase()}
          </span>
          {estaEliminado && <span className="px-2 py-1 rounded-lg text-xs font-black bg-red-700 text-white">ELIMINADO</span>}
        </div>
        <button onClick={() => setEditando(!editando)} className="text-xs text-zinc-400 hover:text-yellow-400 font-black">
          {editando ? "✕ Cancelar" : "✏️ Editar"}
        </button>
      </div>

      {editando ? (
        <div className="space-y-2 mb-4">
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre" className="w-full bg-zinc-900 border border-zinc-700 text-white p-2 rounded-xl text-sm" />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="w-full bg-zinc-900 border border-zinc-700 text-white p-2 rounded-xl text-sm" />
          <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="Teléfono" className="w-full bg-zinc-900 border border-zinc-700 text-white p-2 rounded-xl text-sm" />
          <input value={dni} onChange={e => setDni(e.target.value)} placeholder="DNI" className="w-full bg-zinc-900 border border-zinc-700 text-white p-2 rounded-xl text-sm" />
          <button onClick={guardarEdicion} className="w-full bg-yellow-400 text-black font-black py-2 rounded-xl text-sm">💾 Guardar cambios</button>
        </div>
      ) : (
        <div className="space-y-1 text-sm mb-4">
          <p className="text-yellow-400 font-black text-base">{usuario.nombre || "Sin nombre"}</p>
          <p>📧 {usuario.email || "Sin email"}</p>
          {usuario.vehiculo && <p>🚛 {usuario.vehiculo}</p>}
          {usuario.telefono && <p>📞 {usuario.telefono}</p>}
          {usuario.dni && <p>🪪 DNI: {usuario.dni}</p>}
          <p className="text-zinc-500 text-xs">ID: {usuario.id?.slice(0, 8)}</p>
        </div>
      )}

      {!estaEliminado && (
        <div className="grid grid-cols-2 gap-2">
          {/* Acciones por rol */}
          {usuario.rol === "chofer" && <>
            <button onClick={() => onActualizar(usuario.id, "estado_aprobacion", "aprobado")} className="bg-green-700 text-white font-black py-2 rounded-xl text-xs">✅ Aprobar</button>
            <button onClick={() => onActualizar(usuario.id, "estado_aprobacion", "rechazado")} className="bg-red-700 text-white font-black py-2 rounded-xl text-xs">❌ Rechazar</button>
            <button onClick={() => onActualizar(usuario.id, "estado_aprobacion", "suspendido")} className="bg-orange-600 text-white font-black py-2 rounded-xl text-xs">⛔ Suspender</button>
            <button onClick={() => onActualizar(usuario.id, "estado_aprobacion", "pendiente")} className="bg-zinc-600 text-white font-black py-2 rounded-xl text-xs">🔄 Reactivar</button>
          </>}

          {usuario.rol === "cliente" && <>
            <button onClick={() => onActualizar(usuario.id, "estado_aprobacion", "activo")} className="bg-green-700 text-white font-black py-2 rounded-xl text-xs">✅ Activar</button>
            <button onClick={() => onActualizar(usuario.id, "estado_aprobacion", "suspendido")} className="bg-orange-600 text-white font-black py-2 rounded-xl text-xs">⛔ Suspender</button>
          </>}

          {/* Reset password — todos */}
          <button onClick={() => onResetPassword(usuario.id, usuario.nombre || "usuario")} className="bg-blue-700 text-white font-black py-2 rounded-xl text-xs col-span-2">🔑 Resetear contraseña</button>

          {/* Eliminar — no admin único, no self */}
          {!(usuario.rol === "admin" && esUnicoAdmin) && !esSelf && (
            <button onClick={() => onEliminar(usuario.id, usuario.nombre || "usuario", usuario.rol === "admin")} className="bg-red-900 text-white font-black py-2 rounded-xl text-xs col-span-2">🗑️ Marcar como eliminado</button>
          )}
        </div>
      )}

      {estaEliminado && (
        <button onClick={() => onRestaurar(usuario.id)} className="w-full bg-zinc-700 text-white font-black py-2 rounded-xl text-xs">♻️ Restaurar usuario</button>
      )}
    </div>
  );
};

// ─── TarjetaChofer para sección aprobación ───────────────────────────────────

const TarjetaChofer = ({ chofer, onActualizarAprobacion }: { chofer: any; onActualizarAprobacion: (id: string, estado: string) => void }) => (
  <div className="bg-black border border-zinc-800 rounded-2xl p-5">
    <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h3 className="text-xl font-black text-yellow-400">{chofer.nombre || "Chofer"}</h3>
      <div className="flex gap-2 flex-wrap">
        <span className={`px-3 py-1 rounded-xl text-sm font-black ${chofer.online ? "bg-green-500 text-black" : "bg-red-600 text-white"}`}>
          {chofer.online ? "ONLINE" : "OFFLINE"}
        </span>
        <span className={`px-3 py-1 rounded-xl text-sm font-black ${colorAprobacion(chofer.estado_aprobacion || "pendiente")}`}>
          {(chofer.estado_aprobacion || "pendiente").toUpperCase()}
        </span>
      </div>
    </div>
    <div className="space-y-1 text-sm mb-4">
      <p>🚛 <strong>Vehículo:</strong> {chofer.vehiculo || "Sin dato"}</p>
      <p>📞 <strong>Teléfono:</strong> {chofer.telefono || "Sin dato"}</p>
      <p>📧 <strong>Email:</strong> {chofer.email || "Sin dato"}</p>
      <p>🪪 <strong>DNI:</strong> {chofer.dni || "Sin dato"}</p>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <button onClick={() => onActualizarAprobacion(chofer.id, "aprobado")} className="bg-green-600 text-white font-black py-2 rounded-xl text-sm">✅ Aprobar</button>
      <button onClick={() => onActualizarAprobacion(chofer.id, "rechazado")} className="bg-red-700 text-white font-black py-2 rounded-xl text-sm">❌ Rechazar</button>
      <button onClick={() => onActualizarAprobacion(chofer.id, "suspendido")} className="bg-orange-600 text-white font-black py-2 rounded-xl text-sm">⛔ Suspender</button>
      <button onClick={() => onActualizarAprobacion(chofer.id, "pendiente")} className="bg-yellow-400 text-black font-black py-2 rounded-xl text-sm">🔄 Reactivar</button>
    </div>
  </div>
);

const TarjetaCliente = ({ cliente }: { cliente: any }) => (
  <div className="bg-black border border-zinc-800 rounded-2xl p-5">
    <h3 className="text-xl font-black text-purple-400 mb-3">{cliente.nombre || "Cliente"}</h3>
    <div className="space-y-1 text-sm">
      <p>📧 {cliente.email || "Sin dato"}</p>
      <p>📞 {cliente.telefono || "Sin dato"}</p>
      <p>🪪 DNI: {cliente.dni || "Sin dato"}</p>
      <p>📅 {cliente.created_at?.slice(0, 10) || "Sin dato"}</p>
    </div>
  </div>
);

const TarjetaViaje = ({ carga, paradas, choferInfo, onAbrirCliente, onAbrirChofer, onAsignarChofer, onEliminarViaje, onActualizarEstado }: {
  carga: any; paradas: any[]; choferInfo?: any;
  onAbrirCliente: (id: string) => void; onAbrirChofer: (id: string) => void;
  onAsignarChofer: (id: string) => void; onEliminarViaje: (id: string) => void;
  onActualizarEstado: (id: string, estado: string) => void;
}) => {
  const senal = tiempoRelativo(choferInfo?.ultima_senal_at);
  return (
  <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 shadow-xl">
    <div className="flex flex-col gap-3 mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-2xl font-black text-yellow-400">{carga.origen} → {carga.destino}</h3>
        <span className={`px-3 py-2 rounded-2xl font-black text-sm ${colorEstado(carga.estado)}`}>{carga.estado || "Pendiente"}</span>
      </div>
      <p className="text-zinc-500 text-sm">ID: {String(carga.id).slice(0, 8)} · {carga.created_at?.slice(0, 10)}</p>
    </div>

    {/* Estado operativo del chofer */}
    {carga.chofer_id && (
      <div className="bg-zinc-800 rounded-2xl p-4 mb-4">
        <p className="text-zinc-400 text-xs font-black mb-3">📡 ESTADO OPERATIVO</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-zinc-500 text-xs">Velocidad</p>
            <p className="text-yellow-400 font-black">
              {carga.velocidad_kmh != null ? `${carga.velocidad_kmh} km/h` : "Sin datos"}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Señal</p>
            <p className={`font-black text-xs ${senal?.color || "text-zinc-500"}`}>
              {senal?.texto || "Sin datos"}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Batería</p>
            <p className={`font-black ${colorBateria(choferInfo?.bateria_nivel ?? null)}`}>
              {choferInfo?.bateria_nivel != null
                ? `${emojiBateria(choferInfo.bateria_nivel)} ${choferInfo.bateria_nivel}%`
                : "No disponible"}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Cargando</p>
            <p className={`font-black text-sm ${choferInfo?.bateria_cargando ? "text-green-400" : "text-zinc-400"}`}>
              {choferInfo?.bateria_nivel != null
                ? choferInfo.bateria_cargando ? "⚡ Sí" : "No"
                : "—"}
            </p>
          </div>
        </div>
      </div>
    )}

    {paradas.length > 0 && (
      <div className="bg-zinc-800 rounded-2xl p-4 mb-4">
        <p className="text-zinc-400 text-xs font-black mb-2">RUTA DEL VIAJE</p>
        <div className="space-y-2">
          {paradas.map((parada, index) => (
            <div key={parada.id} className="flex items-center gap-2">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${
                parada.estado === "completada" ? "bg-green-500 text-white" :
                parada.estado === "en_curso" ? "bg-yellow-400 text-black" : "bg-zinc-600 text-zinc-300"
              }`}>{LABELS[index] || index}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-400 font-black">{getTipoParadaLabel(parada.tipo)}</p>
                <p className="text-sm text-white truncate">{parada.direccion}</p>
              </div>
              <span className="text-xs text-zinc-500 flex-shrink-0">{getEstadoParadaLabel(parada.estado)}</span>
            </div>
          ))}
        </div>
      </div>
    )}

    <div className="grid grid-cols-1 gap-2 text-sm mb-5">
      <p>🚛 <strong>Vehículo:</strong> {carga.vehiculo || "Sin dato"}</p>
      <p>📍 <strong>Distancia:</strong> {carga.km_estimados ? `${carga.km_estimados} km` : "Sin calcular"}</p>
      <p>💰 <strong>Cliente paga:</strong> ${Number(carga.precio_cliente || 0).toLocaleString()}</p>
      <p>🚛 <strong>Chofer cobra:</strong> ${Number(carga.pago_chofer || 0).toLocaleString()}</p>
      <p className="text-green-400 font-black">🏦 <strong>Comisión:</strong> ${Number(carga.comision_plataforma || 0).toLocaleString()}</p>
      <p>📡 <strong>Tracking:</strong> {carga.tracking ? "Activo" : "Inactivo"}</p>
      {carga.lat && carga.lng && (
        <a href={`https://www.google.com/maps?q=${carga.lat},${carga.lng}`} target="_blank" rel="noreferrer"
          className="bg-green-700 text-white font-black py-3 rounded-2xl text-center block mt-2">Abrir GPS en mapa</a>
      )}
    </div>

    <div className="grid grid-cols-2 gap-2">
      <button onClick={() => onAbrirCliente(carga.id)} className="bg-yellow-400 text-black font-black py-3 rounded-2xl">Cliente</button>
      <button onClick={() => onAbrirChofer(carga.id)} className="bg-green-600 text-white font-black py-3 rounded-2xl">Chofer</button>
      <button onClick={() => onAsignarChofer(carga.id)} className="bg-blue-600 text-white font-black py-3 rounded-2xl">Asignar</button>
      <button onClick={() => onEliminarViaje(carga.id)} className="bg-red-900 text-white font-black py-3 rounded-2xl">Eliminar</button>
    </div>
    <div className="grid grid-cols-2 gap-2 mt-3">
      {ESTADOS_VIAJE.map((estado) => (
        <button key={estado} onClick={() => onActualizarEstado(carga.id, estado)}
          className={`font-black py-2 rounded-xl text-xs ${carga.estado === estado ? `${colorEstado(estado)} ring-2 ring-white` : "bg-zinc-800 text-zinc-400"}`}>
          {estado}
        </button>
      ))}
    </div>
  </div>
  );
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AdminPage() {
  const { autorizado } = useProtegerRuta("admin");

  const [cargas, setCargas] = useState<any[]>([]);
  const [paradasPorCarga, setParadasPorCarga] = useState<Record<string, any[]>>({});
  const [choferInfoPorCarga, setChoferInfoPorCarga] = useState<Record<string, any>>({});
  const [choferes, setChoferes] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [todosUsuarios, setTodosUsuarios] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroRol, setFiltroRol] = useState("todos");
  const [mostrarEliminados, setMostrarEliminados] = useState(false);
  const [chatViajeId, setChatViajeId] = useState<string | null>(null);
  const [mensajesResumen, setMensajesResumen] = useState<Record<string, number>>({});

  const usuarioActual = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("usuario") || "{}") : {};

  const cargarResumenMensajes = useCallback(async () => {
    const { data } = await supabase
      .from("mensajes_viaje")
      .select("viaje_id, leido, remitente_id")
      .eq("leido", false);
    if (data) {
      const resumen: Record<string, number> = {};
      data.forEach((m: any) => {
        const key = String(m.viaje_id);
        resumen[key] = (resumen[key] || 0) + 1;
      });
      setMensajesResumen(resumen);
    }
  }, []);

  const cargarViajes = useCallback(async () => {
    const { data, error } = await supabase.from("cargas").select("*").order("created_at", { ascending: false });
    if (error) { console.error("Error cargando viajes:", error); return; }
    const cargasData = data || [];
    setCargas(cargasData);

    if (cargasData.length > 0) {
      // Cargar paradas
      const ids = cargasData.map((c: any) => c.id);
      const { data: dataParadas } = await supabase.from("paradas_viaje").select("*").in("carga_id", ids).order("orden", { ascending: true });
      if (dataParadas) {
        const agrupadas: Record<string, any[]> = {};
        dataParadas.forEach((p: any) => {
          const key = String(p.carga_id);
          if (!agrupadas[key]) agrupadas[key] = [];
          agrupadas[key].push(p);
        });
        setParadasPorCarga(agrupadas);
      }

      // Cargar info de choferes para viajes activos
      const choferIds = [...new Set(cargasData
        .filter((c: any) => c.chofer_id)
        .map((c: any) => c.chofer_id)
      )];
      if (choferIds.length > 0) {
        const { data: dataChoferes } = await supabase
          .from("usuarios")
          .select("id, nombre, bateria_nivel, bateria_cargando, ultima_senal_at")
          .in("id", choferIds);
        if (dataChoferes) {
          const infoMap: Record<string, any> = {};
          // Mapear por carga_id
          cargasData.forEach((c: any) => {
            if (c.chofer_id) {
              const chofer = dataChoferes.find((ch: any) => ch.id === c.chofer_id);
              if (chofer) infoMap[String(c.id)] = chofer;
            }
          });
          setChoferInfoPorCarga(infoMap);
        }
      }
    }
  }, []);

  const cargarUsuarios = useCallback(async () => {
    const { data, error } = await supabase.from("usuarios").select("*").order("created_at", { ascending: false });
    if (error) { console.error("Error cargando usuarios:", error); return; }
    const todos = data || [];
    setTodosUsuarios(todos);
    setChoferes(todos.filter((u: any) => u.rol === "chofer" && !u.eliminado));
    setClientes(todos.filter((u: any) => u.rol === "cliente" && !u.eliminado));
  }, []);

  useEffect(() => {
    const iniciar = async () => {
      setCargando(true);
      try { await Promise.all([cargarViajes(), cargarUsuarios(), cargarResumenMensajes()]); }
      catch (e) { console.error(e); }
      finally { setCargando(false); }
    };
    iniciar();

    const channel = supabase.channel("admin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "cargas" }, () => cargarViajes())
      .on("postgres_changes", { event: "*", schema: "public", table: "usuarios" }, () => cargarUsuarios())
      .on("postgres_changes", { event: "*", schema: "public", table: "paradas_viaje" }, () => cargarViajes())
      .on("postgres_changes", { event: "*", schema: "public", table: "mensajes_viaje" }, () => cargarResumenMensajes())
      .subscribe();

    const intervalo = setInterval(() => { cargarViajes(); cargarUsuarios(); cargarResumenMensajes(); }, 5000);
    return () => { supabase.removeChannel(channel); clearInterval(intervalo); };
  }, [cargarViajes, cargarUsuarios, cargarResumenMensajes]);

  const pendientes = useMemo(() => cargas.filter((c) => !c.estado || c.estado.toLowerCase() === "pendiente"), [cargas]);
  const activos = useMemo(() => cargas.filter((c) => ESTADOS_ACTIVOS.includes(c.estado)), [cargas]);
  const finalizados = useMemo(() => cargas.filter((c) => c.estado === "Viaje finalizado"), [cargas]);
  const choferesOnline = useMemo(() => choferes.filter((c) => c.online === true), [choferes]);
  const gpsActivos = useMemo(() => cargas.filter((c) => c.lat && c.lng && ESTADOS_ACTIVOS.includes(c.estado)), [cargas]);
  const primerGpsActivo = gpsActivos[0];

  const adminCount = useMemo(() => todosUsuarios.filter((u) => u.rol === "admin" && !u.eliminado).length, [todosUsuarios]);

  const usuariosFiltrados = useMemo(() => {
    return todosUsuarios.filter((u) => {
      if (!mostrarEliminados && u.eliminado) return false;
      if (filtroRol !== "todos" && u.rol !== filtroRol) return false;
      if (busqueda) {
        const q = busqueda.toLowerCase();
        return (u.nombre || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.telefono || "").toLowerCase().includes(q) ||
          (u.dni || "").toLowerCase().includes(q) ||
          (u.rol || "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [todosUsuarios, busqueda, filtroRol, mostrarEliminados]);

  const actualizarCampoUsuario = async (id: string, campo: string, valor: string) => {
    const { error } = await supabase.from("usuarios").update({ [campo]: valor }).eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    await cargarUsuarios();
  };

  const resetearPassword = async (id: string, nombre: string) => {
    const nuevaPassword = generarPasswordTemporal();
    const ok = confirm(`¿Resetear contraseña de ${nombre}?\n\nLa nueva contraseña temporal será:\n${nuevaPassword}\n\nAnotala antes de confirmar.`);
    if (!ok) return;
    const { error } = await supabase.from("usuarios").update({ password: nuevaPassword }).eq("id", id);
    if (error) { alert("Error al resetear: " + error.message); return; }
    alert(`✅ Contraseña reseteada correctamente.\n\nNueva contraseña temporal:\n${nuevaPassword}\n\nCompartila con el usuario.`);
    await cargarUsuarios();
  };

  const marcarEliminado = async (id: string, nombre: string, esAdmin: boolean) => {
    if (esAdmin && adminCount <= 1) { alert("No podés eliminar al único administrador."); return; }
    const ok = confirm(`¿Marcar como eliminado a "${nombre}"?\n\nEl usuario no podrá ingresar al sistema. Esta acción se puede revertir desde Admin.`);
    if (!ok) return;
    const { error } = await supabase.from("usuarios").update({ eliminado: true }).eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    await cargarUsuarios();
  };

  const restaurarUsuario = async (id: string) => {
    const { error } = await supabase.from("usuarios").update({ eliminado: false }).eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    await cargarUsuarios();
  };

  const actualizarAprobacionChofer = async (id: string, estado: string) => {
    await actualizarCampoUsuario(id, "estado_aprobacion", estado);
  };

  const actualizarEstado = async (id: string, estado: string) => {
    const updateData: any = { estado };
    if (estado === "Viaje finalizado") updateData.tracking = false;
    const { error } = await supabase.from("cargas").update(updateData).eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    await cargarViajes();
  };

  const asignarChofer = async (id: string) => {
    const { error } = await supabase.from("cargas").update({ estado: "Chofer asignado", chofer_id: "chofer_demo", tracking: true }).eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    await cargarViajes();
  };

  const eliminarViaje = async (id: string) => {
    const ok = confirm("¿Eliminar este viaje?");
    if (!ok) return;
    const { error } = await supabase.from("cargas").delete().eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    await cargarViajes();
  };

  const abrirCliente = (id: string) => { localStorage.setItem("viajeActivoId", id); window.open("/panel-cliente", "_blank"); };
  const abrirChofer = (id: string) => { localStorage.setItem("viajeActivoId", id); window.open("/viaje-activo", "_blank"); };

  if (!autorizado) return null;

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <header className="mb-8">
        <h1 className="text-5xl font-black text-yellow-400">CENTRAL OPERATIVA</h1>
        <p className="text-zinc-400 mt-2">Despacho, monitoreo y control de viajes en tiempo real</p>
        <BotonCerrarSesion />
      </header>

      {cargando && <div className="bg-yellow-400 text-black font-black rounded-2xl p-4 mb-6">Cargando central operativa...</div>}

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-zinc-900 border border-yellow-400 rounded-3xl p-6"><p className="text-zinc-400">Pendientes</p><h2 className="text-6xl font-black text-yellow-400">{pendientes.length}</h2></div>
        <div className="bg-zinc-900 border border-green-400 rounded-3xl p-6"><p className="text-zinc-400">Activos</p><h2 className="text-6xl font-black text-green-400">{activos.length}</h2></div>
        <div className="bg-zinc-900 border border-red-400 rounded-3xl p-6"><p className="text-zinc-400">Finalizados</p><h2 className="text-6xl font-black text-red-400">{finalizados.length}</h2></div>
        <div className="bg-zinc-900 border border-blue-400 rounded-3xl p-6"><p className="text-zinc-400">Choferes online</p><h2 className="text-6xl font-black text-blue-400">{choferesOnline.length}</h2></div>
        <div className="bg-zinc-900 border border-purple-400 rounded-3xl p-6"><p className="text-zinc-400">Usuarios</p><h2 className="text-6xl font-black text-purple-400">{todosUsuarios.filter(u => !u.eliminado).length}</h2></div>
      </section>

      {/* Gestión de usuarios */}
      <section className="bg-zinc-900 border border-yellow-400 rounded-3xl p-6 mb-8">
        <h2 className="text-3xl font-black text-yellow-400 mb-2">Gestión de Usuarios</h2>
        <p className="text-zinc-500 text-sm mb-5">Administrá clientes, choferes y administradores.</p>

        {/* Filtros */}
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <input
            type="text"
            placeholder="Buscar por nombre, email, teléfono, DNI o rol..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="flex-1 bg-zinc-800 border border-zinc-700 text-white p-3 rounded-xl text-sm"
          />
          <select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)} className="bg-zinc-800 border border-zinc-700 text-white p-3 rounded-xl text-sm">
            <option value="todos">Todos los roles</option>
            <option value="cliente">Clientes</option>
            <option value="chofer">Choferes</option>
            <option value="admin">Admins</option>
          </select>
          <button onClick={() => setMostrarEliminados(!mostrarEliminados)}
            className={`px-4 py-3 rounded-xl font-black text-sm ${mostrarEliminados ? "bg-red-700 text-white" : "bg-zinc-700 text-zinc-400"}`}>
            {mostrarEliminados ? "👁️ Ocultando eliminados" : "👁️ Ver eliminados"}
          </button>
        </div>

        <p className="text-zinc-500 text-xs mb-4">{usuariosFiltrados.length} usuario{usuariosFiltrados.length !== 1 ? "s" : ""} encontrado{usuariosFiltrados.length !== 1 ? "s" : ""}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {usuariosFiltrados.length === 0 ? <p className="text-zinc-500">No hay usuarios que coincidan.</p> :
            usuariosFiltrados.map((usuario) => (
              <TarjetaUsuario
                key={usuario.id}
                usuario={usuario}
                esUnicoAdmin={adminCount <= 1}
                usuarioActualId={usuarioActual?.id || ""}
                onActualizar={actualizarCampoUsuario}
                onResetPassword={resetearPassword}
                onEliminar={marcarEliminado}
                onRestaurar={restaurarUsuario}
              />
            ))}
        </div>
      </section>

      {/* Gestión de choferes */}
      <section className="bg-zinc-900 border border-green-400 rounded-3xl p-6 mb-8">
        <h2 className="text-3xl font-black text-green-400 mb-2">Aprobación de Choferes</h2>
        <p className="text-zinc-500 text-sm mb-6">Control de acceso a la plataforma para choferes.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {choferes.length === 0 ? <p className="text-zinc-500">No hay choferes registrados.</p> :
            choferes.map((chofer) => <TarjetaChofer key={chofer.id} chofer={chofer} onActualizarAprobacion={actualizarAprobacionChofer} />)}
        </div>
      </section>

      {/* Clientes */}
      <section className="bg-zinc-900 border border-purple-400 rounded-3xl p-6 mb-8">
        <h2 className="text-3xl font-black text-purple-400 mb-6">Clientes registrados</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {clientes.length === 0 ? <p className="text-zinc-500">No hay clientes registrados.</p> :
            clientes.map((cliente) => <TarjetaCliente key={cliente.id} cliente={cliente} />)}
        </div>
      </section>

      {/* Mapa */}
      <section className="bg-zinc-900 border border-yellow-400 rounded-3xl p-6 mb-8">
        <h2 className="text-3xl font-black text-yellow-400 mb-4">Mapa Global Operativo</h2>
        <div className="rounded-3xl overflow-hidden border-2 border-yellow-400 mb-6">
          <iframe title="Mapa TILA"
            src={`https://www.google.com/maps?q=${encodeURIComponent(primerGpsActivo ? `${primerGpsActivo.lat},${primerGpsActivo.lng}` : "Argentina")}&output=embed`}
            width="100%" height="420" loading="lazy" />
        </div>
        <h3 className="text-2xl font-black text-green-400 mb-4">GPS activos</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {gpsActivos.length === 0 ? <p className="text-zinc-500">Sin GPS activos.</p> :
            gpsActivos.map((carga) => (
              <div key={carga.id} className="bg-black border border-zinc-800 rounded-2xl p-5">
                <h4 className="text-xl font-black text-yellow-400 mb-2">{carga.origen} → {carga.destino}</h4>
                <p className="text-sm">📦 {carga.estado}</p>
                <p className="text-sm">📍 {carga.lat}, {carga.lng}</p>
                <a href={`https://www.google.com/maps?q=${carga.lat},${carga.lng}`} target="_blank" rel="noreferrer"
                  className="block bg-green-700 text-white font-black text-center py-3 rounded-2xl mt-4">Abrir ubicación</a>
              </div>
            ))}
        </div>
      </section>

      {/* Central de Asistencia */}
      <section className="bg-zinc-900 border border-blue-400 rounded-3xl p-6 mb-8">
        <h2 className="text-3xl font-black text-blue-400 mb-2">💬 Central de Asistencia</h2>
        <p className="text-zinc-500 text-sm mb-6">Chats activos por viaje. Seleccioná un viaje para ver la conversación.</p>

        {activos.length === 0 ? (
          <p className="text-zinc-500">No hay viajes activos con chat disponible.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activos.map((carga) => {
              const noLeidos = mensajesResumen[String(carga.id)] || 0;
              const seleccionado = chatViajeId === String(carga.id);
              return (
                <div key={carga.id} className={`rounded-2xl border p-4 cursor-pointer transition ${seleccionado ? "border-blue-400 bg-blue-900/20" : "border-zinc-700 bg-black hover:border-zinc-500"}`}
                  onClick={() => setChatViajeId(seleccionado ? null : String(carga.id))}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-yellow-400 font-black text-sm truncate">{carga.origen} → {carga.destino}</p>
                    {noLeidos > 0 && (
                      <span className="bg-red-500 text-white text-xs font-black rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">
                        {noLeidos}
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-500 text-xs">{carga.estado}</p>
                  <p className="text-blue-400 text-xs mt-1">{seleccionado ? "▲ Cerrar chat" : "▼ Ver chat"}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Chat expandido */}
        {chatViajeId && usuarioActual?.id && (
          <div className="mt-6 border border-blue-400 rounded-2xl overflow-hidden">
            <ChatAsistencia
              viajeId={chatViajeId}
              usuarioId={usuarioActual.id}
              usuarioRol="admin"
              usuarioNombre={usuarioActual.nombre || "Admin"}
            />
          </div>
        )}
      </section>

      {/* Viajes */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div>
          <h2 className="text-3xl font-black text-yellow-400 mb-4">Pendientes</h2>
          <div className="grid gap-4">
            {pendientes.length === 0 ? <p className="text-zinc-500">Sin pendientes.</p> :
              pendientes.map((carga) => <TarjetaViaje key={carga.id} carga={carga} paradas={paradasPorCarga[String(carga.id)] || []} choferInfo={choferInfoPorCarga[String(carga.id)]} onAbrirCliente={abrirCliente} onAbrirChofer={abrirChofer} onAsignarChofer={asignarChofer} onEliminarViaje={eliminarViaje} onActualizarEstado={actualizarEstado} />)}
          </div>
        </div>
        <div>
          <h2 className="text-3xl font-black text-green-400 mb-4">Activos</h2>
          <div className="grid gap-4">
            {activos.length === 0 ? <p className="text-zinc-500">Sin activos.</p> :
              activos.map((carga) => <TarjetaViaje key={carga.id} carga={carga} paradas={paradasPorCarga[String(carga.id)] || []} choferInfo={choferInfoPorCarga[String(carga.id)]} onAbrirCliente={abrirCliente} onAbrirChofer={abrirChofer} onAsignarChofer={asignarChofer} onEliminarViaje={eliminarViaje} onActualizarEstado={actualizarEstado} />)}
          </div>
        </div>
        <div>
          <h2 className="text-3xl font-black text-red-400 mb-4">Finalizados</h2>
          <div className="grid gap-4">
            {finalizados.length === 0 ? <p className="text-zinc-500">Sin finalizados.</p> :
              finalizados.map((carga) => <TarjetaViaje key={carga.id} carga={carga} paradas={paradasPorCarga[String(carga.id)] || []} choferInfo={choferInfoPorCarga[String(carga.id)]} onAbrirCliente={abrirCliente} onAbrirChofer={abrirChofer} onAsignarChofer={asignarChofer} onEliminarViaje={eliminarViaje} onActualizarEstado={actualizarEstado} />)}
          </div>
        </div>
      </section>
    </main>
  );
}