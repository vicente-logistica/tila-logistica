// Service Worker mínimo — TILA Logística
// Estrategia: network-only pass-through.
// No se cachea nada: APIs, Supabase, MercadoPago, rutas dinámicas.
// Solo sirve para satisfacer el criterio de instalabilidad PWA de Chrome.

const CACHE_NAME = "tila-sw-v1";

self.addEventListener("install", () => {
  // Activar inmediatamente sin esperar a que se cierre la pestaña anterior.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Tomar control de todas las pestañas abiertas de inmediato.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through puro: todas las requests van a la red sin interceptar.
  // Esto evita servir respuestas cacheadas de APIs, Supabase o MP.
  event.respondWith(fetch(event.request));
});
