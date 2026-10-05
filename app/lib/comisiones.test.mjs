import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calcularTarifaTILA, estimarDuracion, esComisionClienteBpValida, esComisionChoferBpValida, COMISION_BP_MAXIMO_TECNICO,
} from "./tarifas.ts";
import { leerConfiguracionComisiones, interpretarFilaConfiguracion, guardarConfiguracionComisiones } from "./configuracionComisiones.ts";
import { cotizarCarga, camposEconomicosCarga, TIPO_CARGA_MAP } from "./cotizacion.ts";
import { procesarGetComisiones, procesarPutComisiones } from "./adminComisiones.ts";
import { porcentajeTextoABp, bpAPorcentajeTexto, esCambioDelAdmin } from "./comisionesFormato.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = resolve(AQUI, "..");
const silenciar = (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = l; console.error = e; } };
const silenciarAsync = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };
const tarifa = (entrada) => silenciar(() => calcularTarifaTILA(entrada));
const cotizar = (d, c) => silenciar(() => cotizarCarga(d, c));

// ═══════════════ REGRESIÓN: 750/750 = producción ═══════════════

const { casos: GOLDEN } = JSON.parse(readFileSync(join(AQUI, "tarifas-produccion-750.fixture.json"), "utf8"));

test("regresión: 750/750 reproduce EXACTAMENTE los 448 casos calculados con el tarifas.ts de producción (301e569)", () => {
  assert.equal(GOLDEN.length, 448);
  for (const [v, c, km, p, base, cli, cho, com] of GOLDEN) {
    const r = tarifa({ distanciaKm: km, tipoVehiculo: v, tipoCarga: c, duracionHoras: estimarDuracion(km, v), cantidadParadas: p, peajes: 0, horasEspera: 0 });
    assert.deepEqual([r.subtotalAntesComision, r.precioCliente, r.choferCobra, r.comisionTila], [base, cli, cho, com], `${v}/${c}/${km}km/${p} paradas`);
  }
});

test("regresión: sin pasar comisiones usa 750/750 (igual que pasarlas explícitas)", () => {
  const e = { distanciaKm: 400, tipoVehiculo: "Camión rígido", tipoCarga: "general", duracionHoras: estimarDuracion(400, "Camión rígido") };
  assert.deepEqual(tarifa(e), tarifa({ ...e, comisionClienteBp: 750, comisionChoferBp: 750 }));
  const r = tarifa(e);
  assert.deepEqual([r.subtotalAntesComision, r.precioCliente, r.choferCobra, r.comisionTila], [1137143, 1222429, 1051857, 170572]);
});

test("regresión: aritmética entera en bp = fórmula anterior (7.5/100 con floats) para TODO subtotal 0..2.000.000", () => {
  const q = (n) => { const c = Math.floor(n / 10000), r = n - c * 10000; return r * 2 >= 10000 ? c + 1 : c; };
  for (let s = 0; s <= 2_000_000; s += 1) {
    const cli = Math.round(s * (1 + 7.5 / 100)), cho = Math.round(s * (1 - 7.5 / 100));
    if (q(s * 10750) !== cli || q(s * 9250) !== cho) assert.fail(`difiere en subtotal=${s}`);
  }
});

// ═══════════════ OTRAS COMISIONES ═══════════════

const BASE = { distanciaKm: 400, tipoVehiculo: "Camión rígido", tipoCarga: "general", duracionHoras: estimarDuracion(400, "Camión rígido") };
const SUBTOTAL = 1137143;

for (const [cliBp, choBp, cliEsperado, choEsperado] of [
  [500, 500, 1194000, 1080286],   // 1137143 × 1,05 = 1194000,15 → 1194000 ; × 0,95 = 1080285,85 → 1080286
  [475, 325, 1191157, 1100186],   // × 1,0475 = 1191157,29 → 1191157 ; × 0,9675 = 1100185,85 → 1100186
  [0, 0, SUBTOTAL, SUBTOTAL],
]) {
  test(`${cliBp}/${choBp} bp → cliente ${cliEsperado}, chofer ${choEsperado}`, () => {
    const r = tarifa({ ...BASE, comisionClienteBp: cliBp, comisionChoferBp: choBp });
    assert.equal(r.subtotalAntesComision, SUBTOTAL, "el precio base no depende de la comisión");
    assert.equal(r.precioCliente, cliEsperado);
    assert.equal(r.choferCobra, choEsperado);
    assert.equal(r.comisionTila, r.precioCliente - r.choferCobra);
  });
}

