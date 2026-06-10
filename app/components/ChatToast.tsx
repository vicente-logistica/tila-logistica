"use client";

/**
 * Toast compacto estilo nube para notificaciones de chat.
 * Reemplaza el cartel amarillo gigante.
 * Se posiciona top-center, no bloquea la UI.
 */
interface ChatToastProps {
  texto: string | null;
}

export default function ChatToast({ texto }: ChatToastProps) {
  if (!texto) return null;

  // Separar "Icono Rol · Acción" → dos líneas si hay " · "
  const partes = texto.split(" · ");
  const linea1 = partes[0] ?? texto;
  const linea2 = partes[1] ?? null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9998] pointer-events-none">
      <div className="flex items-center gap-2.5 bg-yellow-300 border border-yellow-400 shadow-lg px-4 py-2.5 rounded-2xl max-w-[280px] min-w-[180px]">
        {/* Punto rojo indicador */}
        <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 animate-pulse" />
        <div className="min-w-0">
          <p className="text-red-700 font-black text-xs leading-tight truncate">{linea1}</p>
          {linea2 && (
            <p className="text-red-600 text-[11px] leading-tight mt-0.5">{linea2}</p>
          )}
        </div>
      </div>
    </div>
  );
}
