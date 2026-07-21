"use client";

import Link from "next/link";

export default function CrearCuentaPage() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4 py-8 overflow-hidden">
      <section className="w-full max-w-3xl flex flex-col items-center text-center">
        <img
          src="/logo-tila.png"
          alt="TILA"
          className="w-full max-w-[520px] max-h-[45vh] object-contain mb-8 animate-pulse drop-shadow-[0_0_40px_rgba(250,204,21,0.45)]"
        />

        <h1 className="text-3xl md:text-5xl font-black text-yellow-400 mb-4 leading-tight">
          Crear cuenta
        </h1>

        <p className="text-zinc-400 mb-10 text-lg md:text-xl">
          Seleccioná el tipo de cuenta que querés crear
        </p>

        <div className="w-full max-w-md space-y-5">
          <Link
            href="/registro-cliente"
            className="block w-full bg-yellow-400 hover:bg-yellow-500 text-black text-center font-black text-2xl py-5 rounded-3xl transition hover:scale-105"
          >
            REGISTRARME COMO CLIENTE
          </Link>

          <Link
            href="/registro-chofer"
            className="block w-full bg-zinc-900 border-2 border-yellow-400 hover:bg-zinc-800 text-yellow-400 text-center font-black text-2xl py-5 rounded-3xl transition hover:scale-105"
          >
            REGISTRARME COMO CHOFER
          </Link>
        </div>

        <div className="flex flex-wrap justify-center gap-4 mt-10 text-xs text-zinc-600">
          <Link href="/terminos" className="hover:text-yellow-400 transition">Términos y Condiciones</Link>
          <Link href="/privacidad" className="hover:text-yellow-400 transition">Política de Privacidad</Link>
          <Link href="/contrato-transportista" className="hover:text-yellow-400 transition">Contrato Transportista</Link>
          <a href="mailto:contacto@tilalogistica.com" className="hover:text-yellow-400 transition">Contacto</a>
        </div>
      </section>
    </main>
  );
}