// Utilidad mínima de voz para navegación. Diagnóstico en dispositivo real (Android 14,
// WebView Chrome/150) confirmó que el WebView de Android NO implementa el Web Speech API:
// ni window.speechSynthesis ni SpeechSynthesisUtterance existen ahí (a diferencia de la
// app de Chrome para Android, que sí los tiene) — no es un bug de esta app, es una
// limitación del componente nativo WebView, no solucionable con JS/polyfills.
//
// Por eso: en la app nativa (Capacitor) se usa el plugin @capacitor-community/text-to-speech,
// que habla directo con el motor de TTS del sistema operativo (android.speech.tts.TextToSpeech
// en Android, AVSpeechSynthesizer en iOS) por fuera del WebView. En navegador (Chrome de
// escritorio, usado para probar durante desarrollo) se sigue usando Web Speech API, que ahí
// sí funciona — no depende del plugin nativo.
//
// Import dinámico de @capacitor/core (mismo patrón que ya usa app/utils/salirApp.ts) para no
// cargar código nativo-only durante SSR/build de Next.js.

const hablarNativo = async (texto: string): Promise<boolean> => {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return false;
    const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
    // queueStrategy por defecto es Flush: corta cualquier locución en curso antes de
    // hablar la nueva, igual que el .cancel() del camino web — nunca dos voces superpuestas.
    await TextToSpeech.speak({ text: texto, lang: "es-AR", rate: 1 });
    return true;
  } catch {
    return false; // no es Capacitor nativo, o el plugin falló — cae al camino web
  }
};

const detenerVozNativo = async (): Promise<boolean> => {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return false;
    const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
    await TextToSpeech.stop();
    return true;
  } catch {
    return false;
  }
};

export const vozDisponible = (): boolean =>
  typeof window !== "undefined" && "speechSynthesis" in window;

// Fire-and-forget a propósito: ningún llamador necesita esperar a que termine de hablar.
export const hablar = (texto: string): void => {
  (async () => {
    if (await hablarNativo(texto)) return;
    // Camino web (navegador de escritorio/desarrollo) — cancela cualquier locución en
    // curso antes de hablar, nunca quedan dos voces superpuestas.
    if (!vozDisponible()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(texto);
    utterance.lang = "es-AR";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  })();
};

export const detenerVoz = (): void => {
  (async () => {
    if (await detenerVozNativo()) return;
    if (!vozDisponible()) return;
    window.speechSynthesis.cancel();
  })();
};
