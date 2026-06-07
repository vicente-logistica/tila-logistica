"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  DOCS_PERSONALES,
  DOCS_VEHICULO,
  TIPOS_VEHICULO_CHOFER,
  VehiculoRow,
  labelVehiculo,
  subirDocChofer,
  actualizarCampoVehiculo,
} from "../lib/vehiculos";
import { evaluarChoferOnline, hoyIso } from "../lib/validacion-chofer";

interface Props {
  choferId: string;
  categoriaLegal?: string;
  onActualizado?: () => void;
}

export default function GestionVehiculosChofer({ choferId, categoriaLegal, onActualizado }: Props) {
  const [vehiculos, setVehiculos] = useState<VehiculoRow[]>([]);
  const [vehiculoActivoId, setVehiculoActivoId] = useState<string | null>(null);
  const [docsPersonales, setDocsPersonales] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [subiendo, setSubiendo] = useState<string | null>(null);

  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [patente, setPatente] = useState("");
  const [tipoVehiculo, setTipoVehiculo] = useState("");
  const [seguroVenc, setSeguroVenc] = useState("");
  const [vtvVenc, setVtvVenc] = useState("");

  const vehiculoActivo = vehiculos.find(v => v.id === vehiculoActivoId) ?? null;
  const validacion = evaluarChoferOnline({ vehiculoActivo, docsPersonales, vehiculoActivoId });

  const cargar = useCallback(async () => {
    if (!choferId) return;
    setCargando(true);
    const [{ data: lista }, { data: perfil }, { data: docs }] = await Promise.all([
      supabase.from("vehiculos").select("*").eq("chofer_id", choferId).order("created_at", { ascending: true }),
      supabase.from("usuarios").select("vehiculo_activo_id").eq("id", choferId).single(),
      supabase.from("documentacion_chofer").select("tipo, url").eq("chofer_id", choferId),
    ]);
    setVehiculos(lista || []);
    setVehiculoActivoId(perfil?.vehiculo_activo_id ?? lista?.[0]?.id ?? null);
    const mapa: Record<string, string> = {};
    (docs || []).forEach((d: { tipo: string; url: string }) => { mapa[d.tipo] = d.url; });
    setDocsPersonales(mapa);
    setCargando(false);
  }, [choferId]);

  useEffect(() => { cargar(); }, [cargar]);

  const seleccionarVehiculo = async (vehiculoId: string) => {
    setGuardando(true);
    await supabase.from("vehiculos").update({ activo: false }).eq("chofer_id", choferId);
    await supabase.from("vehiculos").update({ activo: true }).eq("id", vehiculoId);
    await supabase.from("usuarios").update({ vehiculo_activo_id: vehiculoId }).eq("id", choferId);
    const u = localStorage.getItem("usuario");
    if (u) {
      const parsed = JSON.parse(u);
      parsed.vehiculo_activo_id = vehiculoId;
      localStorage.setItem("usuario", JSON.stringify(parsed));
    }
    setVehiculoActivoId(vehiculoId);
    setGuardando(false);
    await cargar();
    onActualizado?.();
  };

  const crearVehiculo = async () => {
    if (!marca.trim() || !modelo.trim() || !anio || !patente.trim() || !tipoVehiculo) {
      alert("Completá marca, modelo, año, patente y tipo de vehículo");
      return;
    }
    if (!seguroVenc || !vtvVenc) {
      alert("Indicá las fechas de vencimiento del seguro y VTV / RTO");
      return;
    }
    setGuardando(true);
    const { data: nuevo, error } = await supabase.from("vehiculos").insert([{
      chofer_id: choferId,
      marca: marca.trim(),
      modelo: modelo.trim(),
      anio: Number(anio),
      patente: patente.trim().toUpperCase(),
      tipo_vehiculo: tipoVehiculo,
      seguro_vencimiento: seguroVenc,
      vtv_rto_vencimiento: vtvVenc,
      activo: vehiculos.length === 0,
      estado_validacion: "pendiente",
    }]).select().single();
    if (error) { alert("Error: " + error.message); setGuardando(false); return; }
    if (vehiculos.length === 0) {
      await supabase.from("usuarios").update({ vehiculo_activo_id: nuevo.id }).eq("id", choferId);
      setVehiculoActivoId(nuevo.id);
    }
    setMarca(""); setModelo(""); setAnio(""); setPatente(""); setTipoVehiculo("");
    setSeguroVenc(""); setVtvVenc("");
    setMostrarForm(false);
    setGuardando(false);
    await cargar();
    onActualizado?.();
  };

  const guardarDatosVehiculo = async () => {
    if (!vehiculoActivo) return;
    setGuardando(true);
    await supabase.from("vehiculos").update({
      marca: marca.trim() || vehiculoActivo.marca,
      modelo: modelo.trim() || vehiculoActivo.modelo,
      anio: anio ? Number(anio) : vehiculoActivo.anio,
      patente: (patente.trim() || vehiculoActivo.patente || "").toUpperCase(),
      tipo_vehiculo: tipoVehiculo || vehiculoActivo.tipo_vehiculo,
      seguro_vencimiento: seguroVenc || vehiculoActivo.seguro_vencimiento,
      vtv_rto_vencimiento: vtvVenc || vehiculoActivo.vtv_rto_vencimiento,
      updated_at: new Date().toISOString(),
    }).eq("id", vehiculoActivo.id);
    setGuardando(false);
    await cargar();
    onActualizado?.();
  };

  const subirDocPersonal = async (tipo: string, bucket: string, archivo: File) => {
    setSubiendo(tipo);
    await subirDocChofer(supabase, choferId, tipo, bucket, archivo);
    setSubiendo(null);
    await cargar();
    onActualizado?.();
  };

  const subirDocVehiculo = async (tipo: string, bucket: string, campo: keyof VehiculoRow, archivo: File) => {
    if (!vehiculoActivo) { alert("Seleccioná un vehículo primero"); return; }
    setSubiendo(tipo);
    const url = await subirDocChofer(supabase, choferId, tipo, bucket, archivo);
    if (url) await actualizarCampoVehiculo(supabase, vehiculoActivo.id, campo, url);
    setSubiendo(null);
    await cargar();
    onActualizado?.();
  };

  const iniciarEdicion = (v: VehiculoRow) => {
    setMarca(v.marca || "");
    setModelo(v.modelo || "");
    setAnio(v.anio ? String(v.anio) : "");
    setPatente(v.patente || "");
    setTipoVehiculo(v.tipo_vehiculo || "");
    setSeguroVenc(v.seguro_vencimiento?.slice(0, 10) || "");
    setVtvVenc(v.vtv_rto_vencimiento?.slice(0, 10) || "");
  };

  useEffect(() => {
    if (vehiculoActivo && !mostrarForm) iniciarEdicion(vehiculoActivo);
  }, [vehiculoActivo?.id]);

  if (cargando) {
    return <p className="text-zinc-500 text-sm text-center animate-pulse">Cargando vehículos...</p>;
  }

  return (
    <div className="space-y-4 text-left">
      {/* Acciones requeridas */}
      {!validacion.puedeOnline && (
        <div className="bg-orange-950 border-2 border-orange-500 rounded-2xl p-4">
          <p className="text-orange-400 font-black text-sm mb-2">⚠️ Acciones requeridas</p>
          <p className="text-zinc-400 text-xs mb-3">Completá esto para ponerte ONLINE</p>
          <ul className="space-y-1">
            {validacion.acciones.slice(0, 6).map((a, i) => (
              <li key={i} className="text-white text-xs flex gap-2"><span className="text-orange-400">•</span>{a}</li>
            ))}
            {validacion.acciones.length > 6 && (
              <li className="text-zinc-500 text-xs">+{validacion.acciones.length - 6} más</li>
            )}
          </ul>
        </div>
      )}

      {/* Selector de vehículo */}
      {vehiculos.length > 0 && (
        <div>
          <p className="text-zinc-500 text-xs font-black mb-2">VEHÍCULO ACTIVO</p>
          <div className="space-y-2">
            {vehiculos.map(v => {
              const activo = v.id === vehiculoActivoId;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={guardando}
                  onClick={() => seleccionarVehiculo(v.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition text-left ${
                    activo ? "border-yellow-400 bg-yellow-400/10" : "border-zinc-700 bg-zinc-800 hover:border-zinc-500"
                  }`}
                >
                  <div>
                    <p className="text-white font-black text-sm">{labelVehiculo(v)}</p>
                    <p className="text-zinc-500 text-xs">{v.tipo_vehiculo || "Sin tipo"}</p>
                  </div>
                  {activo && <span className="text-yellow-400 text-xs font-black">✓ ACTIVO</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Formulario vehículo activo / nuevo */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-yellow-400 font-black text-sm">
            {mostrarForm || vehiculos.length === 0 ? "➕ Registrar vehículo" : "✏️ Completar vehículo activo"}
          </p>
          {vehiculos.length > 0 && (
            <button type="button" onClick={() => setMostrarForm(v => !v)}
              className="text-zinc-400 text-xs font-black hover:text-white">
              {mostrarForm ? "Editar activo" : "+ Otro vehículo"}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input value={marca} onChange={e => setMarca(e.target.value)} placeholder="Marca *"
            className="p-3 rounded-xl bg-black border border-zinc-700 text-sm" />
          <input value={modelo} onChange={e => setModelo(e.target.value)} placeholder="Modelo *"
            className="p-3 rounded-xl bg-black border border-zinc-700 text-sm" />
          <input value={anio} onChange={e => setAnio(e.target.value)} placeholder="Año *" type="number" min="1980" max="2030"
            className="p-3 rounded-xl bg-black border border-zinc-700 text-sm" />
          <input value={patente} onChange={e => setPatente(e.target.value)} placeholder="Patente *"
            className="p-3 rounded-xl bg-black border border-zinc-700 text-sm uppercase" />
        </div>

        <div className="flex flex-wrap gap-1">
          {TIPOS_VEHICULO_CHOFER.map(t => (
            <button key={t} type="button" onClick={() => setTipoVehiculo(t)}
              className={`px-2 py-1 rounded-lg text-xs font-black ${tipoVehiculo === t ? "bg-yellow-400 text-black" : "bg-zinc-900 text-zinc-400 border border-zinc-700"}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-zinc-500 text-xs font-black">Venc. seguro *</label>
            <input type="date" value={seguroVenc} min={hoyIso()} onChange={e => setSeguroVenc(e.target.value)}
              className="w-full p-3 rounded-xl bg-black border border-zinc-700 text-sm mt-1" />
          </div>
          <div>
            <label className="text-zinc-500 text-xs font-black">Venc. VTV/RTO *</label>
            <input type="date" value={vtvVenc} min={hoyIso()} onChange={e => setVtvVenc(e.target.value)}
              className="w-full p-3 rounded-xl bg-black border border-zinc-700 text-sm mt-1" />
          </div>
        </div>

        {categoriaLegal && (
          <p className="text-zinc-600 text-xs">Categoría legal del chofer: {categoriaLegal}</p>
        )}

        <button type="button" disabled={guardando}
          onClick={mostrarForm || vehiculos.length === 0 ? crearVehiculo : guardarDatosVehiculo}
          className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black py-3 rounded-xl text-sm disabled:opacity-50">
          {guardando ? "Guardando..." : mostrarForm || vehiculos.length === 0 ? "Registrar vehículo" : "Guardar datos del vehículo"}
        </button>
      </div>

      {/* Docs personales */}
      <div>
        <p className="text-zinc-500 text-xs font-black mb-2">DOCUMENTACIÓN PERSONAL</p>
        <div className="grid grid-cols-2 gap-2">
          {DOCS_PERSONALES.map(doc => (
            <DocUpload key={doc.tipo} label={doc.label} listo={!!docsPersonales[doc.tipo]}
              subiendo={subiendo === doc.tipo}
              onFile={f => subirDocPersonal(doc.tipo, doc.bucket, f)} />
          ))}
        </div>
      </div>

      {/* Docs vehículo activo */}
      {vehiculoActivo && (
        <div>
          <p className="text-zinc-500 text-xs font-black mb-2">DOCUMENTACIÓN DEL VEHÍCULO ACTIVO</p>
          <div className="grid grid-cols-1 gap-2">
            {DOCS_VEHICULO.map(doc => (
              <DocUpload key={doc.tipo} label={doc.label}
                listo={!!(vehiculoActivo as any)[doc.campo]}
                subiendo={subiendo === doc.tipo}
                onFile={f => subirDocVehiculo(doc.tipo, doc.bucket, doc.campo, f)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocUpload({ label, listo, subiendo, onFile }: {
  label: string; listo: boolean; subiendo: boolean; onFile: (f: File) => void;
}) {
  return (
    <label className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${
      listo ? "border-green-600 bg-green-950/30" : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
    }`}>
      <span className="text-xs font-black text-zinc-300">{listo ? "✅" : "📄"} {label}</span>
      <span className="text-xs text-yellow-400 font-black">{subiendo ? "..." : listo ? "Cambiar" : "Subir"}</span>
      <input type="file" accept="image/*,.pdf" className="hidden" disabled={subiendo}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}