// ═══════════════ REDONDEO ═══════════════

test("redondeo: todos los montos son pesos enteros y la comisión cierra exacto", () => {
  for (const [cli, cho] of [[750, 750], [500, 500], [475, 325], [1, 9999], [9999, 1], [333, 667]]) for (const km of [1, 13.7, 99.9, 555]) {
    const r = tarifa({ distanciaKm: km, tipoVehiculo: "Pick-up", tipoCarga: "refrigerada", duracionHoras: estimarDuracion(km, "Pick-up"), comisionClienteBp: cli, comisionChoferBp: cho });
    for (const v of [r.subtotalAntesComision, r.precioCliente, r.choferCobra, r.comisionTila]) assert.ok(Number.isInteger(v), `${v} no es entero`);
    assert.equal(r.precioCliente - r.choferCobra, r.comisionTila);
    assert.ok(r.choferCobra >= 0);
  }
});

test("redondeo: empate exacto (x,5) se resuelve hacia arriba, sin error de punto flotante", () => {
  // Moto con 0 km cae en su mínimo, 15000 → 15000 × 1,075 = 16125 exacto.
  const r = tarifa({ distanciaKm: 0, tipoVehiculo: "Moto", duracionHoras: 0 });
  assert.deepEqual([r.subtotalAntesComision, r.precioCliente, r.choferCobra], [15000, 16125, 13875]);
  // 15000 × 1,3333 = 19999,5 → 20000 ; 15000 × 0,6667 = 10000,5 → 10001
  const r2 = tarifa({ distanciaKm: 0, tipoVehiculo: "Moto", duracionHoras: 0, comisionClienteBp: 3333, comisionChoferBp: 3333 });
  assert.deepEqual([r2.precioCliente, r2.choferCobra], [20000, 10001]);
});

// ═══════════════ VALIDACIÓN ═══════════════

test("validación cliente: cualquier porcentaje ≥ 0 (sin tope comercial); rechaza negativos, NaN, no enteros, no-números", () => {
  for (const bueno of [0, 5, 100, 475, 750, 1000, 2500, 5000, 10000, 50000, COMISION_BP_MAXIMO_TECNICO]) assert.equal(esComisionClienteBpValida(bueno), true, String(bueno));
  for (const malo of [-1, -750, NaN, Infinity, 7.5, 750.5, COMISION_BP_MAXIMO_TECNICO + 1, "750", null, undefined, {}]) {
    assert.equal(esComisionClienteBpValida(malo), false, `debería rechazar ${String(malo)}`);
  }
});

test("validación chofer: 0 % a 100 % inclusive (con más, el pago sería negativo)", () => {
  for (const bueno of [0, 5, 100, 750, 1000, 5000, 9999, 10000]) assert.equal(esComisionChoferBpValida(bueno), true, String(bueno));
  for (const malo of [-1, 10001, 12000, NaN, 7.5, "750", null]) assert.equal(esComisionChoferBpValida(malo), false, `debería rechazar ${String(malo)}`);
});

test("validación: calcularTarifaTILA se niega a calcular con una comisión inválida", () => {
  for (const malo of [-1, NaN, 7.5]) {
    assert.throws(() => tarifa({ ...BASE, comisionClienteBp: malo }), /Comisión inválida/);
    assert.throws(() => tarifa({ ...BASE, comisionChoferBp: malo }), /Comisión inválida/);
  }
  assert.throws(() => tarifa({ ...BASE, comisionChoferBp: 10001 }), /Comisión inválida/, "chofer > 100 %");
});

test("100 % y más: chofer 100 % cobra $0 (nunca negativo); cliente 100 % paga el doble; cliente 250 % se acepta", () => {
  const cho100 = tarifa({ ...BASE, comisionClienteBp: 750, comisionChoferBp: 10000 });
  assert.equal(cho100.choferCobra, 0);
  assert.equal(cho100.comisionTila, cho100.precioCliente);
  const cli100 = tarifa({ ...BASE, comisionClienteBp: 10000, comisionChoferBp: 750 });
  assert.equal(cli100.precioCliente, 2 * SUBTOTAL);
  const cli250 = tarifa({ ...BASE, comisionClienteBp: 25000, comisionChoferBp: 0 });
  assert.equal(cli250.precioCliente, Math.round(SUBTOTAL * 3.5));
  assert.equal(cli250.choferCobra, SUBTOTAL);
  for (const r of [cho100, cli100, cli250]) for (const v of [r.precioCliente, r.choferCobra, r.comisionTila]) assert.ok(Number.isInteger(v) && v >= 0);
});

