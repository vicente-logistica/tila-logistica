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
    if (tipo === "viaje")           return "🔴 Nuevo mensaje del chofer";
    if (tipo === "soporte_cliente") return "🔴 Nuevo mensaje de Soporte TILA";
  }
  if (rol === "admin") {
    if (tipo === "viaje")           return "🔴 Nuevo mensaje operativo";
    if (tipo === "soporte_cliente") return "🔴 Nuevo mensaje de cliente";
    if (tipo === "soporte_chofer")  return "🔴 Nuevo mensaje de chofer";
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
  const [abierto, setAbierto]   = useState(false);
  const [texto, setTexto]       = useState("");
  const [enviando, setEnviando] = useState(false);
  const inputRef                = useRef<HTMLInputElement | null>(null);

  // chatVisibleRef: true cuando el chat está a la vista (siempre en inline, o cuando abierto en flotante)
  const chatVisibleRef = useRef<boolean>(modoInline); // inline siempre visible al montar

  // Silencio interno del componente: siempre false (el padre controla si suena o no vía el canal externo)
  const silenciadoRef = useRef(false);

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
    chatVisibleRef,
    textoAlerta: textoAlertaPorTipo(tipoChat, usuarioRol),
    onNoLeidosChange,
  });

  // Sincronizar chatVisibleRef con estado abierto (modo flotante)
  useEffect(() => {
    if (!modoInline) chatVisibleRef.current = abierto;
  }, [abierto, modoInline]);

  // Scroll automático cada vez que cambia la cantidad de mensajes
  useEffect(() => {
    if (mensajes.length > 0) scrollToBottom();
  }, [mensajes.length]);

  // Al abrir panel flotante: marcar leídos, scroll, foco
  useEffect(() => {
    if (!modoInline && abierto) {
      marcarLeidos();
      setTimeout(() => { scrollToBottom(); inputRef.current?.focus(); }, 120);
    }
  }, [abierto]);

  // En modoInline: al montar (panel ya está visible)
  useEffect(() => {
    if (modoInline) {
      chatVisibleRef.current = true;
      marcarLeidos();
      setTimeout(() => { scrollToBottom(); inputRef.current?.focus(); }, 120);
    }
    return () => {
      // Al desmontar (panel se cierra) indicar que ya no es visible
      if (modoInline) chatVisibleRef.current = false;
    };
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
      requestAnimationFrame(() => {
        setTimeout(() => { inputRef.current?.focus(); scrollToBottom(); }, 50);
      });
    }
    setEnviando(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); }
  };

  // Renderizar solo los últimos 4 mensajes (compacto)
  const mensajesVisibles = mensajes.slice(-4);

  const BurbujaMensaje = ({ m }: { m: any }) => {
    const esMio = m.remitente_id === usuarioId;
    return (
      <div className={`flex ${esMio ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-[85%] flex flex-col gap-0.5 ${esMio ? "items-end" : "items-start"}`}>
          <div className="flex items-center gap-1">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${colorRol(m.remitente_rol)}`}>
              {labelRol(m.remitente_rol)}
            </span>
            <span className="text-zinc-600 text-[10px]">{m.remitente_nombre}</span>
          </div>
          <div className={`px-3 py-1.5 rounded-2xl text-sm break-words leading-snug ${
            esMio
              ? "bg-yellow-400 text-black font-bold rounded-tr-sm"
              : "bg-zinc-800 text-white rounded-tl-sm"
          }`}>
            {m.mensaje}
          </div>
          <span className="text-zinc-700 text-[10px]">{formatHora(m.created_at)}</span>
        </div>
      </div>
    );
  };

  // ─── Lista de mensajes compacta ─────────────────────────────────────────────
  const ListaMensajes = (
    <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 space-y-2 min-h-0">
      {mensajesVisibles.length === 0 ? (
        <p className="text-zinc-600 text-xs text-center pt-4">Sin mensajes. Escribí algo para empezar.</p>
      ) : (
        mensajesVisibles.map(m => <BurbujaMensaje key={m.id} m={m} />)
      )}
      <div ref={bottomRef} />
    </div>
  );

  // ─── Input ──────────────────────────────────────────────────────────────────
  const InputArea = (
    <div className="flex gap-2 px-3 pb-3 pt-2 border-t border-zinc-800 flex-shrink-0">
      <input
        ref={inputRef}
        type="text"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribí un mensaje…"
        className="flex-1 bg-zinc-900 border border-zinc-700 text-white px-3 py-2 rounded-xl text-sm outline-none focus:border-yellow-400 transition"
      />
      <button
        onClick={handleEnviar}
        disabled={enviando || !texto.trim()}
        className={`px-3 py-2 rounded-xl font-black text-sm transition ${
          enviando || !texto.trim()
            ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
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
      <div className="flex flex-col bg-zinc-950" style={{ height: 230 }}>
        {ListaMensajes}
        {InputArea}
      </div>
    );
  }

  // ── MODO FLOTANTE ────────────────────────────────────────────────────────────
  const titulo = tituloPorTipo(tipoChat);
  return (
    <>
      <button
        onClick={() => { setAbierto(v => !v); if (!abierto) setNoLeidos(0); }}
        className={`fixed bottom-6 right-6 z-50 font-black rounded-full w-14 h-14 flex items-center justify-center shadow-2xl transition ${
          noLeidos > 0 && !abierto ? "bg-red-500 scale-105 animate-pulse" : "bg-yellow-400 hover:bg-yellow-500"
        } text-black`}
      >
        <span className="relative">
          <span className="text-xl">💬</span>
          {noLeidos > 0 && !abierto && (
            <span className="absolute -top-2.5 -right-2.5 bg-red-600 text-white text-[10px] font-black rounded-full min-w-4 h-4 flex items-center justify-center px-1">
              {noLeidos}
            </span>
          )}
        </span>
      </button>

      {abierto && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 md:w-96 bg-zinc-900 border-2 border-yellow-400 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ height: 340 }}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 flex-shrink-0 bg-zinc-900">
            <p className="text-yellow-400 font-black text-sm">{titulo}</p>
            <button onClick={() => setAbierto(false)} className="text-zinc-500 hover:text-white text-lg w-7 h-7 flex items-center justify-center">✕</button>
          </div>
          {ListaMensajes}
          {InputArea}
        </div>
      )}
    </>
  );
}
