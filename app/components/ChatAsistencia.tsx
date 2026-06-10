"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export type TipoChat = "viaje" | "soporte_cliente" | "soporte_chofer";

interface ChatAsistenciaProps {
  viajeId: string | number;
  usuarioId: string;
  usuarioRol: "cliente" | "chofer" | "admin";
  usuarioNombre: string;
  tipoChat?: TipoChat;
  modoInline?: boolean; // cuando true: sin botón flotante, sin fixed, contenido directo
  onNoLeidosChange?: (cantidad: number) => void; // callback para avisar no leídos al padre
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

const tituloPorTipo = (tipo: TipoChat): string => {
  if (tipo === "soporte_cliente") return "🛟 Soporte cliente";
  if (tipo === "soporte_chofer")  return "🚛 Soporte chofer";
  return "💬 Chat del viaje";
};

export default function ChatAsistencia({
  viajeId,
  usuarioId,
  usuarioRol,
  usuarioNombre,
  tipoChat = "viaje",
  modoInline = false,
  onNoLeidosChange,
}: ChatAsistenciaProps) {
  const [abierto, setAbierto]         = useState(false);
  const [mensajes, setMensajes]       = useState<any[]>([]);
  const [texto, setTexto]             = useState("");
  const [enviando, setEnviando]       = useState(false);
  const [noLeidos, setNoLeidos]       = useState(0);
  const [flashNuevo, setFlashNuevo]   = useState(false);
  const bottomRef   = useRef<HTMLDivElement | null>(null);
  const abiertoRef  = useRef(false);
  const mensajesRef = useRef<any[]>([]);

  useEffect(() => { abiertoRef.current = abierto; }, [abierto]);
  useEffect(() => { mensajesRef.current = mensajes; }, [mensajes]);
  useEffect(() => { onNoLeidosChange?.(noLeidos); }, [noLeidos]);

  const calcularNoLeidos = (todos: any[]) =>
    todos.filter(m => !m.leido && m.remitente_id !== usuarioId).length;

  const cargarMensajes = async () => {
    const { data, error } = await supabase
      .from("mensajes_viaje")
      .select("*")
      .eq("viaje_id", Number(viajeId))
      .eq("tipo_chat", tipoChat)
      .order("created_at", { ascending: true });

    if (error) { console.error("Error cargando mensajes:", error); return; }

    const todos = data || [];
    setMensajes(todos);
    setNoLeidos(calcularNoLeidos(todos));

    if (abiertoRef.current) {
      marcarLeidos();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  const marcarLeidos = async () => {
    await supabase
      .from("mensajes_viaje")
      .update({ leido: true })
      .eq("viaje_id", Number(viajeId))
      .eq("tipo_chat", tipoChat)
      .neq("remitente_id", usuarioId)
      .eq("leido", false);
    setNoLeidos(0);
  };

  const manejarNuevoMensaje = (payload: any) => {
    const nuevo = payload.new;
    if (!nuevo) return;
    // Ignorar mensajes de otros tipos de chat en el mismo canal
    if (nuevo.tipo_chat !== tipoChat) return;

    setMensajes(prev => {
      if (prev.find(m => m.id === nuevo.id)) return prev;
      const actualizados = [...prev, nuevo];
      mensajesRef.current = actualizados;
      return actualizados;
    });

    if (nuevo.remitente_id !== usuarioId) {
      if (!abiertoRef.current) {
        setNoLeidos(prev => prev + 1);
        setFlashNuevo(true);
        setTimeout(() => setFlashNuevo(false), 2000);
      } else {
        marcarLeidos();
      }
    }

    if (abiertoRef.current) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  useEffect(() => {
    if (!viajeId) return;
    cargarMensajes();

    const canal = supabase
      .channel(`chat-${viajeId}-${tipoChat}-${usuarioId}-${Date.now()}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "mensajes_viaje",
        filter: `viaje_id=eq.${viajeId}`,
      }, manejarNuevoMensaje)
      .subscribe();

    const intervalo = setInterval(cargarMensajes, 5000);

    return () => {
      supabase.removeChannel(canal);
      clearInterval(intervalo);
    };
  }, [viajeId, usuarioId, tipoChat]);

  useEffect(() => {
    if (abierto) {
      marcarLeidos();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
    }
  }, [abierto]);

  useEffect(() => {
    if (abierto && mensajes.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [mensajes, abierto]);

  const enviarMensaje = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    const { error } = await supabase.from("mensajes_viaje").insert([{
      viaje_id:         Number(viajeId),
      remitente_id:     usuarioId,
      remitente_rol:    usuarioRol,
      remitente_nombre: usuarioNombre,
      mensaje:          texto.trim(),
      leido:            false,
      tipo_chat:        tipoChat,
    }]);
    if (error) { alert("Error al enviar: " + error.message); }
    else { setTexto(""); }
    setEnviando(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensaje(); }
  };

  const titulo = tituloPorTipo(tipoChat);

  // ── MODO INLINE: contenido directo sin botón flotante ni fixed ──────────────
  if (modoInline) {
    return (
      <div className="flex flex-col h-full">
        {/* Mensajes */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {mensajes.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center mt-8">Sin mensajes todavía.<br />Escribí algo para empezar.</p>
          ) : (
            mensajes.map((m) => {
              const esMio = m.remitente_id === usuarioId;
              return (
                <div key={m.id} className={`flex ${esMio ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] flex flex-col gap-1 ${esMio ? "items-end" : "items-start"}`}>
                    <div className="flex items-center gap-1">
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-black ${colorRol(m.remitente_rol)}`}>
                        {labelRol(m.remitente_rol)}
                      </span>
                      <span className="text-zinc-500 text-xs">{m.remitente_nombre}</span>
                    </div>
                    <div className={`px-3 py-2 rounded-2xl text-sm break-words ${
                      esMio ? "bg-yellow-400 text-black font-black rounded-tr-sm" : "bg-zinc-800 text-white rounded-tl-sm"
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
              enviando || !texto.trim() ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-yellow-400 hover:bg-yellow-500 text-black"
            }`}
          >
            ➤
          </button>
        </div>
      </div>
    );
  }

  // ── MODO FLOTANTE (por defecto): botón fixed + panel fixed ──────────────────
  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setAbierto(!abierto)}
        className={`fixed bottom-6 right-6 z-50 font-black rounded-full w-16 h-16 flex items-center justify-center shadow-2xl transition ${
          flashNuevo ? "bg-red-500 scale-110" : "bg-yellow-400 hover:bg-yellow-500"
        } text-black`}
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
        <div className="fixed bottom-24 right-6 z-50 w-80 md:w-96 bg-zinc-900 border-2 border-yellow-400 rounded-3xl shadow-2xl flex flex-col" style={{ maxHeight: "70vh" }}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800 flex-shrink-0">
            <div>
              <p className="text-yellow-400 font-black">{titulo}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 rounded-lg text-xs font-black ${colorRol(usuarioRol)}`}>
                  {labelRol(usuarioRol)}
                </span>
                <span className="text-zinc-500 text-xs truncate">{usuarioNombre}</span>
              </div>
            </div>
            <button onClick={() => setAbierto(false)} className="text-zinc-400 hover:text-white font-black text-xl w-8 h-8 flex items-center justify-center">✕</button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ minHeight: "200px", maxHeight: "calc(70vh - 140px)" }}>
            {mensajes.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center mt-8">Sin mensajes todavía.<br />Escribí algo para empezar.</p>
            ) : (
              mensajes.map((m) => {
                const esMio = m.remitente_id === usuarioId;
                return (
                  <div key={m.id} className={`flex ${esMio ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[82%] flex flex-col gap-1 ${esMio ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-1">
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-black ${colorRol(m.remitente_rol)}`}>
                          {labelRol(m.remitente_rol)}
                        </span>
                        <span className="text-zinc-500 text-xs">{m.remitente_nombre}</span>
                      </div>
                      <div className={`px-3 py-2 rounded-2xl text-sm break-words ${
                        esMio ? "bg-yellow-400 text-black font-black rounded-tr-sm" : "bg-zinc-800 text-white rounded-tl-sm"
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
                enviando || !texto.trim() ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-yellow-400 hover:bg-yellow-500 text-black"
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
