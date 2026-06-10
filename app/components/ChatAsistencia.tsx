"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// ── Helpers de presentación ──────────────────────────────────────────────────

const colorRol = (rol: string) => {
  if (rol === "admin")  return "bg-purple-600 text-white";
  if (rol === "chofer") return "bg-blue-600 text-white";
  return "bg-yellow-400 text-black";
};

const labelRol = (rol: string) => {
  if (rol === "admin")  return "🛡️ Admin TILA";
  if (rol === "chofer") return "🚛 Chofer";
  return "📦 Cliente";
};

const formatHora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const tituloPorTipo = (tipo: TipoChat): string => {
  if (tipo === "soporte_cliente") return "🛟 Soporte TILA";
  if (tipo === "soporte_chofer")  return "🛟 Soporte TILA";
  return "💬 Chat del viaje";
};

/** Texto del toast según quien recibe el mensaje */
const textoAlertaPorTipo = (tipo: TipoChat, rol: "cliente" | "chofer" | "admin"): string => {
  if (rol === "chofer") {
    if (tipo === "viaje")          return "📦 Cliente · Nuevo mensaje";
    if (tipo === "soporte_chofer") return "🛟 Soporte TILA · Nuevo mensaje";
  }
  if (rol === "cliente") {
    if (tipo === "viaje")           return "🚛 Chofer · Nuevo mensaje";
    if (tipo === "soporte_cliente") return "🛟 Soporte TILA · Nuevo mensaje";
  }
  if (rol === "admin") {
    if (tipo === "viaje")           return "🚛 Chofer · Nuevo mensaje operativo";
    if (tipo === "soporte_cliente") return "📦 Cliente · Nuevo mensaje";
    if (tipo === "soporte_chofer")  return "🚛 Chofer · Nuevo mensaje";
  }
  return "💬 Nuevo mensaje";
};

