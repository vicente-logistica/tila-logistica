// Levanta un entorno de validación 100 % local y aislado de producción:
//   - Supabase simulado en 127.0.0.1:4545 (datos inventados)
//   - la app (build de producción, `next start`) en 3 modos de autenticación:
//       legacy → http://localhost:3131     dual → http://127.0.0.1:3132     strict → http://127.0.0.2:3133
//     (hosts distintos = jars de cookies y localStorage separados en el navegador)
// El TILA_SESSION_SECRET de prueba se genera al azar y solo vive en memoria y en el archivo de estado (fuera del repo).
//
// Uso:  node scripts/validacion-local/levantar-entorno.mjs --build   (compila con las variables de prueba y levanta)
//       node scripts/validacion-local/levantar-entorno.mjs           (levanta usando el build existente de prueba)
// Variable opcional: TILA_VAL_DIR = carpeta del archivo de estado (defecto: <tmp>/tila-validacion)
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { iniciarMock } from "./mock-supabase.mjs";

const dir = process.env.TILA_VAL_DIR || path.join(os.tmpdir(), "tila-validacion");
fs.mkdirSync(dir, { recursive: true });
const archivoEstado = path.join(dir, "estado.json");

const PUERTO_MOCK = 4545;
const secreto = crypto.randomBytes(48).toString("base64url"); // solo de prueba
const MODOS = [
  { modo: "legacy", host: "localhost", puerto: 3131 },
  { modo: "dual",   host: "127.0.0.1", puerto: 3132 },
  { modo: "strict", host: "127.0.0.2", puerto: 3133 },
  // legacy SIN TILA_SESSION_SECRET: equivale al código anterior al cambio (control de comparación)
  { modo: "legacy-sin-secreto", host: "127.0.0.3", puerto: 3134, sinSecreto: true },
];

/** Variables que APUNTAN TODO al mock y neutralizan cualquier servicio real. */
function entornoBase() {
  const e = { ...process.env };
  Object.assign(e, {
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_MOCK}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-de-prueba",
    SUPABASE_URL: `http://127.0.0.1:${PUERTO_MOCK}`,
    SUPABASE_SERVICE_ROLE_KEY: "service-de-prueba",
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "SIN-CLAVE-DE-PRUEBA",
    NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: "SIN-MAP-ID-DE-PRUEBA",
    GOOGLE_SERVER_API_KEY: "SIN-CLAVE-DE-PRUEBA",
    MERCADOPAGO_ACCESS_TOKEN: "REEMPLAZAR_CON_TU_TOKEN",
    NEXT_PUBLIC_BASE_URL: "http://localhost:3131",
    TILA_SESSION_SECRET: secreto,
  });
  delete e.TILA_AUTH_MODE;
  delete e.MERCADOPAGO_WEBHOOK_SECRET;
  return e;
}

if (process.argv.includes("--build")) {
  console.log("[build] compilando con variables de prueba (apuntan al mock, no a producción)…");
  const r = spawnSync("npx next build", { shell: true, stdio: "inherit", env: entornoBase() });
  if (r.status !== 0) { console.error("[build] FALLÓ"); process.exit(1); }
}

await iniciarMock(PUERTO_MOCK);
console.log(`[mock] http://127.0.0.1:${PUERTO_MOCK}`);

const hijos = MODOS.map(({ modo, puerto, sinSecreto }) => {
  const env = entornoBase();
  if (modo === "dual" || modo === "strict") env.TILA_AUTH_MODE = modo;
  if (sinSecreto) delete env.TILA_SESSION_SECRET;
  const h = spawn(`npx next start -H 0.0.0.0 -p ${puerto}`, { shell: true, stdio: "ignore", env });
  return h;
});

async function listo(url) {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(url + "/api/mercadopago/webhook")).ok) return true; } catch { /* reintentar */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
for (const { modo, host, puerto } of MODOS) {
  const ok = await listo(`http://${host}:${puerto}`);
  console.log(`[app:${modo}] http://${host}:${puerto} ${ok ? "LISTA" : "NO LEVANTÓ"}`);
}

fs.writeFileSync(archivoEstado, JSON.stringify({ secreto, mock: PUERTO_MOCK, modos: MODOS, pids: hijos.map((h) => h.pid) }, null, 2));
console.log(`[estado] ${archivoEstado}`);
console.log("ENTORNO LISTO (Ctrl+C o taskkill para detener)");

const cerrar = () => {
  for (const h of hijos) { try { spawnSync(`taskkill /F /T /PID ${h.pid}`, { shell: true, stdio: "ignore" }); } catch { /* ignorar */ } }
  process.exit(0);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
