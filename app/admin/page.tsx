"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";                                   
import BotonCerrarSesion from "../components/BotonCerrarSesion";
import { useProtegerRuta } from "../hooks/useProtegerRuta";

const ESTADOS_VIAJE = [
  "Chofer asignado",
  "En camino",
  "Carga retirada",
  "En ruta",
  "Descarga completada",
  "Viaje finalizado",
];

const ESTADOS_ACTIVOS = [
  "Chofer asignado",
  "En camino",
  "Carga retirada",
  "En ruta",
  "Descarga completada",
];

const colorEstado = (estado: string) => {
  switch (estado) {
    case "Chofer asignado":
      return "bg-green-700 text-white";
    case "En camino":
      return "bg-yellow-400 text-black";
    case "Carga retirada":
      return "bg-blue-600 text-white";
    case "En ruta":
      return "bg-zinc-600 text-white";
    case "Descarga completada":
      return "bg-red-600 text-white";
    case "Viaje finalizado":
      return "bg-green-500 text-white";
    default:
      return "bg-zinc-800 text-white";
  }
};

// ─── Tarjetas fuera del componente principal para evitar recreación en cada render ───

const TarjetaChofer = ({
  chofer,
  onActualizarValidacion,
}: {
  chofer: any;
  onActualizarValidacion: (id: string, estado: string) => void;
}) => (
  <div className="bg-black border border-zinc-800 rounded-2xl p-5">
    <div className="flex items-center justify-between mb-3 gap-3">
      <h3 className="text-xl font-black text-yellow-400">
        {chofer.nombre || "Chofer"}
      </h3>

      <span
        className={`px-3 py-1 rounded-xl text-sm font-black ${
          chofer.online ? "bg-green-500 text-black" : "bg-red-600 text-white"
        }`}
      >
        {chofer.online ? "ONLINE" : "OFFLINE"}
      </span>
    </div>

    <div className="space-y-2 text-sm">
      <p>🚛 <strong>Vehículo:</strong> {chofer.vehiculo || "Sin dato"}</p>
      <p>🪪 <strong>Patente:</strong> {chofer.patente || "Sin dato"}</p>
      <p>📦 <strong>Capacidad:</strong> {chofer.capacidad_carga || "Sin dato"}</p>
      <p>📍 <strong>Zona:</strong> {chofer.zona_operativa || "Sin dato"}</p>
      <p>📞 <strong>Teléfono:</strong> {chofer.telefono || "Sin dato"}</p>
      <p>📧 <strong>Email:</strong> {chofer.email || "Sin dato"}</p>
      <p>🪪 <strong>DNI:</strong> {chofer.dni || "Sin dato"}</p>
      <p>📄 <strong>Licencia:</strong> {chofer.licencia || "Sin dato"}</p>
      <p>🛡️ <strong>Seguro:</strong> {chofer.seguro_vehiculo || "Sin dato"}</p>
      <p>
        ✅ <strong>Estado:</strong>{" "}
        <span className="text-yellow-400 font-black">
          {chofer.estado_validacion || "pendiente"}
        </span>
      </p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
      <button
        onClick={() => onActualizarValidacion(chofer.id, "aprobado")}
        className="bg-green-600 text-white font-black py-3 rounded-2xl"
      >
        APROBAR
      </button>
      <button
        onClick={() => onActualizarValidacion(chofer.id, "pendiente")}
        className="bg-yellow-400 text-black font-black py-3 rounded-2xl"
      >
        PENDIENTE
      </button>
      <button
        onClick={() => onActualizarValidacion(chofer.id, "bloqueado")}
        className="bg-red-700 text-white font-black py-3 rounded-2xl"
      >
        BLOQUEAR
      </button>
    </div>
  </div>
);

