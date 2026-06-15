/**
 * Reproduce el sonido de notificación de chat.
 * Silencia el error si el navegador bloquea autoplay (sin gesto del usuario).
 */
export function playChatSound(): void {
  const audio = new Audio("/sounds/drop.wav");
  audio.volume = 1;
  audio.play().catch(() => {
    // Fallback: intentar con el mp3 de alerta general
    const fallback = new Audio("/sounds/alerta-viaje.mp3");
    fallback.volume = 1;
    fallback.play().catch(() => {
      // Si sigue fallando (sin gesto de usuario) — ignorar silenciosamente
    });
  });
}
