"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { subirDocChofer } from "../lib/vehiculos";

interface Documento {
  tipo: string;
  label: string;
  bucket: string;
  icono: string;
}

const DOCUMENTOS: Documento[] = [
  { tipo: "dni_frente",             label: "DNI Frente",                   bucket: "documentacion-choferes", icono: "🪪" },
  { tipo: "dni_dorso",              label: "DNI Dorso",                    bucket: "documentacion-choferes", icono: "🪪" },
  { tipo: "licencia",               label: "Licencia de conducir",         bucket: "documentacion-choferes", icono: "📋" },
  { tipo: "antecedentes_penales",   label: "Certificado de antecedentes",  bucket: "documentacion-choferes", icono: "📋" },
  { tipo: "seguro",                 label: "Seguro del vehículo",          bucket: "documentacion-choferes", icono: "🛡️" },
  { tipo: "cedula_verde",           label: "Cédula verde",                 bucket: "documentacion-choferes", icono: "📄" },
  { tipo: "vtv_rto",                label: "VTV / RTO",                    bucket: "documentacion-choferes", icono: "📄" },
  { tipo: "foto_frente",            label: "Foto frente vehículo",         bucket: "vehiculos",              icono: "🚛" },
  { tipo: "foto_lateral_izquierda", label: "Foto lateral izquierda",       bucket: "vehiculos",              icono: "🚛" },
  { tipo: "foto_lateral_derecha",   label: "Foto lateral derecha",         bucket: "vehiculos",              icono: "🚛" },
  { tipo: "foto_trasera",           label: "Foto trasera",                 bucket: "vehiculos",              icono: "🚛" },
];

interface SubirDocumentacionProps {
  choferIdExterno?: string;
  soloLectura?: boolean;
}

