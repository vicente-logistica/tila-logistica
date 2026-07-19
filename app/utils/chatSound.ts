/**
 * Coordinador global de sonidos del chat.
 *
 * Responsabilidades:
 * - Deduplicar por ID de mensaje.
 * - Hacer converger Realtime y polling.
 * - Registrar el ID antes de intentar reproducir.
 * - Reproducir un sonido por cada mensaje entrante.
 * - Evitar que varios sonidos se disparen exactamente al mismo tiempo.
 */

export type ChatMessageId = string | number;

interface NotifyChatMessageOptions {
  silenciado?: boolean;
}

const MAX_IDS_RECORDADOS = 2000;
const ESPERA_ENTRE_SONIDOS_MS = 180;

const idsProcesados = new Set<string>();
const ordenIdsProcesados: string[] = [];

let colaSonidos: Promise<void> = Promise.resolve();

function normalizarId(id: ChatMessageId): string {
  return String(id);
}

function recordarId(id: ChatMessageId): boolean {
  const idNormalizado = normalizarId(id);

  if (idsProcesados.has(idNormalizado)) {
    return false;
  }

  /*
   * El ID se registra inmediatamente, antes del sonido o de marcar leído.
   * Así Realtime y polling nunca pueden notificar dos veces el mismo mensaje.
   */
  idsProcesados.add(idNormalizado);
  ordenIdsProcesados.push(idNormalizado);

  if (ordenIdsProcesados.length > MAX_IDS_RECORDADOS) {
    const idAntiguo = ordenIdsProcesados.shift();

    if (idAntiguo) {
      idsProcesados.delete(idAntiguo);
    }
  }

  return true;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function reproducirArchivo(src: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const audio = new Audio(src);
    audio.volume = 1;
    audio.preload = "auto";

    await audio.play();
    return true;
  } catch {
    return false;
  }
}

async function reproducirSonidoInterno(): Promise<void> {
  const principalReproducido = await reproducirArchivo("/sounds/drop.wav");

  if (!principalReproducido) {
    await reproducirArchivo("/sounds/alerta-viaje.mp3");
  }

  /*
   * Separamos mínimamente cada inicio de reproducción.
   * Cada mensaje mantiene su propio intento de sonido.
   */
  await esperar(ESPERA_ENTRE_SONIDOS_MS);
}

/**
 * API nueva y obligatoria para mensajes entrantes.
 *
 * Devuelve:
 * - true: este ID era nuevo y fue procesado.
 * - false: este ID ya había sido procesado por otro pipeline.
 */
export function notifyChatMessage(
  messageId: ChatMessageId,
  options: NotifyChatMessageOptions = {},
): boolean {
  if (!recordarId(messageId)) {
    return false;
  }

  if (!options.silenciado) {
    colaSonidos = colaSonidos
      .then(() => reproducirSonidoInterno())
      .catch(() => {
        // La cola no debe quedar bloqueada por un error de audio.
      });
  }

  return true;
}

/**
 * Registra mensajes existentes como baseline sin reproducir sonido.
 * Se usa en la carga inicial.
 */
export function markChatMessagesAsKnown(
  messageIds: readonly ChatMessageId[],
): void {
  for (const id of messageIds) {
    recordarId(id);
  }
}

/**
 * Permite consultar si un mensaje ya fue procesado.
 */
export function wasChatMessageProcessed(
  messageId: ChatMessageId,
): boolean {
  return idsProcesados.has(normalizarId(messageId));
}

/**
 * Compatibilidad temporal con código existente.
 *
 * No deduplica porque no recibe ID. Una vez migrados todos los listeners,
 * los mensajes entrantes deberán usar notifyChatMessage().
 */
export function playChatSound(): void {
  colaSonidos = colaSonidos
    .then(() => reproducirSonidoInterno())
    .catch(() => {
      // La cola no debe quedar bloqueada por un error de audio.
    });
}
