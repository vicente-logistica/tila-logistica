"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChatRealtime } from "../hooks/useChatRealtime";
import ChatToast from "./ChatToast";

export type TipoChat = "viaje" | "soporte_cliente" | "soporte_chofer";

interface ChatAsistenciaProps {
  viajeId: string | number;
  usuarioId: string;
  usuarioRol: "cliente" | "chofer" | "admin";
  usuarioNombre: string;
  tipoChat?: TipoChat;
  /**
   * modoInline: rellena el contenedor padre con h-full.
   * El PADRE debe tener altura definida (flex-1 min-h-0, style.height, etc.)
   */
  modoInline?: boolean;
  onNoLeidosChange?: (cantidad: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
const tituloPorTipo = (tipo: TipoChat) =>
  tipo === "soporte_cliente" || tipo === "soporte_chofer" ? "🛟 Soporte TILA" : "💬 Chat del viaje";

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

// ── Componente ────────────────────────────────────────────────────────────────
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

  const inputRef       = useRef<HTMLInputElement | null>(null);
  // ÚNICO target de scroll — nunca se scrollea window ni la página
  const mensajesRef    = useRef<HTMLDivElement | null>(null);
  const autoScrollRef  = useRef(true);
  const chatVisibleRef = useRef(modoInline);
  const silenciadoRef  = useRef(false);

  // ── Scroll sólo sobre el div interno ─────────────────────────────────────
  const scrollAbajo = useCallback((forzar = false) => {
    if (!forzar && !autoScrollRef.current) return;
    const el = mensajesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleScroll = useCallback(() => {
    const el = mensajesRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // ── Hook de datos ─────────────────────────────────────────────────────────
  const { mensajes, noLeidos, setNoLeidos, alerta, resetAlerta, marcarLeidos, enviarMensaje } =
    useChatRealtime({
      viajeId,
      usuarioId,
      tipoChat,
      silenciadoRef,
      chatVisibleRef,
      textoAlerta: textoAlertaPorTipo(tipoChat, usuarioRol),
      onNoLeidosChange,
      onNuevoMensaje: () => scrollAbajo(),
    });

  // ── Sincronizar chatVisibleRef ────────────────────────────────────────────
  useEffect(() => {
    if (!modoInline) chatVisibleRef.current = abierto;
  }, [abierto, modoInline]);

  // ── Al abrir floating ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!modoInline && abierto) {
      marcarLeidos();
      autoScrollRef.current = true;
      scrollAbajo(true);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [abierto]); // eslint-disable-line

  // ── Mount inline ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!modoInline) return;
    chatVisibleRef.current = true;
    marcarLeidos();
    autoScrollRef.current = true;
    scrollAbajo(true);
    setTimeout(() => inputRef.current?.focus(), 80);
    return () => { chatVisibleRef.current = false; };
  }, []); // eslint-disable-line

  // ── Scroll al llegar mensajes ─────────────────────────────────────────────
  useEffect(() => { scrollAbajo(); }, [mensajes.length]); // eslint-disable-line

  // ── Enviar ────────────────────────────────────────────────────────────────
  const handleEnviar = async () => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    const err = await enviarMensaje(texto, usuarioRol, usuarioNombre);
    if (err) {
      alert("Error: " + err.message);
    } else {
      setTexto("");
      // Scroll SÓLO el contenedor interno
      const el = mensajesRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      inputRef.current?.focus();
    }
    setEnviando(false);
  };
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); }
  };

  // ── Burbujas ──────────────────────────────────────────────────────────────
  const ListaMensajes = (
    // flex-1 min-h-0 overflow-y-auto → el scroll vive aquí, no en window
    <div ref={mensajesRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
      {mensajes.length === 0 ? (
        <p className="text-zinc-500 text-xs text-center pt-6 select-none">Sin mensajes todavía.</p>
      ) : (
        mensajes.map((m) => {
          const esMio = m.remitente_id === usuarioId;
          return (
            <div key={m.id} className={`flex ${esMio ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] flex flex-col gap-0.5 ${esMio ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-black leading-tight ${colorRol(m.remitente_rol)}`}>
                    {labelRol(m.remitente_rol)}
                  </span>
                  <span className="text-zinc-500 text-[10px] truncate max-w-[90px]">{m.remitente_nombre}</span>
                </div>
                <div className={`px-3 py-2 rounded-2xl text-sm break-words leading-snug ${
                  esMio ? "bg-yellow-400 text-black font-semibold rounded-tr-sm" : "bg-zinc-800 text-white rounded-tl-sm"
                }`}>
                  {m.mensaje}
                </div>
                <span className="text-zinc-600 text-[10px] select-none">{formatHora(m.created_at)}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  // flex-shrink-0 → siempre visible abajo, nunca se corta
  const InputChat = (
    <div className="flex-shrink-0 flex gap-2 p-3 border-t border-zinc-800">
      <input
        ref={inputRef}
        type="text"
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Escribí un mensaje…"
        className="flex-1 bg-zinc-900 border border-zinc-700 text-white px-3 py-2 rounded-xl text-sm outline-none focus:border-yellow-400 transition min-w-0"
      />
      <button
        onClick={handleEnviar}
        disabled={enviando || !texto.trim()}
        className={`px-3 py-2 rounded-xl font-black text-sm flex-shrink-0 transition ${
          enviando || !texto.trim() ? "bg-zinc-800 text-zinc-600 cursor-not-allowed" : "bg-yellow-400 hover:bg-yellow-500 text-black active:scale-95"
        }`}
      >
        ➤
      </button>
    </div>
  );

  // ──────────────────────────────────────────────────────────────────────────
  // MODO INLINE — rellena el padre (padre define altura)
  // Layout: flex col → mensajes (flex-1 min-h-0 scroll) + input (shrink-0)
  // ──────────────────────────────────────────────────────────────────────────
  if (modoInline) {
    return (
      <div className="h-full w-full flex flex-col bg-zinc-950">
        {ListaMensajes}
        {InputChat}
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODO FLOTANTE — botón burbuja + ventana con altura fija
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Toast de notificación cuando llega mensaje con chat cerrado */}
      {!abierto && alerta && (
        <ChatToast texto={alerta} />
      )}

      <button
        onClick={() => { setAbierto(v => !v); if (!abierto) { setNoLeidos(0); resetAlerta(); } }}
        className={`fixed bottom-6 right-6 z-50 rounded-full w-14 h-14 flex items-center justify-center shadow-2xl transition-transform active:scale-95 ${
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

      {abierto && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 md:w-96 bg-zinc-900 border border-zinc-700 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          style={{ height: "min(420px, 70vh)" }}
        >
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <p className="text-yellow-400 font-black text-sm">{tituloPorTipo(tipoChat)}</p>
            <button onClick={() => setAbierto(false)} className="text-zinc-500 hover:text-white w-7 h-7 flex items-center justify-center transition">✕</button>
          </div>
          {ListaMensajes}
          {InputChat}
        </div>
      )}
    </>
  );
}
