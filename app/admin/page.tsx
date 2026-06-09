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

const CATEGORIAS_LEGALES = ["N1", "N2", "N3"];
const TIPOS_VEHICULO = ["Moto", "Utilitario", "Furgón", "Pick-up", "Camión rígido", "Camión tractor", "Bitrén"];
const TIPOS_CARROCERIA = ["Furgón", "Furgón térmico", "Plataforma", "Baranda volcable", "Cisterna", "Jaula", "Tolva", "Batea", "Portacontenedor", "Mosquito", "Grúa plancha"];

const TarjetaUsuario = ({
  usuario,
  esUnicoAdmin,
  usuarioActualId,
  onActualizar,
  onActualizarAprobacionChofer,
  onResetPassword,
  onEliminar,
  onRestaurar,
}: {
  usuario: any;
  esUnicoAdmin: boolean;
  usuarioActualId: string;
  onActualizar: (id: string, campo: string, valor: string) => void;
  onActualizarAprobacionChofer?: (id: string, estado: string) => void;
  onResetPassword: (id: string, nombre: string) => void;
  onEliminar: (id: string, nombre: string, esAdmin: boolean) => void;
  onRestaurar: (id: string) => void;
}) => {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(usuario.nombre || "");
  const [email, setEmail] = useState(usuario.email || "");
  const [telefono, setTelefono] = useState(usuario.telefono || "");
  const [dni, setDni] = useState(usuario.dni || "");
  const [categoriaLegal, setCategoriaLegal] = useState(usuario.categoria_legal || "");
  const [tipoVehiculo, setTipoVehiculo] = useState(usuario.tipo_vehiculo || "");
  const [tipoCarroceria, setTipoCarroceria] = useState(usuario.tipo_carroceria || "");

  const guardarEdicion = async () => {
    const updateData: any = { nombre, email, telefono, dni };
    if (usuario.rol === "chofer") {
      updateData.categoria_legal = categoriaLegal;
      updateData.tipo_vehiculo = tipoVehiculo;
      updateData.tipo_carroceria = tipoCarroceria;
      if (tipoVehiculo) updateData.vehiculo = tipoVehiculo;
    }
    const { error } = await supabase.from("usuarios").update(updateData).eq("id", usuario.id);
    if (error) { alert("Error al guardar: " + error.message); return; }
    setEditando(false);
  };

  const estaEliminado = usuario.eliminado === true;
  const esSelf = usuario.id === usuarioActualId;

  const cambiarEstadoChofer = (estado: string) => {
    if (onActualizarAprobacionChofer) onActualizarAprobacionChofer(usuario.id, estado);
    else onActualizar(usuario.id, "estado_aprobacion", estado);
  };

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
          {usuario.rol === "chofer" && (
            <>
              <p className="text-zinc-500 text-xs font-black pt-1">CLASIFICACIÓN VEHICULAR</p>
              <div className="flex gap-2">
                {CATEGORIAS_LEGALES.map(c => (
                  <button key={c} type="button" onClick={() => setCategoriaLegal(c)}
                    className={`flex-1 py-2 rounded-xl font-black text-sm ${categoriaLegal === c ? "bg-yellow-400 text-black" : "bg-zinc-800 text-zinc-400"}`}>{c}</button>
                ))}
              </div>
              <select value={tipoVehiculo} onChange={e => setTipoVehiculo(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 text-white p-2 rounded-xl text-sm">
                <option value="">Tipo de vehículo</option>
                {TIPOS_VEHICULO.map(t => <option key={t}>{t}</option>)}
              </select>
              <select value={tipoCarroceria} onChange={e => setTipoCarroceria(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 text-white p-2 rounded-xl text-sm">
                <option value="">Tipo de carrocería</option>
                {TIPOS_CARROCERIA.map(t => <option key={t}>{t}</option>)}
              </select>
            </>
          )}
          <button onClick={guardarEdicion} className="w-full bg-yellow-400 text-black font-black py-2 rounded-xl text-sm">💾 Guardar cambios</button>
        </div>
      ) : (
        <div className="space-y-1 text-sm mb-4">
          <p className="text-yellow-400 font-black text-base">{usuario.nombre || "Sin nombre"}</p>
          <p>📧 {usuario.email || "Sin email"}</p>
          {usuario.vehiculo && <p>🚛 {usuario.vehiculo}</p>}
          {usuario.telefono && <p>📞 {usuario.telefono}</p>}
          {usuario.dni && <p>🪪 DNI: {usuario.dni}</p>}
          {usuario.rol === "chofer" && (usuario.categoria_legal || usuario.tipo_vehiculo || usuario.tipo_carroceria) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {usuario.categoria_legal && <span className="bg-yellow-400 text-black px-2 py-0.5 rounded-lg text-xs font-black">{usuario.categoria_legal}</span>}
              {usuario.tipo_vehiculo && <span className="bg-blue-600 text-white px-2 py-0.5 rounded-lg text-xs font-black">{usuario.tipo_vehiculo}</span>}
              {usuario.tipo_carroceria && <span className="bg-zinc-600 text-white px-2 py-0.5 rounded-lg text-xs font-black">{usuario.tipo_carroceria}</span>}
            </div>
          )}
          <p className="text-zinc-500 text-xs">ID: {usuario.id?.slice(0, 8)}</p>
        </div>
      )}

      {!estaEliminado && (
        <div className="grid grid-cols-2 gap-2">
          {/* Acciones por rol */}
          {usuario.rol === "chofer" && <>
            <button onClick={() => cambiarEstadoChofer("aprobado")} className="bg-green-700 text-white font-black py-2 rounded-xl text-xs">✅ Aprobar</button>
            <button onClick={() => cambiarEstadoChofer("rechazado")} className="bg-red-700 text-white font-black py-2 rounded-xl text-xs">❌ Rechazar</button>
            <button onClick={() => cambiarEstadoChofer("suspendido")} className="bg-orange-600 text-white font-black py-2 rounded-xl text-xs">⛔ Suspender</button>
            <button onClick={() => cambiarEstadoChofer("pendiente")} className="bg-zinc-600 text-white font-black py-2 rounded-xl text-xs">🔄 Reactivar</button>
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

const TIPOS_DOC_LABELS: Record<string, string> = {
  // Documentos personales
  dni_frente:           "DNI Frente",
  dni_dorso:            "DNI Dorso",
  licencia:             "Licencia",
  antecedentes_penales: "Antecedentes",
  // Documentación del vehículo
  cedula_verde:         "Cédula verde",
  seguro:               "Seguro",
  vtv_rto:              "VTV/RTO",
  // Fotos del vehículo
  foto_frente:             "Frente",
  foto_lateral_izquierda:  "Lat. Izq",
  foto_lateral_derecha:    "Lat. Der",
  foto_trasera:            "Trasera",
};
const DOCS_PERSONALES_ADMIN  = ["dni_frente", "dni_dorso", "licencia", "antecedentes_penales"];
const DOCS_VEHICULO_ADMIN    = ["cedula_verde", "seguro", "vtv_rto"];
const FOTOS_VEHICULO_ADMIN   = ["foto_frente", "foto_lateral_izquierda", "foto_lateral_derecha", "foto_trasera"];
const DOCS_REQUERIDOS_ADMIN  = [...DOCS_PERSONALES_ADMIN, ...DOCS_VEHICULO_ADMIN, ...FOTOS_VEHICULO_ADMIN]; // 11 en total
const MENSAJE_APROBACION_MANUAL = "Documentación incompleta — aprobación manual bajo responsabilidad del administrador";

const TarjetaChofer = ({ chofer, onActualizarAprobacion }: { chofer: any; onActualizarAprobacion: (id: string, estado: string) => void }) => {
  const [documentos, setDocumentos] = useState<Record<string, string>>({});
  const [mostrarDocs, setMostrarDocs] = useState(false);
  const [cargandoDocs, setCargandoDocs] = useState(false);

  const cargarDocs = async () => {
    if (cargandoDocs) return;
    setCargandoDocs(true);
    const { data } = await supabase.from("documentacion_chofer").select("tipo, url").eq("chofer_id", chofer.id);
    if (data) {
      const mapa: Record<string, string> = {};
      data.forEach((d: any) => { mapa[d.tipo] = d.url; });
      setDocumentos(mapa);
    }
    setCargandoDocs(false);
    setMostrarDocs(true);
  };

  const docsCompletos = DOCS_REQUERIDOS_ADMIN.filter(t => documentos[t]).length;
  const totalDocs = DOCS_REQUERIDOS_ADMIN.length;
  const puedeAprobar = docsCompletos === totalDocs;

  return (
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
    <div className="space-y-1 text-sm mb-3">
      <p>🚛 <strong>Vehículo:</strong> {chofer.vehiculo || "Sin dato"}</p>
      <p>📞 <strong>Teléfono:</strong> {chofer.telefono || "Sin dato"}</p>
      <p>📧 <strong>Email:</strong> {chofer.email || "Sin dato"}</p>
      <p>🪪 <strong>DNI:</strong> {chofer.dni || "Sin dato"}</p>
    </div>

    {/* Clasificación */}
    {(chofer.categoria_legal || chofer.tipo_vehiculo || chofer.tipo_carroceria) && (
      <div className="bg-zinc-900 rounded-xl p-3 mb-3">
        <p className="text-zinc-500 text-xs font-black mb-2">CLASIFICACIÓN VEHICULAR</p>
        <div className="flex flex-wrap gap-2">
          {chofer.categoria_legal && <span className="bg-yellow-400 text-black px-2 py-0.5 rounded-lg text-xs font-black">{chofer.categoria_legal}</span>}
          {chofer.tipo_vehiculo && <span className="bg-blue-600 text-white px-2 py-0.5 rounded-lg text-xs font-black">{chofer.tipo_vehiculo}</span>}
          {chofer.tipo_carroceria && <span className="bg-zinc-600 text-white px-2 py-0.5 rounded-lg text-xs font-black">{chofer.tipo_carroceria}</span>}
        </div>
      </div>
    )}

    {/* Documentación */}
    <button onClick={cargarDocs} disabled={cargandoDocs}
      className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-black py-2 rounded-xl text-sm mb-3">
      {cargandoDocs ? "Cargando..." : mostrarDocs ? "🗂️ Actualizar docs" : "🗂️ Ver documentación"}
    </button>

    {mostrarDocs && (
      <div className="mb-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-zinc-500 text-xs font-black">DOCUMENTACIÓN</p>
          <span className={`text-xs font-black ${puedeAprobar ? "text-green-400" : "text-red-400"}`}>
            {docsCompletos}/{totalDocs} {puedeAprobar ? "✅ Completa" : "⚠️ Incompleta"}
          </span>
        </div>

        {/* Documentos personales */}
        <div>
          <p className="text-zinc-600 text-xs font-black mb-1">PERSONALES</p>
          <div className="grid grid-cols-4 gap-1">
            {DOCS_PERSONALES_ADMIN.map(tipo => (
              <DocMiniAdmin key={tipo} tipo={tipo} url={documentos[tipo]} label={TIPOS_DOC_LABELS[tipo]} />
            ))}
          </div>
          {/* Código antecedentes */}
          <div className={`mt-1 rounded-xl px-3 py-2 flex items-center gap-2 ${documentos["antecedentes_codigo"] ? "bg-zinc-900" : "bg-red-950 border border-red-800"}`}>
            <span className="text-zinc-500 text-xs font-black">CÓDIGO ANTECEDENTES:</span>
            <span className={`text-sm font-black ${documentos["antecedentes_codigo"] ? "text-white" : "text-red-400"}`}>
              {documentos["antecedentes_codigo"] || "⚠️ No cargado"}
            </span>
          </div>
        </div>

        {/* Documentación del vehículo */}
        <div>
          <p className="text-zinc-600 text-xs font-black mb-1">VEHÍCULO</p>
          <div className="grid grid-cols-3 gap-1">
            {DOCS_VEHICULO_ADMIN.map(tipo => (
              <DocMiniAdmin key={tipo} tipo={tipo} url={documentos[tipo]} label={TIPOS_DOC_LABELS[tipo]} />
            ))}
          </div>
        </div>

        {/* Fotos del vehículo */}
        <div>
          <p className="text-zinc-600 text-xs font-black mb-1">FOTOS</p>
          <div className="grid grid-cols-4 gap-1">
            {FOTOS_VEHICULO_ADMIN.map(tipo => (
              <DocMiniAdmin key={tipo} tipo={tipo} url={documentos[tipo]} label={TIPOS_DOC_LABELS[tipo]} />
            ))}
          </div>
        </div>

        {!puedeAprobar && (
          <p className="text-orange-400 text-xs font-black mt-2 border border-orange-500 rounded-lg p-2">
            ⚠️ Documentación incompleta — podés aprobar manualmente bajo tu responsabilidad
          </p>
        )}
      </div>
    )}

    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={() => onActualizarAprobacion(chofer.id, "aprobado")}
        className="bg-green-600 hover:bg-green-500 text-white font-black py-2 rounded-xl text-sm">
        ✅ Aprobar
      </button>
      <button onClick={() => onActualizarAprobacion(chofer.id, "rechazado")} className="bg-red-700 text-white font-black py-2 rounded-xl text-sm">❌ Rechazar</button>
      <button onClick={() => onActualizarAprobacion(chofer.id, "suspendido")} className="bg-orange-600 text-white font-black py-2 rounded-xl text-sm">⛔ Suspender</button>
      <button onClick={() => onActualizarAprobacion(chofer.id, "pendiente")} className="bg-yellow-400 text-black font-black py-2 rounded-xl text-sm">🔄 Reactivar</button>
    </div>
  </div>
  );
};

const DocMiniAdmin = ({ tipo, url, label }: { tipo: string; url?: string; label: string }) => (
  <div className={`rounded-xl overflow-hidden border ${url ? "border-green-600" : "border-zinc-700"}`}>
    {url ? (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={label} className="w-full h-14 object-cover" />
      </a>
    ) : (
      <div className="h-14 bg-zinc-900 flex items-center justify-center text-zinc-600 text-xs">—</div>
    )}
    <p className="text-xs text-center py-0.5 font-black text-zinc-400 truncate px-1">{label}</p>
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

const LABELS_EVENTO: Record<string, string> = {
  viaje_aceptado:       "✅ Viaje aceptado",
  chofer_en_camino:     "🚛 Chofer en camino",
  carga_retirada:       "📦 Carga retirada",
  en_ruta:              "🛣️ En ruta",
  descarga_completada:  "🏁 Descarga completada",
  viaje_finalizado:     "🏆 Viaje finalizado",
};

const TarjetaViaje = ({ carga, paradas, choferInfo, onAbrirCliente, onAbrirChofer, onAsignarChofer, onEliminarViaje, onActualizarEstado }: {
  carga: any; paradas: any[]; choferInfo?: any;
  onAbrirCliente: (id: string) => void; onAbrirChofer: (id: string) => void;
  onAsignarChofer: (id: string) => void; onEliminarViaje: (id: string) => void;
  onActualizarEstado: (id: string, estado: string) => void;
}) => {
  const [evidencias, setEvidencias]         = useState<any[]>([]);
  const [mostrarEvidencias, setMostrarEvidencias] = useState(false);
  const [cargandoEv, setCargandoEv]         = useState(false);

  const cargarEvidencias = async () => {
    if (cargandoEv) return;
    setCargandoEv(true);
    const { data } = await supabase
      .from("viaje_evidencias")
      .select("*")
      .eq("carga_id", carga.id)
      .order("created_at", { ascending: true });
    setEvidencias(data || []);
    setCargandoEv(false);
    setMostrarEvidencias(true);
  };

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

    {/* ── Evidencias del viaje ─────────────────────────────────────────── */}
    <div className="mt-3 pt-3 border-t border-zinc-800">
      <button
        onClick={cargarEvidencias}
        disabled={cargandoEv}
        className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-black py-2 rounded-xl text-sm mb-2"
      >
        {cargandoEv ? "Cargando..." : mostrarEvidencias ? "📋 Actualizar evidencias" : "📋 Ver evidencias del viaje"}
      </button>

      {mostrarEvidencias && (
        <div className="space-y-2">
          {evidencias.length === 0 ? (
            <p className="text-zinc-600 text-xs text-center py-2">Sin evidencias registradas</p>
          ) : evidencias.map(ev => (
            <div key={ev.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-black text-white">{LABELS_EVENTO[ev.evento] ?? ev.evento}</span>
                <span className="text-zinc-500 flex-shrink-0">
                  {ev.created_at ? new Date(ev.created_at).toLocaleString("es-AR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "—"}
                </span>
              </div>
              {ev.estado_viaje && <p><span className="text-zinc-500">Estado:</span> <span className="text-zinc-300"> {ev.estado_viaje}</span></p>}
              {ev.lat && ev.lng && (
                <p>
                  <span className="text-zinc-500">GPS: </span>
                  <a href={`https://www.google.com/maps?q=${ev.lat},${ev.lng}`} target="_blank" rel="noreferrer"
                    className="text-blue-400 underline">{Number(ev.lat).toFixed(5)}, {Number(ev.lng).toFixed(5)}</a>
                </p>
              )}
              {ev.nombre_receptor && <p><span className="text-zinc-500">Receptor:</span> <span className="text-white font-black"> {ev.nombre_receptor}</span></p>}
              {ev.observacion && <p><span className="text-zinc-500">Obs:</span> <span className="text-zinc-300"> {ev.observacion}</span></p>}
              {ev.foto_url && (
                <a href={ev.foto_url} target="_blank" rel="noreferrer">
                  <img src={ev.foto_url} alt="Evidencia" className="w-full max-h-40 object-cover rounded-lg mt-1 border border-zinc-700" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
  );
};

const ReportesAdmin = ({ cargas, todosUsuarios }: { cargas: any[]; todosUsuarios: any[] }) => {
  const [filtro, setFiltro] = useState("todos");
  const [billetera, setBilletera] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("billetera_chofer").select("*").then(({ data }) => {
      if (data) setBilletera(data);
    });
  }, []);

  const filtrarPorFecha = (items: any[], campo: string) => {
    if (filtro === "todos") return items;
    const ahora = new Date();
    const desde = new Date();
    if (filtro === "hoy") { desde.setHours(0, 0, 0, 0); }
    else if (filtro === "semana") { desde.setDate(ahora.getDate() - 7); }
    else if (filtro === "mes") { desde.setDate(1); desde.setHours(0, 0, 0, 0); }
    return items.filter(item => new Date(item[campo]) >= desde);
  };

  const cargasFiltradas = filtrarPorFecha(cargas, "created_at");
  const usuariosFiltrados = filtrarPorFecha(todosUsuarios, "created_at");
  const billeteraFiltrada = filtrarPorFecha(billetera, "created_at");

  const finalizados = cargasFiltradas.filter(c => c.estado === "Viaje finalizado");
  const pendientes = cargasFiltradas.filter(c => !c.estado || c.estado.toLowerCase() === "pendiente");
  const activos = cargasFiltradas.filter(c => ["Chofer asignado","En camino","Carga retirada","En ruta","Descarga completada"].includes(c.estado));
  const clientes = usuariosFiltrados.filter(u => u.rol === "cliente" && !u.eliminado);
  const choferes = usuariosFiltrados.filter(u => u.rol === "chofer" && !u.eliminado);
  const choferesOnline = todosUsuarios.filter(u => u.rol === "chofer" && u.online && !u.eliminado);

  const facturacionCliente = finalizados.reduce((acc, c) => acc + Number(c.precio_cliente || 0), 0);
  const totalChofer = finalizados.reduce((acc, c) => acc + Number(c.pago_chofer || 0), 0);
  const comisionPlataforma = finalizados.reduce((acc, c) => acc + Number(c.comision_plataforma || 0), 0);
  const totalBilletera = billeteraFiltrada.reduce((acc, b) => acc + Number(b.monto || 0), 0);

  const Metrica = ({ label, valor, color = "text-white", sub = "" }: { label: string; valor: string | number; color?: string; sub?: string }) => (
    <div className="bg-zinc-800 rounded-2xl p-4">
      <p className="text-zinc-500 text-xs font-black mb-1">{label}</p>
      <p className={`text-2xl font-black ${color}`}>{valor}</p>
      {sub && <p className="text-zinc-600 text-xs mt-1">{sub}</p>}
    </div>
  );

  return (
    <section className="bg-zinc-900 border border-yellow-400/50 rounded-3xl p-6 mb-8">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-3xl font-black text-yellow-400">📊 Reportes y métricas</h2>
          <p className="text-zinc-500 text-sm mt-1">Datos operativos y financieros de la plataforma.</p>
        </div>
        <div className="flex gap-2">
          {["hoy", "semana", "mes", "todos"].map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              className={`px-3 py-2 rounded-xl font-black text-xs transition ${filtro === f ? "bg-yellow-400 text-black" : "bg-zinc-800 text-zinc-400 hover:text-white"}`}>
              {f === "hoy" ? "Hoy" : f === "semana" ? "7 días" : f === "mes" ? "Este mes" : "Todo"}
            </button>
          ))}
        </div>
      </div>

      {/* Viajes */}
      <div className="mb-5">
        <p className="text-zinc-400 text-xs font-black mb-3">VIAJES</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metrica label="TOTAL VIAJES" valor={cargasFiltradas.length} color="text-yellow-400" />
          <Metrica label="FINALIZADOS" valor={finalizados.length} color="text-green-400" />
          <Metrica label="ACTIVOS" valor={activos.length} color="text-blue-400" />
          <Metrica label="PENDIENTES" valor={pendientes.length} color="text-zinc-300" />
        </div>
      </div>

      {/* Usuarios */}
      <div className="mb-5">
        <p className="text-zinc-400 text-xs font-black mb-3">USUARIOS</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Metrica label="CLIENTES" valor={clientes.length} color="text-purple-400" />
          <Metrica label="CHOFERES" valor={choferes.length} color="text-blue-400" />
          <Metrica label="CHOFERES ONLINE" valor={choferesOnline.length} color="text-green-400" sub="Ahora mismo" />
        </div>
      </div>

      {/* Financiero */}
      <div>
        <p className="text-zinc-400 text-xs font-black mb-3">FINANCIERO</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-zinc-800 rounded-2xl p-4 md:col-span-1">
            <p className="text-zinc-500 text-xs font-black mb-1">FACTURACIÓN TOTAL</p>
            <p className="text-3xl font-black text-green-400">${facturacionCliente.toLocaleString()}</p>
            <p className="text-zinc-600 text-xs mt-1">Lo que pagaron los clientes</p>
          </div>
          <div className="bg-zinc-800 rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-black mb-1">PAGADO A CHOFERES</p>
            <p className="text-3xl font-black text-yellow-400">${totalChofer.toLocaleString()}</p>
            <p className="text-zinc-600 text-xs mt-1">Acreditado en billeteras</p>
          </div>
          <div className="bg-zinc-800 rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-black mb-1">GANANCIA TILA</p>
            <p className="text-3xl font-black text-blue-400">${comisionPlataforma.toLocaleString()}</p>
            <p className="text-zinc-600 text-xs mt-1">Comisión plataforma</p>
          </div>
        </div>

        {/* Barra visual */}
        {facturacionCliente > 0 && (
          <div className="mt-4 bg-zinc-800 rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-black mb-3">DISTRIBUCIÓN DE INGRESOS</p>
            <div className="flex rounded-xl overflow-hidden h-6">
              <div className="bg-yellow-500 flex items-center justify-center text-xs font-black text-black"
                style={{ width: `${Math.round((totalChofer / facturacionCliente) * 100)}%` }}>
                {Math.round((totalChofer / facturacionCliente) * 100)}% Chofer
              </div>
              <div className="bg-blue-600 flex items-center justify-center text-xs font-black text-white"
                style={{ width: `${Math.round((comisionPlataforma / facturacionCliente) * 100)}%` }}>
                {Math.round((comisionPlataforma / facturacionCliente) * 100)}% TILA
              </div>
            </div>
          </div>
        )}

        {totalBilletera > 0 && totalBilletera !== totalChofer && (
          <div className="mt-3 bg-zinc-800 rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-black mb-1">TOTAL EN BILLETERAS (acumulado histórico)</p>
            <p className="text-2xl font-black text-green-400">${totalBilletera.toLocaleString()}</p>
          </div>
        )}
      </div>
    </section>
  );
};

const formatearFechaAdmin = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

const HistorialAdmin = ({ cargas, paradasPorCarga, todosUsuarios, onRecargar }: { cargas: any[]; paradasPorCarga: Record<string, any[]>; todosUsuarios: any[]; onRecargar: () => Promise<void> }) => {
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [evidenciasPorViaje, setEvidenciasPorViaje] = useState<Record<string, any[]>>({});
  const [cargandoEvPorViaje, setCargandoEvPorViaje] = useState<Record<string, boolean>>({});

  const cargarEvidenciasViaje = async (cargaId: number | string) => {
    const key = String(cargaId);
    if (cargandoEvPorViaje[key]) return;
    setCargandoEvPorViaje(prev => ({ ...prev, [key]: true }));
    const { data } = await supabase
      .from("viaje_evidencias")
      .select("*")
      .eq("carga_id", cargaId)
      .order("created_at", { ascending: true });
    setEvidenciasPorViaje(prev => ({ ...prev, [key]: data || [] }));
    setCargandoEvPorViaje(prev => ({ ...prev, [key]: false }));
  };

  const getNombre = (id: string) => todosUsuarios.find(u => u.id === id)?.nombre || "—";

  const cargasFiltradas = cargas.filter(c => {
    if (filtroEstado !== "todos") {
      const estadoCarga = (c.estado || "pendiente").toLowerCase();
      const filtroLower = filtroEstado.toLowerCase();
      if (estadoCarga !== filtroLower) return false;
    }
    if (filtroTexto) {
      const q = filtroTexto.toLowerCase();
      return (c.origen || "").toLowerCase().includes(q) ||
        (c.destino || "").toLowerCase().includes(q) ||
        getNombre(c.cliente_id).toLowerCase().includes(q) ||
        getNombre(c.chofer_id).toLowerCase().includes(q);
    }
    return true;
  });

  const totalComision = cargas
    .filter(c => c.estado === "Viaje finalizado")
    .reduce((acc, c) => acc + Number(c.comision_plataforma || 0), 0);

  return (
    <section className="bg-zinc-900 border border-zinc-700 rounded-3xl p-6 mb-8">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h2 className="text-3xl font-black text-zinc-300">📋 Historial general</h2>
        <span className="text-green-400 font-black text-sm">Comisión total: ${totalComision.toLocaleString()}</span>
      </div>
      <p className="text-zinc-500 text-sm mb-5">Todos los viajes de la plataforma.</p>

      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <input type="text" placeholder="Buscar por origen, destino, cliente o chofer..."
          value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)}
          className="flex-1 bg-zinc-800 border border-zinc-700 text-white p-3 rounded-xl text-sm" />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-white p-3 rounded-xl text-sm">
          <option value="todos">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="Chofer asignado">Chofer asignado</option>
          <option value="En camino">En camino</option>
          <option value="Carga retirada">Carga retirada</option>
          <option value="En ruta">En ruta</option>
          <option value="Descarga completada">Descarga completada</option>
          <option value="Viaje finalizado">Viaje finalizado</option>
        </select>
      </div>

      <p className="text-zinc-500 text-xs mb-4">{cargasFiltradas.length} viaje{cargasFiltradas.length !== 1 ? "s" : ""}</p>

      <div className="space-y-3">
        {cargasFiltradas.length === 0 ? (
          <p className="text-zinc-500 text-sm">Sin resultados.</p>
        ) : cargasFiltradas.map(carga => {
          const paradas = paradasPorCarga[String(carga.id)] || [];
          const abierto = expandido === String(carga.id);
          return (
            <div key={carga.id} className="bg-zinc-800 border border-zinc-700 rounded-2xl overflow-hidden">
              <button className="w-full p-4 text-left" onClick={() => setExpandido(abierto ? null : String(carga.id))}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-yellow-400 font-black text-sm truncate">{carga.origen} → {carga.destino}</p>
                    <p className="text-zinc-500 text-xs mt-0.5">{formatearFechaAdmin(carga.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    {carga.oculto_cliente && <span className="bg-orange-800 text-orange-200 text-xs font-black px-2 py-0.5 rounded-lg">👤 Oculto cliente</span>}
                    {carga.oculto_chofer && <span className="bg-blue-900 text-blue-200 text-xs font-black px-2 py-0.5 rounded-lg">🚛 Oculto chofer</span>}
                    <span className={`px-2 py-1 rounded-lg text-xs font-black ${colorEstado(carga.estado)}`}>{carga.estado || "Pendiente"}</span>
                    <span className="text-zinc-500 text-xs">{abierto ? "▲" : "▼"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-zinc-400">
                  <span>👤 {getNombre(carga.cliente_id)}</span>
                  {carga.chofer_id && <span>🚛 {getNombre(carga.chofer_id)}</span>}
                  {carga.km_estimados && <span>📏 {carga.km_estimados} km</span>}
                  {carga.precio_cliente && <span className="text-green-400">💰 ${Number(carga.precio_cliente).toLocaleString()}</span>}
                  {carga.comision_plataforma && <span className="text-blue-400">🏦 ${Number(carga.comision_plataforma).toLocaleString()}</span>}
                </div>
              </button>

              {abierto && (
                <div className="border-t border-zinc-700 p-4 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div className="bg-black rounded-xl p-3">
                      <p className="text-zinc-500 font-black">CLIENTE PAGA</p>
                      <p className="text-green-400 font-black text-base">${Number(carga.precio_cliente || 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-black rounded-xl p-3">
                      <p className="text-zinc-500 font-black">CHOFER COBRA</p>
                      <p className="text-yellow-400 font-black text-base">${Number(carga.pago_chofer || 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-black rounded-xl p-3">
                      <p className="text-zinc-500 font-black">COMISIÓN TILA</p>
                      <p className="text-blue-400 font-black text-base">${Number(carga.comision_plataforma || 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-black rounded-xl p-3">
                      <p className="text-zinc-500 font-black">DISTANCIA</p>
                      <p className="text-white font-black text-base">{carga.km_estimados ? `${carga.km_estimados} km` : "—"}</p>
                    </div>
                  </div>

                  {/* ── Estado de pago MP ───────────────────────────────── */}
                  <div className={`rounded-xl p-3 text-xs space-y-1 border ${
                    carga.pagado_cliente ? "bg-green-950 border-green-700" :
                    carga.pago_estado === "rechazado" ? "bg-red-950 border-red-700" :
                    "bg-zinc-900 border-zinc-700"
                  }`}>
                    <p className="font-black text-zinc-400 mb-2">💳 ESTADO DE PAGO</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-zinc-500">pago_estado</span>
                      <span className={`font-black ${
                        carga.pago_estado === "pagado" ? "text-green-400" :
                        carga.pago_estado === "rechazado" ? "text-red-400" :
                        carga.pago_estado === "pendiente_proceso" ? "text-yellow-400" :
                        "text-zinc-300"
                      }`}>{carga.pago_estado || "—"}</span>

                      <span className="text-zinc-500">pagado_cliente</span>
                      <span className={`font-black ${carga.pagado_cliente ? "text-green-400" : "text-orange-400"}`}>
                        {carga.pagado_cliente ? "✅ Sí" : "⏳ No"}
                      </span>

                      <span className="text-zinc-500">mp_status</span>
                      <span className="text-zinc-300 font-black">{carga.mp_status || "—"}</span>

                      <span className="text-zinc-500">mp_payment_id</span>
                      <span className="text-zinc-300 font-mono text-[10px] break-all">{carga.mp_payment_id || "—"}</span>
                    </div>
                  </div>

                  {paradas.length > 0 && (
                    <div>
                      <p className="text-zinc-500 text-xs font-black mb-2">RUTA</p>
                      <div className="space-y-1">
                        {paradas.map((p, i) => (
                          <div key={p.id} className="flex items-center gap-2 text-xs">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center font-black flex-shrink-0 ${
                              p.estado === "completada" ? "bg-green-500 text-white" : "bg-zinc-600 text-zinc-400"
                            }`}>{LABELS[i]}</span>
                            <p className="text-zinc-300 truncate">{p.direccion}</p>
                            {p.completada_at && <p className="text-zinc-500 flex-shrink-0">{formatearFechaAdmin(p.completada_at)}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="text-xs space-y-1">
                    <p className="text-zinc-500 font-black mb-1">CRONOLOGÍA</p>
                    {carga.created_at && <p>📋 <span className="text-zinc-400">Publicado:</span> {formatearFechaAdmin(carga.created_at)}</p>}
                    {carga.hora_aceptacion && <p>✅ <span className="text-zinc-400">Aceptado:</span> <span className="text-green-400">{formatearFechaAdmin(carga.hora_aceptacion)}</span></p>}
                    {carga.hora_inicio && <p>🚛 <span className="text-zinc-400">En camino:</span> <span className="text-yellow-400">{formatearFechaAdmin(carga.hora_inicio)}</span></p>}
                    {carga.hora_finalizacion && <p>🏆 <span className="text-zinc-400">Finalizado:</span> <span className="text-green-400">{formatearFechaAdmin(carga.hora_finalizacion)}</span></p>}
                  </div>

                  {/* ── Evidencias del viaje ──────────────────────────── */}
                  <div className="pt-3 border-t border-zinc-700">
                    <button
                      onClick={() => cargarEvidenciasViaje(carga.id)}
                      disabled={cargandoEvPorViaje[String(carga.id)]}
                      className="w-full bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-black py-2 rounded-xl text-sm mb-2 transition"
                    >
                      {cargandoEvPorViaje[String(carga.id)] ? "Cargando..." : "📋 Ver evidencias del viaje"}
                    </button>

                    {evidenciasPorViaje[String(carga.id)] !== undefined && (
                      <div className="space-y-2">
                        {evidenciasPorViaje[String(carga.id)].length === 0 ? (
                          <p className="text-zinc-600 text-xs text-center py-2">Sin evidencias registradas</p>
                        ) : evidenciasPorViaje[String(carga.id)].map((ev: any) => (
                          <div key={ev.id} className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-black text-white">{LABELS_EVENTO[ev.evento] ?? ev.evento}</span>
                              <span className="text-zinc-500">{ev.estado_viaje || ""}</span>
                            </div>
                            <p className="text-zinc-500">{formatearFechaAdmin(ev.created_at)}</p>
                            {ev.rol_usuario && <p className="text-zinc-400">Rol: {ev.rol_usuario}</p>}
                            {ev.lat && ev.lng && (
                              <a
                                href={`https://www.google.com/maps?q=${ev.lat},${ev.lng}`}
                                target="_blank" rel="noreferrer"
                                className="text-blue-400 underline"
                              >
                                📍 Ver ubicación
                              </a>
                            )}
                            {ev.nombre_receptor && <p className="text-zinc-300">Receptor: <span className="text-white font-black">{ev.nombre_receptor}</span></p>}
                            {ev.observacion && <p className="text-zinc-300">Obs: {ev.observacion}</p>}
                            {ev.foto_url && (
                              <a href={ev.foto_url} target="_blank" rel="noreferrer">
                                <img src={ev.foto_url} alt="evidencia" className="w-full max-w-xs rounded-xl mt-1 border border-zinc-700" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Acciones admin */}
                  <div className="pt-3 border-t border-zinc-700 grid grid-cols-2 gap-2">
                    <button
                      onClick={async () => {
                        const { error } = await supabase.from("cargas").update({
                          oculto_cliente: true, oculto_chofer: true, auto_oculto_at: new Date().toISOString()
                        }).eq("id", carga.id);
                        if (!error) await onRecargar();
                      }}
                      className="py-2 rounded-xl font-black text-xs border border-orange-700 text-orange-400 hover:bg-orange-900/20 transition"
                    >
                      👁️ Ocultar de cliente/chofer
                    </button>
                    <button
                      onClick={async () => {
                        const ok1 = window.confirm("⚠️ Esta acción eliminará definitivamente el viaje del sistema.\n¿Continuar?");
                        if (!ok1) return;
                        const pass = window.prompt("Ingresá tu contraseña de admin para confirmar:");
                        if (!pass) return;
                        const adminGuardado = localStorage.getItem("usuario");
                        if (!adminGuardado) { alert("Error: sesión no encontrada."); return; }
                        const adminObj = JSON.parse(adminGuardado);
                        const { data: adminData } = await supabase.from("usuarios").select("password").eq("id", adminObj.id).single();
                        if (!adminData || adminData.password !== pass) {
                          alert("❌ Contraseña incorrecta. Eliminación cancelada.");
                          return;
                        }
                        await supabase.from("mensajes_viaje").delete().eq("viaje_id", carga.id);
                        await supabase.from("paradas_viaje").delete().eq("carga_id", carga.id);
                        await supabase.from("billetera_chofer").delete().eq("viaje_id", String(carga.id));
                        const { error } = await supabase.from("cargas").delete().eq("id", carga.id);
                        if (error) { alert("Error al eliminar: " + error.message); return; }
                        await onRecargar();
                      }}
                      className="py-2 rounded-xl font-black text-xs border border-red-800 text-red-500 hover:bg-red-900/20 transition"
                    >
                      🗑️ Eliminar definitivo
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
      const choferIds = [...new Set(
        cargasData
          .filter((c: any) => c.chofer_id && String(c.chofer_id).length > 10)
          .map((c: any) => String(c.chofer_id).trim())
      )];

      if (choferIds.length > 0) {
        const { data: dataChoferes, error: errorChoferes } = await supabase
          .from("usuarios")
          .select("id, nombre, bateria_nivel, bateria_cargando, ultima_senal_at")
          .in("id", choferIds);

        if (errorChoferes) console.warn("Error cargando choferes:", errorChoferes);

        if (dataChoferes && dataChoferes.length > 0) {
          const infoMap: Record<string, any> = {};
          cargasData.forEach((c: any) => {
            if (c.chofer_id) {
              const chofer = dataChoferes.find(
                (ch: any) => String(ch.id).trim() === String(c.chofer_id).trim()
              );
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
    const estadosPermitidos = ["aprobado", "pendiente", "rechazado", "suspendido"];
    if (!estadosPermitidos.includes(estado)) {
      alert("Estado no permitido: " + estado);
      return;
    }
    if (estado === "aprobado") {
      const { data } = await supabase.from("documentacion_chofer").select("tipo").eq("chofer_id", id);
      const tipos = new Set((data || []).map((d: any) => d.tipo));
      const docsCompletos = DOCS_REQUERIDOS_ADMIN.every(t => tipos.has(t));
      if (!docsCompletos) alert(MENSAJE_APROBACION_MANUAL);
    }
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
                onActualizarAprobacionChofer={actualizarAprobacionChofer}
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

      {/* Reportes */}
      <ReportesAdmin cargas={cargas} todosUsuarios={todosUsuarios} />

      {/* Historial general */}
      <HistorialAdmin cargas={cargas} paradasPorCarga={paradasPorCarga} todosUsuarios={todosUsuarios} onRecargar={cargarViajes} />

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