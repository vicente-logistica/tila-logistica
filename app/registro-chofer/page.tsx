"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabase";

const CATEGORIAS_LEGALES = ["N1", "N2", "N3"];
const TIPOS_VEHICULO = ["Moto", "Utilitario", "Furgón", "Pick-up", "Camión rígido", "Camión tractor", "Bitrén"];
const TIPOS_CARROCERIA = ["Furgón", "Furgón térmico", "Plataforma", "Baranda volcable", "Cisterna", "Jaula", "Tolva", "Batea", "Portacontenedor", "Mosquito", "Grúa plancha"];

const DOCS_REQUERIDOS = [
  { tipo: "dni_frente", label: "DNI Frente", bucket: "documentacion-choferes" },
  { tipo: "dni_dorso", label: "DNI Dorso", bucket: "documentacion-choferes" },
  { tipo: "licencia", label: "Licencia de conducir", bucket: "documentacion-choferes" },
  { tipo: "seguro", label: "Seguro del vehículo", bucket: "documentacion-choferes" },
  { tipo: "cedula", label: "Cédula del vehículo", bucket: "documentacion-choferes" },
];

const FOTOS_VEHICULO = [
  { tipo: "foto_frente", label: "Frente", bucket: "vehiculos" },
  { tipo: "foto_lateral_izq", label: "Lateral izquierda", bucket: "vehiculos" },
  { tipo: "foto_lateral_der", label: "Lateral derecha", bucket: "vehiculos" },
  { tipo: "foto_trasera", label: "Trasera", bucket: "vehiculos" },
];

