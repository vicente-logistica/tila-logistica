"use client";

import { memo } from "react";

interface HudChoferProps {
  velocidadKmh: number | null;
  bateriaNivel: number | null;
  bateriaDisponible: boolean;
  bateriaCargando?: boolean | null;
}

// Memoizado: sólo depende de 3 valores primitivos (velocidad/batería). Evita que este
// HUD se re-renderice por cambios ajenos del padre (chat, modales, etc.) — sólo
// re-renderiza cuando la velocidad o la batería realmente cambian.
function HudChoferBase({ velocidadKmh, bateriaNivel, bateriaDisponible, bateriaCargando }: HudChoferProps) {
  const velocidadTexto =
    velocidadKmh !== null && velocidadKmh !== undefined && !Number.isNaN(velocidadKmh)
      ? `${Math.round(velocidadKmh)} km/h`
      : "-- km/h";

  const bateriaTexto =
    !bateriaDisponible || bateriaNivel === null
      ? "-- %"
      : `${bateriaNivel}%${bateriaCargando ? " ⚡" : ""}`;

  return (
    <div
      className="absolute z-20 pointer-events-none bg-black/30 backdrop-blur-sm rounded-2xl px-3 py-2 shadow-lg"
      style={{ top: 72, left: 12 }}
    >
      <p className="text-white font-black text-base leading-none tracking-wide">{velocidadTexto}</p>
      <p className="text-zinc-200 text-xs font-bold mt-1 leading-none">🔋 {bateriaTexto}</p>
    </div>
  );
}

export default memo(HudChoferBase);
