"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { esCambioDelAdmin } from "../lib/comisionesFormato";
import { textoAKmEntero } from "../lib/configuracionOperativa";

/**
 * Panel Admin → CONFIGURACIÓN OPERATIVA: radio normal de matching, activar/desactivar
 * Vuelta a Casa y a cuántos km del destino empezar a buscar oportunidades. Lee y guarda
 * /api/admin/configuracion/operativa (sesión firmada + rol admin verificados en el servidor;
 * este componente no decide permisos). Mismas protecciones que Comisiones: sólo cambios del
 * admin (no autocompletado), GUARDAR exige un cambio real y una confirmación, y se relee.
 */

type CampoKm = "radio" | "inicio";
interface Guardado { radio: number; habilitada: boolean; inicio: number }

export default function ConfiguracionOperativa({ adminId }: { adminId: string | undefined }) {
  const [valores, setValores] = useState<Record<CampoKm, string>>({ radio: "", inicio: "" });
  const [habilitada, setHabilitada] = useState(true);
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const [editadoPorAdmin, setEditadoPorAdmin] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [ignorado, setIgnorado] = useState<string | null>(null);
  const interaccion = useRef<Record<CampoKm, boolean>>({ radio: false, inicio: false });

  const aplicarServidor = (j: { radio_matching_km: number; vuelta_casa_habilitada: boolean; vuelta_casa_inicio_km: number; fuente?: string }) => {
    setGuardado({ radio: j.radio_matching_km, habilitada: j.vuelta_casa_habilitada, inicio: j.vuelta_casa_inicio_km });
    setValores({ radio: String(j.radio_matching_km), inicio: String(j.vuelta_casa_inicio_km) });
    setHabilitada(j.vuelta_casa_habilitada);
    setEditadoPorAdmin(false);
    setConfirmando(false);
    setAviso(j.fuente === "fallback"
      ? "Configuración pendiente: falta aplicar la migración de Vuelta a Casa. Se usan los valores por defecto donde corresponde. No se podrá guardar hasta aplicarla."
      : null);
  };

  const cargar = useCallback(async () => {
    if (!adminId) { setError("Sesión de administrador no encontrada."); setCargando(false); return; }
    try {
      const res = await fetch("/api/admin/configuracion/operativa", { headers: { "x-user-id": adminId } });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Error ${res.status}`);
      aplicarServidor(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la configuración operativa");
    } finally {
      setCargando(false);
    }
  }, [adminId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const km: Record<CampoKm, number | null> = { radio: textoAKmEntero(valores.radio), inicio: textoAKmEntero(valores.inicio) };
  const valido = km.radio !== null && km.inicio !== null;
  const huboCambio = !!guardado && valido && (km.radio !== guardado.radio || km.inicio !== guardado.inicio || habilitada !== guardado.habilitada);
  const puedeGuardar = !aviso && !cargando && !guardando && editadoPorAdmin && huboCambio;

  const onChangeKm = (campo: CampoKm) => (e: ChangeEvent<HTMLInputElement>) => {
    const nativo = e.nativeEvent as InputEvent;
    let autofill = false;
    try { autofill = e.target.matches(":-webkit-autofill"); } catch { /* sin ese selector */ }
    if (!esCambioDelAdmin({ huboInteraccion: interaccion.current[campo], inputType: nativo?.inputType, autofill })) {
      setIgnorado("Se ignoró un cambio automático del navegador. Escribí el valor a mano.");
      return;
    }
    setValores(v => ({ ...v, [campo]: e.target.value }));
    setEditadoPorAdmin(true); setConfirmando(false); setExito(null); setIgnorado(null);
  };
  const marcar = (campo: CampoKm) => () => { interaccion.current[campo] = true; };
  const soltar = (campo: CampoKm) => () => { interaccion.current[campo] = false; };

  const confirmarGuardado = async () => {
    if (!adminId || !puedeGuardar || !valido) return;
    setGuardando(true); setError(null); setExito(null);
    try {
      const res = await fetch("/api/admin/configuracion/operativa", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-user-id": adminId },
        body: JSON.stringify({ radio_matching_km: km.radio, vuelta_casa_habilitada: habilitada, vuelta_casa_inicio_km: km.inicio }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Error ${res.status}`);
      await cargar(); // releer lo que efectivamente quedó en la base
      setExito(`Guardado: radio ${json.radio_matching_km} km · Vuelta a Casa ${json.vuelta_casa_habilitada ? "activada" : "desactivada"} · inicio a ${json.vuelta_casa_inicio_km} km del destino.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false); setConfirmando(false);
    }
  };

  if (cargando) return <p className="text-zinc-400 animate-pulse">Cargando configuración operativa…</p>;

  const campoKm = (c: CampoKm, etiqueta: string, ayuda: string) => {
    const invalido = valores[c] && km[c] === null;
    return (
      <label className="block">
        <span className="text-zinc-400 font-black text-sm">{etiqueta}</span>
        <div className="mt-1 flex items-center gap-2">
          <input type="text" inputMode="numeric" name={`tila_admin_operativa_${c}_km`}
            autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true"
            value={valores[c]} disabled={guardando}
            onKeyDown={marcar(c)} onPaste={marcar(c)} onCut={marcar(c)} onDrop={marcar(c)} onCompositionStart={marcar(c)} onBlur={soltar(c)}
            onChange={onChangeKm(c)}
            className={`w-40 shrink-0 bg-black border rounded-xl px-3 py-2 text-2xl font-black text-white text-right tabular-nums ${invalido ? "border-red-500" : "border-zinc-600"}`} />
          <span className="text-2xl font-black text-zinc-300">km</span>
        </div>
        <span className={`text-xs ${invalido ? "text-red-400" : "text-zinc-500"}`}>{invalido ? "Número entero de km, mayor que 0." : ayuda}</span>
      </label>
    );
  };

  return (
    <div className="space-y-5">
      {campoKm("radio", "Radio de cargas cercanas", "Distancia máxima por ruta hasta el retiro. Usada por el listado, la alarma y la aceptación. Radios grandes aumentan consultas a Google.")}

      <div>
        <span className="text-zinc-400 font-black text-sm">Vuelta a Casa</span>
        <div className="mt-1 flex items-center gap-3">
          <button type="button" disabled={guardando}
            onClick={(e) => { if (!e.nativeEvent.isTrusted) return; setHabilitada(v => !v); setEditadoPorAdmin(true); setConfirmando(false); setExito(null); }}
            className={`px-4 py-2 rounded-xl font-black ${habilitada ? "bg-green-600 text-black" : "bg-zinc-800 text-zinc-300 border border-zinc-600"}`}>
            {habilitada ? "ACTIVADA" : "DESACTIVADA"}
          </button>
          <span className="text-zinc-500 text-xs">Sólo recomienda cargas de regreso; no reserva ni asigna.</span>
        </div>
      </div>

      {campoKm("inicio", "Comenzar a buscar oportunidades a", "Se empiezan a buscar cargas de regreso cuando falten esos km (o menos) para llegar al destino.")}

      {aviso && <p className="text-orange-300 text-sm bg-orange-900/30 border border-orange-700 rounded-xl p-3">{aviso}</p>}
      {ignorado && <p className="text-orange-300 text-sm bg-orange-900/30 border border-orange-700 rounded-xl p-3">{ignorado}</p>}
      {error && <p className="text-red-300 text-sm bg-red-900/30 border border-red-700 rounded-xl p-3">{error}</p>}
      {exito && <p className="text-green-300 text-sm bg-green-900/30 border border-green-700 rounded-xl p-3">{exito}</p>}

      {confirmando && guardado && valido ? (
        <div className="bg-black border border-yellow-400 rounded-2xl p-4 space-y-2">
          <p className="text-white font-black">Vas a cambiar la configuración operativa:</p>
          <p className="text-zinc-300 text-sm">Radio {guardado.radio} km → <span className="text-yellow-400 font-black">{km.radio} km</span></p>
          <p className="text-zinc-300 text-sm">Vuelta a Casa {guardado.habilitada ? "activada" : "desactivada"} → <span className="text-yellow-400 font-black">{habilitada ? "activada" : "desactivada"}</span></p>
          <p className="text-zinc-300 text-sm">Inicio {guardado.inicio} km → <span className="text-yellow-400 font-black">{km.inicio} km</span></p>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={confirmarGuardado} disabled={!puedeGuardar}
              className="px-6 py-3 rounded-2xl font-black bg-yellow-400 text-black hover:bg-yellow-300 disabled:bg-zinc-800 disabled:text-zinc-500">
              {guardando ? "Guardando…" : "CONFIRMAR"}
            </button>
            <button type="button" onClick={() => setConfirmando(false)} disabled={guardando}
              className="px-6 py-3 rounded-2xl font-black bg-zinc-800 text-zinc-300 hover:bg-zinc-700">Cancelar</button>
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