export default function RegistroChoferPage() {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [cuitCuil, setCuitCuil] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [licencia, setLicencia] = useState("");
  const [cnrtRuta, setCnrtRuta] = useState("");
  const [antecedentes, setAntecedentes] = useState("");
  const [patente, setPatente] = useState("");
  const [categoriaLegal, setCategoriaLegal] = useState("");
  const [tipoVehiculo, setTipoVehiculo] = useState("");
  const [tipoCarroceria, setTipoCarroceria] = useState("");
  const [zonaOperativa, setZonaOperativa] = useState("");
  const [capacidadCarga, setCapacidadCarga] = useState("");
  const [seguroVehiculo, setSeguroVehiculo] = useState("");
  const [seguroCarga, setSeguroCarga] = useState("");
  const [vtvRto, setVtvRto] = useState("");
  const [metodoCobro, setMetodoCobro] = useState("");
  const [aliasCbuCvu, setAliasCbuCvu] = useState("");
  const [titularCuenta, setTitularCuenta] = useState("");
  const [bancoBilletera, setBancoBilletera] = useState("");

  // Archivos locales para subir después del registro
  const [archivos, setArchivos] = useState<Record<string, File>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const manejarArchivo = (tipo: string, archivo: File) => {
    setArchivos(prev => ({ ...prev, [tipo]: archivo }));
    const reader = new FileReader();
    reader.onload = e => setPreviews(prev => ({ ...prev, [tipo]: e.target?.result as string }));
    reader.readAsDataURL(archivo);
  };

  const registrarChofer = async () => {
    if (!nombre || !telefono || !email || !password || !patente) {
      alert("Completá nombre, teléfono, email, contraseña y patente");
      return;
    }
    if (!categoriaLegal || !tipoVehiculo) {
      alert("Seleccioná categoría legal y tipo de vehículo");
      return;
    }

    setLoading(true);

    // Paso 1: Crear usuario
    const { data: nuevoUsuario, error } = await supabase.from("usuarios").insert([{
      nombre, email, password, telefono,
      rol: "chofer",
      acepta_terminos: true,
      dni, cuit_cuil: cuitCuil,
      licencia, cnrt_ruta: cnrtRuta, antecedentes,
      patente,
      vehiculo: tipoVehiculo,
      categoria_legal: categoriaLegal,
      tipo_vehiculo: tipoVehiculo,
      tipo_carroceria: tipoCarroceria,
      zona_operativa: zonaOperativa,
      capacidad_carga: capacidadCarga,
      seguro_vehiculo: seguroVehiculo,
      seguro_carga: seguroCarga,
      vtv_rto: vtvRto,
      metodo_cobro: metodoCobro,
      alias_cbu_cvu: aliasCbuCvu,
      titular_cuenta: titularCuenta,
      banco_billetera: bancoBilletera,
      estado_validacion: "pendiente",
      estado_aprobacion: "pendiente",
    }]).select().single();

    if (error) { alert("Error: " + error.message); setLoading(false); return; }

    const choferIdNuevo = nuevoUsuario.id;

    // Paso 2: Subir archivos si hay
    const todosArchivos = Object.entries(archivos);
    if (todosArchivos.length > 0) {
      for (const [tipo, archivo] of todosArchivos) {
        const todos = [...DOCS_REQUERIDOS, ...FOTOS_VEHICULO];
        const docInfo = todos.find(d => d.tipo === tipo);
        if (!docInfo) continue;

        const ext = archivo.name.split(".").pop();
        const path = `${choferIdNuevo}/${tipo}.${ext}`;

        const { error: errorUpload } = await supabase.storage
          .from(docInfo.bucket)
          .upload(path, archivo, { upsert: true });

        if (!errorUpload) {
          const { data: urlData } = supabase.storage.from(docInfo.bucket).getPublicUrl(path);
          await supabase.from("documentacion_chofer").insert([{
            chofer_id: choferIdNuevo,
            tipo,
            url: urlData.publicUrl,
          }]);
        }
      }
    }

    setLoading(false);
    alert("Solicitud enviada correctamente. El administrador revisará tu documentación.");
    router.push("/login");
  };

  const totalRequeridos = [...DOCS_REQUERIDOS, ...FOTOS_VEHICULO].length;
  const subidos = Object.keys(archivos).length;

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <Link href="/login" className="text-zinc-400 hover:text-white">← Volver</Link>
        <h1 className="text-4xl font-black text-yellow-400 mt-8">Registro de chofer</h1>
        <p className="text-zinc-400 mt-3 mb-8">Completá tus datos. La cuenta queda pendiente hasta validar documentación.</p>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-5">

          {/* Datos personales */}
          <h2 className="text-2xl font-bold text-yellow-400">Datos personales</h2>
          <input value={nombre} onChange={e => setNombre(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Nombre y apellido" />
          <input value={dni} onChange={e => setDni(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="DNI" />
          <input value={cuitCuil} onChange={e => setCuitCuil(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="CUIT / CUIL" />
          <input value={telefono} onChange={e => setTelefono(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Teléfono" />
          <input value={email} onChange={e => setEmail(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Email" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Contraseña" />

          {/* Documentación */}
          <h2 className="text-2xl font-bold text-yellow-400 pt-4">Documentación obligatoria</h2>
          <input value={licencia} onChange={e => setLicencia(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Licencia / registro profesional" />
          <input value={cnrtRuta} onChange={e => setCnrtRuta(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="CNRT / RUTA" />
          <input value={antecedentes} onChange={e => setAntecedentes(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Número de gestión certificado antecedentes" />

          {/* Vehículo */}
          <h2 className="text-2xl font-bold text-yellow-400 pt-4">Vehículo</h2>
          <input value={patente} onChange={e => setPatente(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Patente" />

          <div>
            <label className="text-zinc-400 text-sm font-black mb-2 block">Categoría legal *</label>
            <div className="flex gap-3">
              {CATEGORIAS_LEGALES.map(cat => (
                <button key={cat} type="button" onClick={() => setCategoriaLegal(cat)}
                  className={`flex-1 py-3 rounded-xl font-black text-lg transition ${categoriaLegal === cat ? "bg-yellow-400 text-black" : "bg-black border border-zinc-700 text-zinc-400"}`}>
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-zinc-400 text-sm font-black mb-2 block">Tipo de vehículo *</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {TIPOS_VEHICULO.map(tipo => (
                <button key={tipo} type="button" onClick={() => setTipoVehiculo(tipo)}
                  className={`py-3 px-2 rounded-xl font-black text-sm transition ${tipoVehiculo === tipo ? "bg-yellow-400 text-black" : "bg-black border border-zinc-700 text-zinc-400"}`}>
                  {tipo}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-zinc-400 text-sm font-black mb-2 block">Tipo de carrocería</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {TIPOS_CARROCERIA.map(tipo => (
                <button key={tipo} type="button" onClick={() => setTipoCarroceria(tipo)}
                  className={`py-3 px-2 rounded-xl font-black text-sm transition ${tipoCarroceria === tipo ? "bg-blue-600 text-white" : "bg-black border border-zinc-700 text-zinc-400"}`}>
                  {tipo}
                </button>
              ))}
            </div>
          </div>

          {(categoriaLegal || tipoVehiculo || tipoCarroceria) && (
            <div className="bg-zinc-800 border border-yellow-400/30 rounded-2xl p-4">
              <p className="text-yellow-400 text-xs font-black mb-2">CLASIFICACIÓN SELECCIONADA</p>
              <div className="flex flex-wrap gap-2">
                {categoriaLegal && <span className="bg-yellow-400 text-black px-3 py-1 rounded-lg text-sm font-black">{categoriaLegal}</span>}
                {tipoVehiculo && <span className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-black">{tipoVehiculo}</span>}
                {tipoCarroceria && <span className="bg-zinc-600 text-white px-3 py-1 rounded-lg text-sm font-black">{tipoCarroceria}</span>}
              </div>
            </div>
          )}

          <input value={zonaOperativa} onChange={e => setZonaOperativa(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Zona operativa" />
          <input value={capacidadCarga} onChange={e => setCapacidadCarga(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Capacidad de carga" />
          <input value={seguroVehiculo} onChange={e => setSeguroVehiculo(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Seguro del vehículo" />
          <input value={seguroCarga} onChange={e => setSeguroCarga(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Seguro de carga" />
          <input value={vtvRto} onChange={e => setVtvRto(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="VTV / RTO" />

          {/* Fotos y documentos */}
          <h2 className="text-2xl font-bold text-yellow-400 pt-4">📋 Documentos personales</h2>
          <p className="text-zinc-500 text-sm">Podés subir ahora o completar después. Sin documentación completa no se puede aprobar la cuenta.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {DOCS_REQUERIDOS.map(doc => (
              <div key={doc.tipo} className={`rounded-2xl border-2 overflow-hidden ${archivos[doc.tipo] ? "border-green-500" : "border-dashed border-zinc-600"} bg-black p-3`}>
                {previews[doc.tipo] ? (
                  <img src={previews[doc.tipo]} alt={doc.label} className="w-full h-24 object-cover rounded-xl mb-2" />
                ) : (
                  <div className="h-16 flex items-center justify-center text-zinc-600 text-sm">Sin subir</div>
                )}
                <p className="text-xs font-black text-zinc-300 mb-1">{doc.label}</p>
                <label className={`block w-full py-2 rounded-xl font-black text-xs text-center cursor-pointer transition ${archivos[doc.tipo] ? "bg-green-700 text-white" : "bg-yellow-400 text-black"}`}>
                  {archivos[doc.tipo] ? "✅ Cargado — cambiar" : "📁 Subir"}
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) manejarArchivo(doc.tipo, f); }} />
                </label>
              </div>
            ))}
          </div>

          <h2 className="text-2xl font-bold text-yellow-400 pt-4">🚛 Fotos del vehículo</h2>
          <div className="grid grid-cols-2 gap-3">
            {FOTOS_VEHICULO.map(doc => (
              <div key={doc.tipo} className={`rounded-2xl border-2 overflow-hidden ${archivos[doc.tipo] ? "border-green-500" : "border-dashed border-zinc-600"} bg-black p-3`}>
                {previews[doc.tipo] ? (
                  <img src={previews[doc.tipo]} alt={doc.label} className="w-full h-24 object-cover rounded-xl mb-2" />
                ) : (
                  <div className="h-16 flex items-center justify-center text-zinc-600 text-2xl">📷</div>
                )}
                <p className="text-xs font-black text-zinc-300 mb-1">{doc.label}</p>
                <label className={`block w-full py-2 rounded-xl font-black text-xs text-center cursor-pointer transition ${archivos[doc.tipo] ? "bg-green-700 text-white" : "bg-yellow-400 text-black"}`}>
                  {archivos[doc.tipo] ? "✅ Cargado — cambiar" : "📷 Subir foto"}
                  <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) manejarArchivo(doc.tipo, f); }} />
                </label>
              </div>
            ))}
          </div>

          {subidos > 0 && (
            <div className="bg-zinc-800 rounded-2xl p-3 text-center">
              <p className="text-green-400 font-black text-sm">{subidos}/{totalRequeridos} archivos seleccionados para subir</p>
            </div>
          )}

          {/* Cobro */}
          <h2 className="text-2xl font-bold text-yellow-400 pt-4">Cobro del chofer</h2>
          <select value={metodoCobro} onChange={e => setMetodoCobro(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700">
            <option value="">Método de cobro preferido</option>
            <option>Transferencia bancaria</option>
            <option>Mercado Pago</option>
            <option>Billetera virtual</option>
          </select>
          <input value={aliasCbuCvu} onChange={e => setAliasCbuCvu(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Alias / CBU / CVU" />
          <input value={titularCuenta} onChange={e => setTitularCuenta(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Titular de la cuenta" />
          <input value={bancoBilletera} onChange={e => setBancoBilletera(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Banco / billetera" />

          <button type="button" onClick={registrarChofer} disabled={loading}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xl py-4 rounded-2xl">
            {loading ? "Enviando y subiendo archivos..." : "Enviar solicitud de validación"}
          </button>

        </div>
      </div>
    </main>
  );
}