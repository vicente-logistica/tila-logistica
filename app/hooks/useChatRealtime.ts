"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { playChatSound } from "../utils/chatSound";

export type TipoChat = "viaje" | "soporte_cliente" | "soporte_chofer";

interface UseChatRealtimeOpts {
  viajeId: string | number;
  usuarioId: string;
  tipoChat: TipoChat;
  /** Ref de silencio del sector — se lee en el callback sin stale closure */
  silenciadoRef: React.MutableRefObject<boolean>;
  /** Texto a mostrar en la burbuja de alerta cuando llega mensaje de otro (solo si chat está cerrado) */
  textoAlerta?: string;
  /**
   * Ref que indica si el chat está actualmente visible para el usuario.
   * Cuando es true y llega un mensaje de otro, se marca como leído automáticamente
   * en lugar de incrementar el badge y mostrar alerta.
   */
  chatVisibleRef?: React.MutableRefObject<boolean>;
  /** Callback para notificar al padre del conteo actual de no leídos */
  onNoLeidosChange?: (n: number) => void;
}

export interface UseChatRealtimeResult {
  mensajes: any[];
  noLeidos: number;
  setNoLeidos: React.Dispatch<React.SetStateAction<number>>;
  alerta: string | null;
  resetAlerta: () => void;
  marcarLeidos: () => Promise<void>;
  enviarMensaje: (texto: string, rol: string, nombre: string) => Promise<any>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
}

export function useChatRealtime({
  viajeId,
  usuarioId,
  tipoChat,
  silenciadoRef,
  textoAlerta,
  chatVisibleRef,
  onNoLeidosChange,
}: UseChatRealtimeOpts): UseChatRealtimeResult {
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [noLeidos, setNoLeidos] = useState(0);
  const [alerta, setAlerta]     = useState<string | null>(null);
  const alertaTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef               = useRef<HTMLDivElement | null>(null);
  // Evitar doble-insert por Realtime + polling
  const idsVistos               = useRef<Set<string | number>>(new Set());

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    });
  }, []);

  const marcarLeidos = useCallback(async () => {
    await supabase
      .from("mensajes_viaje")
      .update({ leido: true })
      .eq("viaje_id", Number(viajeId))
      .eq("tipo_chat", tipoChat)
      .neq("remitente_id", usuarioId)
      .eq("leido", false);
    setNoLeidos(0);
    onNoLeidosChange?.(0);
  }, [viajeId, tipoChat, usuarioId, onNoLeidosChange]);

  const resetAlerta = useCallback(() => {
    if (alertaTimerRef.current) clearTimeout(alertaTimerRef.current);
    setAlerta(null);
  }, []);

  const enviarMensaje = useCallback(async (texto: string, rol: string, nombre: string) => {
    const { error } = await supabase.from("mensajes_viaje").insert([{
      viaje_id:         Number(viajeId),
      remitente_id:     usuarioId,
      remitente_rol:    rol,
      remitente_nombre: nombre,
      mensaje:          texto.trim(),
      leido:            false,
      tipo_chat:        tipoChat,
    }]);
    return error;
  }, [viajeId, usuarioId, tipoChat]);

  // Carga mensajes y actualiza sin duplicar
  const cargarMensajes = useCallback(async () => {
    const { data } = await supabase
      .from("mensajes_viaje")
      .select("*")
      .eq("viaje_id", Number(viajeId))
      .eq("tipo_chat", tipoChat)
      .order("created_at", { ascending: true });
    if (!data) return;
    data.forEach(m => idsVistos.current.add(m.id));
    setMensajes(data);
    const nl = data.filter(m => !m.leido && m.remitente_id !== usuarioId).length;
    setNoLeidos(nl);
    onNoLeidosChange?.(nl);
  }, [viajeId, tipoChat, usuarioId, onNoLeidosChange]);

  useEffect(() => {
    if (!viajeId || !usuarioId) return;

    cargarMensajes().then(() => scrollToBottom());

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
          scrollToBottom();

          if (nuevo.remitente_id !== usuarioId) {
            if (chatVisibleRef?.current) {
              // Chat abierto → marcar leído automáticamente, sin badge ni alerta
              supabase
                .from("mensajes_viaje")
                .update({ leido: true })
                .eq("viaje_id", Number(viajeId))
                .eq("tipo_chat", tipoChat)
                .neq("remitente_id", usuarioId)
                .eq("leido", false)
                .then(() => {
                  setNoLeidos(0);
                  onNoLeidosChange?.(0);
                });
            } else {
              // Chat cerrado → badge + alerta + sonido
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

    const intervalo = setInterval(cargarMensajes, 8000);

    return () => {
      supabase.removeChannel(canal);
      clearInterval(intervalo);
      if (alertaTimerRef.current) clearTimeout(alertaTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viajeId, usuarioId, tipoChat]);

  return {
    mensajes,
    noLeidos,
    setNoLeidos,
    alerta,
    resetAlerta,
    marcarLeidos,
    enviarMensaje,
    bottomRef,
    scrollToBottom,
  };
}
