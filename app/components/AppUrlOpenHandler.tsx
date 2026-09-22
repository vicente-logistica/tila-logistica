"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const HOST_PERMITIDO = "tila-logistica.vercel.app";

export default function AppUrlOpenHandler() {
  const router = useRouter();

  useEffect(() => {
    const removedores: Array<() => void> = [];

    const manejarUrl = (urlStr: string) => {
      let u: URL;
      try {
        u = new URL(urlStr);
      } catch {
        return;
      }
      if (u.host !== HOST_PERMITIDO) return;

      if (u.pathname === "/") {
        // Retorno de Mercado Pago al abandonar el checkout (VIEW a la raíz del
        // dominio). Solo redirige si ese abandono es el que estaba en curso —
        // una apertura normal de "/" sin el marcador sigue mostrando la landing.
        if (localStorage.getItem("tila_mp_checkout_activo") !== "1") return;
        localStorage.removeItem("tila_mp_checkout_activo");
        try {
          const usuarioGuardado = localStorage.getItem("usuario");
          if (!usuarioGuardado) return;
          const usuario = JSON.parse(usuarioGuardado);
          if (usuario?.rol !== "cliente") return;
          router.replace("/panel-cliente");
        } catch {
          // localStorage corrupto — el marcador ya se limpió arriba, no hacer nada más.
        }
        return;
      }

      if (u.pathname === "/panel-cliente") {
        // Retorno de Mercado Pago con resultado real (?pago=ok|error|pendiente) —
        // se conserva pathname + query para que el manejo existente del banner
        // en panel-cliente siga funcionando igual que hoy.
        localStorage.removeItem("tila_mp_checkout_activo");
        router.replace(u.pathname + u.search);
        return;
      }
    };

    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import("@capacitor/app");

        const lanzamiento = await App.getLaunchUrl();
        if (lanzamiento?.url) manejarUrl(lanzamiento.url);

        const listenerUrl = await App.addListener("appUrlOpen", ({ url }) => manejarUrl(url));
        removedores.push(() => listenerUrl.remove());

        // Cierre del navegador in-app de Mercado Pago (Browser.open, ver panel-cliente) por CUALQUIER
        // motivo (back-url, botón atrás, swipe) — a diferencia de appUrlOpen/getLaunchUrl, este SÍ
        // dispara aunque el usuario cierre el checkout sin llegar a ninguna back_url ni destruir la
        // Activity. Solo limpia el marcador y asegura volver a /panel-cliente; nunca toca sesión ni
        // pago_estado — el resultado real del pago sigue siendo exclusivamente responsabilidad del
        // webhook + las back_urls (manejadas arriba, en pathname === "/panel-cliente").
        const { Browser } = await import("@capacitor/browser");
        const listenerBrowser = await Browser.addListener("browserFinished", () => {
          localStorage.removeItem("tila_mp_checkout_activo");
          router.replace("/panel-cliente");
        });
        removedores.push(() => listenerBrowser.remove());
      } catch {
        // No es Capacitor nativo — ignorar silenciosamente
      }
    })();

    return () => {
      for (const remover of removedores) remover();
    };
  }, [router]);

  return null;
}
