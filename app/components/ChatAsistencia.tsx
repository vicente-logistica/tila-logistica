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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  if (tipo === "soporte_cliente" || tipo === "soporte_chofer") return "🛟 Soporte TILA";
  return "💬 Chat del viaje";
};

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

// ── Dimensiones compactas ─────────────────────────────────────────────────────
// Se usan tanto en floating como en inline para consistencia.
// El historial completo se scrollea DENTRO del contenedor — nunca se corta.
const CHAT_W = 340; // px ancho
const CHAT_H = 400; // px alto total (header incluido en floating, mensajes+input en inline)

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

  const inputRef             = useRef<HTMLInputElement | null>(null);
  // ↓ Este ref es el ÚNICO scroll target — nunca se scrollea window/page
  const mensajesContainerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef        = useRef(true);   // false cuando el usuario sube manualmente
  const chatVisibleRef       = useRef(modoInline);
  const silenciadoRef        = useRef(false);

  // ── Scroll directo sobre el contenedor interno ───────────────────────────
  const scrollToBottom = useCallback((forzar = false) => {
    if (!forzar && !autoScrollRef.current) return;
    const el = mensajesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleScroll = useCallback(() => {
    const el = mensajesContainerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // ── Hook de datos ─────────────────────────────────────────────────────────
  const { mensajes, noLeidos, setNoLeidos, marcarLeidos, enviarMensaje } =
    useChatRealtime({
      viajeId,
      usuarioId,
      tipoChat,
      silenciadoRef,
      chatVisibleRef,
      textoAlerta: textoAlertaPorTipo(tipoChat, usuarioRol),
      onNoLeidosChange,
      onNuevoMensaje: () => scrollToBottom(),
    });

  // ── Sincronizar chatVisibleRef ────────────────────────────────────────────
  useEffect(() => {
    if (!modoInline) chatVisibleRef.current = abierto;
  }, [abierto, modoInline]);

  // ── Al abrir (floating) ───────────────────────────────────────────────────
  useEffect(() => {
    if (!modoInline && abierto) {
      marcarLeidos();
      autoScrollRef.current = true;
      scrollToBottom(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Al montar en inline ───────────────────────────────────────────────────
  useEffect(() => {
    if (modoInline) {
      chatVisibleRef.current = true;
      marcarLeidos();
      autoScrollRef.current = true;
      scrollToBottom(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    return () => { if (modoInline) chatVisibleRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll inteligente al llegar mensajes nuevos ──────────────────────────
  useEffect(() => {
    scrollToBottom();
  }, [mensajes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enviar ────────────────────────────────────────────────────────────────
  const handleEnviar = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    const error = await enviarMensaje(texto, usuarioRol, usuarioNombre);
    if (error) {
      alert("Error al enviar: " + error.message);
    } else {
      setTexto("");
      autoScrollRef.current = true;
      // Scroll directo — sin rAF ni setTimeout — actúa sobre el contenedor interno
      const el = mensajesContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      inputRef.current?.focus();
    }
    setEnviando(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); }
  };

  // ── Burbujas ──────────────────────────────────────────────────────────────
  const ListaMensajes = (
    <div
      ref={mensajesContainerRef}
      onScroll={handleScroll}
      style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
      className="p-2.5 space-y-2"
    >
      {mensajes.length === 0 ? (
        <p className="text-zinc-600 text-xs text-center pt-4 select-none">
          Sin mensajes todavía.
        </p>
      ) : (
        mensajes.map((m) => {
          const esMio = m.remitente_id === usuarioId;
          return (
            <div key={m.id} className={`flex ${esMio ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] flex flex-col gap-0.5 ${esMio ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-1">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-black leading-tight ${colorRol(m.remitente_rol)}`}>
                    {labelRol(m.remitente_rol)}
                  </span>
                  <span className="text-zinc-600 text-[9px] truncate max-w-[80px]">{m.remitente_nombre}</span>
                </div>
                <div className={`px-2.5 py-1.5 rounded-2xl text-xs break-words leading-snug ${
                  esMio
                    ? "bg-yellow-400 text-black font-semibold rounded-tr-sm"
                    : "bg-zinc-800 text-white rounded-tl-sm"
                }`}>
                  {m.mensaje}
                </div>
                <span className="text-zinc-700 text-[9px] select-none">{formatHora(m.created_at)}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  // Input siempre visible, flex-shrink-0
  const InputArea = (
    <div
      style={{ flexShrink: 0 }}
      className="flex gap-1.5 px-2.5 py-2 border-t border-zinc-800 bg-inherit"
    >
      <input
        ref={inputRef}
        type="text"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribí…"
        className="flex-1 bg-zinc-900 border border-zinc-700 text-white px-2.5 py-1.5 rounded-xl text-xs outline-none focus:border-yellow-400 transition min-w-0"
      />
      <button
        onClick={handleEnviar}
        disabled={enviando || !texto.trim()}
        className={`px-2.5 py-1.5 rounded-xl font-black text-xs transition flex-shrink-0 ${
          enviando || !texto.trim()
            ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            : "bg-yellow-400 hover:bg-yellow-500 text-black active:scale-95"
        }`}
      >
        ➤
      </button>
    </div>
  );

  // ── MODO INLINE ───────────────────────────────────────────────────────────
  // Se autosiza — el padre NO necesita proveer altura.
  if (modoInline) {
    return (
      <div
        style={{ width: "100%", maxWidth: CHAT_W, height: CHAT_H, display: "flex", flexDirection: "column" }}
        className="bg-zinc-950"
      >
        {ListaMensajes}
        {InputArea}
      </div>
    );
  }

  // ── MODO FLOTANTE ─────────────────────────────────────────────────────────
  const titulo = tituloPorTipo(tipoChat);
  const HEADER_H = 44; // px

  return (
    <>
      {/* Botón burbuja */}
      <button
        onClick={() => { setAbierto(v => !v); if (!abierto) setNoLeidos(0); }}
        className={`fixed bottom-6 right-6 z-50 rounded-full w-14 h-14 flex items-center justify-center shadow-2xl transition-transform active:scale-95 ${
          noLeidos > 0 && !abierto ? "bg-red-500 animate-pulse" : "bg-yellow-400 hover:bg-yellow-500"
        } text-black`}
      >
        <span className="relative">
          <span className="text-xl">💬</span>
          {noLeidos > 0 && !abierto && (
            <span className="absolute -top-2.5 -right-2.5 bg-red-700 text-white text-[10px] font-black rounded-full min-w-4 h-4 flex items-center justify-center px-1">
              {noLeidos}
            </span>
          )}
        </span>
      </button>

      {/* Ventana compacta */}
      {abierto && (
        <div
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{
            width: CHAT_W,
            maxWidth: "calc(100vw - 32px)",
            height: CHAT_H + HEADER_H,
            bottom: 88,   // encima del botón
            right: 16,
          }}
        >
          {/* Header */}
          <div
            style={{ height: HEADER_H, flexShrink: 0 }}
            className="flex items-center justify-between px-3 border-b border-zinc-800"
          >
            <p className="text-yellow-400 font-black text-sm">{titulo}</p>
            <button
              onClick={() => setAbierto(false)}
              className="text-zinc-500 hover:text-white w-7 h-7 flex items-center justify-center transition text-base"
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
