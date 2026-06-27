"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  DOCS_PERSONALES,
  DOCS_VEHICULO,
  FOTOS_VEHICULO,
  TIPOS_VEHICULO_CHOFER,
  VehiculoRow,
  labelVehiculo,
  subirDocChofer,
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
  const [codigoAntecedentes, setCodigoAntecedentes] = useState("");
  const [guardandoCodigo, setGuardandoCodigo] = useState(false);

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
    (docs || []).forEach((d: { tipo: string; url: string }) => {
      mapa[d.tipo] = d.url;
      if (d.tipo === "antecedentes_codigo") setCodigoAntecedentes(d.url ?? "");
    });
    setDocsPersonales(mapa);
    setCargando(false);
  }, [choferId]);

  useEffect(() => { cargar(); }, [cargar]);

  const seleccionarVehiculo = async (vehiculoId: string) => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/chofer/vehiculos/${vehiculoId}/activo`, {
        method: "PATCH",
        headers: { "x-user-id": choferId },
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data?.error ?? "Error al seleccionar vehículo");
        setGuardando(false);
        return;
      }
      // Actualizar localStorage para que el panel no tenga que recargar perfil
      const u = localStorage.getItem("usuario");
      if (u) {
        const parsed = JSON.parse(u);
        parsed.vehiculo_activo_id = vehiculoId;
        localStorage.setItem("usuario", JSON.stringify(parsed));
      }
      setVehiculoActivoId(vehiculoId);
    } catch {
      alert("Error de conexión al seleccionar vehículo");
    } finally {
      setGuardando(false);
    }
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
    try {
      const res = await fetch("/api/chofer/vehiculos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": choferId },
        body: JSON.stringify({
          marca: marca.trim(),
          modelo: modelo.trim(),
          anio: Number(anio),
          patente: patente.trim().toUpperCase(),
          tipo_vehiculo: tipoVehiculo,
          seguro_vencimiento: seguroVenc,
          vtv_rto_vencimiento: vtvVenc,
        }),
      });
      const data = await res.json();
      if (!res.ok) { alert("Error: " + (data?.error ?? "Error desconocido")); setGuardando(false); return; }
      if (vehiculos.length === 0 && data.vehiculo?.id) {
        setVehiculoActivoId(data.vehiculo.id);
        const u = localStorage.getItem("usuario");
        if (u) {
          const parsed = JSON.parse(u);
          parsed.vehiculo_activo_id = data.vehiculo.id;
          localStorage.setItem("usuario", JSON.stringify(parsed));
        }
      }
    } catch {
      alert("Error de conexión al crear vehículo");
      setGuardando(false);
      return;
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
    try {
      const res = await fetch(`/api/chofer/vehiculos/${vehiculoActivo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-user-id": choferId },
        body: JSON.stringify({
          marca:               marca.trim() || vehiculoActivo.marca,
          modelo:              modelo.trim() || vehiculoActivo.modelo,
          anio:                anio ? Number(anio) : vehiculoActivo.anio,
          patente:             (patente.trim() || vehiculoActivo.patente || "").toUpperCase(),
          tipo_vehiculo:       tipoVehiculo || vehiculoActivo.tipo_vehiculo,
          seguro_vencimiento:  seguroVenc || vehiculoActivo.seguro_vencimiento,
          vtv_rto_vencimiento: vtvVenc || vehiculoActivo.vtv_rto_vencimiento,
        }),
      });
      const data = await res.json();
      if (!res.ok) alert(data?.error ?? "Error al guardar vehículo");
    } catch {
      alert("Error de conexión al guardar vehículo");
    } finally {
      setGuardando(false);
    }
    await cargar();
    onActualizado?.();
  };

  const guardarCodigoAntecedentes = async () => {
    setGuardandoCodigo(true);
    try {
      const res = await fetch("/api/chofer/documentacion", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": choferId },
        body: JSON.stringify({ tipo: "antecedentes_codigo", url: codigoAntecedentes.trim() }),
      });
      const data = await res.json();
      if (!res.ok) alert(data?.error ?? "Error al guardar código");
    } catch {
      alert("Error de conexión al guardar código de antecedentes");
    } finally {
      setGuardandoCodigo(false);
    }
  };

  const subirDocPersonal = async (tipo: string, bucket: string, archivo: File) => {
    console.log("[TILA-DOC] PASO 1 — archivo seleccionado (GestionVehiculosChofer personal)", {
      choferId, tipo, bucket,
      archivo: { name: archivo.name, size: archivo.size, type: archivo.type },
    });
    setSubiendo(tipo);
    const url = await subirDocChofer(supabase, choferId, tipo, bucket, archivo);
    console.log("[TILA-DOC] subirDocPersonal fin", { tipo, urlOk: !!url, url });
    setSubiendo(null);
    await cargar();
    onActualizado?.();
  };

  const subirDocVehiculo = async (tipo: string, bucket: string, campo: keyof VehiculoRow, archivo: File) => {
    if (!vehiculoActivo) { alert("Seleccioná un vehículo primero"); return; }
    console.log("[TILA-DOC] PASO 1 — archivo seleccionado (GestionVehiculosChofer vehículo)", {
      choferId, vehiculoId: vehiculoActivo.id, tipo, bucket, campo,
      archivo: { name: archivo.name, size: archivo.size, type: archivo.type },
    });
    setSubiendo(tipo);
    // Upload a Storage + UPSERT en documentacion_chofer — ambos ya migrados a server-side en subirDocChofer
    const url = await subirDocChofer(supabase, choferId, tipo, bucket, archivo);
    console.log("[TILA-DOC] subirDocVehiculo post subirDocChofer", { tipo, urlOk: !!url, url });
    if (url) {
      // UPDATE del campo URL en vehiculos vía API server-side
      try {
        const res = await fetch(`/api/chofer/vehiculos/${vehiculoActivo.id}/docs`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-user-id": choferId },
          body: JSON.stringify({ [campo]: url }),
        });
        const data = await res.json();
        if (!res.ok) {
          console.error("[TILA-DOC] error actualizando campo vehiculo vía API:", data?.error);
          alert(data?.error ?? "Error al guardar URL del documento en el vehículo");
        }
      } catch (e: any) {
        console.error("[TILA-DOC] excepción actualizando campo vehiculo:", e?.message);
        alert("Error de conexión al guardar documento del vehículo");
      }
    }
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
            {validacion.acciones.slice(0, 10).map((a, i) => (
              <li key={i} className="text-white text-xs flex gap-2"><span className="text-orange-400">•</span>{a}</li>
            ))}
            {validacion.acciones.length > 10 && (
              <li className="text-zinc-500 text-xs">+{validacion.acciones.length - 10} más</li>
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
          <div className="flex flex-col">
            <label className="text-zinc-500 text-xs font-black mb-1 whitespace-nowrap">Venc. seguro *</label>
            <input type="date" value={seguroVenc} min={hoyIso()} onChange={e => setSeguroVenc(e.target.value)}
              className="w-full p-3 rounded-xl bg-black border border-zinc-700 text-sm" />
          </div>
          <div className="flex flex-col">
            <label className="text-zinc-500 text-xs font-black mb-1 whitespace-nowrap">Venc. VTV / RTO *</label>
            <input type="date" value={vtvVenc} min={hoyIso()} onChange={e => setVtvVenc(e.target.value)}
              className="w-full p-3 rounded-xl bg-black border border-zinc-700 text-sm" />
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
        {/* Código del certificado de antecedentes */}
        <div className="mt-2 bg-zinc-800 rounded-xl p-3">
          <p className="text-zinc-500 text-xs font-black mb-2">CÓDIGO DEL CERTIFICADO DE ANTECEDENTES</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={codigoAntecedentes}
              onChange={e => setCodigoAntecedentes(e.target.value)}
              placeholder="Ej: 12345678"
              className="flex-1 bg-black border border-zinc-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-400"
            />
            <button
              type="button"
              onClick={guardarCodigoAntecedentes}
              disabled={guardandoCodigo}
              className="bg-yellow-400 hover:bg-yellow-500 disabled:bg-zinc-600 text-black font-black text-sm px-4 py-2 rounded-xl transition"
            >
              {guardandoCodigo ? "..." : "Guardar"}
            </button>
          </div>
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

      {/* Fotos del vehículo — 4 ángulos, guardadas en documentacion_chofer */}
      {vehiculoActivo && (
        <div>
          <p className="text-zinc-500 text-xs font-black mb-2">FOTOS DEL VEHÍCULO (4 ángulos)</p>
          <div className="grid grid-cols-2 gap-2">
            {FOTOS_VEHICULO.map(doc => (
              <DocUpload key={doc.tipo} label={doc.label}
                listo={!!docsPersonales[doc.tipo]}
                subiendo={subiendo === doc.tipo}
                onFile={f => subirDocPersonal(doc.tipo, doc.bucket, f)} />
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
        onChange={e => {
          const f = e.target.files?.[0];
          console.log("[TILA-DOC] PASO 1 — archivo seleccionado (GestionVehiculosChofer DocUpload)", {
            label,
            archivo: f ? { name: f.name, size: f.size, type: f.type } : null,
          });
          if (!f) {
            alert("No se recibió archivo del dispositivo");
            return;
          }
          onFile(f);
          e.target.value = "";
        }} />
    </label>
  );
}