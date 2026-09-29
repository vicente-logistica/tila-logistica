import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validarCambiosEstadoChofer, procesarPatchEstadoChofer, COLUMNAS_ESTADO_CHOFER } from "./estadoChofer.ts";
import { identidadAdminComisiones, rechazoSinSesion } from "./adminComisiones.ts";
import { firmarSesion, NOMBRE_COOKIE_SESION } from "./auth/sesion.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = resolve(AQUI, "..");
const RAIZ_REPO = resolve(RAIZ_APP, "..");
const AHORA = new Date("2026-09-29T12:00:00.000Z");

// ═══════════════ /api/chofer/estado — lista blanca ═══════════════

test("estado chofer: acepta sólo las 5 columnas permitidas, con tipos correctos", () => {
  assert.deepEqual(validarCambiosEstadoChofer({ online: true }, AHORA), { ok: true, cambios: { online: true } });
  assert.deepEqual(validarCambiosEstadoChofer({ navegador_preferido: "waze" }, AHORA), { ok: true, cambios: { navegador_preferido: "waze" } });
  assert.deepEqual(
    validarCambiosEstadoChofer({ bateria_nivel: 87, bateria_cargando: false, senal: true }, AHORA),
    { ok: true, cambios: { bateria_nivel: 87, bateria_cargando: false, ultima_senal_at: AHORA.toISOString() } },
  );
  assert.deepEqual(validarCambiosEstadoChofer({ bateria_nivel: null, bateria_cargando: null, senal: true }, AHORA).ok, true);
  for (const nav of ["google_maps", "waze", "preguntar_siempre", "mapa_tila"]) assert.equal(validarCambiosEstadoChofer({ navegador_preferido: nav }).ok, true, nav);
  assert.deepEqual([...COLUMNAS_ESTADO_CHOFER].sort(), ["bateria_cargando", "bateria_nivel", "navegador_preferido", "online", "ultima_senal_at"]);
});

test("estado chofer: cualquier campo fuera de la lista blanca (rol, id, datos sensibles) rechaza el pedido entero", () => {
  for (const malo of [
    { rol: "admin" }, { online: true, rol: "admin" }, { id: "otro" }, { estado_aprobacion: "aprobado" },
    { eliminado: false }, { password: "x" }, { email: "a@b.c" }, { ultima_senal_at: "2000-01-01" }, { vehiculo_activo_id: 1 },
  ]) {
    const r = validarCambiosEstadoChofer(malo, AHORA);
    assert.equal(r.ok, false, JSON.stringify(malo));
  }
});

test("estado chofer: tipos inválidos o vacío → rechazado", () => {
  for (const malo of [
    null, [], "x", {}, { online: "true" }, { online: 1 }, { navegador_preferido: "otro" }, { navegador_preferido: 5 },
    { bateria_nivel: -1 }, { bateria_nivel: 101 }, { bateria_nivel: NaN }, { bateria_nivel: "50" }, { bateria_cargando: "si" }, { senal: false },
  ]) {
    assert.equal(validarCambiosEstadoChofer(malo, AHORA).ok, false, JSON.stringify(malo));
  }
});

/** Base falsa: registra cada UPDATE (columnas y filtro). */
function baseFalsa(usuarios) {
  const updates = [];
  const db = {
    from(tabla) {
      assert.equal(tabla, "usuarios");
      let modo = "select", valores = null;
      const q = {
        select: () => q,
        update: (v) => { modo = "update"; valores = v; return q; },
        eq: (c, v) => {
          if (modo === "update") { updates.push({ valores, filtro: [c, v] }); return Promise.resolve({ error: null }); }
          q._id = v; return q;
        },
        maybeSingle: async () => ({ data: usuarios[q._id] ?? null, error: null }),
      };
      return q;
    },
  };
  return { db, updates };
}
const USUARIOS = { "ch-1": { id: "ch-1", rol: "chofer", eliminado: false }, "cl-1": { id: "cl-1", rol: "cliente" }, "ad-1": { id: "ad-1", rol: "admin" }, "ch-baja": { id: "ch-baja", rol: "chofer", eliminado: true } };

test("estado chofer: el UPDATE es SIEMPRE sobre la fila del propio usuario y sólo con columnas permitidas", async () => {
  const { db, updates } = baseFalsa(USUARIOS);
  const r = await procesarPatchEstadoChofer(db, "ch-1", { online: true, navegador_preferido: "waze" }, AHORA);
  assert.equal(r.status, 200);
  assert.deepEqual(updates, [{ valores: { online: true, navegador_preferido: "waze" }, filtro: ["id", "ch-1"] }]);
});

test("estado chofer: sin identidad → 401; no chofer o dado de baja → 403; campo prohibido → 400 — y nunca se escribe", async () => {
  const { db, updates } = baseFalsa(USUARIOS);
  assert.equal((await procesarPatchEstadoChofer(db, null, { online: true })).status, 401);
  assert.equal((await procesarPatchEstadoChofer(db, "no-existe", { online: true })).status, 401);
  for (const id of ["cl-1", "ad-1", "ch-baja"]) assert.equal((await procesarPatchEstadoChofer(db, id, { online: true })).status, 403, id);
  assert.equal((await procesarPatchEstadoChofer(db, "ch-1", { rol: "admin" })).status, 400);
  assert.equal((await procesarPatchEstadoChofer(db, "ch-1", { online: true, rol: "admin" })).status, 400);
  assert.equal(updates.length, 0);
});

