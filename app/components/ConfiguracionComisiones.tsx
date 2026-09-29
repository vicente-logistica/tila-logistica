"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { porcentajeTextoABp, bpAPorcentajeTexto, esCambioDelAdmin } from "../lib/comisionesFormato";

type Campo = "cliente" | "chofer";
const NOMBRE: Record<Campo, string> = { cliente: "Comisión cliente", chofer: "Comisión chofer" };
const CHOFER_BP_MAXIMO = 10000; // 100 %: con más, el pago al chofer sería negativo

/**
 * Panel Admin → Comisiones. Dos campos de porcentaje libres (coma o punto, hasta 2
 * decimales). Lee y guarda vía /api/admin/configuracion/comisiones — el servidor verifica
 * que el usuario sea admin y valida los valores; este componente no decide permisos.
 *
 * Protección contra cambios que no hizo el admin: un campo sólo acepta cambios después
 * de una interacción real sobre él (teclado, pegar, IME). Autocompletado del navegador o
 * cambios sin interacción se ignoran y el campo conserva el valor leído del servidor.
 * Además, GUARDAR exige un cambio real respecto de lo guardado y una confirmación.
 */
export default function ConfiguracionComisiones({ adminId }: { adminId: string | undefined }) {
  const [valores, setValores]   = useState<Record<Campo, string>>({ cliente: "", chofer: "" });
  const [guardado, setGuardado] = useState<Record<Campo, number> | null>(null);
  const [editadoPorAdmin, setEditadoPorAdmin] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [cargando, setCargando]   = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [aviso, setAviso]   = useState<string | null>(null);
  const [exito, setExito]   = useState<string | null>(null);
  const [ignorado, setIgnorado] = useState<string | null>(null);
  // true mientras el admin interactúa con ESE campo (se apaga al salir del campo).
  const interaccion = useRef<Record<Campo, boolean>>({ cliente: false, chofer: false });

  const aplicarServidor = (json: { comision_cliente_bp: number; comision_chofer_bp: number; fuente?: string }) => {
    setGuardado({ cliente: json.comision_cliente_bp, chofer: json.comision_chofer_bp });
    setValores({ cliente: bpAPorcentajeTexto(json.comision_cliente_bp), chofer: bpAPorcentajeTexto(json.comision_chofer_bp) });
    setEditadoPorAdmin(false);
    setConfirmando(false);
    setAviso(json.fuente === "fallback"
      ? `La configuración todavía no existe en la base: se muestran los valores por defecto (${bpAPorcentajeTexto(json.comision_cliente_bp)} % / ${bpAPorcentajeTexto(json.comision_chofer_bp)} %). No se podrá guardar hasta aplicar la migración.`
      : null);
  };

  const cargar = useCallback(async () => {
    if (!adminId) { setError("Sesión de administrador no encontrada."); setCargando(false); return; }
    try {
      const res = await fetch("/api/admin/configuracion/comisiones", { headers: { "x-user-id": adminId } });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Error ${res.status}`);
      aplicarServidor(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la configuración");
    } finally {
      setCargando(false);
    }
  }, [adminId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const bp: Record<Campo, number | null> = {
    cliente: porcentajeTextoABp(valores.cliente),
    chofer:  porcentajeTextoABp(valores.chofer),
  };
  const errorCampo: Record<Campo, string | null> = {
    cliente: valores.cliente && bp.cliente === null ? "Número ≥ 0 con hasta 2 decimales (ej.: 7,50 · 0,05 · 100)." : null,
    chofer:  valores.chofer && bp.chofer === null ? "Número ≥ 0 con hasta 2 decimales (ej.: 7,50 · 0,05 · 100)."
      : bp.chofer !== null && bp.chofer > CHOFER_BP_MAXIMO ? "Máximo 100 %: con más, el pago al chofer sería negativo." : null,
  };
  const valido = bp.cliente !== null && bp.chofer !== null && !errorCampo.cliente && !errorCampo.chofer;
  const huboCambio = !!guardado && valido && (bp.cliente !== guardado.cliente || bp.chofer !== guardado.chofer);
  const puedeGuardar = !aviso && !cargando && !guardando && editadoPorAdmin && huboCambio;

  const onChangeCampo = (campo: Campo) => (e: ChangeEvent<HTMLInputElement>) => {
    const nativo = e.nativeEvent as InputEvent;
    let autofill = false;
    try { autofill = e.target.matches(":-webkit-autofill"); } catch { /* navegador sin ese selector */ }
    if (!esCambioDelAdmin({ huboInteraccion: interaccion.current[campo], inputType: nativo?.inputType, autofill })) {
      // No se actualiza el estado: React restaura el valor controlado en el input.
      setIgnorado(`Se ignoró un cambio automático del navegador en "${NOMBRE[campo]}". Escribí el valor a mano.`);
      return;
    }
    setValores(v => ({ ...v, [campo]: e.target.value }));
    setEditadoPorAdmin(true);
    setConfirmando(false);
    setExito(null);
    setIgnorado(null);
  };

  const marcarInteraccion = (campo: Campo) => () => { interaccion.current[campo] = true; };
  const finInteraccion = (campo: Campo) => () => { interaccion.current[campo] = false; };

  const confirmarGuardado = async () => {
    if (!adminId || !puedeGuardar) return;
    setGuardando(true); setError(null); setExito(null);
    try {
      const res = await fetch("/api/admin/configuracion/comisiones", {
        method:  "PUT",
        headers: { "Content-Type": "application/json", "x-user-id": adminId },
        body:    JSON.stringify({ comision_cliente_bp: bp.cliente, comision_chofer_bp: bp.chofer }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Error ${res.status}`);
      await cargar(); // releer lo que efectivamente quedó en la base
      setExito(`Guardado: cliente ${bpAPorcentajeTexto(json.comision_cliente_bp)} % · chofer ${bpAPorcentajeTexto(json.comision_chofer_bp)} %. Se aplica a las cargas nuevas.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
      setConfirmando(false);
    }
  };

  const campo = (c: Campo) => (
    <label className="block">
      <span className="text-zinc-400 font-black text-sm">{NOMBRE[c]} %</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="text" inputMode="decimal" name={`tila_admin_comision_${c}_pct`}
          autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true"
          value={valores[c]} disabled={cargando || guardando}
          onKeyDown={marcarInteraccion(c)} onPaste={marcarInteraccion(c)} onCut={marcarInteraccion(c)}
          onDrop={marcarInteraccion(c)} onCompositionStart={marcarInteraccion(c)} onBlur={finInteraccion(c)}
          onChange={onChangeCampo(c)}
          className={`w-40 shrink-0 bg-black border rounded-xl px-3 py-2 text-2xl font-black text-white text-right tabular-nums ${errorCampo[c] ? "border-red-500" : "border-zinc-600"}`}
        />
        <span className="text-2xl font-black text-zinc-300">%</span>
      </div>
      {errorCampo[c] && <span className="text-red-400 text-xs">{errorCampo[c]}</span>}
    </label>
  );

  return (
    <div className="space-y-5">
      {cargando ? (
        <p className="text-zinc-400 animate-pulse">Cargando configuración…</p>
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            {campo("cliente")}
            {campo("chofer")}
          </div>
          <p className="text-zinc-500 text-sm">
            Se aplica a las cargas publicadas a partir de ahora. Las cargas existentes conservan sus montos.
          </p>
          {aviso && <p className="text-orange-300 text-sm bg-orange-900/30 border border-orange-700 rounded-xl p-3">{aviso}</p>}
          {ignorado && <p className="text-orange-300 text-sm bg-orange-900/30 border border-orange-700 rounded-xl p-3">{ignorado}</p>}
          {error && <p className="text-red-300 text-sm bg-red-900/30 border border-red-700 rounded-xl p-3">{error}</p>}
          {exito && <p className="text-green-300 text-sm bg-green-900/30 border border-green-700 rounded-xl p-3">{exito}</p>}

          {confirmando && guardado && bp.cliente !== null && bp.chofer !== null ? (
            <div className="bg-black border border-yellow-400 rounded-2xl p-4 space-y-3">
              <p className="text-white font-black">Vas a cambiar las comisiones:</p>
              <p className="text-zinc-300 text-sm">
                Cliente {bpAPorcentajeTexto(guardado.cliente)} % → <span className="text-yellow-400 font-black">{bpAPorcentajeTexto(bp.cliente)} %</span>
                {" · "}
                Chofer {bpAPorcentajeTexto(guardado.chofer)} % → <span className="text-yellow-400 font-black">{bpAPorcentajeTexto(bp.chofer)} %</span>
              </p>
              <p className="text-zinc-500 text-xs">Afecta sólo a las cargas que se publiquen después de guardar.</p>
              <div className="flex gap-3">
                <button type="button" onClick={confirmarGuardado} disabled={!puedeGuardar}
                  className="px-6 py-3 rounded-2xl font-black bg-yellow-400 text-black hover:bg-yellow-300 disabled:bg-zinc-800 disabled:text-zinc-500">
                  {guardando ? "Guardando…" : "CONFIRMAR"}
                </button>
                <button type="button" onClick={() => setConfirmando(false)} disabled={guardando}
                  className="px-6 py-3 rounded-2xl font-black bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button" onClick={() => setConfirmando(true)} disabled={!puedeGuardar}
              className={`px-6 py-3 rounded-2xl font-black ${puedeGuardar ? "bg-yellow-400 text-black hover:bg-yellow-300" : "bg-zinc-800 text-zinc-500 cursor-not-allowed"}`}
            >
              GUARDAR CAMBIOS
            </button>
          )}
        </>
      )}
    </div>
  );
}
