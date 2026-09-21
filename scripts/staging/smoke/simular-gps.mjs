// Simula el GPS de un chofer sobre el viaje activo del seed (carga 103, chofer1) moviéndose Rosario → Santa Fe.
// Envía PATCH /api/cargas/gps como lo hace la app (cookie + x-user-id). No usa ningún GPS real.
// Uso: TILA_ENTORNO=local|staging node scripts/staging/smoke/simular-gps.mjs --base=URL [--pasos=20] [--intervalo=1000] [--carga=103] [--chofer=chofer1]
import { asegurarAppNoProduccion } from "../guardas.mjs";
import { iniciarSesion, esperar } from "./util.mjs";
import { rutaGps } from "../seed/datos.mjs";

const arg = (n, d) => process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const base = arg("base");
if (!base) { console.error("Falta --base=URL de la app (staging o local)."); process.exit(2); }
try { asegurarAppNoProduccion(base, { etiqueta: "--base" }); } catch (e) { console.error(e.message); process.exit(2); }

const pasos = Number(arg("pasos", 20)), intervalo = Number(arg("intervalo", 1000)), carga = Number(arg("carga", 103));
const ses = await iniciarSesion(base, arg("chofer", "chofer1"));
let ok = 0, mal = 0;
for (const [i, p] of rutaGps(pasos).entries()) {
  const r = await ses.api("PATCH", "/api/cargas/gps", { carga_id: carga, lat: p.lat, lng: p.lng, velocidad: p.velocidad });
  if (r.status === 200) ok++; else mal++;
  console.log(`punto ${String(i + 1).padStart(2)}/${pasos + 1}  lat=${p.lat} lng=${p.lng} vel=${p.velocidad}  → ${r.status}`);
  await esperar(intervalo);
}
console.log(`GPS simulado: ${ok} OK, ${mal} con error`);
process.exit(mal ? 1 : 0);
