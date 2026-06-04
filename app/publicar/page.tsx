"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";
import BotonCerrarSesion from "../components/BotonCerrarSesion";

const SOPORTE_WHATSAPP = "5491158689383";
const SOPORTE_EMAIL = "logisticatila@gmail.com";

const CATEGORIAS_LEGALES = ["N1", "N2", "N3"];

const TIPOS_VEHICULO = [
  { nombre: "Moto", categoria: "N1" },
  { nombre: "Utilitario", categoria: "N1" },
  { nombre: "Furgón", categoria: "N1" },
  { nombre: "Pick-up", categoria: "N1" },
  { nombre: "Camión rígido", categoria: "N2" },
  { nombre: "Camión tractor", categoria: "N3" },
  { nombre: "Bitrén", categoria: "N3" },
];

const TIPOS_CARROCERIA = [
  "Furgón", "Furgón térmico", "Plataforma", "Baranda volcable",
  "Cisterna", "Jaula", "Tolva", "Batea",
  "Portacontenedor", "Mosquito", "Grúa plancha",
];

const tiposCarga = [
  { nombre: "Carga común", extraLitros: 0 },
  { nombre: "Carga frágil", extraLitros: 0.5 },
  { nombre: "Carga cara", extraLitros: 0.5 },
  { nombre: "Carga peligrosa", extraLitros: 1 },
  { nombre: "Carga refrigerada", extraLitros: 1 },
];

// Tarifa base por tipo de vehículo
const TARIFAS_VEHICULO: Record<string, { litrosKm: number; minimo: number }> = {
  "Moto": { litrosKm: 0.3, minimo: 8000 },
  "Utilitario": { litrosKm: 0.6, minimo: 15000 },
  "Furgón": { litrosKm: 0.8, minimo: 25000 },
  "Pick-up": { litrosKm: 0.9, minimo: 30000 },
  "Camión rígido": { litrosKm: 1.5, minimo: 85000 },
  "Camión tractor": { litrosKm: 2.5, minimo: 350000 },
  "Bitrén": { litrosKm: 3, minimo: 500000 },
};

const precioCombustible = 2500;

const calcularKmAutomatico = (origen: string, destino: string) => {
  const o = origen.toLowerCase();
  const d = destino.toLowerCase();
  if (o.includes("rosario") && d.includes("cordoba")) return 400;
  if (o.includes("cordoba") && d.includes("rosario")) return 400;
  if (o.includes("buenos aires") && d.includes("santa fe")) return 475;
  if (o.includes("santa fe") && d.includes("buenos aires")) return 475;
  if (o.includes("pilar") && d.includes("corrientes")) return 900;
  if (o.includes("corrientes") && d.includes("pilar")) return 900;
  return 0;
};

const MAX_PARADAS = 4;

