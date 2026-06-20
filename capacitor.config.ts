import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tilalogistica.app",
  appName: "TILA Logística",
  // webDir apunta a public porque usamos server.url (modo server — no bundle estático).
  // Capacitor necesita un webDir válido aunque no lo use para contenido en modo server.
  webDir: "public",
  server: {
    // Toda la lógica (API Routes, Supabase, Mercado Pago) sigue en Vercel.
    // La app nativa es un WebView que carga esta URL.
    url: "https://tila-logistica.vercel.app",
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#09090b",
      showSpinner: false,
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "Dark",
      backgroundColor: "#09090b",
    },
  },
};

export default config;
