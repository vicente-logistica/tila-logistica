import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guardas de código fuente del paso 3 de geo-publicación: /publicar pide la distancia de
// TODA la ruta en una sola llamada, con debounce y cancelación, y /api/distancia usa el
// helper compartido (sin exponer ni guardar coordenadas).
const leer = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const pagina = leer("publicar/page.tsx");
const ruta = leer("api/distancia/route.ts");

test("/publicar: una sola llamada a /api/distancia, con todos los puntos como ?punto=", () => {
  assert.equal(pagina.match(/fetch\(`\/api\/distancia/g)?.length, 1); // llamadas reales, no comentarios
  assert.match(pagina, /q\.append\("punto", p\)/);
  assert.doesNotMatch(pagina, /tramos\.map\(async/); // ya no hay una llamada por tramo
});

test("/publicar: la distancia se pide con debounce de ~600 ms y se cancela al cambiar las direcciones", () => {
  assert.match(pagina, /const DEBOUNCE_DISTANCIA_MS = 600;/);
  assert.match(pagina, /\}, DEBOUNCE_DISTANCIA_MS\);/);
  assert.match(pagina, /fetch\(`\/api\/distancia\?\$\{q\}`, \{ signal: control\.signal \}\)/);
  assert.match(pagina, /return \(\) => \{ clearTimeout\(t\); control\.abort\(\); \};\s*\}, \[origen, destino, paradasIntermedias\]\);/);
});

test("/publicar: el navegador no escribe geografía ni paradas_viaje (lo hace el servidor desde el paso 4)", () => {
  assert.doesNotMatch(pagina, /place_id|geo_obtenido_at|origen_lat|destino_lat/);
  assert.doesNotMatch(pagina, /paradas_viaje/);
  assert.doesNotMatch(pagina, /from "\.\.\/lib\/supabase"/);
});

test("/api/distancia: usa el helper compartido y sólo devuelve km (sin coordenadas ni place_id)", () => {
  assert.match(ruta, /obtenerRutaPublicacion\(puntos, key\)/);
  assert.match(ruta, /puntosDesdeParametros\(/);
  assert.match(ruta, /NextResponse\.json\(\{ km: ruta\.kmTotal, kmPorTramo: ruta\.kmPorTramo \}\)/);
  assert.doesNotMatch(ruta, /maps\.googleapis\.com/); // la URL la arma el helper
  // Señales concretas de devolver o guardar geografía (el comentario de documentación puede
  // mencionar "place_id" sin que el código lo use).
  assert.doesNotMatch(ruta, /ruta\.puntos|placeId|from\("|supabase/);
});
