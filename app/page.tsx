"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  // Caso excepcional: Android destruyó la Activity mientras Mercado Pago estaba
  // abierto (Browser.open, ver panel-cliente) — Capacitor recarga el WebView desde
  // cero en esta ruta, perdiendo la navegación a /panel-cliente. Esto NO es un
  // redirect genérico por tener sesión — sólo actúa si tila_mp_checkout_activo quedó
  // marcado (se limpia en cuanto panel-cliente detecta un cierre normal del
  // navegador o una back_url real de MP). Sin ese marcador, esta página se comporta
  // EXACTAMENTE igual que antes.
  useEffect(() => {
    try {
      if (localStorage.getItem("tila_mp_checkout_activo") !== "1") return;
      // Se limpia ACÁ MISMO, apenas se confirma que estaba activo — antes de
      // cualquier chequeo que pueda fallar (sin usuario, JSON.parse roto, rol
      // distinto). Así ningún camino de salida puede dejar el marcador colgado
      // indefinidamente esperando una condición que nunca se va a cumplir.
      localStorage.removeItem("tila_mp_checkout_activo");
      const usuarioGuardado = localStorage.getItem("usuario");
      if (!usuarioGuardado) return;
      const usuario = JSON.parse(usuarioGuardado);
      if (usuario?.rol !== "cliente") return;
      router.replace("/panel-cliente");
    } catch {
      // localStorage corrupto — el marcador ya se limpió arriba (o nunca llegó a
      // leerse como "1" si el primer getItem falló) — no hacer nada más.
    }
  }, [router]);

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-6 overflow-hidden">

      <section className="w-full max-w-6xl flex flex-col items-center justify-center text-center">

        {/* LOGO */}
        <div className="w-full flex justify-center mb-8 animate-pulse">

          <img
            src="/logo-tila.png"
            alt="TILA"
            className="w-full max-w-[850px] max-h-[52vh] object-contain drop-shadow-[0_0_50px_rgba(250,204,21,0.45)]"
          />

        </div>

        {/* TITULO */}
        <h1 className="text-3xl md:text-6xl font-black text-yellow-400 mb-5 leading-tight">
          Tecnología Inteligente Logística Argentina
        </h1>

        {/* TEXTO */}
        <p className="text-zinc-300 text-base md:text-xl max-w-4xl mb-10 leading-relaxed">
          Conectamos cargas, choferes y empresas con monitoreo GPS,
          seguridad operativa y control logístico inteligente
          en tiempo real.
        </p>

        {/* BOTONES */}
        <div className="flex flex-col sm:flex-row gap-5 w-full max-w-lg">

          <Link href="/login" className="w-full">

            <button className="w-full bg-zinc-800 border-2 border-yellow-400 hover:bg-zinc-700 text-yellow-400 font-black text-xl py-5 rounded-3xl transition-all duration-300 hover:scale-105 shadow-2xl">
              Ingresar
            </button>

          </Link>

          <Link href="/crear-cuenta" className="w-full">

            <button className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xl py-5 rounded-3xl transition-all duration-300 hover:scale-105 shadow-2xl">
              Crear cuenta
            </button>

          </Link>

        </div>

        {/* FOOTER */}
        <p className="text-zinc-500 text-sm md:text-base tracking-[0.35em] mt-10">
          TU CARGA · NUESTRO COMPROMISO · TU ÉXITO
        </p>

        <div className="flex flex-wrap justify-center gap-4 mt-6 text-xs text-zinc-600">
          <Link href="/terminos" className="hover:text-yellow-400 transition">Términos y Condiciones</Link>
          <Link href="/privacidad" className="hover:text-yellow-400 transition">Política de Privacidad</Link>
          <Link href="/contrato-transportista" className="hover:text-yellow-400 transition">Contrato Transportista</Link>
          <a href="mailto:contacto@tilalogistica.com" className="hover:text-yellow-400 transition">Contacto</a>
        </div>

      </section>

    </main>
  );
}