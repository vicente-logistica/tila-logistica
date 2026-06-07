"use client";



import Link from "next/link";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { supabase } from "@/app/lib/supabase";

import {
  DOCS_PERSONALES,
  DOCS_VEHICULO,
  FOTOS_VEHICULO,
  TIPOS_VEHICULO_CHOFER,
  subirDocChofer,
  actualizarCampoVehiculo,
} from "@/app/lib/vehiculos";



const CATEGORIAS_LEGALES = ["N1", "N2", "N3"];

const TIPOS_CARROCERIA = ["Furgón", "Furgón térmico", "Plataforma", "Baranda volcable", "Cisterna", "Jaula", "Tolva", "Batea", "Portacontenedor", "Mosquito", "Grúa plancha"];



const DOCS_REQUERIDOS = [...DOCS_PERSONALES, ...DOCS_VEHICULO];

const TODOS_ARCHIVOS = [...DOCS_REQUERIDOS, ...FOTOS_VEHICULO];



const MAP_DOC_VEHICULO: Record<string, keyof import("@/app/lib/vehiculos").VehiculoRow> = {

  cedula: "cedula_verde_url",

  seguro: "seguro_url",

  vtv_rto: "vtv_rto_url",

  foto_frente: "foto_vehiculo_url",

};



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

  const [marca, setMarca] = useState("");

  const [modelo, setModelo] = useState("");

  const [anio, setAnio] = useState("");

  const [patente, setPatente] = useState("");

  const [categoriaLegal, setCategoriaLegal] = useState("");

  const [tipoVehiculo, setTipoVehiculo] = useState("");

  const [tipoCarroceria, setTipoCarroceria] = useState("");

  const [zonaOperativa, setZonaOperativa] = useState("");

  const [capacidadCarga, setCapacidadCarga] = useState("");

  const [seguroVenc, setSeguroVenc] = useState("");

  const [vtvVenc, setVtvVenc] = useState("");

  const [seguroCarga, setSeguroCarga] = useState("");

  const [metodoCobro, setMetodoCobro] = useState("");

  const [aliasCbuCvu, setAliasCbuCvu] = useState("");

  const [titularCuenta, setTitularCuenta] = useState("");

  const [bancoBilletera, setBancoBilletera] = useState("");



  const [archivos, setArchivos] = useState<Record<string, File>>({});

  const [previews, setPreviews] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);



  const manejarArchivo = (tipo: string, archivo: File) => {

    setArchivos(prev => ({ ...prev, [tipo]: archivo }));

    if (archivo.type.startsWith("image/")) {

      const reader = new FileReader();

      reader.onload = e => setPreviews(prev => ({ ...prev, [tipo]: e.target?.result as string }));

      reader.readAsDataURL(archivo);

    } else {

      setPreviews(prev => ({ ...prev, [tipo]: "pdf" }));

    }

  };



  const registrarChofer = async () => {

    if (!nombre || !telefono || !email || !password) {

      alert("Completá nombre, teléfono, email y contraseña");

      return;

    }

    if (!marca.trim() || !modelo.trim() || !anio || !patente.trim()) {

      alert("Completá marca, modelo, año y patente del vehículo");

      return;

    }

    if (!categoriaLegal || !tipoVehiculo) {

      alert("Seleccioná categoría legal y tipo de vehículo");

      return;

    }

    if (!seguroVenc || !vtvVenc) {

      alert("Indicá las fechas de vencimiento del seguro y VTV / RTO");

      return;

    }

    if (!archivos.antecedentes) {

      alert("Subí el certificado de antecedentes (PDF o imagen)");

      return;

    }



    setLoading(true);



    const capacidadKg = capacidadCarga

      ? parseInt(capacidadCarga.replace(/\D/g, ""), 10) || null

      : null;



    const { data: nuevoUsuario, error } = await supabase.from("usuarios").insert([{

      nombre, email, password, telefono,

      rol: "chofer",

      acepta_terminos: true,

      dni, cuit_cuil: cuitCuil,

      licencia, cnrt_ruta: cnrtRuta,

      patente: patente.trim().toUpperCase(),

      vehiculo: tipoVehiculo,

      categoria_legal: categoriaLegal,

      tipo_vehiculo: tipoVehiculo,

      tipo_carroceria: tipoCarroceria,

      zona_operativa: zonaOperativa,

      capacidad_carga: capacidadCarga,

      seguro_carga: seguroCarga,

      metodo_cobro: metodoCobro,

      alias_cbu_cvu: aliasCbuCvu,

      titular_cuenta: titularCuenta,

      banco_billetera: bancoBilletera,

      estado_validacion: "pendiente",

      estado_aprobacion: "pendiente",

    }]).select().single();



    if (error) { alert("Error: " + error.message); setLoading(false); return; }



    const choferIdNuevo = nuevoUsuario.id;



    const { data: nuevoVehiculo, error: errorVehiculo } = await supabase.from("vehiculos").insert([{

      chofer_id: choferIdNuevo,

      marca: marca.trim(),

      modelo: modelo.trim(),

      anio: Number(anio),

      patente: patente.trim().toUpperCase(),

      tipo_vehiculo: tipoVehiculo,

      capacidad_kg: capacidadKg,

      seguro_vencimiento: seguroVenc,

      vtv_rto_vencimiento: vtvVenc,

      activo: true,

      estado_validacion: "pendiente",

    }]).select().single();



    if (errorVehiculo) {

      alert("Error al registrar vehículo: " + errorVehiculo.message);

      setLoading(false);

      return;

    }



    await supabase.from("usuarios").update({ vehiculo_activo_id: nuevoVehiculo.id }).eq("id", choferIdNuevo);



    for (const [tipo, archivo] of Object.entries(archivos)) {

      const docInfo = TODOS_ARCHIVOS.find(d => d.tipo === tipo);

      if (!docInfo) continue;



      const url = await subirDocChofer(supabase, choferIdNuevo, tipo, docInfo.bucket, archivo);

      if (!url) continue;



      const campoVehiculo = MAP_DOC_VEHICULO[tipo];

      if (campoVehiculo) {

        await actualizarCampoVehiculo(supabase, nuevoVehiculo.id, campoVehiculo, url);

      }

    }



    setLoading(false);

    alert("Solicitud enviada correctamente. El administrador revisará tu documentación.");

    router.push("/login");

  };



  const totalRequeridos = TODOS_ARCHIVOS.length;

  const subidos = Object.keys(archivos).length;



  const renderDoc = (doc: { tipo: string; label: string }) => (

    <div key={doc.tipo} className={`rounded-2xl border-2 overflow-hidden ${archivos[doc.tipo] ? "border-green-500" : doc.tipo === "antecedentes" ? "border-orange-500" : "border-dashed border-zinc-600"} bg-black p-3`}>

      {previews[doc.tipo] && previews[doc.tipo] !== "pdf" ? (

        <img src={previews[doc.tipo]} alt={doc.label} className="w-full h-24 object-cover rounded-xl mb-2" />

      ) : previews[doc.tipo] === "pdf" ? (

        <div className="h-16 flex items-center justify-center text-green-400 text-sm font-black mb-2">📄 PDF cargado</div>

      ) : (

        <div className="h-16 flex items-center justify-center text-zinc-600 text-sm">Sin subir</div>

      )}

      <p className="text-xs font-black text-zinc-300 mb-1">

        {doc.label}{doc.tipo === "antecedentes" ? " *" : ""}

      </p>

      <label className={`block w-full py-2 rounded-xl font-black text-xs text-center cursor-pointer transition ${archivos[doc.tipo] ? "bg-green-700 text-white" : "bg-yellow-400 text-black"}`}>

        {archivos[doc.tipo] ? "✅ Cargado — cambiar" : "📁 Subir"}

        <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) manejarArchivo(doc.tipo, f); }} />

      </label>

    </div>

  );



  return (

    <main className="min-h-screen bg-black text-white p-4 md:p-8">

      <div className="max-w-4xl mx-auto">

        <Link href="/login" className="text-zinc-400 hover:text-white">← Volver</Link>

        <h1 className="text-4xl font-black text-yellow-400 mt-8">Registro de chofer</h1>

        <p className="text-zinc-400 mt-3 mb-8">Completá tus datos y registrá tu vehículo. La cuenta queda pendiente hasta validar documentación.</p>



        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-5">



          <h2 className="text-2xl font-bold text-yellow-400">Datos personales</h2>

          <input value={nombre} onChange={e => setNombre(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Nombre y apellido" />

          <input value={dni} onChange={e => setDni(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="DNI" />

          <input value={cuitCuil} onChange={e => setCuitCuil(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="CUIT / CUIL" />

          <input value={telefono} onChange={e => setTelefono(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Teléfono" />

          <input value={email} onChange={e => setEmail(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Email" />

          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Contraseña" />



          <h2 className="text-2xl font-bold text-yellow-400 pt-4">Documentación obligatoria</h2>

          <input value={licencia} onChange={e => setLicencia(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Licencia / registro profesional" />

          <input value={cnrtRuta} onChange={e => setCnrtRuta(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="CNRT / RUTA" />



          <h2 className="text-2xl font-bold text-yellow-400 pt-4">Vehículo</h2>

          <div className="grid grid-cols-2 gap-3">

            <input value={marca} onChange={e => setMarca(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Marca *" />

            <input value={modelo} onChange={e => setModelo(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Modelo *" />

            <input value={anio} onChange={e => setAnio(e.target.value)} type="number" min="1980" max="2030" className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Año *" />

            <input value={patente} onChange={e => setPatente(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700 uppercase" placeholder="Patente *" />

          </div>



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

              {TIPOS_VEHICULO_CHOFER.map(tipo => (

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



          <div className="grid grid-cols-2 gap-3">

            <div>

              <label className="text-zinc-400 text-sm font-black mb-2 block">Vencimiento seguro *</label>

              <input type="date" value={seguroVenc} onChange={e => setSeguroVenc(e.target.value)}

                className="w-full p-4 rounded-xl bg-black border border-zinc-700" />

            </div>

            <div>

              <label className="text-zinc-400 text-sm font-black mb-2 block">Vencimiento VTV / RTO *</label>

              <input type="date" value={vtvVenc} onChange={e => setVtvVenc(e.target.value)}

                className="w-full p-4 rounded-xl bg-black border border-zinc-700" />

            </div>

          </div>



          <input value={zonaOperativa} onChange={e => setZonaOperativa(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Zona operativa" />

          <input value={capacidadCarga} onChange={e => setCapacidadCarga(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Capacidad de carga (kg)" />

          <input value={seguroCarga} onChange={e => setSeguroCarga(e.target.value)} className="w-full p-4 rounded-xl bg-black border border-zinc-700" placeholder="Seguro de carga" />



          <h2 className="text-2xl font-bold text-yellow-400 pt-4">📋 Documentos personales</h2>

          <p className="text-zinc-500 text-sm">El certificado de antecedentes es obligatorio (PDF o imagen).</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            {DOCS_PERSONALES.map(renderDoc)}

          </div>



          <h2 className="text-2xl font-bold text-yellow-400 pt-4">📄 Documentos del vehículo</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            {DOCS_VEHICULO.map(renderDoc)}

          </div>



          <h2 className="text-2xl font-bold text-yellow-400 pt-4">🚛 Fotos del vehículo</h2>

          <div className="grid grid-cols-2 gap-3">

            {FOTOS_VEHICULO.map(renderDoc)}

          </div>



          {subidos > 0 && (

            <div className="bg-zinc-800 rounded-2xl p-3 text-center">

              <p className="text-green-400 font-black text-sm">{subidos}/{totalRequeridos} archivos seleccionados</p>

            </div>

          )}



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


