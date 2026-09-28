"use client";

import { useEffect, useState } from "react";
import { porcentajeTextoABp, bpAPorcentajeTexto } from "../lib/comisionesFormato";

/**
 * Panel Admin → Comisiones. Lee y guarda las comisiones vigentes vía
 * /api/admin/configuracion/comisiones — el servidor verifica que el usuario sea admin;
 * este componente no decide ningún permiso. Los cambios sólo afectan cargas NUEVAS.
 */
export default function ConfiguracionComisiones({ adminId }: { adminId: string | undefined }) {
  const [cliente, setCliente] = useState("");
  const [chofer, setChofer]   = useState("");
  const [cargando, setCargando]   = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [aviso, setAviso]     = useState<string | null>(null);
  const [exito, setExito]     = useState<string | null>(null);

  const aplicar = (json: { comision_cliente_bp: number; comision_chofer_bp: number; fuente?: string }) => {
    setCliente(bpAPorcentajeTexto(json.comision_cliente_bp));
    setChofer(bpAPorcentajeTexto(json.comision_chofer_bp));
    setAviso(json.fuente === "fallback"
      ? "La configuración todavía no existe en la base: se muestran los valores por defecto (7,50 % / 7,50 %). No se podrá guardar hasta aplicar la migración."
      : null);
  };

  useEffect(() => {
    if (!adminId) { setError("Sesión de administrador no encontrada."); setCargando(false); return; }
    fetch("/api/admin/configuracion/comisiones", { headers: { "x-user-id": adminId } })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Error ${res.status}`);
        aplicar(json);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo leer la configuración"))
      .finally(() => setCargando(false));
  }, [adminId]);

  const bpCliente = porcentajeTextoABp(cliente);
  const bpChofer  = porcentajeTextoABp(chofer);
  const valido = bpCliente !== null && bpChofer !== null;

  const guardar = async () => {
    if (!adminId || !valido || guardando) return;
    setGuardando(true); setError(null); setExito(null);
    try {
      const res = await fetch("/api/admin/configuracion/comisiones", {
        method:  "PUT",
        headers: { "Content-Type": "application/json", "x-user-id": adminId },
        body:    JSON.stringify({ comision_cliente_bp: bpCliente, comision_chofer_bp: bpChofer }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Error ${res.status}`);
      aplicar(json);
      setExito(`Guardado: cliente ${bpAPorcentajeTexto(json.comision_cliente_bp)} % · chofer ${bpAPorcentajeTexto(json.comision_chofer_bp)} %. Se aplica a las cargas nuevas.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  const campo = (etiqueta: string, valor: string, setValor: (v: string) => void, bp: number | null) => (
    <label className="block">
      <span className="text-zinc-400 font-black text-sm">{etiqueta}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="text" inputMode="decimal" value={valor} disabled={cargando || guardando}
          onChange={(e) => { setValor(e.target.value); setExito(null); }}
          className={`w-32 bg-black border rounded-xl px-3 py-2 text-2xl font-black text-white text-right ${bp === null && valor ? "border-red-500" : "border-zinc-600"}`}
        />
        <span className="text-2xl font-black text-zinc-300">%</span>
      </div>
      {bp === null && valor && <span className="text-red-400 text-xs">Entre 0 y 99,99, con hasta 2 decimales (ej.: 7,50 · 4,75).</span>}
    </label>
  );

  return (
    <div className="space-y-5">
      {cargando ? (
        <p className="text-zinc-400 animate-pulse">Cargando configuración…</p>
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            {campo("Comisión cliente", cliente, setCliente, bpCliente)}
            {campo("Comisión chofer", chofer, setChofer, bpChofer)}
          </div>
          <p className="text-zinc-500 text-sm">
            Se aplica a las cargas publicadas a partir de ahora. Las cargas existentes conservan sus montos.
          </p>
          {aviso && <p className="text-orange-300 text-sm bg-orange-900/30 border border-orange-700 rounded-xl p-3">{aviso}</p>}
          {error && <p className="text-red-300 text-sm bg-red-900/30 border border-red-700 rounded-xl p-3">{error}</p>}
          {exito && <p className="text-green-300 text-sm bg-green-900/30 border border-green-700 rounded-xl p-3">{exito}</p>}
          <button
            type="button" onClick={guardar} disabled={!valido || guardando || !!aviso}
            className={`px-6 py-3 rounded-2xl font-black ${valido && !guardando && !aviso ? "bg-yellow-400 text-black hover:bg-yellow-300" : "bg-zinc-800 text-zinc-500 cursor-not-allowed"}`}
          >
            {guardando ? "Guardando…" : "GUARDAR CAMBIOS"}
          </button>
        </>
      )}
    </div>
  );
}
