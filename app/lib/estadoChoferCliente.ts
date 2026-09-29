/**
 * Cliente de /api/chofer/estado (ver app/lib/estadoChofer.ts). Reemplaza los UPDATE
 * directos a `usuarios` con la clave anon. Devuelve true si el servidor aceptó el cambio;
 * nunca lanza (las llamadas de señal/batería son "fire and forget", como antes).
 */
export async function actualizarEstadoChofer(
  userId: string,
  cambios: { online?: boolean; navegador_preferido?: string; bateria_nivel?: number | null; bateria_cargando?: boolean | null; senal?: true },
): Promise<boolean> {
  try {
    const res = await fetch("/api/chofer/estado", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json", "x-user-id": String(userId) },
      body:    JSON.stringify(cambios),
    });
    return res.ok;
  } catch {
    return false;
  }
}