const TarjetaCliente = ({ cliente }: { cliente: any }) => (
  <div className="bg-black border border-zinc-800 rounded-2xl p-5">
    <h3 className="text-xl font-black text-purple-400 mb-3">
      {cliente.nombre || "Cliente"}
    </h3>

    <div className="space-y-2 text-sm">
      <p>📧 <strong>Email:</strong> {cliente.email || "Sin dato"}</p>
      <p>📞 <strong>Teléfono:</strong> {cliente.telefono || "Sin dato"}</p>
      <p>🪪 <strong>DNI:</strong> {cliente.dni || "Sin dato"}</p>
      <p>📅 <strong>Registro:</strong> {cliente.created_at?.slice(0, 10) || "Sin dato"}</p>
    </div>
  </div>
);

const TarjetaViaje = ({
  carga,
  onAbrirCliente,
  onAbrirChofer,
  onAsignarChofer,
  onEliminarViaje,
  onActualizarEstado,
}: {
  carga: any;
  onAbrirCliente: (id: string) => void;
  onAbrirChofer: (id: string) => void;
  onAsignarChofer: (id: string) => void;
  onEliminarViaje: (id: string) => void;
  onActualizarEstado: (id: string, estado: string) => void;
}) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 shadow-xl">
    <div className="flex flex-col gap-3 mb-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-2xl font-black text-yellow-400">
          {carga.origen} → {carga.destino}
        </h3>

        <span className={`px-3 py-2 rounded-2xl font-black text-sm ${colorEstado(carga.estado)}`}>
          {carga.estado || "Pendiente"}
        </span>
      </div>

      <p className="text-zinc-500 text-sm">
        ID: {String(carga.id).slice(0, 8)} · {carga.created_at?.slice(0, 10)}
      </p>
    </div>

    <div className="grid grid-cols-1 gap-2 text-sm mb-5">
      <p>🚛 <strong>Vehículo:</strong> {carga.vehiculo || "Sin dato"}</p>
      <p>📍 <strong>Distancia:</strong> {carga.km_estimados ? `${carga.km_estimados} km` : "Sin calcular"}</p>
      <p>⚖️ <strong>Peso:</strong> {carga.peso || "Sin dato"}</p>
      <p>📦 <strong>Tipo:</strong> {carga.tipo_carga || "Sin dato"}</p>
      <p>⚙️ <strong>Base:</strong> ${Number(carga.precio_base || 0).toLocaleString()}</p>
      <p>💰 <strong>Cliente paga:</strong> ${Number(carga.precio_cliente || 0).toLocaleString()}</p>
      <p>🚛 <strong>Chofer cobra:</strong> ${Number(carga.pago_chofer || 0).toLocaleString()}</p>
      <p className="text-green-400 font-black">
        🏦 <strong>Comisión plataforma:</strong> ${Number(carga.comision_plataforma || 0).toLocaleString()}
      </p>
      <p>👨‍✈️ <strong>Chofer:</strong> {carga.chofer_id || "Sin asignar"}</p>
      <p>📡 <strong>Tracking:</strong> {carga.tracking ? "Activo" : "Inactivo"}</p>
      <p>📍 <strong>GPS:</strong> {carga.lat && carga.lng ? `${carga.lat}, ${carga.lng}` : "Sin GPS"}</p>
      <p>
        🕒 <strong>GPS actualizado:</strong>{" "}
        {carga.gps_actualizado ? new Date(carga.gps_actualizado).toLocaleString() : "Sin datos"}
      </p>

      {carga.lat && carga.lng && (
        <a
          href={`https://www.google.com/maps?q=${carga.lat},${carga.lng}`}
          target="_blank"
          rel="noreferrer"
          className="bg-green-700 text-white font-black py-3 rounded-2xl text-center block mt-2"
        >
          Abrir GPS en mapa
        </a>
      )}
    </div>

    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={() => onAbrirCliente(carga.id)}
        className="bg-yellow-400 text-black font-black py-3 rounded-2xl"
      >
        Cliente
      </button>
      <button
        onClick={() => onAbrirChofer(carga.id)}
        className="bg-green-600 text-white font-black py-3 rounded-2xl"
      >
        Chofer
      </button>
      <button
        onClick={() => onAsignarChofer(carga.id)}
        className="bg-blue-600 text-white font-black py-3 rounded-2xl"
      >
        Asignar
      </button>
      <button
        onClick={() => onEliminarViaje(carga.id)}
        className="bg-red-900 text-white font-black py-3 rounded-2xl"
      >
        Eliminar
      </button>
    </div>

    <div className="grid grid-cols-2 gap-2 mt-3">
      {ESTADOS_VIAJE.map((estado) => (
        <button
          key={estado}
          onClick={() => onActualizarEstado(carga.id, estado)}
          className={`font-black py-2 rounded-xl text-xs ${
            carga.estado === estado
              ? `${colorEstado(estado)} ring-2 ring-white`
              : "bg-zinc-800 text-zinc-400"
          }`}
        >
          {estado}
        </button>
      ))}
    </div>
  </div>
);