test("valores extremos de cliente: hasta el máximo técnico el cálculo sigue siendo exacto (verificado con BigInt)", () => {
  for (const bpCli of [10000, 25000, 1_000_000, COMISION_BP_MAXIMO_TECNICO]) {
    const r = tarifa({ ...BASE, comisionClienteBp: bpCli, comisionChoferBp: 750 });
    const num = BigInt(SUBTOTAL) * BigInt(10000 + bpCli);
    const esperado = num / 10000n + (num % 10000n * 2n >= 10000n ? 1n : 0n);
    assert.equal(BigInt(r.precioCliente), esperado, `cliente ${bpCli} bp`);
  }
});

// ═══════════════ FORMATO DEL PANEL (% ↔ bp) ═══════════════

test("formato: porcentaje libre escrito por el admin (coma o punto) → puntos básicos exactos", () => {
  for (const [texto, bp] of [
    ["0", 0], ["0,05", 5], ["0.05", 5], ["1", 100], ["4,75", 475], ["5", 500], ["7,5", 750], ["7.5", 750], ["7,50", 750],
    ["10", 1000], ["25", 2500], ["50", 5000], ["100", 10000], ["100,00", 10000], ["250", 25000], ["3.25", 325], [" 7,50 % ", 750],
  ]) {
    assert.equal(porcentajeTextoABp(texto), bp, texto);
  }
  for (const malo of ["", "-1", "7,505", "0,005", "abc", "7,5,0", "1e2", "7 5", ",5", "5,"]) assert.equal(porcentajeTextoABp(malo), null, malo);
});

test("formato: puntos básicos → texto del panel, ida y vuelta exacta", () => {
  assert.deepEqual([750, 500, 475, 325, 0, 9999, 5, 10000, 25000].map(bpAPorcentajeTexto), ["7,50", "5,00", "4,75", "3,25", "0,00", "99,99", "0,05", "100,00", "250,00"]);
  for (let bp = 0; bp <= 30000; bp++) assert.equal(porcentajeTextoABp(bpAPorcentajeTexto(bp)), bp);
});

test("panel: GET 750/750 → los inputs muestran 7,50 y 7,50", () => {
  const json = { ok: true, comision_cliente_bp: 750, comision_chofer_bp: 750, fuente: "fallback" };
  assert.deepEqual([bpAPorcentajeTexto(json.comision_cliente_bp), bpAPorcentajeTexto(json.comision_chofer_bp)], ["7,50", "7,50"]);
});

test("panel: sólo se aceptan cambios del admin; autocompletado o cambios sin interacción se ignoran", () => {
  assert.equal(esCambioDelAdmin({ huboInteraccion: true, inputType: "insertText" }), true, "tecleo");
  assert.equal(esCambioDelAdmin({ huboInteraccion: true, inputType: "insertFromPaste" }), true, "pegar");
  assert.equal(esCambioDelAdmin({ huboInteraccion: true, inputType: "deleteContentBackward" }), true, "borrar");
  assert.equal(esCambioDelAdmin({ huboInteraccion: false, inputType: "insertText" }), false, "sin interacción previa (script/extensión)");
  assert.equal(esCambioDelAdmin({ huboInteraccion: false, inputType: undefined }), false, "cambio sin evento de teclado");
  assert.equal(esCambioDelAdmin({ huboInteraccion: true, inputType: "insertReplacementText" }), false, "sugerencia/autocompletado");
  assert.equal(esCambioDelAdmin({ huboInteraccion: true, inputType: "insertText", autofill: true }), false, ":-webkit-autofill");
});

// ═══════════════ COTIZAR = PUBLICAR ═══════════════

