"use client";

import { useEffect, useRef, useState } from "react";
import { useChatRealtime } from "../hooks/useChatRealtime";

export type TipoChat = "viaje" | "soporte_cliente" | "soporte_chofer";

interface ChatAsistenciaProps {
  viajeId: string | number;
  usuarioId: string;
  usuarioRol: "cliente" | "chofer" | "admin";
  usuarioNombre: string;
  tipoChat?: TipoChat;
  modoInline?: boolean;
  onNoLeidosChange?: (cantidad: number) => void;
}

const colorRol = (rol: string) => {
  if (rol === "admin")  return "bg-purple-600 text-white";
  if (rol === "chofer") return "bg-blue-600 text-white";
  return "bg-yellow-400 text-black";
};

const labelRol = (rol: string) => {
  if (rol === "admin")  return "🛡️ Admin";
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

const textoAlertaPorTipo = (tipo: TipoChat, rol: "cliente" | "chofer" | "admin"): string => {
  if (rol === "chofer") {
    if (tipo === "viaje")          return "🔴 Nuevo mensaje del cliente";
    if (tipo === "soporte_chofer") return "🔴 Nuevo mensaje de Soporte TILA";
  }
  if (rol === "cliente") {
    if (tipo === "viaje")            return "🔴 Nuevo mensaje del chofer";
    if (tipo === "soporte_cliente")  return "🔴 Nuevo mensaje de Soporte TILA";
  }
  if (rol === "admin") {
    if (tipo === "viaje")            return "🔴 Nuevo mensaje operativo";
    if (tipo === "soporte_cliente")  return "🔴 Nuevo mensaje de cliente";
    if (tipo === "soporte_chofer")   return "🔴 Nuevo mensaje de chofer";
  }
  return "🔴 Nuevo mensaje";
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
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto]     = useState("");
  const [enviando, setEnviando] = useState(false);
  const [flash, setFlash]     = useState(false);
  const inputRef              = useRef<HTMLInputElement | null>(null);
  // En el componente visual el silencio es siempre false — la alerta interna se maneja en el panel padre
  const silenciadoRef         = useRef(false);

  const {
    mensajes,
    noLeidos,
    setNoLeidos,
    marcarLeidos,
    enviarMensaje,
    bottomRef,
    scrollToBottom,
  } = useChatRealtime({
    viajeId,
    usuarioId,
    tipoChat,
    silenciadoRef,
    textoAlerta: textoAlertaPorTipo(tipoChat, usuarioRol),
  });

  // Notificar al padre del conteo de no leídos
  useEffect(() => { onNoLeidosChange?.(noLeidos); }, [noLeidos]);

  // Scroll automático cuando llegan mensajes nuevos
  useEffect(() => {
    if (mensajes.length > 0) scrollToBottom();
  }, [mensajes.length]);

  // Al abrir el panel flotante: marcar leídos, scroll, foco
  useEffect(() => {
    if (abierto) {
      marcarLeidos();
      setTimeout(() => {
        scrollToBottom();
        inputRef.current?.focus();
      }, 150);
    }
  }, [abierto]);

  // En modoInline: dar foco al montar (cuando el padre muestra el panel)
  useEffect(() => {
    if (modoInline) {
      marcarLeidos();
      setTimeout(() => {
        scrollToBottom();
        inputRef.current?.focus();
      }, 120);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnviar = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    const error = await enviarMensaje(texto, usuarioRol, usuarioNombre);
    if (error) {
      alert("Error al enviar: " + error.message);
    } else {
      setTexto("");
      // Mantener foco y bajar al último mensaje
      requestAnimationFrame(() => {
        setTimeout(() => {
          inputRef.current?.focus();
          scrollToBottom();
        }, 50);
      });
    }
    setEnviando(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); }
  };

  const titulo = tituloPorTipo(tipoChat);

  // ─── Renderizado de la lista de mensajes ────────────────────────────────────
  const ListaMensajes = (
    <div
      className="flex-1 overflow-y-auto overscroll-contain scroll-smooth p-3 space-y-3"
      style={{ minHeight: 0 }}
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
                <div className="flex items-center gap-1">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-black ${colorRol(m.remitente_rol)}`}>
                    {labelRol(m.remitente_rol)}
                  </span>
                  <span className="text-zinc-500 text-xs">{m.remitente_nombre}</span>
                </div>
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
      {/* Anchor para scroll-to-bottom */}
      <div ref={bottomRef} />
    </div>
  );

  // ─── Input compartido ────────────────────────────────────────────────────────
  const InputArea = (
    <div className="p-3 border-t border-zinc-800 flex gap-2 flex-shrink-0">
      <input
        ref={inputRef}
        type="text"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribí un mensaje..."
        className="flex-1 bg-zinc-800 border border-zinc-700 text-white p-3 rounded-xl text-sm outline-none focus:border-yellow-400"
      />
      <button
        onClick={handleEnviar}
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
  );

  // ── MODO INLINE ──────────────────────────────────────────────────────────────
  if (modoInline) {
    return (
      <div className="flex flex-col h-full min-h-0">
        {ListaMensajes}
        {InputArea}
      </div>
    );
  }

  // ── MODO FLOTANTE ────────────────────────────────────────────────────────────
  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => { setAbierto(v => !v); if (!abierto) setNoLeidos(0); }}
        className={`fixed bottom-6 right-6 z-50 font-black rounded-full w-16 h-16 flex items-center justify-center shadow-2xl transition ${
          flash ? "bg-red-500 scale-110" : "bg-yellow-400 hover:bg-yellow-500"
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

      {/* Panel flotante */}
      {abierto && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 md:w-96 bg-zinc-900 border-2 border-yellow-400 rounded-3xl shadow-2xl flex flex-col"
          style={{ height: "70vh", maxHeight: "70vh" }}
        >
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
            <button
              onClick={() => setAbierto(false)}
              className="text-zinc-400 hover:text-white font-black text-xl w-8 h-8 flex items-center justify-center"
            >
              ✕
            </button>
          </div>

          {ListaMensajes}
          {InputArea}
        </div>
      )}
    </>
  );
}