// ─── Componente principal ───────────────────────────────────────────────────────

export default function AdminPage() {
  const { autorizado } = useProtegerRuta("admin");

  const [cargas, setCargas] = useState<any[]>([]);
  const [choferes, setChoferes] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargarViajes = useCallback(async () => {
    const { data, error } = await supabase
      .from("cargas")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error cargando viajes:", error);
      return;
    }

    setCargas(data || []);
  }, []);

  const cargarChoferes = useCallback(async () => {
    const { data, error } = await supabase
      .from("usuarios")
      .select("*")
      .eq("rol", "chofer")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error cargando choferes:", error);
      return;
    }

    setChoferes(data || []);
  }, []);

  const cargarClientes = useCallback(async () => {
    const { data, error } = await supabase
      .from("usuarios")
      .select("*")
      .eq("rol", "cliente")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error cargando clientes:", error);
      return;
    }

    setClientes(data || []);
  }, []);

  useEffect(() => {
    const iniciarAdmin = async () => {
      setCargando(true);

      try {
        await Promise.all([
          cargarViajes(),
          cargarChoferes(),
          cargarClientes(),
        ]);
      } catch (error) {
        console.error("Error iniciando admin:", error);
      } finally {
        // Garantiza que el estado de carga se limpia siempre,
        // incluso si alguna query falla
        setCargando(false);
      }
    };

    iniciarAdmin();

    const channel = supabase
      .channel("admin-central-operativa-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cargas" },
        async () => {
          await cargarViajes();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "usuarios" },
        async () => {
          await cargarChoferes();
          await cargarClientes();
        }
      )
      .subscribe();

    const intervalo = setInterval(() => {
      cargarViajes();
      cargarChoferes();
      cargarClientes();
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(intervalo);
    };
  }, [cargarViajes, cargarChoferes, cargarClientes]);

  const pendientes = useMemo(() => {
    return cargas.filter(
      (c) => !c.estado || c.estado.toLowerCase() === "pendiente"
    );
  }, [cargas]);

  const activos = useMemo(() => {
    return cargas.filter((c) => ESTADOS_ACTIVOS.includes(c.estado));
  }, [cargas]);

  const finalizados = useMemo(() => {
    return cargas.filter((c) => c.estado === "Viaje finalizado");
  }, [cargas]);

  const choferesOnline = useMemo(() => {
    return choferes.filter((c) => c.online === true);
  }, [choferes]);

  const gpsActivos = useMemo(() => {
    return cargas.filter(
      (c) =>
        c.lat &&
        c.lng &&
        c.estado !== "Viaje finalizado" &&
        ESTADOS_ACTIVOS.includes(c.estado)
    );
  }, [cargas]);

  const primerGpsActivo = gpsActivos[0];

  const actualizarValidacionChofer = async (id: string, estado: string) => {
    const { error } = await supabase
      .from("usuarios")
      .update({ estado_validacion: estado })
      .eq("id", id);

    if (error) {
      console.error(error);
      alert("Error al actualizar chofer");
      return;
    }

    await cargarChoferes();
  };

  const actualizarEstado = async (id: string, estado: string) => {
    const updateData: any = { estado };

    if (estado === "Viaje finalizado") {
      updateData.tracking = false;
    }

    const { error } = await supabase
      .from("cargas")
      .update(updateData)
      .eq("id", id);

    if (error) {
      console.error(error);
      alert("Error al actualizar estado");
      return;
    }

    await cargarViajes();
  };

  const asignarChofer = async (id: string) => {
    const { error } = await supabase
      .from("cargas")
      .update({
        estado: "Chofer asignado",
        chofer_id: "chofer_demo",
        tracking: true,
      })
      .eq("id", id);

    if (error) {
      console.error(error);
      alert("Error al asignar chofer");
      return;
    }

    await cargarViajes();
  };

  const eliminarViaje = async (id: string) => {
    const ok = confirm("¿Eliminar este viaje?");
    if (!ok) return;

    const { error } = await supabase.from("cargas").delete().eq("id", id);

    if (error) {
      console.error(error);
      alert("Error al eliminar viaje");
      return;
    }

    await cargarViajes();
  };

  const abrirCliente = (id: string) => {
    localStorage.setItem("viajeActivoId", id);
    window.open("/panel-cliente", "_blank");
  };

  const abrirChofer = (id: string) => {
    localStorage.setItem("viajeActivoId", id);
    window.open("/viaje-activo", "_blank");
  };

  if (!autorizado) return null;

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <header className="mb-8">
        <h1 className="text-5xl font-black text-yellow-400">
          CENTRAL OPERATIVA
        </h1>
        <p className="text-zinc-400 mt-2">
          Despacho, monitoreo y control de viajes en tiempo real
        </p>
        <BotonCerrarSesion />
      </header>

      {cargando && (
        <div className="bg-yellow-400 text-black font-black rounded-2xl p-4 mb-6">
          Cargando central operativa...
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-zinc-900 border border-yellow-400 rounded-3xl p-6">
          <p className="text-zinc-400">Pendientes</p>
          <h2 className="text-6xl font-black text-yellow-400">{pendientes.length}</h2>
        </div>

        <div className="bg-zinc-900 border border-green-400 rounded-3xl p-6">
          <p className="text-zinc-400">Activos</p>
          <h2 className="text-6xl font-black text-green-400">{activos.length}</h2>
        </div>

        <div className="bg-zinc-900 border border-red-400 rounded-3xl p-6">
          <p className="text-zinc-400">Finalizados</p>
          <h2 className="text-6xl font-black text-red-400">{finalizados.length}</h2>
        </div>

        <div className="bg-zinc-900 border border-blue-400 rounded-3xl p-6">
          <p className="text-zinc-400">Choferes online</p>
          <h2 className="text-6xl font-black text-blue-400">{choferesOnline.length}</h2>
        </div>

        <div className="bg-zinc-900 border border-purple-400 rounded-3xl p-6">
          <p className="text-zinc-400">Clientes</p>
          <h2 className="text-6xl font-black text-purple-400">{clientes.length}</h2>
        </div>
      </section>

      <section className="bg-zinc-900 border border-green-400 rounded-3xl p-6 mb-8">
        <h2 className="text-3xl font-black text-green-400 mb-6">
          Choferes registrados
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {choferes.length === 0 ? (
            <p className="text-zinc-500">No hay choferes registrados.</p>
          ) : (
            choferes.map((chofer) => (
              <TarjetaChofer
                key={chofer.id}
                chofer={chofer}
                onActualizarValidacion={actualizarValidacionChofer}
              />
            ))
          )}
        </div>
      </section>

      <section className="bg-zinc-900 border border-purple-400 rounded-3xl p-6 mb-8">
        <h2 className="text-3xl font-black text-purple-400 mb-6">
          Clientes registrados
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {clientes.length === 0 ? (
            <p className="text-zinc-500">No hay clientes registrados.</p>
          ) : (
            clientes.map((cliente) => (
              <TarjetaCliente key={cliente.id} cliente={cliente} />
            ))
          )}
        </div>
      </section>

      <section className="bg-zinc-900 border border-yellow-400 rounded-3xl p-6 mb-8">
        <h2 className="text-3xl font-black text-yellow-400 mb-4">
          Mapa Global Operativo
        </h2>

        <div className="rounded-3xl overflow-hidden border-2 border-yellow-400 mb-6">
          <iframe
            title="Mapa global operativo TILA"
            src={`https://www.google.com/maps?q=${encodeURIComponent(
              primerGpsActivo
                ? `${primerGpsActivo.lat},${primerGpsActivo.lng}`
                : "Argentina"
            )}&output=embed`}
            width="100%"
            height="420"
            loading="lazy"
          />
        </div>

        <h3 className="text-2xl font-black text-green-400 mb-4">
          GPS activos en tiempo real
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {gpsActivos.length === 0 ? (
            <p className="text-zinc-500">No hay unidades con GPS activo todavía.</p>
          ) : (
            gpsActivos.map((carga) => (
              <div key={carga.id} className="bg-black border border-zinc-800 rounded-2xl p-5">
                <h4 className="text-xl font-black text-yellow-400 mb-2">
                  {carga.origen} → {carga.destino}
                </h4>

                <p className="text-sm">🚛 <strong>Vehículo:</strong> {carga.vehiculo || "Sin dato"}</p>
                <p className="text-sm">👨‍✈️ <strong>Chofer:</strong> {carga.chofer_id || "Sin asignar"}</p>
                <p className="text-sm">📦 <strong>Estado:</strong> {carga.estado}</p>
                <p className="text-sm">📍 <strong>GPS:</strong> {carga.lat}, {carga.lng}</p>
                <p className="text-sm text-zinc-400">
                  🕒 <strong>Actualizado:</strong>{" "}
                  {carga.gps_actualizado ? new Date(carga.gps_actualizado).toLocaleString() : "Sin dato"}
                </p>

                <a
                  href={`https://www.google.com/maps?q=${carga.lat},${carga.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block bg-green-700 hover:bg-green-600 text-white font-black text-center py-3 rounded-2xl mt-4"
                >
                  Abrir ubicación
                </a>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div>
          <h2 className="text-3xl font-black text-yellow-400 mb-4">Pendientes</h2>
          <div className="grid gap-4">
            {pendientes.length === 0 ? (
              <p className="text-zinc-500">Sin pendientes.</p>
            ) : (
              pendientes.map((carga) => (
                <TarjetaViaje
                  key={carga.id}
                  carga={carga}
                  onAbrirCliente={abrirCliente}
                  onAbrirChofer={abrirChofer}
                  onAsignarChofer={asignarChofer}
                  onEliminarViaje={eliminarViaje}
                  onActualizarEstado={actualizarEstado}
                />
              ))
            )}
          </div>
        </div>

        <div>
          <h2 className="text-3xl font-black text-green-400 mb-4">Activos</h2>
          <div className="grid gap-4">
            {activos.length === 0 ? (
              <p className="text-zinc-500">Sin activos.</p>
            ) : (
              activos.map((carga) => (
                <TarjetaViaje
                  key={carga.id}
                  carga={carga}
                  onAbrirCliente={abrirCliente}
                  onAbrirChofer={abrirChofer}
                  onAsignarChofer={asignarChofer}
                  onEliminarViaje={eliminarViaje}
                  onActualizarEstado={actualizarEstado}
                />
              ))
            )}
          </div>
        </div>

        <div>
          <h2 className="text-3xl font-black text-red-400 mb-4">Finalizados</h2>
          <div className="grid gap-4">
            {finalizados.length === 0 ? (
              <p className="text-zinc-500">Sin finalizados.</p>
            ) : (
              finalizados.map((carga) => (
                <TarjetaViaje
                  key={carga.id}
                  carga={carga}
                  onAbrirCliente={abrirCliente}
                  onAbrirChofer={abrirChofer}
                  onAsignarChofer={asignarChofer}
                  onEliminarViaje={eliminarViaje}
                  onActualizarEstado={actualizarEstado}
                />
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}