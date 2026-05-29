"use client";

import { useEffect, useState } from "react";
const PRECIO_LITRO = 2200;
const COMISION_CLIENTE = 0.075;
const COMISION_CHOFER = 0.075;

const litrosPorTipo: Record<string, number> = {
  "Carga general": 1.50,
  "Chatarra": 1.50,
  "Electrónica": 2.25,
  "Refrigerados": 2.25,
  "Carga industrial": 2.75,
  "Peligrosa": 4.50,
};

const formatoPesos = (valor: number) => {
  return valor.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
};

const calcularTarifa = (km: number, tipo: string, peajes = 0) => {
  const litros = litrosPorTipo[tipo] || 1.25;
  const base = km * litros * PRECIO_LITRO;
  const subtotal = base + peajes;

  return {
    litros,
    base,
    subtotal,
    clientePaga: Math.floor(subtotal * (1 + COMISION_CLIENTE)),
    choferCobra: Math.floor(subtotal * (1 - COMISION_CHOFER)),
    comisionApp: Math.floor(subtotal * 0.15),
  };
};
const cargasIniciales = [
  {
    origen: "Puerto Madryn",
    destino: "Córdoba",
    vehiculo: "Semi",
    peso: "20 toneladas",
    km: 1400,
    peajes: 45000,
    tipo: "Carga general",
  },

  {
    origen: "Rosario",
    destino: "Buenos Aires",
    vehiculo: "Chasis",
    peso: "15 toneladas",
    km: 300,
    peajes: 18000,
    tipo: "Electrónica",
  },

  {
    origen: "Pilar",
    destino: "Mar del Plata",
    vehiculo: "Utilitario",
    peso: "10 toneladas",
    km: 400,
    peajes: 22000,
    tipo: "Refrigerados",
  },

  {
    origen: "Tigre",
    destino: "Mendoza",
    vehiculo: "Semi",
    peso: "25 toneladas",
    km: 1050,
    peajes: 60000,
    tipo: "Carga industrial",
  },
];

let alertaAudio: HTMLAudioElement | null = null;
let alertaTimer: ReturnType<typeof setTimeout> | null = null;

