"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { useProtegerRuta } from "../hooks/useProtegerRuta";

const vehiculos = [
  { nombre: "Flete chico", litrosKm: 0.8, minimo: 25000 },
  { nombre: "Camión mediano furgón", litrosKm: 1.5, minimo: 85000 },
  { nombre: "Camión grande / semi", litrosKm: 3, minimo: 500000 },
];

const tiposCarga = [
  { nombre: "Carga común", extraLitros: 0 },
  { nombre: "Carga frágil", extraLitros: 0.5 },
  { nombre: "Carga cara", extraLitros: 0.5 },
  { nombre: "Carga peligrosa", extraLitros: 1 },
  { nombre: "Carga refrigerada", extraLitros: 1 },
];

const calcularKmAutomatico = (origen: string, destino: string) => {
  const o = origen.toLowerCase();
  const d = destino.toLowerCase();

  if (o.includes("rosario") && d.includes("cordoba")) return 400;
  if (o.includes("cordoba") && d.includes("rosario")) return 400;
  if (o.includes("buenos aires") && d.includes("santa fe")) return 475;
  if (o.includes("santa fe") && d.includes("buenos aires")) return 475;
  if (o.includes("pilar") && d.includes("corrientes")) return 900;
  if (o.includes("corrientes") && d.includes("pilar")) return 900;
  if (o.includes("san isidro") && d.includes("mar azul")) return 420;
  if (o.includes("mar azul") && d.includes("san isidro")) return 420;

  return 0;
};

const MAX_PARADAS = 4;

