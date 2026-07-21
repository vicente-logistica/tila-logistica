"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SOPORTE_WHATSAPP = "5491158689383";
const SOPORTE_EMAIL = "contacto@tilalogistica.com";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const ingresar = async () => {
    if (!email || !password) { alert("Completá email y contraseña"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error ?? "Email o contraseña incorrectos");
        return;
      }

      localStorage.setItem("usuario", JSON.stringify(data.usuario));

      const rol = data.usuario?.rol;
      if (rol === "cliente")      router.replace("/panel-cliente");
      else if (rol === "chofer")  router.replace("/panel-chofer");
      else if (rol === "admin")   router.replace("/admin");
      else alert("Rol inválido");

    } catch {
      alert("Error de conexión. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4 py-6 overflow-hidden">
      <section className="w-full max-w-md flex flex-col items-center text-center">

        <img
          src="/logo-tila.png"
          alt="TILA"
          className="w-full max-w-[420px] max-h-[42vh] object-contain mb-8 animate-pulse drop-shadow-[0_0_40px_rgba(250,204,21,0.45)]"
        />

        <p className="text-zinc-400 mb-8 text-lg">Accedé a tu cuenta</p>

        <div className="w-full space-y-5">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 text-white p-4 rounded-2xl outline-none focus:border-yellow-400"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 text-white p-4 rounded-2xl outline-none focus:border-yellow-400"
          />
          <button
            onClick={ingresar}
            disabled={loading}
            className={`w-full font-black text-xl py-5 rounded-3xl transition ${
              loading ? "bg-zinc-700 text-zinc-400 cursor-not-allowed" : "bg-yellow-400 hover:bg-yellow-500 text-black hover:scale-105"
            }`}
          >
            {loading ? "INGRESANDO..." : "INGRESAR"}
          </button>
        </div>

        <p className="text-zinc-500 text-sm tracking-[0.25em] mt-10">
          TU CARGA · NUESTRO COMPROMISO · TU ÉXITO
        </p>

        {/* Soporte TILA */}
        <div className="mt-8 w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-zinc-500 text-xs font-black mb-3">🆘 SOPORTE TILA</p>
          <div className="flex gap-3 justify-center">
            <a href={`https://wa.me/${SOPORTE_WHATSAPP}`} target="_blank" rel="noreferrer"
              className="bg-green-600 hover:bg-green-500 text-white font-black px-4 py-2 rounded-xl text-sm">
              💬 WhatsApp
            </a>
            <a href={`mailto:${SOPORTE_EMAIL}`}
              className="bg-zinc-700 hover:bg-zinc-600 text-white font-black px-4 py-2 rounded-xl text-sm">
              📧 Email
            </a>
          </div>
        </div>

      </section>
    </main>
  );
}