test("cotizar y publicar usan la MISMA configuración, la MISMA función y los MISMOS campos", () => {
  const cotizarSrc  = readFileSync(join(RAIZ_APP, "api/tarifas/cotizar/route.ts"), "utf8");
  // La lógica de publicar vive en lib/publicarCargaServidor.ts (el handler sólo la conecta).
  const publicarSrc = readFileSync(join(RAIZ_APP, "lib/publicarCargaServidor.ts"), "utf8");
  assert.match(cotizarSrc, /leerConfiguracionComisiones\(supabaseAdmin\)/, "cotizar: lee la configuración vigente");
  assert.match(publicarSrc, /leerConfiguracionComisiones\(db\)/, "publicar: lee la configuración vigente");
  assert.match(cotizarSrc, /cotizarCarga\(\s*\{ kmEstimados: kmNum, tipoVehiculo: tipo_vehiculo, tipoCarga: tipo_carga, paradasIntermedias: paradas_intermedias \},\s*comisiones,?\s*\)/, "cotizar: misma llamada");
  // publicar cotiza con los km de la RUTA DEL SERVIDOR (y las paradas ya filtradas), no con los del cliente.
  assert.match(publicarSrc, /cotizarCarga\(\s*\{ kmEstimados: kmServidor, tipoVehiculo: tipo_vehiculo, tipoCarga: tipo_carga, paradasIntermedias: paradas \},\s*comisiones,?\s*\)/, "publicar: misma llamada");
  for (const [nombre, src] of [["cotizar", cotizarSrc], ["publicar", publicarSrc]]) {
    assert.match(src, /camposEconomicosCarga\(tarifa\)/, `${nombre}: mismos campos económicos`);
    assert.doesNotMatch(src, /calcularTarifaTILA|7\.5|0\.075/, `${nombre}: sin cálculo ni porcentaje propio`);
  }
  for (const campo of ["precio_base", "precio_cliente", "pago_chofer", "comision_plataforma"]) {
    assert.match(publicarSrc, new RegExp(`${campo}:\\s+economicos\\.${campo}`), `publicar guarda ${campo} desde camposEconomicosCarga`);
  }
  const paginaSrc = readFileSync(join(RAIZ_APP, "publicar/page.tsx"), "utf8");
  assert.doesNotMatch(paginaSrc, /calcularTarifaTILA|lib\/tarifas/, "la vista previa no calcula en el navegador");
  assert.match(paginaSrc, /\/api\/tarifas\/cotizar/);
});

test("cotizarCarga = cálculo que hacía publicar antes (mapeo de carga, paradas, duración)", () => {
  const r = cotizar({ kmEstimados: 137, tipoVehiculo: "Furgón", tipoCarga: "Carga cara", paradasIntermedias: ["A", "", "B"] }, { comisionClienteBp: 750, comisionChoferBp: 750 });
  const esperado = tarifa({ distanciaKm: 137, tipoVehiculo: "Furgón", tipoCarga: "fragil", duracionHoras: estimarDuracion(137, "Furgón"), cantidadParadas: 3, peajes: 0, horasEspera: 0 });
  assert.deepEqual(r, esperado);
  assert.equal(Object.keys(TIPO_CARGA_MAP).length, 5);
});

// ═══════════════ CARGAS EXISTENTES NO SE RECALCULAN ═══════════════