// ── Componente ───────────────────────────────────────────────────────────────

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

  const inputRef          = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef         = useRef<HTMLDivElement | null>(null);
  const autoScrollRef     = useRef(true);    // false cuando el usuario sube manualmente
  const chatVisibleRef    = useRef(modoInline); // inline siempre visible al montar
  const silenciadoRef     = useRef(false);   // el panel padre controla el sonido; aquí siempre false

  // ── Scroll inteligente tipo WhatsApp ─────────────────────────────────────

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const scrollToBottom = useCallback((forzar = false) => {
    if (!forzar && !autoScrollRef.current) return; // usuario scrolleó hacia arriba — no forzar
    requestAnimationFrame(() => {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    });
  }, []);

  const handleScroll = useCallback(() => {
    autoScrollRef.current = isNearBottom();
  }, [isNearBottom]);

  // ── Hook de datos ─────────────────────────────────────────────────────────

  const { mensajes, noLeidos, setNoLeidos, marcarLeidos, enviarMensaje } = useChatRealtime({
    viajeId,
    usuarioId,
    tipoChat,
    silenciadoRef,
    chatVisibleRef,
    textoAlerta: textoAlertaPorTipo(tipoChat, usuarioRol),
    onNoLeidosChange,
    onNuevoMensaje: () => scrollToBottom(), // llamado por el hook al recibir mensaje nuevo
  });

  // ── Sincronizar chatVisibleRef con estado abierto ─────────────────────────

  useEffect(() => {
    if (!modoInline) chatVisibleRef.current = abierto;
  }, [abierto, modoInline]);

  // ── Scroll al abrir (modo flotante) ──────────────────────────────────────

  useEffect(() => {
    if (!modoInline && abierto) {
      marcarLeidos();
      autoScrollRef.current = true;
      scrollToBottom(true);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [abierto]);

  // ── Mount en modoInline: el panel padre lo muestra ───────────────────────

  useEffect(() => {
    if (modoInline) {
      chatVisibleRef.current = true;
      marcarLeidos();
      autoScrollRef.current = true;
      scrollToBottom(true);
      setTimeout(() => inputRef.current?.focus(), 120);
    }
    return () => {
      if (modoInline) chatVisibleRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scroll cuando llegan mensajes nuevos (inteligente) ───────────────────
  // También cubre la carga inicial (mensajes pasan de 0 a N)

  useEffect(() => {
    scrollToBottom();
  }, [mensajes.length]);

  // ── Enviar mensaje ────────────────────────────────────────────────────────

  const handleEnviar = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    const error = await enviarMensaje(texto, usuarioRol, usuarioNombre);
    if (error) {
      alert("Error al enviar: " + error.message);
    } else {
      setTexto("");
      autoScrollRef.current = true; // tras enviar, volver a modo auto-scroll
      requestAnimationFrame(() => {
        setTimeout(() => {
          scrollToBottom(true);
          inputRef.current?.focus();
        }, 50);
      });
    }
    setEnviando(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); }
  };

  // ── Renderizado de burbujas ───────────────────────────────────────────────

  const ListaMensajes = (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-2"
      style={{ minHeight: 0 }}
    >
      {mensajes.length === 0 ? (
        <p className="text-zinc-600 text-xs text-center pt-6 select-none">
          Sin mensajes todavía. Escribí algo para empezar.
        </p>
      ) : (
        mensajes.map((m) => {
          const esMio = m.remitente_id === usuarioId;
          return (
            <div key={m.id} className={`flex ${esMio ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] flex flex-col gap-0.5 ${esMio ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-black leading-tight ${colorRol(m.remitente_rol)}`}>
                    {labelRol(m.remitente_rol)}
                  </span>
                  <span className="text-zinc-600 text-[10px] truncate max-w-[100px]">{m.remitente_nombre}</span>
                </div>
                <div className={`px-3 py-2 rounded-2xl text-sm break-words leading-snug ${
                  esMio
                    ? "bg-yellow-400 text-black font-semibold rounded-tr-sm"
                    : "bg-zinc-800 text-white rounded-tl-sm"
                }`}>
                  {m.mensaje}
                </div>
                <span className="text-zinc-700 text-[10px] select-none">{formatHora(m.created_at)}</span>
              </div>
            </div>
          );
        })
      )}
      {/* Anchor de scroll */}
      <div ref={bottomRef} />
    </div>
  );

  const InputArea = (
    <div className="flex gap-2 px-3 pb-3 pt-2 border-t border-zinc-800 flex-shrink-0 bg-inherit">
      <input
        ref={inputRef}
        type="text"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribí un mensaje…"
        className="flex-1 bg-zinc-900 border border-zinc-700 text-white px-3 py-2 rounded-xl text-sm outline-none focus:border-yellow-400 transition min-w-0"
      />
      <button
        onClick={handleEnviar}
        disabled={enviando || !texto.trim()}
        className={`px-3 py-2 rounded-xl font-black text-sm transition flex-shrink-0 ${
          enviando || !texto.trim()
            ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            : "bg-yellow-400 hover:bg-yellow-500 text-black active:scale-95"
        }`}
      >
        ➤
      </button>
    </div>
  );

  // ── MODO INLINE: el padre provee el contenedor con altura ─────────────────
  if (modoInline) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-zinc-950">
        {ListaMensajes}
        {InputArea}
      </div>
    );
  }

  // ── MODO FLOTANTE: botón fijo + ventana compacta ──────────────────────────
  const titulo = tituloPorTipo(tipoChat);
  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => { setAbierto(v => !v); if (!abierto) setNoLeidos(0); }}
        className={`fixed bottom-6 right-6 z-50 font-black rounded-full w-14 h-14 flex items-center justify-center shadow-2xl transition-transform active:scale-95 ${
          noLeidos > 0 && !abierto ? "bg-red-500" : "bg-yellow-400 hover:bg-yellow-500"
        } text-black`}
      >
        <span className="relative">
          <span className="text-xl">💬</span>
          {noLeidos > 0 && !abierto && (
            <span className="absolute -top-2.5 -right-2.5 bg-red-700 text-white text-[10px] font-black rounded-full min-w-4 h-4 flex items-center justify-center px-1 animate-pulse">
              {noLeidos}
            </span>
          )}
        </span>
      </button>

      {/* Panel flotante compacto */}
      {abierto && (
        <div
          className="fixed bottom-24 right-4 z-50 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ width: 320, height: 380 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 flex-shrink-0">
            <p className="text-yellow-400 font-black text-sm">{titulo}</p>
            <button
              onClick={() => setAbierto(false)}
              className="text-zinc-500 hover:text-white text-lg w-7 h-7 flex items-center justify-center transition"
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