export default function SubirDocumentacion({ choferIdExterno, soloLectura = false }: SubirDocumentacionProps) {
  const [documentos, setDocumentos] = useState<Record<string, string>>({});
  const [subiendo, setSubiendo] = useState<Record<string, boolean>>({});
  const [choferId, setChoferId] = useState<string | null>(choferIdExterno || null);
  const [codigoAntecedentes, setCodigoAntecedentes] = useState("");
  const [guardandoCodigo, setGuardandoCodigo] = useState(false);

  useEffect(() => {
    if (!choferIdExterno) {
      const u = localStorage.getItem("usuario");
      if (u) setChoferId(JSON.parse(u).id);
    } else {
      setChoferId(choferIdExterno);
    }
  }, [choferIdExterno]);

  useEffect(() => {
    if (!choferId) return;
    cargarDocumentos();
  }, [choferId]);

  const cargarDocumentos = async () => {
    if (!choferId) return;
    console.log("[TILA-DOC] cargarDocumentos", { choferId });
    const { data, error } = await supabase
      .from("documentacion_chofer")
      .select("tipo, url")
      .eq("chofer_id", choferId);
    console.log("[TILA-DOC] cargarDocumentos resultado", {
      ok: !error,
      count: data?.length ?? 0,
      data,
      error: error ? { message: error.message, code: error.code, details: error.details } : null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    if (data) {
      const mapa: Record<string, string> = {};
      data.forEach((d: any) => {
        mapa[d.tipo] = d.url;
        if (d.tipo === "antecedentes_codigo") setCodigoAntecedentes(d.url ?? "");
      });
      setDocumentos(mapa);
    }
  };

  const guardarCodigoAntecedentes = async () => {
    if (!choferId) return;
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

  const subirArchivo = async (tipo: string, bucket: string, archivo: File) => {
    console.log("[TILA-DOC] PASO 1 — archivo seleccionado (SubirDocumentacion)", {
      choferId,
      tipo,
      bucket,
      archivo: { name: archivo.name, size: archivo.size, type: archivo.type },
    });

    if (!choferId) {
      console.warn("[TILA-DOC] subirArchivo sin choferId", { tipo, bucket });
      alert("No se encontró ID del chofer");
      return;
    }

    setSubiendo(prev => ({ ...prev, [tipo]: true }));

    const url = await subirDocChofer(supabase, choferId, tipo, bucket, archivo);

    console.log("[TILA-DOC] subirArchivo resultado (SubirDocumentacion)", {
      tipo,
      urlOk: !!url,
      url,
    });

    if (!url) {
      setSubiendo(prev => ({ ...prev, [tipo]: false }));
      return;
    }

    setDocumentos(prev => ({ ...prev, [tipo]: url }));
    setSubiendo(prev => ({ ...prev, [tipo]: false }));
  };

  const totalDocs = DOCUMENTOS.length;
  const docsCompletos = DOCUMENTOS.filter(d => documentos[d.tipo]).length;
  const porcentaje = Math.round((docsCompletos / totalDocs) * 100);

  const docsPorSeccion = {
    documentacion: DOCUMENTOS.filter(d => d.bucket === "documentacion-choferes"),
    fotos: DOCUMENTOS.filter(d => d.bucket === "vehiculos"),
  };

  return (
    <div className="space-y-6">
      <div className="bg-zinc-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-zinc-400 text-sm font-black">DOCUMENTACIÓN COMPLETA</p>
          <span className={`font-black text-sm ${porcentaje === 100 ? "text-green-400" : porcentaje >= 50 ? "text-yellow-400" : "text-red-400"}`}>
            {docsCompletos}/{totalDocs} — {porcentaje}%
          </span>
        </div>
        <div className="w-full bg-zinc-700 rounded-full h-2">
          <div className={`h-2 rounded-full transition-all ${porcentaje === 100 ? "bg-green-400" : porcentaje >= 50 ? "bg-yellow-400" : "bg-red-500"}`}
            style={{ width: `${porcentaje}%` }} />
        </div>
        {porcentaje === 100 && (
          <p className="text-green-400 font-black text-sm mt-2">✅ Documentación completa — apto para aprobación</p>
        )}
        {porcentaje < 100 && (
          <p className="text-zinc-500 text-xs mt-2">Falta documentación para poder ser aprobado</p>
        )}
      </div>

      <div>
        <h3 className="text-lg font-black text-yellow-400 mb-3">📋 Documentos personales</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {docsPorSeccion.documentacion.map(doc => (
            <ItemDocumento
              key={doc.tipo}
              doc={doc}
              url={documentos[doc.tipo]}
              subiendo={subiendo[doc.tipo]}
              soloLectura={soloLectura}
              onSeleccionar={archivo => subirArchivo(doc.tipo, doc.bucket, archivo)}
            />
          ))}
        </div>
        {/* Código numérico del certificado de antecedentes */}
        <div className="mt-3 bg-zinc-800 rounded-2xl p-4">
          <p className="text-zinc-400 text-xs font-black mb-2">CÓDIGO DEL CERTIFICADO DE ANTECEDENTES</p>
          {soloLectura ? (
            <p className="text-white font-black text-base">{codigoAntecedentes || <span className="text-zinc-500 font-normal">No cargado</span>}</p>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={codigoAntecedentes}
                onChange={e => setCodigoAntecedentes(e.target.value)}
                placeholder="Ej: 12345678"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-yellow-400"
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
          )}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-black text-yellow-400 mb-3">🚛 Fotos del vehículo</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {docsPorSeccion.fotos.map(doc => (
            <ItemDocumento
              key={doc.tipo}
              doc={doc}
              url={documentos[doc.tipo]}
              subiendo={subiendo[doc.tipo]}
              soloLectura={soloLectura}
              onSeleccionar={archivo => subirArchivo(doc.tipo, doc.bucket, archivo)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ItemDocumento({ doc, url, subiendo, soloLectura, onSeleccionar }: {
  doc: Documento;
  url?: string;
  subiendo?: boolean;
  soloLectura: boolean;
  onSeleccionar: (archivo: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ampliado, setAmpliado] = useState(false);

  const manejarCambio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    console.log("[TILA-DOC] PASO 1 — archivo seleccionado (SubirDocumentacion ItemDocumento)", {
      tipo: doc.tipo,
      label: doc.label,
      archivo: archivo
        ? { name: archivo.name, size: archivo.size, type: archivo.type }
        : null,
    });
    if (!archivo) {
      alert("No se recibió archivo del dispositivo");
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target?.result as string);
    reader.readAsDataURL(archivo);
    onSeleccionar(archivo);
    e.target.value = "";
  };

  const imagenMostrar = preview || url;

  return (
    <>
      <div className={`relative rounded-2xl border-2 overflow-hidden ${url ? "border-green-500" : "border-dashed border-zinc-600"} bg-black`}>
        {imagenMostrar ? (
          <div className="relative">
            <img src={imagenMostrar} alt={doc.label} className="w-full h-32 object-cover cursor-pointer" onClick={() => setAmpliado(true)} />
            <div className="absolute top-1 right-1 flex gap-1">
              <span className="bg-green-500 text-white text-xs font-black px-2 py-0.5 rounded-lg">✓</span>
            </div>
          </div>
        ) : (
          <div className="h-32 flex flex-col items-center justify-center text-zinc-600">
            <span className="text-3xl mb-1">{doc.icono}</span>
            <p className="text-xs text-center px-2">Sin subir</p>
          </div>
        )}
        <div className="p-2">
          <p className="text-xs font-black text-zinc-300 truncate">{doc.label}</p>
          {!soloLectura && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={manejarCambio}
              />
              <button
                onClick={() => inputRef.current?.click()}
                disabled={subiendo}
                className={`w-full mt-1 py-1.5 rounded-xl font-black text-xs transition ${
                  subiendo ? "bg-zinc-700 text-zinc-500" : url ? "bg-zinc-700 hover:bg-zinc-600 text-zinc-300" : "bg-yellow-400 hover:bg-yellow-500 text-black"
                }`}
                type="button"
              >
                {subiendo ? "Subiendo..." : url ? "Reemplazar" : "Subir"}
              </button>
            </>
          )}
        </div>
      </div>

      {ampliado && imagenMostrar && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setAmpliado(false)}>
          <div className="max-w-2xl w-full">
            <img src={imagenMostrar} alt={doc.label} className="w-full rounded-2xl" />
            <p className="text-white text-center mt-3 font-black">{doc.label}</p>
          </div>
        </div>
      )}
    </>
  );
}
