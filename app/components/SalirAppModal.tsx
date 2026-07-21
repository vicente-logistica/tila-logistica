"use client";

import { useEffect, useState } from "react";
import { registrarAperturaSalirApp, cerrarSesionYSalir } from "../utils/salirApp";

/** Modal global de confirmación de cierre de sesión — montado una sola vez en el layout. */
export default function SalirAppModal() {
  const [mostrar, setMostrar] = useState(false);

  useEffect(() => {
    return registrarAperturaSalirApp(() => setMostrar(true));
  }, []);

  if (!mostrar) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6">
      <div className="bg-zinc-900 border border-yellow-400 rounded-3xl p-6 text-center shadow-2xl max-w-sm w-full">
        <p className="text-yellow-400 font-black text-lg mb-2">¿Querés cerrar sesión y salir de TILA?</p>
        <p className="text-zinc-400 text-sm mb-6">
          Vas a cerrar tu sesión actual. Vas a necesitar volver a iniciar sesión para continuar.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMostrar(false)}
            className="flex-1 py-2.5 rounded-xl font-black text-sm bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition">
            Cancelar
          </button>
          <button type="button" onClick={() => cerrarSesionYSalir()}
            className="flex-1 py-2.5 rounded-xl font-black text-sm bg-yellow-400 text-black hover:bg-yellow-300 transition">
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
