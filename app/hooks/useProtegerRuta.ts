"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Rol = "admin" | "chofer" | "cliente";

const panelPorRol: Record<Rol, string> = {
  admin: "/admin",
  chofer: "/panel-chofer",
  cliente: "/panel-cliente",
};

export function useProtegerRuta(rolRequerido: Rol) {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);

  useEffect(() => {
    try {
      const usuarioGuardado = localStorage.getItem("usuario");

      // Sin sesión → redirigir al inicio
      if (!usuarioGuardado) {
        router.replace("/");
        return;
      }

      const usuario = JSON.parse(usuarioGuardado);

      // Sesión inválida o sin rol → redirigir al inicio
      if (!usuario?.id || !usuario?.rol) {
        router.replace("/");
        return;
      }

      const rol = usuario.rol as Rol;

      // Rol incorrecto → redirigir a su panel correspondiente
      if (rol !== rolRequerido) {
        const destino = panelPorRol[rol] || "/";
        router.replace(destino);
        return;
      }

      // Todo OK → autorizar
      setAutorizado(true);
    } catch (error) {
      // localStorage corrupto → redirigir al inicio
      console.log("Error leyendo sesión:", error);
      router.replace("/");
    }
  }, [rolRequerido, router]);

  return { autorizado };
}