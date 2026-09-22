// Verifica en un servidor REAL (`next start`) cómo responden las rutas migradas al resolver de sesión
// en cada modo (legacy / dual / strict). Solo GET de lectura y usuarios inexistentes:
// no puede escribir nada en la base.
// Requiere haber corrido `npm run build` antes.
// Uso: node scripts/verificar-modos-auth.mjs
import { spawn, execSync } from "node:child_process";
import { firmarSesion, NOMBRE_COOKIE_SESION } from "../app/lib/auth/sesion.ts";

const SECRETO = "test-secret-".padEnd(48, "x"); // solo para esta verificación local
const FANTASMA = "00000000-0000-0000-0000-00000000f00d";
const OTRO = "00000000-0000-0000-0000-00000000beef";
const RUTAS = ["/api/chofer/billetera"]; // agregar aquí cada ruta a medida que se migra

const FALTA = "No autorizado: falta x-user-id";
const NO_ENCONTRADO = "No autorizado: usuario no encontrado";

const cookieValida = `${NOMBRE_COOKIE_SESION}=${firmarSesion(FANTASMA, { env: { TILA_SESSION_SECRET: SECRETO } })}`;
const cookieRota = `${NOMBRE_COOKIE_SESION}=abc.def`;

// [nombre, headers, esperado por modo]
const CASOS = [
  ["sin credenciales",             {},                                                    { legacy: FALTA, dual: FALTA, strict: FALTA }],
  ["solo x-user-id inexistente",   { "x-user-id": FANTASMA },                             { legacy: NO_ENCONTRADO, dual: NO_ENCONTRADO, strict: FALTA }],
  ["solo cookie válida",           { cookie: cookieValida },                              { legacy: FALTA, dual: NO_ENCONTRADO, strict: NO_ENCONTRADO }],
  ["solo cookie inválida",         { cookie: cookieRota },                                { legacy: FALTA, dual: FALTA, strict: FALTA }],
  ["cookie válida + header ajeno", { cookie: cookieValida, "x-user-id": OTRO },           { legacy: NO_ENCONTRADO, dual: NO_ENCONTRADO, strict: NO_ENCONTRADO }],
  ["Bearer válido",                { authorization: `Bearer ${cookieValida.split("=")[1]}` }, { legacy: FALTA, dual: NO_ENCONTRADO, strict: NO_ENCONTRADO }],
];

async function probar(modo, puerto) {
  const env = { ...process.env, TILA_SESSION_SECRET: SECRETO };
  if (modo === "legacy") delete env.TILA_AUTH_MODE; else env.TILA_AUTH_MODE = modo;
  const srv = spawn("npx next start -p " + puerto, { shell: true, stdio: "ignore", env });
  const base = `http://127.0.0.1:${puerto}`;
  let fallos = 0;
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(base + "/api/mercadopago/webhook")).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    for (const ruta of RUTAS) {
      for (const [nombre, headers, esperado] of CASOS) {
        const r = await fetch(base + ruta, { headers });
        const j = await r.json().catch(() => ({}));
        const ok = r.status === 401 && j.error === esperado[modo];
        if (!ok) fallos++;
        console.log(`${ok ? "PASS" : "FAIL"} [${modo}] ${ruta} — ${nombre}: ${r.status} "${j.error}"${ok ? "" : `  (esperado 401 "${esperado[modo]}")`}`);
      }
    }
  } finally {
    try { execSync(`taskkill /F /T /PID ${srv.pid}`, { stdio: "ignore" }); } catch {}
  }
  return fallos;
}

let total = 0;
total += await probar("legacy", 3121);
total += await probar("dual", 3122);
total += await probar("strict", 3123);
console.log(total === 0 ? "\nTODOS LOS CASOS OK" : `\n${total} CASOS FALLARON`);
process.exit(total === 0 ? 0 : 1);
