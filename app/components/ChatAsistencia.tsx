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

  const cargarMensajes = async () => {
    const { data, error } = await supabase
      .from("mensajes_viaje")
      .select("*")
      .eq("viaje_id", Number(viajeId))
      .order("created_at", { ascending: true });
    if (error) { console.error("Error cargando mensajes:", error); return; }
    setMensajes(data || []);
    // Contar no leídos que no son del usuario actual
    const sinLeer = (data || []).filter(m => !m.leido && m.remitente_id !== usuarioId).length;
    setNoLeidos(sinLeer);
  };

  const marcarLeidos = async () => {
    await supabase
      .from("mensajes_viaje")
      .update({ leido: true })
      .eq("viaje_id", Number(viajeId))
      .neq("remitente_id", usuarioId)
      .eq("leido", false);
    setNoLeidos(0);
  };

  useEffect(() => {
    if (!viajeId) return;
    cargarMensajes();

    const canal = supabase
      .channel(`chat-viaje-${viajeId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "mensajes_viaje",
        filter: `viaje_id=eq.${viajeId}`,
      }, () => { cargarMensajes(); })
      .subscribe();

    return () => { supabase.removeChannel(canal); };
  }, [viajeId]);

  useEffect(() => {
    if (abierto) {
      marcarLeidos();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [abierto, mensajes]);

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
    if (error) { alert("Error al enviar: " + error.message); }
    else { setTexto(""); }
    setEnviando(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensaje(); }
  };

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setAbierto(!abierto)}
        className="fixed bottom-6 right-6 z-50 bg-yellow-400 hover:bg-yellow-500 text-black font-black rounded-full w-16 h-16 flex items-center justify-center shadow-2xl"
      >
        {noLeidos > 0 ? (
          <span className="relative">
            💬
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-black rounded-full w-5 h-5 flex items-center justify-center">
              {noLeidos}
            </span>
          </span>
        ) : (
          <span className="text-2xl">💬</span>
        )}
      </button>

      {/* Panel de chat */}
      {abierto && (
        <div className="fixed bottom-24 right-6 z-50 w-80 md:w-96 bg-zinc-900 border-2 border-yellow-400 rounded-3xl shadow-2xl flex flex-col" style={{ maxHeight: "70vh" }}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <div>
              <p className="text-yellow-400 font-black">💬 Asistencia</p>
              <p className="text-zinc-500 text-xs">Viaje #{String(viajeId).slice(0, 8)}</p>
            </div>
            <button onClick={() => setAbierto(false)} className="text-zinc-400 hover:text-white font-black text-lg">✕</button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ minHeight: "200px" }}>
            {mensajes.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center mt-4">Sin mensajes todavía. Escribí algo.</p>
            ) : (
              mensajes.map((m) => {
                const esMio = m.remitente_id === usuarioId;
                return (
                  <div key={m.id} className={`flex ${esMio ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] ${esMio ? "items-end" : "items-start"} flex flex-col gap-1`}>
                      {!esMio && (
                        <div className="flex items-center gap-1">
                          <span className={`px-2 py-0.5 rounded-lg text-xs font-black ${colorRol(m.remitente_rol)}`}>
                            {m.remitente_rol}
                          </span>
                          <span className="text-zinc-500 text-xs">{m.remitente_nombre}</span>
                        </div>
                      )}
                      <div className={`px-3 py-2 rounded-2xl text-sm ${esMio ? "bg-yellow-400 text-black font-black" : "bg-zinc-800 text-white"}`}>
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
          <div className="p-3 border-t border-zinc-800 flex gap-2">
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
              className={`px-4 py-3 rounded-xl font-black text-sm ${enviando || !texto.trim() ? "bg-zinc-700 text-zinc-500" : "bg-yellow-400 hover:bg-yellow-500 text-black"}`}
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}