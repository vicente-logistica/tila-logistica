"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

interface Documento {
  tipo: string;
  label: string;
  bucket: string;
  icono: string;
}

const DOCUMENTOS: Documento[] = [
  { tipo: "dni_frente", label: "DNI Frente", bucket: "documentacion-choferes", icono: "🪪" },
  { tipo: "dni_dorso", label: "DNI Dorso", bucket: "documentacion-choferes", icono: "🪪" },
  { tipo: "licencia", label: "Licencia de conducir", bucket: "documentacion-choferes", icono: "📋" },
  { tipo: "antecedentes", label: "Certificado de antecedentes", bucket: "documentacion-choferes", icono: "📋" },
  { tipo: "seguro", label: "Seguro del vehículo", bucket: "documentacion-choferes", icono: "🛡️" },
  { tipo: "cedula", label: "Cédula del vehículo", bucket: "documentacion-choferes", icono: "📄" },
  { tipo: "vtv_rto", label: "VTV / RTO", bucket: "documentacion-choferes", icono: "📄" },
  { tipo: "foto_frente", label: "Foto frente vehículo", bucket: "vehiculos", icono: "🚛" },
  { tipo: "foto_lateral_izq", label: "Foto lateral izquierda", bucket: "vehiculos", icono: "🚛" },
  { tipo: "foto_lateral_der", label: "Foto lateral derecha", bucket: "vehiculos", icono: "🚛" },
  { tipo: "foto_trasera", label: "Foto trasera", bucket: "vehiculos", icono: "🚛" },
];

interface SubirDocumentacionProps {
  choferIdExterno?: string;
  soloLectura?: boolean;
}

export default function SubirDocumentacion({ choferIdExterno, soloLectura = false }: SubirDocumentacionProps) {
  const [documentos, setDocumentos] = useState<Record<string, string>>({});
  const [subiendo, setSubiendo] = useState<Record<string, boolean>>({});
  const [choferId, setChoferId] = useState<string | null>(choferIdExterno || null);

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
    console.log("[SubirDocumentacion] cargarDocumentos", { choferId });
    const { data, error } = await supabase
      .from("documentacion_chofer")
      .select("tipo, url")
      .eq("chofer_id", choferId);
    console.log("[SubirDocumentacion] cargarDocumentos resultado", {
      ok: !error,
      count: data?.length ?? 0,
      data,
      error: error ? { message: error.message, code: error.code, details: error.details } : null,
    });
    if (error) {
      alert("Error cargar documentacion_chofer: " + error.message);
      return;
    }
    if (data) {
      const mapa: Record<string, string> = {};
      data.forEach((d: any) => { mapa[d.tipo] = d.url; });
      setDocumentos(mapa);
    }
  };

  const subirArchivo = async (tipo: string, bucket: string, archivo: File) => {
    if (!choferId) {
      console.warn("[SubirDocumentacion] subirArchivo sin choferId", { tipo, bucket });
      alert("No se encontró ID del chofer");
      return;
    }
    setSubiendo(prev => ({ ...prev, [tipo]: true }));

    const ext = archivo.name.split(".").pop();
    const path = `${choferId}/${tipo}.${ext}`;

    console.log("[SubirDocumentacion] ANTES upload", {
      choferId,
      tipo,
      bucket,
      path,
      archivo: { name: archivo.name, size: archivo.size, type: archivo.type },
    });

    const { data: dataUpload, error: errorUpload } = await supabase.storage
      .from(bucket)
      .upload(path, archivo, { upsert: true });

    console.log("[SubirDocumentacion] DESPUÉS upload", {
      ok: !errorUpload,
      dataUpload,
      errorUpload: errorUpload
        ? { message: errorUpload.message, name: errorUpload.name, statusCode: (errorUpload as any).statusCode }
        : null,
    });

    if (errorUpload) {
      alert("Error al subir: " + errorUpload.message);
      setSubiendo(prev => ({ ...prev, [tipo]: false }));
      return;
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    const url = urlData.publicUrl;

    console.log("[SubirDocumentacion] DESPUÉS getPublicUrl", { path, bucket, urlData, url });

    const payload = { chofer_id: choferId, tipo, url };
    const { data: dataUpsert, error: errorDB } = await supabase
      .from("documentacion_chofer")
      .upsert([payload], { onConflict: "chofer_id,tipo" });

    console.log("[SubirDocumentacion] DESPUÉS upsert documentacion_chofer", {
      payload,
      ok: !errorDB,
      dataUpsert,
      errorDB: errorDB
        ? { message: errorDB.message, code: errorDB.code, details: errorDB.details, hint: errorDB.hint }
        : null,
    });

    if (errorDB) {
      alert("Error upsert documentacion_chofer: " + errorDB.message);
      console.log("[SubirDocumentacion] upsert falló — intentando insert", { payload });
      const { data: dataInsert, error: errorInsert } = await supabase
        .from("documentacion_chofer")
        .insert([payload]);
      console.log("[SubirDocumentacion] DESPUÉS insert fallback", {
        ok: !errorInsert,
        dataInsert,
        errorInsert: errorInsert
          ? { message: errorInsert.message, code: errorInsert.code, details: errorInsert.details }
          : null,
      });
      if (errorInsert) {
        alert("Error insert documentacion_chofer: " + errorInsert.message);
        console.log("[SubirDocumentacion] insert falló — intentando update", { payload });
        const { data: dataUpdate, error: errorUpdate } = await supabase
          .from("documentacion_chofer")
          .update({ url })
          .eq("chofer_id", choferId)
          .eq("tipo", tipo);
        console.log("[SubirDocumentacion] DESPUÉS update fallback", {
          ok: !errorUpdate,
          dataUpdate,
          errorUpdate: errorUpdate
            ? { message: errorUpdate.message, code: errorUpdate.code, details: errorUpdate.details }
            : null,
        });
        if (errorUpdate) {
          alert("Error update documentacion_chofer: " + errorUpdate.message);
          setSubiendo(prev => ({ ...prev, [tipo]: false }));
          return;
        }
      }
    }

    console.log("[SubirDocumentacion] subida OK — actualizando estado local", { tipo, url });
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
    console.log("[SubirDocumentacion] ItemDocumento onChange", {
      tipo: doc.tipo,
      archivo: archivo
        ? { name: archivo.name, size: archivo.size, type: archivo.type }
        : null,
    });
    if (!archivo) return;
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