export default function CargasPage() {
  const [cargas, setCargas] = useState<any[]>([]);
  const [indiceActual, setIndiceActual] = useState(0);
  const [choferOcupado, setChoferOcupado] = useState(false);
  const [viajeActivo, setViajeActivo] = useState<any | null>(null);
  const [alertaActiva, setAlertaActiva] = useState(false);
  const detenerAlerta = () => {
    if (alertaAudio) {
      alertaAudio.pause();
      alertaAudio.currentTime = 0;
      alertaAudio.src = "";
      alertaAudio = null;
    }

    if (alertaTimer) {
      clearTimeout(alertaTimer);
      alertaTimer = null;
    }
  };

  const iniciarAlerta = () => {
    detenerAlerta();setAlertaActiva(false);
    setAlertaActiva(true);
    const audio = new Audio("/sounds/alerta-viaje.mp3");
    alertaAudio = audio;
    audio.volume = 1;
    audio.loop = true;
    audio.play().catch(() => {});

    alertaTimer = setTimeout(() => {
      detenerAlerta();
    }, 25000);
  };

  useEffect(() => {
    setCargas(cargasIniciales);
    setIndiceActual(0);
  
    setTimeout(() => {
      iniciarAlerta();
    }, 1200);
  
    return () => {
      detenerAlerta();
    };
  }, []);

  const tomarViaje = () => {
    detenerAlerta();

    const carga = cargas[indiceActual];
    if (!carga) return;

    setChoferOcupado(true);
    setViajeActivo(carga);

    const nuevasCargas = cargas.filter((_, i) => i !== indiceActual);
    setCargas(nuevasCargas);
    setIndiceActual(-1);

    const origen = encodeURIComponent(carga.origen + " Argentina");
    const destino = encodeURIComponent(carga.destino + " Argentina");

    window.open(
      `https://www.google.com/maps/dir/?api=1&origin=${origen}&destination=${destino}`,
      "_blank"
    );
  };

  const rechazarViaje = () => {
    detenerAlerta();
  
    const nuevasCargas = cargas.filter((_, i) => i !== indiceActual);
  
    setCargas(nuevasCargas);
  
    if (nuevasCargas.length === 0) {
      setIndiceActual(-1);
      return;
    }
  
    setIndiceActual(0);
  
    setTimeout(() => {
      iniciarAlerta();
    }, 500);
  };
  
  const finalizarViaje = () => {
    detenerAlerta();
  
    setChoferOcupado(false);
  
    setViajeActivo(null);
  
    if (cargas.length > 0) {
      setIndiceActual(0);
  
      setTimeout(() => {
        iniciarAlerta();
      }, 500);
    }
  };

  const cargaActual = cargas[indiceActual];
  
  const tarifa = cargaActual
  ? calcularTarifa(
      cargaActual.km || 0,
      cargaActual.tipo || "Carga general",
      cargaActual.peajes || 0
    )
  : null;
  
  return (
    <main className="min-h-screen bg-zinc-950 text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-20"></div>

      <div className="relative z-10 p-6">
        <div className="mb-8">
          <p className="text-green-400 font-black text-xl">
            {choferOcupado ? "🔴 OCUPADO" : "🟢 CONECTADO"}
          </p>
          <p className="text-zinc-400">
            {choferOcupado ? "Viaje en curso" : "Buscando viajes..."}
          </p>
        </div>

        {choferOcupado && viajeActivo ? (
          <div className="bg-zinc-900 p-8 rounded-3xl max-w-4xl border-4 border-green-500">
            <h1 className="text-4xl font-black text-green-400">
              Viaje aceptado
            </h1>

            <h2 className="text-3xl font-bold mt-6">
              {viajeActivo.origen} → {viajeActivo.destino}
            </h2>

            <p className="text-yellow-400 text-4xl mt-5 font-black">
              {viajeActivo.precio}
            </p>

            <button
              type="button"
              onClick={finalizarViaje}
              className="mt-8 w-full bg-green-500 hover:bg-green-600 text-black font-black px-8 py-5 rounded-2xl text-2xl"
            >
              FINALIZAR VIAJE
            </button>
          </div>
        ) : !cargaActual ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 text-center">
            <h2 className="text-3xl font-black text-yellow-400">
              No hay cargas disponibles
            </h2>
            <p className="text-zinc-400 mt-4">
              Esperando nuevos viajes...
            </p>
          </div>
        ) : (
          <div className="bg-zinc-900 p-8 rounded-3xl max-w-4xl border-4 border-yellow-400 shadow-2xl animate-pulse">
            <div className="text-center mb-6">
              <p className="text-red-500 text-2xl font-black animate-bounce">
                🚨 NUEVO VIAJE DISPONIBLE 🚨
              </p>
            </div>

            <h2 className="text-3xl font-black">
              {cargaActual.origen} → {cargaActual.destino}
            </h2>

            <p className="text-zinc-400 mt-2 text-lg">
              {cargaActual.vehiculo} · {cargaActual.peso}
            </p>

            <p className="text-yellow-400 text-4xl mt-5 font-black">
              {cargaActual.precio}
            </p>

            <p className="text-zinc-300 mt-5 text-lg">
              {cargaActual.detalles}
              <div className="mt-6 bg-black/40 rounded-2xl p-5 border border-zinc-700">
  <p className="text-zinc-400 text-sm">
    Cliente paga
  </p>

  <p className="text-3xl font-black text-yellow-400">
   {tarifa ? formatoPesos(tarifa.clientePaga) : ""}
  </p>

  <div className="mt-4 flex justify-between">
    <div>
      <p className="text-zinc-400 text-sm">
        Chofer cobra
      </p>

      <p className="text-2xl font-bold text-green-400">
  {tarifa ? formatoPesos(tarifa.choferCobra) : ""}
</p>

    </div>

    <div className="text-right">
    <p className="text-zinc-400 text-sm">
  Comisión app
</p> 
    <p className="text-2xl font-bold text-red-400">
  {tarifa ? formatoPesos(tarifa.comisionApp) : ""}
</p>
    </div>
  </div>
</div>
</p>

 <div className="mt-6 rounded-2xl overflow-hidden border-2 border-yellow-400">
              <iframe
                src={`https://www.google.com/maps?q=${encodeURIComponent(
                  cargaActual.origen + " Argentina"
                )}&output=embed`}
                width="100%"
                height="320"
                loading="lazy"
              ></iframe>
            </div>

            <button
              type="button"
              onClick={tomarViaje}
              className="mt-8 w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black px-8 py-5 rounded-2xl text-2xl"
            >
              ACEPTAR VIAJE
            </button>

            <button
              type="button"
              onClick={rechazarViaje}
              className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white font-black px-8 py-5 rounded-2xl text-xl"
            >
              RECHAZAR
            </button>
          </div>
        )}
      </div>
    </main>
  );
}