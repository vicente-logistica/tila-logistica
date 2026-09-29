"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { esCambioDelAdmin } from "../lib/comisionesFormato";
import { textoARadioKm } from "../lib/configuracionRadio";

/**
 * Panel Admin → Configuración → RADIO DE MATCHING. Un campo de km (entero ≥ 1, sin tope)
 * que lee y guarda /api/admin/configuracion/radio — el servidor exige sesión firmada y rol
 * admin; este componente no decide permisos. Mismas protecciones que Comisiones: sólo se
 * aceptan cambios tecleados/pegados por el admin, GUARDAR exige un cambio real y una
 * confirmación, y después de guardar se relee el valor.
 */
export default function ConfiguracionRadio({ adminId }: { adminId: string | undefined }) {
  const [valor, setValor]       = useState("");
  const [guardado, setGuardado] = useState<number | null>(null);
  const [editadoPorAdmin, setEditadoPorAdmin] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [cargando, setCargando]   = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [aviso, setAviso]   = useState<string | null>(null);
  const [exito, setExito]   = useState<string | null>(null);
  const [ignorado, setIgnorado] = useState<string | null>(null);
  const interaccion = useRef(false);

  const aplicarServidor = (json: { radio_matching_km: number; fuente?: string }) => {
    setGuardado(json.radio_matching_km);
    setValor(String(json.radio_matching_km));
    setEditadoPorAdmin(false);
    setConfirmando(false);
    setAviso(json.fuente === "fallback"
      ? `Configuración pendiente: la columna del radio todavía no existe en la base. Se usa el valor por defecto (${json.radio_matching_km} km). No se podrá guardar hasta aplicar la migración.`
      : null);
  };

  const cargar = useCallback(async () => {
    if (!adminId) { setError("Sesión de administrador no encontrada."); setCargando(false); return; }
    try {
      const res = await fetch("/api/admin/configuracion/radio", { headers: { "x-user-id": adminId } });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Error ${res.status}`);
      aplicarServidor(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el radio");
    } finally {
      setCargando(false);
    }
  }, [adminId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const km = textoARadioKm(valor);
  const errorCampo = valor && km === null ? "Número entero de km, mayor o igual a 1 (ej.: 35 · 65 · 100 · 1000)." : null;
  const huboCambio = guardado !== null && km !== null && km !== guardado;
  const puedeGuardar = !aviso && !cargando && !guardando && editadoPorAdmin && huboCambio;

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const nativo = e.nativeEvent as InputEvent;
    let autofill = false;
    try { autofill = e.target.matches(":-webkit-autofill"); } catch { /* navegador sin ese selector */ }
    if (!esCambioDelAdmin({ huboInteraccion: interaccion.current, inputType: nativo?.inputType, autofill })) {
      setIgnorado("Se ignoró un cambio automático del navegador en el radio. Escribí el valor a mano.");
      return;
    }
    setValor(e.target.value);
    setEditadoPorAdmin(true);
    setConfirmando(false);
    setExito(null);
    setIgnorado(null);
  };
  const marcar = () => { interaccion.current = true; };

  const confirmarGuardado = async () => {
    if (!adminId || !puedeGuardar || km === null) return;
    setGuardando(true); setError(null); setExito(null);
    try {
      const res = await fetch("/api/admin/configuracion/radio", {
        method:  "PUT",
        headers: { "Content-Type": "application/json", "x-user-id": adminId },
        body:    JSON.stringify({ radio_matching_km: km }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Error ${res.status}`);
      await cargar(); // releer lo que efectivamente quedó en la base
      setExito(`Guardado: radio de matching ${json.radio_matching_km} km. Se aplica a las nuevas ofertas y aceptaciones.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
      setConfirmando(false);
    }
  };

  if (cargando) return <p className="text-zinc-400 animate-pulse">Cargando radio…</p>;

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="text-zinc-400 font-black text-sm">Radio actual</span>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="text" inputMode="numeric" name="tila_admin_radio_matching_km"
            autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true"
            value={valor} disabled={guardando}
            onKeyDown={marcar} onPaste={marcar} onCut={marcar} onDrop={marcar} onCompositionStart={marcar}
            onBlur={() => { interaccion.current = false; }}
            onChange={onChange}
            className={`w-40 shrink-0 bg-black border rounded-xl px-3 py-2 text-2xl font-black text-white text-right tabular-nums ${errorCampo ? "border-red-500" : "border-zinc-600"}`}
          />
          <span className="text-2xl font-black text-zinc-300">km</span>
        </div>
        {errorCampo && <span className="text-red-400 text-xs">{errorCampo}</span>}
      </label>
      <p className="text-zinc-500 text-sm">
        Distancia máxima por ruta desde el chofer hasta el punto de retiro. Afecta las nuevas ofertas y aceptaciones; no modifica viajes ya aceptados.
        Radios muy grandes aumentan las consultas a Google Directions.
      </p>
      {aviso && <p className="text-orange-300 text-sm bg-orange-900/30 border border-orange-700 rounded-xl p-3">{aviso}</p>}
      {ignorado && <p className="text-orange-300 text-sm bg-orange-900/30 border border-orange-700 rounded-xl p-3">{ignorado}</p>}
      {error && <p className="text-red-300 text-sm bg-red-900/30 border border-red-700 rounded-xl p-3">{error}</p>}
      {exito && <p className="text-green-300 text-sm bg-green-900/30 border border-green-700 rounded-xl p-3">{exito}</p>}

      {confirmando && guardado !== null && km !== null ? (
        <div className="bg-black border border-yellow-400 rounded-2xl p-4 space-y-3">
          <p className="text-white font-black">Vas a cambiar el radio de matching:</p>
          <p className="text-zinc-300 text-sm">{guardado} km → <span className="text-yellow-400 font-black">{km} km</span></p>
          <p className="text-zinc-500 text-xs">Afecta sólo a nuevas ofertas y aceptaciones.</p>
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
        <button type="button" onClick={() => setConfirmando(true)} disabled={!puedeGuardar}
          className={`px-6 py-3 rounded-2xl font-black ${puedeGuardar ? "bg-yellow-400 text-black hover:bg-yellow-300" : "bg-zinc-800 text-zinc-500 cursor-not-allowed"}`}>
          GUARDAR CAMBIOS
        </button>
      )}
    </div>
  );
}
