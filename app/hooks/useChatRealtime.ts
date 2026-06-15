"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { playChatSound } from "../utils/chatSound";

export type TipoChat = "viaje" | "soporte_cliente" | "soporte_chofer";

interface UseChatRealtimeOpts {
  viajeId: string | number;
  usuarioId: string;
  tipoChat: TipoChat;
  /** Ref de silencio — se lee en el callback sin stale closure */
  silenciadoRef: React.MutableRefObject<boolean>;
  /** Texto del toast cuando llega mensaje de otro y chat está cerrado */
  textoAlerta?: string;
  /** Ref que indica si el chat está visible para el usuario */
  chatVisibleRef?: React.MutableRefObject<boolean>;
  /** Callback para notificar al padre del conteo de no leídos */
  onNoLeidosChange?: (n: number) => void;
  /** Callback disparado al agregar un nuevo mensaje (para que el componente gestione scroll) */
  onNuevoMensaje?: () => void;
}

export interface UseChatRealtimeResult {
  mensajes: any[];
  noLeidos: number;
  setNoLeidos: React.Dispatch<React.SetStateAction<number>>;
  alerta: string | null;
  resetAlerta: () => void;
  marcarLeidos: () => Promise<void>;
  enviarMensaje: (texto: string, rol: string, nombre: string) => Promise<any>;
}

export function useChatRealtime({
  viajeId,
  usuarioId,
  tipoChat,
  silenciadoRef,
  textoAlerta,
  chatVisibleRef,
  onNoLeidosChange,
  onNuevoMensaje,
}: UseChatRealtimeOpts): UseChatRealtimeResult {
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [noLeidos, setNoLeidos] = useState(0);
  const [alerta, setAlerta]     = useState<string | null>(null);
  const alertaTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idsVistos               = useRef<Set<string | number>>(new Set());

  const marcarLeidos = useCallback(async () => {
    try {
      await fetch("/api/chat/marcar-leidos", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-user-id": usuarioId },
        body:    JSON.stringify({ viaje_id: viajeId, tipo_chat: tipoChat }),
      });
    } catch (err) {
      console.error("[marcarLeidos] error de red:", err);
    }
    setNoLeidos(0);
    onNoLeidosChange?.(0);
  }, [viajeId, tipoChat, usuarioId, onNoLeidosChange]);

  const resetAlerta = useCallback(() => {
    if (alertaTimerRef.current) clearTimeout(alertaTimerRef.current);
    setAlerta(null);
  }, []);

  const enviarMensaje = useCallback(async (texto: string, _rol: string, _nombre: string) => {
    try {
      const res = await fetch("/api/chat/mensaje", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-user-id": usuarioId },
        body:    JSON.stringify({ viaje_id: viajeId, tipo_chat: tipoChat, mensaje: texto.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[enviarMensaje] error API:", res.status, data);
        return { message: data?.error ?? "Error al enviar mensaje" };
      }
      return null;
    } catch (err: any) {
      console.error("[enviarMensaje] error de red:", err);
      return { message: err?.message ?? "Error de red" };
    }
  }, [viajeId, usuarioId, tipoChat]);

  const cargarMensajes = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/chat/mensajes?viaje_id=${viajeId}&tipo_chat=${tipoChat}`,
        { headers: { "x-user-id": usuarioId } },
      );
      if (!res.ok) {
        console.error("[cargarMensajes] error API:", res.status);
        return;
      }
      const { data } = await res.json();
      if (!data) return;
      data.forEach((m: any) => idsVistos.current.add(m.id));
      setMensajes(data);
      const nl = data.filter((m: any) => !m.leido && m.remitente_id !== usuarioId).length;
      setNoLeidos(nl);
      onNoLeidosChange?.(nl);
    } catch (err) {
      console.error("[cargarMensajes] error de red:", err);
    }
  }, [viajeId, tipoChat, usuarioId, onNoLeidosChange]);

  useEffect(() => {
    if (!viajeId || !usuarioId) return;

    cargarMensajes();

    const canal = supabase
      .channel(`chat-rt-${viajeId}-${tipoChat}-${usuarioId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensajes_viaje", filter: `viaje_id=eq.${viajeId}` },
        (payload) => {
          const nuevo = payload.new as any;
          if (!nuevo) return;
          if (nuevo.tipo_chat !== tipoChat) return;
          if (idsVistos.current.has(nuevo.id)) return;
          idsVistos.current.add(nuevo.id);

          console.log("CHAT SYNC nuevo", nuevo);
          setMensajes(prev => [...prev, nuevo]);

          // Notificar al componente para que gestione el scroll
          onNuevoMensaje?.();

          if (nuevo.remitente_id !== usuarioId) {
            if (chatVisibleRef?.current) {
              // Chat abierto — auto-marcar leído, sin badge ni alerta
              fetch("/api/chat/marcar-leidos", {
                method:  "POST",
                headers: { "Content-Type": "application/json", "x-user-id": usuarioId },
                body:    JSON.stringify({ viaje_id: viajeId, tipo_chat: tipoChat }),
              })
                .catch(err => console.error("[marcarLeidos-realtime] error:", err))
                .then(() => { setNoLeidos(0); onNoLeidosChange?.(0); });
            } else {
              // Chat cerrado — badge + alerta + sonido
              setNoLeidos(prev => {
                const n = prev + 1;
                onNoLeidosChange?.(n);
                return n;
              });
              if (textoAlerta) {
                if (alertaTimerRef.current) clearTimeout(alertaTimerRef.current);
                setAlerta(textoAlerta);
                alertaTimerRef.current = setTimeout(() => setAlerta(null), 3500);
              }
              if (!silenciadoRef.current) playChatSound();
            }
          }
        },
      )
      .subscribe((status) => {
        console.log("CHAT SYNC status", status);
      });

    // Polling de respaldo
    const intervalo = setInterval(cargarMensajes, 8000);

    return () => {
      supabase.removeChannel(canal);
      clearInterval(intervalo);
      if (alertaTimerRef.current) clearTimeout(alertaTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viajeId, usuarioId, tipoChat]);

  return { mensajes, noLeidos, setNoLeidos, alerta, resetAlerta, marcarLeidos, enviarMensaje };
}