export default function PublicarPage() {
  const { autorizado } = useProtegerRuta("cliente");
  const router = useRouter();

  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [paradasIntermedias, setParadasIntermedias] = useState<string[]>([]);
  const [vehiculo, setVehiculo] = useState("");
  const [peso, setPeso] = useState("");
  const [tipoCarga, setTipoCarga] = useState("");
  const [presentacion, setPresentacion] = useState("");
  const [km, setKm] = useState("");

  const [precioBase, setPrecioBase] = useState(0);
  const [precioCliente, setPrecioCliente] = useState(0);
  const [pagoChofer, setPagoChofer] = useState(0);
  const [comisionPlataforma, setComisionPlataforma] = useState(0);
  const [publicando, setPublicando] = useState(false);

  const precioCombustible = 2500;

  const calcularValores = (
    kilometros: number,
    litrosPorKm: number,
    minimo: number
  ) => {
    const baseCalculada = kilometros * litrosPorKm * precioCombustible;
    const base = Math.max(Math.round(baseCalculada), minimo);
    const cliente = Math.round(base * 1.075);
    const chofer = Math.round(base * 0.925);
    const comision = Math.round(cliente - chofer);
    return { base, cliente, chofer, comision };
  };

  useEffect(() => {
    const calcularDistancia = async () => {
      if (!origen || !destino) return;

      // Construir array de puntos: origen + paradas válidas + destino
      const paradasValidas = paradasIntermedias.filter((p) => p.trim() !== "");
      const puntos = [origen, ...paradasValidas, destino];

      // Si solo hay origen y destino, calcular directo como antes
      if (puntos.length === 2) {
        try {
          const response = await fetch(
            `/api/distancia?origen=${encodeURIComponent(origen)}&destino=${encodeURIComponent(destino)}`
          );
          const data = await response.json();
          setKm(String(data.km || calcularKmAutomatico(origen, destino)));
        } catch (error) {
          console.log(error);
          setKm(String(calcularKmAutomatico(origen, destino)));
        }
        return;
      }

      // Multietapa: calcular cada tramo en paralelo
      const tramos = puntos.slice(0, -1).map((punto, i) => ({
        desde: punto,
        hasta: puntos[i + 1],
      }));

      const resultados = await Promise.all(
        tramos.map(async ({ desde, hasta }) => {
          try {
            const response = await fetch(
              `/api/distancia?origen=${encodeURIComponent(desde)}&destino=${encodeURIComponent(hasta)}`
            );
            const data = await response.json();

            if (data.km && data.km > 0) return data.km;

            const fallback = calcularKmAutomatico(desde, hasta);
            if (fallback > 0) return fallback;

            console.warn(`Sin distancia para tramo: ${desde} → ${hasta}`);
            return 0;
          } catch (error) {
            console.warn(`Error calculando tramo ${desde} → ${hasta}:`, error);
            return calcularKmAutomatico(desde, hasta);
          }
        })
      );

      const totalKm = resultados.reduce((acc, km) => acc + km, 0);
      setKm(String(totalKm > 0 ? totalKm : 0));
    };

    calcularDistancia();
  }, [origen, destino, paradasIntermedias]);

  useEffect(() => {
    calcularTarifa();
  }, [vehiculo, tipoCarga, km]);

  const calcularTarifa = () => {
    if (!vehiculo || !tipoCarga || !km) {
      setPrecioBase(0);
      setPrecioCliente(0);
      setPagoChofer(0);
      setComisionPlataforma(0);
      return;
    }

    const kilometros = Number(km);

    if (!kilometros || kilometros <= 0) {
      setPrecioBase(0);
      setPrecioCliente(0);
      setPagoChofer(0);
      setComisionPlataforma(0);
      return;
    }

    const vehiculoSeleccionado = vehiculos.find((v) => v.nombre === vehiculo);
    const cargaSeleccionada = tiposCarga.find((c) => c.nombre === tipoCarga);

    if (!vehiculoSeleccionado || !cargaSeleccionada) return;

    const litrosPorKm =
      vehiculoSeleccionado.litrosKm + cargaSeleccionada.extraLitros;

    const valores = calcularValores(
      kilometros,
      litrosPorKm,
      vehiculoSeleccionado.minimo
    );

    setPrecioBase(valores.base);
    setPrecioCliente(valores.cliente);
    setPagoChofer(valores.chofer);
    setComisionPlataforma(valores.comision);
  };

  // Paradas intermedias — handlers
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

    if (!origen || !destino || !vehiculo || !peso || !tipoCarga) {
      alert("Completá todos los campos");
      return;
    }

    const usuarioGuardado = localStorage.getItem("usuario");

    if (!usuarioGuardado) {
      alert("Sesión no encontrada. Volvé a iniciar sesión.");
      router.push("/login");
      return;
    }

    const usuario = JSON.parse(usuarioGuardado);

    const vehiculoSeleccionado = vehiculos.find((v) => v.nombre === vehiculo);
    const cargaSeleccionada = tiposCarga.find((c) => c.nombre === tipoCarga);

    if (!vehiculoSeleccionado || !cargaSeleccionada) {
      alert("Seleccioná vehículo y tipo de carga válidos");
      return;
    }

    const litrosPorKm =
      vehiculoSeleccionado.litrosKm + cargaSeleccionada.extraLitros;

    const kilometros = Number(km || calcularKmAutomatico(origen, destino));

    if (!kilometros || kilometros <= 0) {
      alert("No se pudo calcular la distancia del viaje");
      return;
    }

    setPublicando(true);

    const valoresFinales = calcularValores(
      kilometros,
      litrosPorKm,
      vehiculoSeleccionado.minimo
    );

    // Insert principal en cargas
    const { data, error } = await supabase
      .from("cargas")
      .insert([
        {
          cliente_id: usuario.id,
          origen,
          destino,
          vehiculo,
          peso,
          tipo_carga: tipoCarga,
          detalles: presentacion,
          km_estimados: kilometros,
          litros_por_km: litrosPorKm,
          precio_base: valoresFinales.base,
          precio_cliente: valoresFinales.cliente,
          pago_chofer: valoresFinales.chofer,
          comision_plataforma: valoresFinales.comision,
          estado: "pendiente",
          tracking: false,
        },
      ])
      .select()
      .single();

    if (error) {
      console.log(error);
      alert(error.message);
      setPublicando(false);
      return;
    }

    // Insert en paradas_viaje solo si hay paradas intermedias válidas
    const paradasValidas = paradasIntermedias.filter((p) => p.trim() !== "");

    if (paradasValidas.length > 0) {
      const filas = [
        // Parada 0 — retiro (origen)
        {
          carga_id: data.id,
          orden: 0,
          tipo: "retiro",
          direccion: origen,
          estado: "pendiente",
        },
        // Paradas intermedias
        ...paradasValidas.map((direccion, index) => ({
          carga_id: data.id,
          orden: index + 1,
          tipo: "entrega",
          direccion: direccion.trim(),
          estado: "pendiente",
        })),
        // Parada final — destino
        {
          carga_id: data.id,
          orden: paradasValidas.length + 1,
          tipo: "entrega",
          direccion: destino,
          estado: "pendiente",
        },
      ];

      const { error: errorParadas } = await supabase
        .from("paradas_viaje")
        .insert(filas);

      if (errorParadas) {
        // No bloqueante — el viaje se publicó igual
        console.error("Error insertando paradas_viaje:", errorParadas);
      }
    }

    setPublicando(false);
    localStorage.setItem("viajeActivoId", data.id);
    router.push("/panel-cliente");
  };

  if (!autorizado) return null;

  return (
    <main className="min-h-screen bg-black text-white p-6 md:p-10">
      <h1 className="text-4xl md:text-5xl font-bold text-yellow-400 mb-8">
        Publicar carga
      </h1>

      <div className="grid gap-6 max-w-3xl">

        <input
          type="text"
          placeholder="Origen (punto de retiro)"
          value={origen}
          onChange={(e) => setOrigen(e.target.value)}
          className="bg-zinc-900 p-4 rounded-xl"
        />

        {/* Paradas intermedias */}
        {paradasIntermedias.map((parada, index) => (
          <div key={index} className="flex gap-3 items-center">
            <input
              type="text"
              placeholder={`Parada ${index + 1} — dirección de entrega`}
              value={parada}
              onChange={(e) => actualizarParada(index, e.target.value)}
              className="bg-zinc-900 p-4 rounded-xl flex-1"
            />
            <button
              onClick={() => eliminarParada(index)}
              className="bg-red-800 hover:bg-red-700 text-white font-black px-4 py-4 rounded-xl"
            >
              ✕
            </button>
          </div>
        ))}

        {/* Botón agregar parada */}
        {paradasIntermedias.length < MAX_PARADAS && (
          <button
            onClick={agregarParada}
            className="bg-zinc-800 hover:bg-zinc-700 border border-dashed border-yellow-400 text-yellow-400 font-black py-4 rounded-xl"
          >
            + Agregar parada intermedia ({paradasIntermedias.length}/{MAX_PARADAS})
          </button>
        )}

        <input
          type="text"
          placeholder="Destino final"
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          className="bg-zinc-900 p-4 rounded-xl"
        />

        <select
          value={vehiculo}
          onChange={(e) => setVehiculo(e.target.value)}
          className="bg-zinc-900 p-4 rounded-xl"
        >
          <option value="">Seleccionar tipo de vehículo</option>
          {vehiculos.map((v) => (
            <option key={v.nombre} value={v.nombre}>
              {v.nombre}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Peso"
          value={peso}
          onChange={(e) => setPeso(e.target.value)}
          className="bg-zinc-900 p-4 rounded-xl"
        />

        <select
          value={tipoCarga}
          onChange={(e) => setTipoCarga(e.target.value)}
          className="bg-zinc-900 p-4 rounded-xl"
        >
          <option value="">Seleccionar tipo de carga</option>
          {tiposCarga.map((c) => (
            <option key={c.nombre} value={c.nombre}>
              {c.nombre}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Presentación / detalles"
          value={presentacion}
          onChange={(e) => setPresentacion(e.target.value)}
          className="bg-zinc-900 p-4 rounded-xl"
        />

        <div className="bg-zinc-900 border border-yellow-400 rounded-3xl p-6">
          <h2 className="text-3xl font-black text-yellow-400 mb-4">
            Tarifa automática
          </h2>

          <div className="space-y-3 text-xl">
            <p>
              💰 <strong>Precio final cliente:</strong>{" "}
              ${precioCliente.toLocaleString()}
            </p>

            <p className="text-zinc-400">
              📍{" "}
              {paradasIntermedias.filter((p) => p.trim()).length > 0
                ? `Distancia total por ruta multietapa: ${km || "Calculando..."} km`
                : `Distancia calculada automáticamente: ${km || "Calculando..."} km`}
            </p>

            {paradasIntermedias.filter((p) => p.trim()).length > 0 && (
              <p className="text-zinc-500 text-sm">
                * Tarifa calculada solo entre origen y destino final.
                Las paradas intermedias no afectan el precio en esta versión.
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={publicarCarga}
          disabled={publicando}
          className={`p-4 rounded-xl font-bold text-xl ${
            publicando
              ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
              : "bg-yellow-400 hover:bg-yellow-500 text-black"
          }`}
        >
          {publicando ? "Publicando..." : "Publicar carga"}
        </button>

      </div>
    </main>
  );
}