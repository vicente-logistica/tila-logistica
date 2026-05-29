"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabase";

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
  const [vehiculo, setVehiculo] = useState("");
  const [zonaOperativa, setZonaOperativa] = useState("");
  const [capacidadCarga, setCapacidadCarga] = useState("");
  const [seguroVehiculo, setSeguroVehiculo] = useState("");
  const [seguroCarga, setSeguroCarga] = useState("");
  const [vtvRto, setVtvRto] = useState("");

  const [metodoCobro, setMetodoCobro] = useState("");
  const [aliasCbuCvu, setAliasCbuCvu] = useState("");
  const [titularCuenta, setTitularCuenta] = useState("");
  const [bancoBilletera, setBancoBilletera] = useState("");

  const [loading, setLoading] = useState(false);

  const registrarChofer = async () => {
    if (
      !nombre ||
      !telefono ||
      !email ||
      !password ||
      !vehiculo ||
      !patente
    ) {
      alert(
        "Completá nombre, teléfono, email, contraseña, vehículo y patente"
      );
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("usuarios").insert([
      {
        nombre,
        email,
        password,
        telefono,
        rol: "chofer",
        acepta_terminos: true,

        dni,
        cuit_cuil: cuitCuil,
        licencia,
        cnrt_ruta: cnrtRuta,
        antecedentes,

        patente,
        vehiculo,
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
      },
    ]);

    setLoading(false);

    if (error) {
      alert("Error: " + error.message);
      return;
    }

    alert("Solicitud de chofer enviada correctamente");
    router.push("/login");
  };

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <Link href="/login" className="text-zinc-400 hover:text-white">
          ← Volver
        </Link>

        <h1 className="text-4xl font-black text-yellow-400 mt-8">
          Registro de chofer
        </h1>

        <p className="text-zinc-400 mt-3 mb-8">
          Completá tus datos. La cuenta queda pendiente hasta validar
          documentación.
        </p>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-5">
          <h2 className="text-2xl font-bold text-yellow-400">
            Datos personales
          </h2>

          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Nombre y apellido"
          />

          <input
            value={dni}
            onChange={(e) => setDni(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="DNI"
          />

          <input
            value={cuitCuil}
            onChange={(e) => setCuitCuil(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="CUIT / CUIL"
          />

          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Teléfono"
          />

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Email"
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Contraseña"
          />

          <h2 className="text-2xl font-bold text-yellow-400 pt-4">
            Documentación obligatoria
          </h2>

          <input
            value={licencia}
            onChange={(e) => setLicencia(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Licencia / registro profesional"
          />

          <input
            value={cnrtRuta}
            onChange={(e) => setCnrtRuta(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="CNRT / RUTA"
          />

          <input
            value={antecedentes}
            onChange={(e) => setAntecedentes(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Número de gestión certificado antecedentes"
          />

          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
            <p className="text-zinc-400 text-sm">
              Estado validación antecedentes
            </p>

            <p className="text-yellow-400 font-bold mt-2">
              Pendiente de validación
            </p>
          </div>

          <h2 className="text-2xl font-bold text-yellow-400 pt-4">
            Vehículo
          </h2>

          <input
            value={patente}
            onChange={(e) => setPatente(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Patente"
          />

          <input
            value={vehiculo}
            onChange={(e) => setVehiculo(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Tipo de vehículo"
          />

          <input
            value={zonaOperativa}
            onChange={(e) => setZonaOperativa(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Zona operativa"
          />

          <input
            value={capacidadCarga}
            onChange={(e) => setCapacidadCarga(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Capacidad de carga"
          />

          <input
            value={seguroVehiculo}
            onChange={(e) => setSeguroVehiculo(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Seguro del vehículo"
          />

          <input
            value={seguroCarga}
            onChange={(e) => setSeguroCarga(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Seguro de carga"
          />

          <h2 className="text-2xl font-bold text-yellow-400 pt-4">
            Fotos del vehículo
          </h2>

          <div className="bg-black border border-dashed border-zinc-700 rounded-2xl p-6 text-center text-zinc-400">
            Frente del vehículo
          </div>

          <div className="bg-black border border-dashed border-zinc-700 rounded-2xl p-6 text-center text-zinc-400">
            Laterales
          </div>

          <div className="bg-black border border-dashed border-zinc-700 rounded-2xl p-6 text-center text-zinc-400">
            Caja / acoplado / semi
          </div>

          <div className="bg-black border border-dashed border-zinc-700 rounded-2xl p-6 text-center text-zinc-400">
            Interior / cabina
          </div>

          <input
            value={vtvRto}
            onChange={(e) => setVtvRto(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="VTV / RTO"
          />

          <h2 className="text-2xl font-bold text-yellow-400 pt-4">
            Cobro del chofer
          </h2>

          <select
            value={metodoCobro}
            onChange={(e) => setMetodoCobro(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
          >
            <option value="">Método de cobro preferido</option>
            <option>Transferencia bancaria</option>
            <option>Mercado Pago</option>
            <option>Billetera virtual</option>
          </select>

          <input
            value={aliasCbuCvu}
            onChange={(e) => setAliasCbuCvu(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Alias / CBU / CVU"
          />

          <input
            value={titularCuenta}
            onChange={(e) => setTitularCuenta(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Titular de la cuenta"
          />

          <input
            value={bancoBilletera}
            onChange={(e) => setBancoBilletera(e.target.value)}
            className="w-full p-4 rounded-xl bg-black border border-zinc-700"
            placeholder="Banco / billetera"
          />

          <h2 className="text-2xl font-bold text-yellow-400 pt-4">
            Validación facial
          </h2>

          <div className="bg-black border border-dashed border-zinc-700 rounded-2xl p-6 text-center text-zinc-400">
            Selfie en vivo / reconocimiento facial
          </div>

          <button
            type="button"
            onClick={registrarChofer}
            disabled={loading}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xl py-4 rounded-2xl"
          >
            {loading ? "Enviando..." : "Enviar solicitud de validación"}
          </button>
        </div>
      </div>
    </main>
  );
}