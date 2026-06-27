"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegistroClientePage() {
  const router = useRouter();

  const [nombre,          setNombre]          = useState("");
  const [email,           setEmail]           = useState("");
  const [telefono,        setTelefono]        = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmar,       setConfirmar]       = useState("");
  const [aceptaTerminos,  setAceptaTerminos]  = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  const registrar = async () => {
    setError(null);

    if (!nombre.trim())       return setError("El nombre es obligatorio");
    if (!email.trim())        return setError("El email es obligatorio");
    if (password.length < 6)  return setError("La contraseña debe tener al menos 6 caracteres");
    if (password !== confirmar) return setError("Las contraseñas no coinciden");
    if (!aceptaTerminos)      return setError("Debés aceptar los Términos y Condiciones");

    setLoading(true);
    try {
      const res = await fetch("/api/usuarios/registro-cliente", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ nombre, email, password, telefono, acepta_terminos: true }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Error al crear la cuenta");
        return;
      }

      // Guardar solo datos seguros en localStorage (sin password)
      localStorage.setItem("usuario", JSON.stringify(data.usuario));
      router.push("/panel-cliente");

    } catch {
      setError("Error de conexión. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4 py-8">
      <section className="w-full max-w-md flex flex-col items-center">

        <img
          src="/logo-tila.png"
          alt="TILA"
          className="w-full max-w-[320px] max-h-[30vh] object-contain mb-8 animate-pulse drop-shadow-[0_0_40px_rgba(250,204,21,0.45)]"
        />

        <h1 className="text-3xl font-black text-yellow-400 mb-1">Crear cuenta</h1>
        <p className="text-zinc-500 text-sm mb-8">Registrate como cliente para publicar cargas</p>

        <div className="w-full space-y-4">
          <input
            type="text"
            placeholder="Nombre completo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 text-white p-4 rounded-2xl outline-none focus:border-yellow-400"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 text-white p-4 rounded-2xl outline-none focus:border-yellow-400"
          />
          <input
            type="tel"
            placeholder="Teléfono (opcional)"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 text-white p-4 rounded-2xl outline-none focus:border-yellow-400"
          />
          <input
            type="password"
            placeholder="Contraseña (mínimo 6 caracteres)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 text-white p-4 rounded-2xl outline-none focus:border-yellow-400"
          />
          <input
            type="password"
            placeholder="Confirmar contraseña"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 text-white p-4 rounded-2xl outline-none focus:border-yellow-400"
          />

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={aceptaTerminos}
              onChange={(e) => setAceptaTerminos(e.target.checked)}
              className="mt-1 accent-yellow-400 w-4 h-4 flex-shrink-0"
            />
            <span className="text-zinc-400 text-sm">
              Acepto los{" "}
              <Link href="/terminos" target="_blank" className="text-yellow-400 hover:underline">Términos y Condiciones</Link>
              {" "}y la{" "}
              <Link href="/privacidad" target="_blank" className="text-yellow-400 hover:underline">Política de Privacidad</Link>
            </span>
          </label>

          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 text-sm rounded-2xl px-4 py-3">
              {error}
            </div>
          )}

          <button
            onClick={registrar}
            disabled={loading}
            className={`w-full font-black text-xl py-5 rounded-3xl transition ${
              loading
                ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                : "bg-yellow-400 hover:bg-yellow-500 text-black hover:scale-105"
            }`}
          >
            {loading ? "CREANDO CUENTA..." : "CREAR CUENTA"}
          </button>
        </div>

        <p className="text-zinc-600 text-sm mt-8">
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="text-yellow-400 hover:underline">Ingresá acá</Link>
        </p>

      </section>
    </main>
  );
}