// ═══════════════ Ningún archivo del cliente escribe `usuarios` ═══════════════

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "api" ? [] : archivos(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

test("ningún código fuera de app/api escribe `usuarios` con la clave anon (salvo el módulo de servidor estadoChofer)", () => {
  const escritura = /from\(\s*["']usuarios["']\s*\)\s*\.\s*(update|insert|upsert|delete)\s*\(/;
  const escriben = archivos(RAIZ_APP)
    .filter((f) => escritura.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(RAIZ_APP.length + 1).replace(/\\/g, "/"));
  assert.deepEqual(escriben, ["lib/estadoChofer.ts"], "estadoChofer.ts recibe el cliente service role desde /api/chofer/estado");
  for (const f of ["panel-chofer/page.tsx", "viaje-activo/page.tsx"]) {
    assert.match(readFileSync(join(RAIZ_APP, f), "utf8"), /actualizarEstadoChofer\(/, `${f} usa /api/chofer/estado`);
  }
});

// ═══════════════ Admin comisiones: x-user-id NO alcanza ═══════════════

const SECRETO = "s".repeat(40);
const ENV_OK = { TILA_SESSION_SECRET: SECRETO, TILA_AUTH_MODE: "legacy" }; // aun con el modo global en legacy
const req = (headers = {}, method = "GET") => new Request("https://tila.test/api/admin/configuracion/comisiones", { method, headers: { host: "tila.test", ...headers } });
const cookie = (token) => ({ cookie: `${NOMBRE_COOKIE_SESION}=${token}` });

test("admin comisiones: inventar x-user-id de un admin NO autentica (aunque TILA_AUTH_MODE sea legacy)", () => {
  const r = identidadAdminComisiones(req({ "x-user-id": "ad-1" }), ENV_OK);
  assert.equal(r.userId, null);
  assert.equal(r.motivo, "sin_credenciales");
});

test("admin comisiones: sin TILA_SESSION_SECRET rechaza (config_incompleta), nunca cae al header", () => {
  const r = identidadAdminComisiones(req({ "x-user-id": "ad-1" }), { TILA_AUTH_MODE: "legacy" });
  assert.equal(r.userId, null);
  assert.equal(r.motivo, "config_incompleta");
  assert.equal(rechazoSinSesion(r.motivo).status, 401);
});

test("admin comisiones: sesión firmada válida → identidad del TOKEN; un x-user-id distinto se ignora", () => {
  const token = firmarSesion("ad-1", { env: ENV_OK });
  assert.equal(identidadAdminComisiones(req(cookie(token)), ENV_OK).userId, "ad-1");
  assert.equal(identidadAdminComisiones(req({ ...cookie(token), "x-user-id": "otro-admin" }), ENV_OK).userId, "ad-1");
  assert.equal(identidadAdminComisiones(req({ authorization: `Bearer ${token}` }), ENV_OK).userId, "ad-1");
});

test("admin comisiones: token falsificado, de otro secreto o vencido → rechazado", () => {
  const ajeno = firmarSesion("ad-1", { env: { TILA_SESSION_SECRET: "x".repeat(40) } });
  assert.equal(identidadAdminComisiones(req(cookie(ajeno)), ENV_OK).userId, null);
  // Payload de admin pegado a la firma REAL de la sesión de un cliente → la firma no corresponde.
  const [, firmaCliente] = firmarSesion("cl-1", { env: ENV_OK }).split(".");
  const cuerpoAdmin = Buffer.from(JSON.stringify({ v: 1, sub: "ad-1", scp: "completa", iat: 0, exp: 9999999999 })).toString("base64url");
  assert.equal(identidadAdminComisiones(req(cookie(`${cuerpoAdmin}.${firmaCliente}`)), ENV_OK).userId, null, "payload manipulado");
  const vencido = firmarSesion("ad-1", { env: ENV_OK, ttlSeg: 1, ahora: Date.now() - 60_000 });
  assert.equal(identidadAdminComisiones(req(cookie(vencido)), ENV_OK).userId, null);
});

test("admin comisiones: PUT con cookie desde otro origen (CSRF) → rechazado", () => {
  const token = firmarSesion("ad-1", { env: ENV_OK });
  const r = identidadAdminComisiones(req({ ...cookie(token), origin: "https://atacante.test" }, "PUT"), ENV_OK);
  assert.equal(r.userId, null);
  assert.equal(r.motivo, "origen_invalido");
  assert.equal(identidadAdminComisiones(req({ ...cookie(token), origin: "https://tila.test" }, "PUT"), ENV_OK).userId, "ad-1");
});

test("la ruta admin de comisiones usa identidadAdminComisiones, no resolverUsuario directo", () => {
  const src = readFileSync(join(RAIZ_APP, "api/admin/configuracion/comisiones/route.ts"), "utf8");
  assert.match(src, /identidadAdminComisiones\(req\)/);
  assert.doesNotMatch(src, /resolverUsuario\(/);
  assert.doesNotMatch(src, /x-user-id"\)/);
});

// ═══════════════ Migración ═══════════════

test("migración: elimina la política UPDATE anon y revoca UPDATE/DELETE/TRUNCATE sobre usuarios", () => {
  const sql = readFileSync(join(RAIZ_REPO, "supabase/migrations/20260929_restringir_update_anon_usuarios.sql"), "utf8");
  const sinComentarios = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(sinComentarios, /DROP POLICY IF EXISTS "anon_update_usuarios_permisivo" ON public\.usuarios;/);
  assert.match(sinComentarios, /REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public\.usuarios FROM anon, authenticated;/);
  assert.doesNotMatch(sinComentarios, /\bGRANT\b|CREATE POLICY/i, "no otorga nada nuevo");
});
