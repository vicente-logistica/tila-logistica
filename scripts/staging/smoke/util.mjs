// Utilidades compartidas por los smoke tests de staging.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asegurarAppNoProduccion } from "../guardas.mjs";
import { EMAIL, CLAVES, ID } from "../seed/datos.mjs";

export { EMAIL, CLAVES, ID };

/** Resuelve las URLs de la app por modo: --modos legacy=URL,dual=URL,strict=URL, o el estado.json del entorno local aislado. */
export function resolverModos(argv = process.argv.slice(2), env = process.env) {
  const arg = argv.find((a) => a.startsWith("--modos="))?.slice(8);
  let mapa = {};
  if (arg) mapa = Object.fromEntries(arg.split(",").map((p) => p.split(/=(.+)/).slice(0, 2)));
  else {
    const dir = env.TILA_VAL_DIR || path.join(os.tmpdir(), "tila-validacion");
    const f = path.join(dir, "estado.json");
    if (!fs.existsSync(f)) throw new Error("Indicá --modos=legacy=URL,dual=URL,strict=URL o levantá el entorno local (levantar-entorno.mjs).");
    const est = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const m of est.modos) mapa[m.modo] = `http://${m.host}:${m.puerto}`;
  }
  for (const [m, u] of Object.entries(mapa)) asegurarAppNoProduccion(u, { etiqueta: `app(${m})`, env });
  return mapa;
}

/** Reporte simple: acumula filas y devuelve el resumen. */
export function reporte() {
  const filas = [];
  return {
    filas,
    anotar(flujo, paso, modo, esperado, real) {
      const pass = JSON.stringify(esperado) === JSON.stringify(real);
      filas.push({ flujo, paso, modo, esperado, real, pass });
      console.log(`${pass ? "PASS" : "FAIL"} [${modo}] ${flujo} · ${paso}: ${JSON.stringify(real)}${pass ? "" : `  (esperado ${JSON.stringify(esperado)})`}`);
      return pass;
    },
    resumen() {
      const f = filas.filter((x) => !x.pass).length;
      const por = {};
      for (const x of filas) { por[x.modo] ??= [0, 0]; por[x.modo][x.pass ? 0 : 1]++; }
      console.log(`\nTOTAL ${filas.length} · PASS ${filas.length - f} · FAIL ${f} | por modo [pass,fail]: ${JSON.stringify(por)}`);
      return f;
    },
  };
}

/** Sesión "como el frontend": login real; en cada request manda la cookie (si el servidor la emitió) Y el x-user-id. */
export async function iniciarSesion(base, clave) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL(clave), password: CLAVES[clave] }) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(`login ${clave} falló: ${r.status} ${j.error ?? ""}`);
  const c = r.headers.getSetCookie().find((x) => x.startsWith("tila_sesion="));
  const cookie = c ? c.split(";")[0] : null;
  const id = j.usuario.id;
  const headers = (extra = {}) => ({ "x-user-id": id, ...(cookie ? { cookie } : {}), ...extra });
  const api = async (metodo, ruta, cuerpo) => {
    const res = await fetch(base + ruta, { method: metodo, headers: headers(cuerpo ? { "content-type": "application/json" } : {}), body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const txt = await res.text();
    let json = null; try { json = JSON.parse(txt); } catch { /* no JSON */ }
    return { status: res.status, json, texto: txt };
  };
  return { id, rol: j.usuario.rol, cookie, headers, api, base };
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
