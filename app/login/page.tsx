"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const ingresar = async () => {
    if (!email || !password) {
      alert("Completá email y contraseña");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("usuarios")
        .select("*")
        .eq("email", email.toLowerCase())
        .eq("password", password)
        .single();

      if (error || !data) {
        alert("Email o contraseña incorrectos");
        setLoading(false);
        return;
      }

      // Validación de aprobación para choferes
      if (data.rol === "chofer") {
        const aprobacion = data.estado_aprobacion || "pendiente";

        if (aprobacion === "pendiente") {
          alert("Tu cuenta de chofer está pendiente de aprobación por el administrador. Te avisaremos cuando esté habilitada.");
          setLoading(false);
          return;
        }

        if (aprobacion === "rechazado") {
          alert("Tu cuenta de chofer fue rechazada. Contactá al administrador para más información.");
          setLoading(false);
          return;
        }

        if (aprobacion === "suspendido") {
          alert("Tu cuenta de chofer está suspendida. Contactá al administrador para reactivarla.");
          setLoading(false);
          return;
        }

        // Fallback: validación antigua por estado_validacion
        if (aprobacion !== "aprobado" && data.estado_validacion !== "aprobado") {
          alert("Tu cuenta de chofer todavía está pendiente de validación.");
          setLoading(false);
          return;
        }
      }

      // Guardar en localStorage sin campos sensibles
      const {
        password: _password,
        cuit_cuil,
        antecedentes,
        alias_cbu_cvu,
        titular_cuenta,
        banco_billetera,
        metodo_cobro,
        cnrt_ruta,
        vtv_rto,
        ...usuarioSeguro
      } = data;

      localStorage.setItem("usuario", JSON.stringify(usuarioSeguro));

      if (data.rol === "cliente") {
        router.push("/publicar");
      } else if (data.rol === "chofer") {
        router.push("/panel-chofer");
      } else if (data.rol === "admin") {
        router.push("/admin");
      } else {
        alert("Rol inválido");
      }

    } catch (error) {
      console.log(error);
      alert("Error inesperado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-6 overflow-hidden">
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
              loading
                ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                : "bg-yellow-400 hover:bg-yellow-500 text-black hover:scale-105"
            }`}
          >
            {loading ? "INGRESANDO..." : "INGRESAR"}
          </button>
        </div>

        <p className="text-zinc-500 text-sm tracking-[0.25em] mt-10">
          TU CARGA · NUESTRO COMPROMISO · TU ÉXITO
        </p>

      </section>
    </main>
  );
}