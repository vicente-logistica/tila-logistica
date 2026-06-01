"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

interface ChatAsistenciaProps {
  viajeId: string | number;
  usuarioId: string;
  usuarioRol: "cliente" | "chofer" | "admin";
  usuarioNombre: string;
}

const colorRol = (rol: string) => {
  if (rol === "admin") return "bg-purple-600 text-white";
  if (rol === "chofer") return "bg-blue-600 text-white";
  return "bg-yellow-400 text-black";
};

const labelRol = (rol: string) => {
  if (rol === "admin") return "🛡️ Admin";
  if (rol === "chofer") return "🚛 Chofer";
  return "📦 Cliente";
};

const formatHora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function ChatAsistencia({
  viajeId,
  usuarioId,
  usuarioRol,
  usuarioNombre,
}: ChatAsistenciaProps) {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [noLeidos, setNoLeidos] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abieroRef = useRef(false);

  // Sincronizar ref con estado para usar en callbacks
  useEffect(() => { abieroRef.current = abierto; }, [abierto]);

  const cargarMensajes = async () => {
    const { data, error } = await supabase
      .from("mensajes_viaje")
      .select("*")
      .eq("viaje_id", Number(viajeId))
      .order("created_at", { ascending: true });

    if (error) { console.error("Error cargando mensajes:", error); return; }

    const todos = data || [];
    setMensajes(todos);

    // Actualizar badge siempre, independiente de si está abierto
    const sinLeer = todos.filter(
      (m) => !m.leido && m.remitente_id !== usuarioId
    ).length;
    setNoLeidos(sinLeer);

    // Si está abierto, marcar como leídos y hacer scroll
    if (abieroRef.current) {
      marcarLeidos();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  const marcarLeidos = async () => {
    const { error } = await supabase
      .from("mensajes_viaje")
      .update({ leido: true })
      .eq("viaje_id", Number(viajeId))
      .neq("remitente_id", usuarioId)
      .eq("leido", false);

    if (!error) setNoLeidos(0);
  };

  useEffect(() => {
    if (!viajeId) return;
    cargarMensajes();

    const canal = supabase
      .channel(`chat-viaje-${viajeId}-${usuarioId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "mensajes_viaje",
        filter: `viaje_id=eq.${viajeId}`,
      }, () => {
        cargarMensajes();
      })
      .subscribe();

    // Polling cada 10s como fallback
    const intervalo = setInterval(cargarMensajes, 10000);

    return () => {
      supabase.removeChannel(canal);
      clearInterval(intervalo);
    };
  }, [viajeId, usuarioId]);

  // Al abrir: marcar leídos y scroll
  useEffect(() => {
    if (abierto) {
      marcarLeidos();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
    }
  }, [abierto]);

  // Scroll cuando llegan mensajes nuevos y está abierto
  useEffect(() => {
    if (abierto && mensajes.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [mensajes]);

  const enviarMensaje = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);

    const { error } = await supabase.from("mensajes_viaje").insert([{
      viaje_id: Number(viajeId),
      remitente_id: usuarioId,
      remitente_rol: usuarioRol,
      remitente_nombre: usuarioNombre,
      mensaje: texto.trim(),
      leido: false,
    }]);

    if (error) {
      alert("Error al enviar: " + error.message);
    } else {
      setTexto("");
    }
    setEnviando(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensaje(); }
  };

  return (
    <>
      {/* Botón flotante con badge */}
      <button
        onClick={() => setAbierto(!abierto)}
        className="fixed bottom-6 right-6 z-50 bg-yellow-400 hover:bg-yellow-500 text-black font-black rounded-full w-16 h-16 flex items-center justify-center shadow-2xl transition"
      >
        <span className="relative flex items-center justify-center">
          <span className="text-2xl">💬</span>
          {noLeidos > 0 && (
            <span className="absolute -top-3 -right-3 bg-red-500 text-white text-xs font-black rounded-full min-w-5 h-5 flex items-center justify-center px-1 animate-pulse">
              {noLeidos}
            </span>
          )}
        </span>
      </button>

      {/* Panel de chat */}
      {abierto && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 md:w-96 bg-zinc-900 border-2 border-yellow-400 rounded-3xl shadow-2xl flex flex-col"
          style={{ maxHeight: "70vh" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800 flex-shrink-0">
            <div>
              <p className="text-yellow-400 font-black">💬 Asistencia</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 rounded-lg text-xs font-black ${colorRol(usuarioRol)}`}>
                  {labelRol(usuarioRol)}
                </span>
                <span className="text-zinc-500 text-xs truncate">{usuarioNombre}</span>
              </div>
            </div>
            <button
              onClick={() => setAbierto(false)}
              className="text-zinc-400 hover:text-white font-black text-xl w-8 h-8 flex items-center justify-center"
            >
              ✕
            </button>
          </div>

          {/* Mensajes */}
          <div
            className="flex-1 overflow-y-auto p-4 space-y-3"
            style={{ minHeight: "200px", maxHeight: "calc(70vh - 140px)" }}
          >
            {mensajes.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center mt-8">
                Sin mensajes todavía.<br />Escribí algo para empezar.
              </p>
            ) : (
              mensajes.map((m) => {
                const esMio = m.remitente_id === usuarioId;
                return (
                  <div key={m.id} className={`flex ${esMio ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[82%] flex flex-col gap-1 ${esMio ? "items-end" : "items-start"}`}>
                      {/* Badge de rol — siempre visible */}
                      <div className="flex items-center gap-1">
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-black ${colorRol(m.remitente_rol)}`}>
                          {labelRol(m.remitente_rol)}
                        </span>
                        <span className="text-zinc-500 text-xs">{m.remitente_nombre}</span>
                      </div>
                      {/* Burbuja */}
                      <div className={`px-3 py-2 rounded-2xl text-sm break-words ${
                        esMio
                          ? "bg-yellow-400 text-black font-black rounded-tr-sm"
                          : "bg-zinc-800 text-white rounded-tl-sm"
                      }`}>
                        {m.mensaje}
                      </div>
                      <span className="text-zinc-600 text-xs">{formatHora(m.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-zinc-800 flex gap-2 flex-shrink-0">
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribí un mensaje..."
              className="flex-1 bg-zinc-800 border border-zinc-700 text-white p-3 rounded-xl text-sm outline-none focus:border-yellow-400"
            />
            <button
              onClick={enviarMensaje}
              disabled={enviando || !texto.trim()}
              className={`px-4 py-3 rounded-xl font-black text-sm transition ${
                enviando || !texto.trim()
                  ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                  : "bg-yellow-400 hover:bg-yellow-500 text-black"
              }`}
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}