export default function PublicarPage() {
  const { autorizado } = useProtegerRuta("cliente");
  const router = useRouter();

  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [paradasIntermedias, setParadasIntermedias] = useState<string[]>([]);

  const [categoriaLegal, setCategoriaLegal] = useState("");
  const [tipoVehiculo, setTipoVehiculo] = useState("");
  const [tipoCarroceria, setTipoCarroceria] = useState("");

  const [peso, setPeso] = useState("");
  const [tipoCarga, setTipoCarga] = useState("");
  const [presentacion, setPresentacion] = useState("");
  const [km, setKm] = useState("");

  const [precioCliente, setPrecioCliente] = useState(0);
  const [pagoChofer, setPagoChofer] = useState(0);
  const [comisionPlataforma, setComisionPlataforma] = useState(0);
  const [publicando, setPublicando] = useState(false);

  // Filtrar tipos de vehículo por categoría seleccionada
  const tiposFiltrados = categoriaLegal
    ? TIPOS_VEHICULO.filter(t => t.categoria === categoriaLegal)
    : TIPOS_VEHICULO;

  // Si cambia la categoría y el tipo seleccionado no corresponde, limpiar
  useEffect(() => {
    if (tipoVehiculo && categoriaLegal) {
      const tipo = TIPOS_VEHICULO.find(t => t.nombre === tipoVehiculo);
      if (tipo && tipo.categoria !== categoriaLegal) setTipoVehiculo("");
    }
  }, [categoriaLegal]);

  const calcularValores = (kilometros: number, litrosPorKm: number, minimo: number) => {
    const base = Math.max(Math.round(kilometros * litrosPorKm * precioCombustible), minimo);
    const cliente = Math.round(base * 1.075);
    const chofer = Math.round(base * 0.925);
    const comision = Math.round(cliente - chofer);
    return { cliente, chofer, comision };
  };

  useEffect(() => {
    const calcularDistancia = async () => {
      if (!origen || !destino) return;
      const paradasValidas = paradasIntermedias.filter(p => p.trim() !== "");
      const puntos = [origen, ...paradasValidas, destino];

      if (puntos.length === 2) {
        try {
          const response = await fetch(`/api/distancia?origen=${encodeURIComponent(origen)}&destino=${encodeURIComponent(destino)}`);
          const data = await response.json();
          setKm(String(data.km || calcularKmAutomatico(origen, destino)));
        } catch {
          setKm(String(calcularKmAutomatico(origen, destino)));
        }
        return;
      }

      const tramos = puntos.slice(0, -1).map((punto, i) => ({ desde: punto, hasta: puntos[i + 1] }));
      const resultados = await Promise.all(
        tramos.map(async ({ desde, hasta }) => {
          try {
            const response = await fetch(`/api/distancia?origen=${encodeURIComponent(desde)}&destino=${encodeURIComponent(hasta)}`);
            const data = await response.json();
            return data.km && data.km > 0 ? data.km : calcularKmAutomatico(desde, hasta);
          } catch {
            return calcularKmAutomatico(desde, hasta);
          }
        })
      );
      const totalKm = resultados.reduce((acc, k) => acc + k, 0);
      setKm(String(totalKm > 0 ? totalKm : 0));
    };
    calcularDistancia();
  }, [origen, destino, paradasIntermedias]);

  useEffect(() => {
    if (!tipoVehiculo || !tipoCarga || !km) {
      setPrecioCliente(0); setPagoChofer(0); setComisionPlataforma(0);
      return;
    }
    const kilometros = Number(km);
    if (!kilometros || kilometros <= 0) { setPrecioCliente(0); setPagoChofer(0); setComisionPlataforma(0); return; }
    const tarifaBase = TARIFAS_VEHICULO[tipoVehiculo];
    const cargaSeleccionada = tiposCarga.find(c => c.nombre === tipoCarga);
    if (!tarifaBase || !cargaSeleccionada) return;
    const litrosPorKm = tarifaBase.litrosKm + cargaSeleccionada.extraLitros;
    const valores = calcularValores(kilometros, litrosPorKm, tarifaBase.minimo);
    setPrecioCliente(valores.cliente);
    setPagoChofer(valores.chofer);
    setComisionPlataforma(valores.comision);
  }, [tipoVehiculo, tipoCarga, km]);

  const agregarParada = () => {
    if (paradasIntermedias.length >= MAX_PARADAS) return;
    setParadasIntermedias([...paradasIntermedias, ""]);
  };

  const actualizarParada = (index: number, valor: string) => {
    const nuevas = [...paradasIntermedias];
    nuevas[index] = valor;
    setParadasIntermedias(nuevas);
  };

  const eliminarParada = (index: number) => {
    setParadasIntermedias(paradasIntermedias.filter((_, i) => i !== index));
  };

  const publicarCarga = async () => {
    if (publicando) return;
    if (!origen || !destino || !tipoVehiculo || !peso || !tipoCarga) {
      alert("Completá todos los campos obligatorios");
      return;
    }

    const usuarioGuardado = localStorage.getItem("usuario");
    if (!usuarioGuardado) { alert("Sesión no encontrada. Volvé a iniciar sesión."); router.push("/login"); return; }
    const usuario = JSON.parse(usuarioGuardado);

    const tarifaBase = TARIFAS_VEHICULO[tipoVehiculo];
    const cargaSeleccionada = tiposCarga.find(c => c.nombre === tipoCarga);
    if (!tarifaBase || !cargaSeleccionada) { alert("Seleccioná vehículo y tipo de carga válidos"); return; }

    const litrosPorKm = tarifaBase.litrosKm + cargaSeleccionada.extraLitros;
    const kilometros = Number(km || calcularKmAutomatico(origen, destino));
    if (!kilometros || kilometros <= 0) { alert("No se pudo calcular la distancia del viaje"); return; }

    setPublicando(true);
    const valoresFinales = calcularValores(kilometros, litrosPorKm, tarifaBase.minimo);

    // vehiculo = texto legible para compatibilidad
    const vehiculoTexto = [tipoVehiculo, tipoCarroceria, categoriaLegal].filter(Boolean).join(" - ");

    const { data, error } = await supabase.from("cargas").insert([{
      cliente_id: usuario.id,
      origen, destino,
      vehiculo: vehiculoTexto,          // campo viejo — texto legible
      categoria_legal: categoriaLegal,   // campo nuevo
      tipo_vehiculo: tipoVehiculo,       // campo nuevo
      tipo_carroceria: tipoCarroceria,   // campo nuevo
      peso,
      tipo_carga: tipoCarga,
      detalles: presentacion,
      km_estimados: kilometros,
      litros_por_km: litrosPorKm,
      precio_base: valoresFinales.cliente,
      precio_cliente: valoresFinales.cliente,
      pago_chofer: valoresFinales.chofer,
      comision_plataforma: valoresFinales.comision,
      estado: "pendiente",
      tracking: false,
    }]).select().single();

    if (error) { alert("Error publicando carga: " + error.message); setPublicando(false); return; }

    // Paradas intermedias
    const paradasValidas = paradasIntermedias.map(p => p.trim()).filter(Boolean);
    if (paradasValidas.length > 0) {
      const paradasParaInsertar = [
        { carga_id: Number(data.id), orden: 0, tipo: "retiro", direccion: origen.trim(), estado: "pendiente" },
        ...paradasValidas.map((direccion, index) => ({
          carga_id: Number(data.id), orden: index + 1, tipo: "parada", direccion, estado: "pendiente",
        })),
        { carga_id: Number(data.id), orden: paradasValidas.length + 1, tipo: "entrega", direccion: destino.trim(), estado: "pendiente" },
      ];
      const { error: errorParadas } = await supabase.from("paradas_viaje").insert(paradasParaInsertar);
      if (errorParadas) console.error("Error insertando paradas_viaje:", errorParadas);
    }

    setPublicando(false);
    localStorage.setItem("viajeActivoId", String(data.id));
    router.push("/panel-cliente");
  };

  if (!autorizado) return null;

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl md:text-5xl font-black text-yellow-400">Publicar carga</h1>
          <BotonCerrarSesion />
        </div>

        <div className="grid gap-6">

          {/* Ruta */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-4">
            <h2 className="text-xl font-black text-yellow-400">📍 Ruta</h2>

            <input type="text" placeholder="Origen — punto de retiro" value={origen}
              onChange={e => setOrigen(e.target.value)}
              className="w-full bg-black border border-zinc-700 text-white p-4 rounded-xl focus:border-yellow-400 outline-none" />

            {paradasIntermedias.map((parada, index) => (
              <div key={index} className="flex gap-3 items-center">
                <input type="text" placeholder={`Parada ${index + 1} — dirección intermedia`} value={parada}
                  onChange={e => actualizarParada(index, e.target.value)}
                  className="bg-black border border-zinc-700 text-white p-4 rounded-xl flex-1 focus:border-yellow-400 outline-none" />
                <button onClick={() => eliminarParada(index)}
                  className="bg-red-800 hover:bg-red-700 text-white font-black px-4 py-4 rounded-xl">✕</button>
              </div>
            ))}

            {paradasIntermedias.length < MAX_PARADAS && (
              <button onClick={agregarParada}
                className="w-full bg-zinc-800 hover:bg-zinc-700 border border-dashed border-yellow-400 text-yellow-400 font-black py-4 rounded-xl text-sm">
                + Agregar parada intermedia ({paradasIntermedias.length}/{MAX_PARADAS})
              </button>
            )}

            <input type="text" placeholder="Destino final" value={destino}
              onChange={e => setDestino(e.target.value)}
              className="w-full bg-black border border-zinc-700 text-white p-4 rounded-xl focus:border-yellow-400 outline-none" />

            {km && Number(km) > 0 && (
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-zinc-400 text-sm">📏 Distancia estimada: <span className="text-yellow-400 font-black">{km} km</span></p>
              </div>
            )}
          </div>

          {/* Vehículo requerido */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-5">
            <h2 className="text-xl font-black text-yellow-400">🚛 Vehículo requerido</h2>

            {/* Categoría legal */}
            <div>
              <label className="text-zinc-400 text-sm font-black mb-2 block">Categoría legal</label>
              <div className="flex gap-3">
                {CATEGORIAS_LEGALES.map(cat => (
                  <button key={cat} type="button" onClick={() => setCategoriaLegal(cat)}
                    className={`flex-1 py-3 rounded-xl font-black text-lg transition ${
                      categoriaLegal === cat ? "bg-yellow-400 text-black" : "bg-black border border-zinc-700 text-zinc-400 hover:border-yellow-400"
                    }`}>
                    {cat}
                  </button>
                ))}
              </div>
              <p className="text-zinc-600 text-xs mt-1">N1 hasta 3.5t · N2 hasta 12t · N3 más de 12t</p>
            </div>

            {/* Tipo de vehículo */}
            <div>
              <label className="text-zinc-400 text-sm font-black mb-2 block">Tipo de vehículo *</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {tiposFiltrados.map(tipo => (
                  <button key={tipo.nombre} type="button" onClick={() => { setTipoVehiculo(tipo.nombre); if (!categoriaLegal) setCategoriaLegal(tipo.categoria); }}
                    className={`py-3 px-2 rounded-xl font-black text-sm transition ${
                      tipoVehiculo === tipo.nombre ? "bg-yellow-400 text-black" : "bg-black border border-zinc-700 text-zinc-400 hover:border-yellow-400"
                    }`}>
                    {tipo.nombre}
                  </button>
                ))}
              </div>
            </div>

            {/* Tipo de carrocería */}
            <div>
              <label className="text-zinc-400 text-sm font-black mb-2 block">Tipo de carrocería</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {TIPOS_CARROCERIA.map(tipo => (
                  <button key={tipo} type="button" onClick={() => setTipoCarroceria(tipoCarroceria === tipo ? "" : tipo)}
                    className={`py-3 px-2 rounded-xl font-black text-sm transition ${
                      tipoCarroceria === tipo ? "bg-blue-600 text-white" : "bg-black border border-zinc-700 text-zinc-400 hover:border-blue-400"
                    }`}>
                    {tipo}
                  </button>
                ))}
              </div>
            </div>

            {/* Resumen clasificación */}
            {(categoriaLegal || tipoVehiculo || tipoCarroceria) && (
              <div className="bg-zinc-800 border border-yellow-400/30 rounded-2xl p-4">
                <p className="text-yellow-400 text-xs font-black mb-2">VEHÍCULO SELECCIONADO</p>
                <div className="flex flex-wrap gap-2">
                  {categoriaLegal && <span className="bg-yellow-400 text-black px-3 py-1 rounded-lg text-sm font-black">{categoriaLegal}</span>}
                  {tipoVehiculo && <span className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-black">{tipoVehiculo}</span>}
                  {tipoCarroceria && <span className="bg-zinc-600 text-white px-3 py-1 rounded-lg text-sm font-black">{tipoCarroceria}</span>}
                </div>
              </div>
            )}
          </div>

          {/* Detalles de la carga */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-4">
            <h2 className="text-xl font-black text-yellow-400">📦 Detalles de la carga</h2>

            <input type="text" placeholder="Peso (ej: 500 kg, 2 toneladas)" value={peso}
              onChange={e => setPeso(e.target.value)}
              className="w-full bg-black border border-zinc-700 text-white p-4 rounded-xl focus:border-yellow-400 outline-none" />

            <div>
              <label className="text-zinc-400 text-sm font-black mb-2 block">Tipo de carga *</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {tiposCarga.map(c => (
                  <button key={c.nombre} type="button" onClick={() => setTipoCarga(c.nombre)}
                    className={`py-3 px-2 rounded-xl font-black text-sm transition ${
                      tipoCarga === c.nombre ? "bg-yellow-400 text-black" : "bg-black border border-zinc-700 text-zinc-400 hover:border-yellow-400"
                    }`}>
                    {c.nombre}
                  </button>
                ))}
              </div>
            </div>

            <input type="text" placeholder="Presentación / detalles adicionales" value={presentacion}
              onChange={e => setPresentacion(e.target.value)}
              className="w-full bg-black border border-zinc-700 text-white p-4 rounded-xl focus:border-yellow-400 outline-none" />
          </div>

          {/* Tarifa */}
          {precioCliente > 0 && (
            <div className="bg-zinc-900 border border-yellow-400 rounded-3xl p-6">
              <h2 className="text-xl font-black text-yellow-400 mb-4">💰 Tarifa estimada</h2>
              <div className="text-center">
                <p className="text-zinc-400 text-sm mb-1">Precio total del servicio</p>
                <p className="text-5xl font-black text-green-400">${precioCliente.toLocaleString()}</p>
                <p className="text-zinc-500 text-sm mt-2">{km} km · {tipoVehiculo} · {tipoCarga}</p>
              </div>
            </div>
          )}

          {/* Publicar */}
          <button type="button" onClick={publicarCarga} disabled={publicando}
            className={`w-full p-5 rounded-2xl font-black text-xl transition ${
              publicando ? "bg-zinc-700 text-zinc-400 cursor-not-allowed" : "bg-yellow-400 hover:bg-yellow-500 text-black hover:scale-105"
            }`}>
            {publicando ? "Publicando..." : "Publicar carga"}
          </button>

          {/* Soporte */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-zinc-500 text-xs font-black mb-3 text-center">🆘 SOPORTE TILA</p>
            <div className="flex gap-3 justify-center">
              <a href={`https://wa.me/${SOPORTE_WHATSAPP}`} target="_blank" rel="noreferrer"
                className="bg-green-600 hover:bg-green-500 text-white font-black px-4 py-2 rounded-xl text-sm">💬 WhatsApp</a>
              <a href={`mailto:${SOPORTE_EMAIL}`}
                className="bg-zinc-700 hover:bg-zinc-600 text-white font-black px-4 py-2 rounded-xl text-sm">📧 Email</a>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}