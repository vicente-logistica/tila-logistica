"use client";

import { useEffect, useState } from "react";
import { useProtegerRuta } from "../hooks/useProtegerRuta";

export default function BilleteraChoferPage() {
  const { autorizado } = useProtegerRuta("chofer");

  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [saldo, setSaldo] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [sinSesion, setSinSesion] = useState(false);

  const cargarBilletera = async () => {
    try {
      const usuarioGuardado = localStorage.getItem("usuario");

      if (!usuarioGuardado) {
        setSinSesion(true);
        return;
      }

      const usuario = JSON.parse(usuarioGuardado);

      if (!usuario?.id) {
        setSinSesion(true);
        return;
      }

      const res = await fetch("/api/chofer/billetera", {
        headers: { "x-user-id": usuario.id },
      });

      if (!res.ok) {
        console.log("[billetera] error HTTP:", res.status);
        alert("Error cargando billetera");
        return;
      }

      const { data } = await res.json();

      setMovimientos(data || []);

      const total =
        (data || []).reduce((acc: number, item: any) => {
          return acc + Number(item.monto || 0);
        }, 0);

      setSaldo(total);
    } catch (error) {
      console.log("Error inesperado en billetera:", error);
    } finally {
      // Garantiza que el estado de carga se limpia siempre
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarBilletera();

    // Polling de respaldo cada 5 segundos para reflejar nuevos pagos automáticamente
    const intervalo = setInterval(() => {
      cargarBilletera();
    }, 5000);

    return () => clearInterval(intervalo);
  }, []);

  if (!autorizado) return null;

  if (cargando) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <h1 className="text-4xl font-black text-yellow-400 animate-pulse">
          Cargando billetera...
        </h1>
      </main>
    );
  }

  if (sinSesion) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 text-center max-w-md">
          <h2 className="text-3xl font-black text-yellow-400 mb-4">
            Sesión no encontrada
          </h2>
          <p className="text-zinc-400 mb-6">
            Tenés que iniciar sesión para ver tu billetera.
          </p>
          <button
            onClick={() => (window.location.href = "/")}
            className="bg-yellow-400 hover:bg-yellow-500 text-black font-black px-8 py-4 rounded-2xl"
          >
            Ir al inicio
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <section className="max-w-5xl mx-auto">

      <div className="bg-green-600 rounded-3xl p-8 mb-8 shadow-2xl border-4 border-white">
  <div className="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <p className="text-2xl font-bold mb-2">
        💼 SALDO DISPONIBLE
      </p>

      <h1 className="text-6xl font-black text-yellow-300">
        ${saldo.toLocaleString()}
      </h1>
    </div>

    <button
      onClick={() => {
        localStorage.clear();
        window.location.href = "/login";
      }}
      className="bg-red-700 hover:bg-red-600 border border-red-500 hover:border-red-400 text-white font-black text-sm px-5 py-3 rounded-2xl shadow-xl transition-all duration-200"
    >
      ⛔ CERRAR SESIÓN
    </button>
  </div>
</div>

        <div className="bg-zinc-900 rounded-3xl p-8 border-4 border-yellow-400">
          <h2 className="text-4xl font-black text-yellow-400 mb-6">
            Historial de ganancias
          </h2>

          {movimientos.length === 0 ? (
            <p className="text-zinc-500 text-xl">
              Todavía no tenés movimientos en tu billetera.
            </p>
          ) : (
            <div className="space-y-4">
              {movimientos.map((mov) => (
                <div
                  key={mov.id}
                  className="bg-zinc-800 rounded-2xl p-5 border border-zinc-700"
                >
                  <p className="text-xl font-bold text-green-400">
                    + ${Number(mov.monto || 0).toLocaleString()}
                  </p>

                  <p className="text-zinc-300">
                    Viaje ID: {mov.viaje_id}
                  </p>

                  <p className="text-zinc-500 text-sm">
                    {new Date(mov.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}