"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const LABELS = ["A", "B", "C", "D", "E", "F"];

const formatearFecha = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

const colorEstado = (estado: string) => {
  if (estado === "Viaje finalizado") return "bg-green-700 text-white";
  if (estado === "pendiente") return "bg-yellow-400 text-black";
  return "bg-zinc-600 text-white";
};

const puedeOcultar = (viaje: any): boolean => {
  const estadosActivos = ["Chofer asignado", "En camino", "Carga retirada", "En ruta", "Descarga completada"];
  return !estadosActivos.includes(viaje.estado || "");
};

export default function HistorialChofer() {
  const [viajes, setViajes] = useState<any[]>([]);
  const [paradasPorViaje, setParadasPorViaje] = useState<Record<string, any[]>>({});
  const [clientesPorViaje, setClientesPorViaje] = useState<Record<string, any>>({});
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [ocultando, setOcultando] = useState<string | null>(null);

  useEffect(() => { cargarHistorial(); }, []);

  const cargarHistorial = async () => {
    const u = localStorage.getItem("usuario");
    if (!u) return;
    const usuario = JSON.parse(u);

    const { data, error } = await supabase
      .from("cargas")
      .select("*")
      .eq("chofer_id", usuario.id)
      .neq("oculto_chofer", true)
      .order("created_at", { ascending: false });

    if (error) { console.error(error); setCargando(false); return; }
    setViajes(data || []);

    if (data && data.length > 0) {
      const ids = data.map((c: any) => c.id);

      const { data: dataParadas } = await supabase
        .from("paradas_viaje").select("*").in("carga_id", ids).order("orden", { ascending: true });
      if (dataParadas) {
        const mapa: Record<string, any[]> = {};
        dataParadas.forEach((p: any) => {
          const k = String(p.carga_id);
          if (!mapa[k]) mapa[k] = [];
          mapa[k].push(p);
        });
        setParadasPorViaje(mapa);
      }

      const clienteIds = [...new Set(data.filter((c: any) => c.cliente_id).map((c: any) => String(c.cliente_id)))];
      if (clienteIds.length > 0) {
        const { data: dataClientes } = await supabase
          .from("usuarios").select("id, nombre, telefono").in("id", clienteIds);
        if (dataClientes) {
          const mapaClientes: Record<string, any> = {};
          data.forEach((c: any) => {
            if (c.cliente_id) {
              const cliente = dataClientes.find((cl: any) => cl.id === c.cliente_id);
              if (cliente) mapaClientes[String(c.id)] = cliente;
            }
          });
          setClientesPorViaje(mapaClientes);
        }
      }
    }
    setCargando(false);
  };

  const ocultarViaje = async (viajeId: string) => {
    const confirmado = window.confirm(
      "Esto solo elimina el viaje de tu historial.\nTILA conservará la trazabilidad administrativa."
    );
    if (!confirmado) return;

    setOcultando(viajeId);
    const { error } = await supabase
      .from("cargas")
      .update({ oculto_chofer: true, auto_oculto_at: new Date().toISOString() })
      .eq("id", viajeId);

    if (error) { alert("Error: " + error.message); }
    else { setViajes(prev => prev.filter(v => String(v.id) !== viajeId)); }
    setOcultando(null);
  };

  const finalizados = viajes.filter(v => v.estado === "Viaje finalizado");
  const totalGanado = finalizados.reduce((acc, v) => acc + Number(v.pago_chofer || 0), 0);
  const promedioPorViaje = finalizados.length > 0 ? Math.round(totalGanado / finalizados.length) : 0;

  if (cargando) return <div className="text-zinc-400 text-sm animate-pulse">Cargando historial...</div>;

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-800 rounded-2xl p-4 text-center">
          <p className="text-zinc-500 text-xs font-black">VIAJES TOTALES</p>
          <p className="text-3xl font-black text-yellow-400 mt-1">{viajes.length}</p>
        </div>
        <div className="bg-zinc-800 rounded-2xl p-4 text-center">
          <p className="text-zinc-500 text-xs font-black">TOTAL GANADO</p>
          <p className="text-xl font-black text-green-400 mt-1">${totalGanado.toLocaleString()}</p>
        </div>
        <div className="bg-zinc-800 rounded-2xl p-4 text-center">
          <p className="text-zinc-500 text-xs font-black">PROMEDIO</p>
          <p className="text-xl font-black text-blue-400 mt-1">${promedioPorViaje.toLocaleString()}</p>
        </div>
      </div>

      {viajes.length === 0 ? (
        <div className="bg-zinc-800 rounded-2xl p-8 text-center">
          <p className="text-zinc-500">No tenés viajes en tu historial.</p>
        </div>
      ) : (
        viajes.map((viaje) => {
          const paradas = paradasPorViaje[String(viaje.id)] || [];
          const cliente = clientesPorViaje[String(viaje.id)];
          const abierto = expandido === String(viaje.id);
          const puede = puedeOcultar(viaje);

          return (
            <div key={viaje.id} className="bg-zinc-800 border border-zinc-700 rounded-2xl overflow-hidden">
              <button className="w-full p-4 text-left" onClick={() => setExpandido(abierto ? null : String(viaje.id))}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-yellow-400 font-black text-sm truncate">{viaje.origen} → {viaje.destino}</p>
                    <p className="text-zinc-500 text-xs mt-1">{formatearFecha(viaje.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-2 py-1 rounded-lg text-xs font-black ${colorEstado(viaje.estado || "pendiente")}`}>
                      {viaje.estado || "Pendiente"}
                    </span>
                    <span className="text-zinc-500 text-xs">{abierto ? "▲" : "▼"}</span>
                  </div>
                </div>
                <div className="flex gap-4 mt-2 text-xs text-zinc-400">
                  {viaje.km_estimados && <span>📏 {viaje.km_estimados} km</span>}
                  {viaje.pago_chofer && <span className="text-green-400 font-black">💰 ${Number(viaje.pago_chofer).toLocaleString()}</span>}
                  {cliente && <span>👤 {cliente.nombre}</span>}
                </div>
              </button>

              {abierto && (
                <div className="border-t border-zinc-700 p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-black rounded-xl p-3">
                      <p className="text-zinc-500 text-xs font-black">GANANCIA</p>
                      <p className="text-green-400 font-black text-lg">${Number(viaje.pago_chofer || 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-black rounded-xl p-3">
                      <p className="text-zinc-500 text-xs font-black">DISTANCIA</p>
                      <p className="text-white font-black">{viaje.km_estimados ? `${viaje.km_estimados} km` : "—"}</p>
                    </div>
                    <div className="bg-black rounded-xl p-3">
                      <p className="text-zinc-500 text-xs font-black">TIPO DE CARGA</p>
                      <p className="text-white font-black text-xs">{viaje.tipo_carga || "—"}</p>
                    </div>
                    <div className="bg-black rounded-xl p-3">
                      <p className="text-zinc-500 text-xs font-black">PESO</p>
                      <p className="text-white font-black text-xs">{viaje.peso || "—"}</p>
                    </div>
                  </div>

                  {cliente && (
                    <div className="bg-black rounded-xl p-3">
                      <p className="text-zinc-500 text-xs font-black mb-1">CLIENTE</p>
                      <p className="text-white font-black">{cliente.nombre}</p>
                      {cliente.telefono && <p className="text-zinc-400 text-xs">{cliente.telefono}</p>}
                    </div>
                  )}

                  {paradas.length > 0 && (
                    <div>
                      <p className="text-zinc-500 text-xs font-black mb-2">RUTA</p>
                      <div className="space-y-2">
                        {paradas.map((p, i) => (
                          <div key={p.id} className="flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${
                              p.estado === "completada" ? "bg-green-500 text-white" : "bg-zinc-600 text-zinc-400"
                            }`}>{LABELS[i]}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-xs truncate">{p.direccion}</p>
                              {p.completada_at && <p className="text-zinc-500 text-xs">{formatearFecha(p.completada_at)}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-zinc-500 text-xs font-black mb-2">CRONOLOGÍA</p>
                    <div className="space-y-1 text-xs">
                      {viaje.created_at && <p>📋 <span className="text-zinc-400">Publicado:</span> <span className="text-zinc-300">{formatearFecha(viaje.created_at)}</span></p>}
                      {viaje.hora_aceptacion && <p>✅ <span className="text-zinc-400">Aceptado:</span> <span className="text-green-400">{formatearFecha(viaje.hora_aceptacion)}</span></p>}
                      {viaje.hora_inicio && <p>🚛 <span className="text-zinc-400">En camino:</span> <span className="text-yellow-400">{formatearFecha(viaje.hora_inicio)}</span></p>}
                      {viaje.hora_finalizacion && <p>🏆 <span className="text-zinc-400">Finalizado:</span> <span className="text-green-400">{formatearFecha(viaje.hora_finalizacion)}</span></p>}
                    </div>
                  </div>

                  {/* Botón ocultar */}
                  <div className="pt-2 border-t border-zinc-700">
                    {puede ? (
                      <button
                        onClick={() => ocultarViaje(String(viaje.id))}
                        disabled={ocultando === String(viaje.id)}
                        className={`w-full py-2 rounded-xl font-black text-xs transition ${
                          ocultando === String(viaje.id)
                            ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                            : "border border-red-800 text-red-500 hover:bg-red-900/30"
                        }`}
                      >
                        {ocultando === String(viaje.id) ? "Ocultando..." : "🗑️ Eliminar de mi historial"}
                      </button>
                    ) : (
                      <p className="text-zinc-600 text-xs text-center">No podés ocultar un viaje en curso</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}