"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ejecutarBackButtonInterceptor } from "../utils/backButtonInterceptor";

export default function CapacitorBackHandler() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let removeListener: (() => void) | null = null;

    const setup = async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;

        const { App } = await import("@capacitor/app");

        const listener = await App.addListener("backButton", ({ canGoBack }) => {
          // Una pantalla con overlay propio (ej. seguimiento de viaje del cliente)
          // puede reclamar este evento — si lo maneja, no aplicar navegación por defecto.
          if (ejecutarBackButtonInterceptor()) return;

          const currentPath = window.location.pathname;
          const viajeActivoId = localStorage.getItem("viajeActivoId");

          // En viaje-activo: volver al panel-chofer (nunca salir ni perder el viaje)
          if (currentPath === "/viaje-activo") {
            router.push("/panel-chofer");
            return;
          }

          // En pantalla raíz o login: salir de la app (con historial primero)
          if (currentPath === "/" || currentPath === "/login") {
            if (canGoBack) {
              history.back();
            } else {
              App.exitApp();
            }
            return;
          }

          // Raíz de rol: Atrás no hace nada acá — la única salida voluntaria es
          // "Cerrar sesión" (con confirmación). No navega, no cierra la app, no toca sesión.
          if (currentPath === "/panel-cliente" || currentPath === "/panel-chofer" || currentPath === "/admin") {
            return;
          }

          // Hay viaje activo en cualquier otra pantalla: si no hay historial, retomar viaje
          if (viajeActivoId && !canGoBack) {
            router.push("/viaje-activo");
            return;
          }

          // Default: navegar hacia atrás en el historial del WebView
          if (canGoBack) {
            history.back();
            return;
          }

          // Sin historial: volver al panel según el rol almacenado
          try {
            const usuarioRaw = localStorage.getItem("usuario");
            if (usuarioRaw) {
              const usuario = JSON.parse(usuarioRaw);
              const paneles: Record<string, string> = {
                chofer: "/panel-chofer",
                cliente: "/panel-cliente",
                admin: "/admin",
              };
              const destino = paneles[usuario.rol as string];
              if (destino) { router.push(destino); return; }
            }
          } catch {
            // localStorage corrupto — ir al inicio
          }

          router.push("/");
        });

        removeListener = () => listener.remove();
      } catch {
        // No es Capacitor nativo — ignorar silenciosamente
      }
    };

    setup();

    return () => {
      removeListener?.();
    };
  }, [pathname, router]);

  return null;
}
