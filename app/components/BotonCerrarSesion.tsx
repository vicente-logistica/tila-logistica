"use client";

export default function BotonCerrarSesion() {
  const cerrarSesion = () => {
    localStorage.clear();
    window.location.href = "/login";
  };
  return (
    <button
      onClick={cerrarSesion}
      className="border border-zinc-600 hover:border-red-500 text-zinc-400 hover:text-red-500 font-black text-sm px-4 py-2 rounded-xl transition-all duration-200"
    >
      Cerrar sesion
    </button>
  );
}
