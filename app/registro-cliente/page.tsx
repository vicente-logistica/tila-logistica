"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { useRouter } from "next/navigation";

export default function RegistroClientePage() {

  const router = useRouter();

  const [cuit, setCuit] = useState("");
  const [razon, setRazon] = useState("");
  const [contacto, setContacto] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [direccion, setDireccion] = useState("");
  const [deposito, setDeposito] = useState("");
  const [loading, setLoading] = useState(false);

  const registrarCliente = async () => {

    if (!email || !password) {
      alert("Completá email y contraseña");
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("usuarios")
      .insert([
        {
          nombre: razon,
          email,
          password,
          telefono,
          rol: "cliente",
          acepta_terminos: true,
          cuit,
          contacto,
          direccion,
          deposito,
        }
      ]);

    setLoading(false);

    if (error) {
      alert("Error: " + error.message);
      return;
    }

    alert("Cliente registrado correctamente");

    router.push("/login");
  };

  return (
    <main className="min-h-screen bg-black text-white p-8">

      <div className="max-w-3xl mx-auto">

        <Link href="/login" className="text-zinc-400 hover:text-white">
          ← Volver
        </Link>

        <h1 className="text-4xl font-black text-yellow-400 mt-8">
          Registro de cliente
        </h1>

        <p className="text-zinc-400 mt-3 mb-8">
          Cargá los datos de la empresa para poder publicar cargas.
        </p>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-5">

          <input
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="CUIT"
          />

          <input
            value={razon}
            onChange={(e) => setRazon(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Razón social"
          />

          <input
            value={contacto}
            onChange={(e) => setContacto(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Responsable / contacto"
          />

          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Teléfono"
          />

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Email"
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Contraseña"
          />

          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Dirección fiscal"
          />

          <input
            value={deposito}
            onChange={(e) => setDeposito(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Depósito / punto de carga principal"
          />

          <select className="w-full p-4 rounded-xl bg-black border border-zinc-700">
            <option>Medio de pago preferido</option>
            <option>Tarjeta</option>
            <option>Mercado Pago</option>
            <option>Transferencia bancaria</option>
          </select>

          <button
            onClick={registrarCliente}
            disabled={loading}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xl py-4 rounded-2xl"
          >
            {loading ? "Guardando..." : "Guardar datos de cliente"}
          </button>

        </div>
      </div>
    </main>
  );
}