function archivosTs(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivosTs(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

test("ningún archivo de la app escribe los montos de una carga salvo publicar (nada recalcula cargas existentes)", () => {
  const escritura = /\b(precio_base|precio_cliente|pago_chofer|comision_plataforma)\s*:/;
  const escriben = archivosTs(RAIZ_APP)
    .filter((f) => escritura.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(RAIZ_APP.length + 1).replace(/\\/g, "/"))
    .sort();
  // cotizacion.ts sólo ARMA el objeto (camposEconomicosCarga); el único INSERT es publicar
  // (lib/publicarCargaServidor.ts, que usa /api/cargas/publicar).
  assert.deepEqual(escriben, ["lib/cotizacion.ts", "lib/publicarCargaServidor.ts"]);
});

// ═══════════════ Base falsa de configuracion_plataforma + usuarios ═══════════════

function baseFalsa({ fila = { comision_cliente_bp: 750, comision_chofer_bp: 750 }, usuarios = {}, errorLectura = null, errorEscritura = null } = {}) {
  const estado = { fila: fila ? { id: 1, ...fila } : null, upserts: [] };
  const db = {
    from(tabla) {
      if (tabla === "usuarios") {
        let id;
        const q = { select: () => q, eq: (_c, v) => { id = v; return q; }, maybeSingle: async () => ({ data: usuarios[id] ?? null, error: null }) };
        return q;
      }
      assert.equal(tabla, "configuracion_plataforma");
      let escritura = null;
      const q = {
        select: () => q,
        eq: (c, v) => { assert.deepEqual([c, v], ["id", 1]); return q; },
        upsert: (valores, opts) => { assert.deepEqual(opts, { onConflict: "id" }); escritura = valores; return q; },
        maybeSingle: async () => (errorLectura ? { data: null, error: errorLectura } : { data: estado.fila, error: null }),
        single: async () => {
          if (errorEscritura) return { data: null, error: errorEscritura };
          estado.upserts.push(escritura);
          estado.fila = { ...estado.fila, ...escritura };
          return { data: estado.fila, error: null };
        },
      };
      return q;
    },
  };
  return { db, estado };
}

const ADMIN = { id: "a-1", rol: "admin", eliminado: false };
const USUARIOS = { "a-1": ADMIN, "c-1": { id: "c-1", rol: "cliente" }, "h-1": { id: "h-1", rol: "chofer" }, "a-baja": { id: "a-baja", rol: "admin", eliminado: true } };

// ═══════════════ CONFIGURACIÓN SERVER-SIDE ═══════════════

test("configuración: lee la fila id=1 de la base", async () => {
  const { db } = baseFalsa({ fila: { comision_cliente_bp: 500, comision_chofer_bp: 475 } });
  assert.deepEqual(await silenciarAsync(() => leerConfiguracionComisiones(db)), { comisionClienteBp: 500, comisionChoferBp: 475, fuente: "db" });
});

test("configuración: fallback controlado a 750/750 (tabla ausente, sin fila, valores inválidos)", async () => {
  for (const opts of [
    { errorLectura: { code: "42P01", message: "relation \"configuracion_plataforma\" does not exist" } },
    { fila: null },
    { fila: { comision_cliente_bp: -5, comision_chofer_bp: 750 } },
    { fila: { comision_cliente_bp: 7.5, comision_chofer_bp: 7.5 } },
  ]) {
    const c = await silenciarAsync(() => leerConfiguracionComisiones(baseFalsa(opts).db));
    assert.deepEqual([c.comisionClienteBp, c.comisionChoferBp, c.fuente], [750, 750, "fallback"]);
    assert.ok(c.motivo);
  }
});

test("interpretarFilaConfiguracion valida los dos valores", () => {
  assert.deepEqual(interpretarFilaConfiguracion({ comision_cliente_bp: 0, comision_chofer_bp: 9999 }), { comisionClienteBp: 0, comisionChoferBp: 9999, fuente: "db" });
  assert.ok("error" in interpretarFilaConfiguracion({ comision_cliente_bp: "750", comision_chofer_bp: 750 }));
  assert.ok("error" in interpretarFilaConfiguracion(null));
});

test("guardarConfiguracionComisiones: upsert en id=1 con updated_by; nunca escribe valores inválidos", async () => {
  const { db, estado } = baseFalsa();
  const r = await guardarConfiguracionComisiones(db, { comisionClienteBp: 500, comisionChoferBp: 475 }, "a-1");
  assert.equal(r.ok, true);
  assert.equal(estado.upserts.length, 1);
  assert.deepEqual([estado.upserts[0].id, estado.upserts[0].comision_cliente_bp, estado.upserts[0].comision_chofer_bp, estado.upserts[0].updated_by], [1, 500, 475, "a-1"]);
  for (const malo of [-1, 7.5, "500", null]) {
    const m = await guardarConfiguracionComisiones(db, { comisionClienteBp: malo, comisionChoferBp: 500 }, "a-1");
    assert.equal(m.ok, false);
  }
  assert.equal(estado.upserts.length, 1, "ningún valor inválido llegó a la base");
});

// ═══════════════ ENDPOINT ADMIN: sólo admin en el servidor ═══════════════

test("admin GET/PUT: sin usuario → 401; usuario inexistente → 401", async () => {
  const { db, estado } = baseFalsa({ usuarios: USUARIOS });
  assert.equal((await procesarGetComisiones(db, null)).status, 401);
  assert.equal((await procesarPutComisiones(db, null, { comision_cliente_bp: 500, comision_chofer_bp: 500 })).status, 401);
  assert.equal((await procesarPutComisiones(db, "no-existe", { comision_cliente_bp: 500, comision_chofer_bp: 500 })).status, 401);
  assert.equal(estado.upserts.length, 0);
});

test("admin GET/PUT: cliente, chofer o admin dado de baja → 403 y no se modifica nada", async () => {
  const { db, estado } = baseFalsa({ usuarios: USUARIOS });
  for (const id of ["c-1", "h-1", "a-baja"]) {
    assert.equal((await procesarGetComisiones(db, id)).status, 403, id);
    assert.equal((await procesarPutComisiones(db, id, { comision_cliente_bp: 100, comision_chofer_bp: 100 })).status, 403, id);
  }
  assert.equal(estado.upserts.length, 0);
});

test("admin PUT: valores inválidos → 400 y no se modifica nada", async () => {
  const { db, estado } = baseFalsa({ usuarios: USUARIOS });
  for (const body of [{}, { comision_cliente_bp: 7.5, comision_chofer_bp: 750 }, { comision_cliente_bp: 750, comision_chofer_bp: -1 }, { comision_cliente_bp: 750, comision_chofer_bp: 10001 }, { comision_cliente_bp: -5, comision_chofer_bp: 750 }]) {
    assert.equal((await procesarPutComisiones(db, "a-1", body)).status, 400, JSON.stringify(body));
  }
  assert.equal(estado.upserts.length, 0);
});

test("admin PUT: acepta valores libres — 0,05 %, 10 %, 100 % y cliente > 100 %", async () => {
  for (const [cli, cho] of [[5, 5], [1000, 1000], [10000, 10000], [25000, 0]]) {
    const { db, estado } = baseFalsa({ usuarios: USUARIOS });
    const r = await procesarPutComisiones(db, "a-1", { comision_cliente_bp: cli, comision_chofer_bp: cho });
    assert.equal(r.status, 200, `${cli}/${cho}`);
    assert.deepEqual([r.body.comision_cliente_bp, r.body.comision_chofer_bp], [cli, cho]);
    assert.equal(estado.upserts.length, 1);
  }
});

test("admin PUT: error de la base (tabla sin migrar) → 500, sin romper nada", async () => {
  const { db } = baseFalsa({ usuarios: USUARIOS, errorEscritura: { code: "42P01", message: "relation does not exist" } });
  const r = await procesarPutComisiones(db, "a-1", { comision_cliente_bp: 500, comision_chofer_bp: 500 });
  assert.equal(r.status, 500);
});

// ═══════════════ RECORRIDO COMPLETO PEDIDO ═══════════════

test("recorrido: Admin ve 7,50/7,50 → guarda 5/5 → la carga NUEVA usa 5/5 → la VIEJA conserva sus montos", async () => {
  const { db } = baseFalsa({ usuarios: USUARIOS });
  const datos = { kmEstimados: 400, tipoVehiculo: "Camión rígido", tipoCarga: "Carga común", paradasIntermedias: [] };

  // Carga vieja: publicada con la configuración vigente (750/750) → montos guardados.
  const configVieja = await silenciarAsync(() => leerConfiguracionComisiones(db));
  const cargaVieja = camposEconomicosCarga(cotizar(datos, configVieja));
  const cargaViejaGuardada = structuredClone(cargaVieja);

  // 1-3. Admin abre Comisiones y ve 7,50 % / 7,50 %.
  const get1 = await procesarGetComisiones(db, "a-1");
  assert.equal(get1.status, 200);
  assert.deepEqual([bpAPorcentajeTexto(get1.body.comision_cliente_bp), bpAPorcentajeTexto(get1.body.comision_chofer_bp)], ["7,50", "7,50"]);

  // 4-5. Cambia a 5 % / 5 % y guarda.
  const put = await procesarPutComisiones(db, "a-1", { comision_cliente_bp: porcentajeTextoABp("5"), comision_chofer_bp: porcentajeTextoABp("5") });
  assert.equal(put.status, 200);
  assert.deepEqual([put.body.comision_cliente_bp, put.body.comision_chofer_bp], [500, 500]);

  // 6-7. Una carga NUEVA (cotizar/publicar leen la configuración vigente) usa 5 % / 5 %.
  const configNueva = await silenciarAsync(() => leerConfiguracionComisiones(db));
  const cargaNueva = camposEconomicosCarga(cotizar(datos, configNueva));
  assert.deepEqual(cargaNueva, { precio_base: 1137143, precio_cliente: 1194000, pago_chofer: 1080286, comision_plataforma: 113714 });

  // 8. La carga vieja conserva sus montos (750/750).
  assert.deepEqual(cargaVieja, cargaViejaGuardada);
  assert.deepEqual(cargaVieja, { precio_base: 1137143, precio_cliente: 1222429, pago_chofer: 1051857, comision_plataforma: 170572 });
});
