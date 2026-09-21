// Smoke tests de FLUJOS de TILA sobre un entorno de staging o local (legacy / dual / strict).
//   CLIENTE : login → publicar → historial → seguimiento → chat → cancelar
//   CHOFER  : login → disponibles → oferta → aceptar (+carrera) → viaje activo → estados → evidencia → GPS → chat → finalizar → billetera
//   ADMIN   : login → usuarios → cargas → chat/resumen → documentación
//   AUTH    : matriz de credenciales por modo sobre rutas ya migradas
//
// Uso: TILA_ENTORNO=local|staging node scripts/staging/smoke/flujos.mjs [--modos=legacy=URL,dual=URL,strict=URL] [--supabase=URL --anon=KEY]
// Requiere el seed aplicado (scripts/staging/seed/aplicar.mjs). Escribe datos (publica y avanza viajes): SOLO staging/local.
import { calcularTarifaTILA, estimarDuracion } from "../../../app/lib/tarifas.ts";
import { resolverModos, reporte, iniciarSesion, ID } from "./util.mjs";

const R = reporte();
const modos = resolverModos();
const supabaseUrl = process.argv.slice(2).find((a) => a.startsWith("--supabase="))?.slice(11);
const anon = process.argv.slice(2).find((a) => a.startsWith("--anon="))?.slice(7);

const tarifa = (km, veh) => { const l = console.log; console.log = () => {}; try { return calcularTarifaTILA({ distanciaKm: km, tipoVehiculo: veh, tipoCarga: "general", duracionHoras: estimarDuracion(km, veh), cantidadParadas: 1 }); } finally { console.log = l; } };
const SECUENCIA = ["En camino", "Carga retirada", "En ruta", "Descarga completada", "Viaje finalizado"];

for (const [modo, base] of Object.entries(modos)) {
  const ok = (flujo, paso, esperado, real) => R.anotar(flujo, paso, modo, esperado, real);

  // ══ CLIENTE ═══════════════════════════════════════════════════════════════
  const cli = await iniciarSesion(base, "cliente1");
  ok("cliente", "login (rol cliente)", "cliente", cli.rol);
  const pub = await cli.api("POST", "/api/cargas/publicar", { origen: "Rosario, Santa Fe", destino: "Córdoba, Córdoba", tipo_vehiculo: "Camión rígido", tipo_carroceria: "Baranda volcable", categoria_legal: "N2", peso: "3 t", tipo_carga: "Carga común", detalles: `smoke ${modo}`, km_estimados: 400, paradas_intermedias: [] });
  ok("cliente", "publicar → 200 y estado pendiente", [200, "pendiente"], [pub.status, pub.json?.carga?.estado]);
  const esperado = tarifa(400, "Camión rígido");
  ok("cliente", "publicar: precio calculado en SERVIDOR (= tarifa v2)", [esperado.precioCliente, esperado.choferCobra], [pub.json?.carga?.precio_cliente, pub.json?.carga?.pago_chofer]);
  const nuevaId = pub.json?.carga?.id;
  const hist = await cli.api("GET", "/api/cargas/historial-cliente");
  ok("cliente", "historial (ruta migrada) contiene la carga nueva", true, !!hist.json?.cargas?.some((c) => c.id === nuevaId));
  const seg = hist.json?.cargas?.find((c) => c.id === 103);
  ok("cliente", "seguimiento: viaje 103 'En camino' con GPS", ["En camino", true], [seg?.estado, seg?.lat != null && seg?.lng != null]);
  const msg = await cli.api("POST", "/api/chat/mensaje", { viaje_id: 103, tipo_chat: "viaje", mensaje: `smoke cliente ${modo}` });
  ok("cliente", "chat: enviar al chofer", 200, msg.status);
  const lee = await cli.api("GET", "/api/chat/mensajes?viaje_id=103&tipo_chat=viaje");
  ok("cliente", "chat: el mensaje aparece", true, !!lee.json?.data?.some((m) => m.mensaje === `smoke cliente ${modo}`));
  const ajeno = await cli.api("POST", "/api/chat/mensaje", { viaje_id: 104, tipo_chat: "viaje", mensaje: "no debería" });
  ok("cliente", "chat: NO puede escribir en un viaje ajeno (104 es de cliente2)", 403, ajeno.status);

  // ══ CHOFER (ciclo completo con chofer2) ═══════════════════════════════════
  const cho = await iniciarSesion(base, "chofer2");
  ok("chofer", "login (rol chofer)", "chofer", cho.rol);
  const disp = await cho.api("GET", "/api/cargas/disponibles");
  ok("chofer", "disponibles incluye la oferta nueva", true, !!disp.json?.cargas?.some((c) => c.id === nuevaId));
  const cho1 = await iniciarSesion(base, "chofer1");
  const [a1, a2] = await Promise.all([cho.api("POST", "/api/cargas/aceptar", { carga_id: nuevaId }), cho1.api("POST", "/api/cargas/aceptar", { carga_id: nuevaId })]);
  ok("chofer", "aceptar con CARRERA de 2 choferes: exactamente uno gana (200) y otro 409", [200, 409], [a1.status, a2.status].sort());
  const ganador = a1.status === 200 ? cho : cho1;
  const act = await ganador.api("GET", `/api/cargas/activa?carga_id=${nuevaId}`);
  ok("chofer", "viaje activo (por id) pertenece al ganador", ["Chofer asignado", ganador.id], [act.json?.carga?.estado, act.json?.carga?.chofer_id]);
  const salto = await ganador.api("PATCH", "/api/cargas/estado", { carga_id: nuevaId, nuevo_estado: "En ruta" });
  ok("chofer", "estado: salto inválido → 422", 422, salto.status);
  for (const [i, est] of SECUENCIA.entries()) {
    const r = await ganador.api("PATCH", "/api/cargas/estado", { carga_id: nuevaId, nuevo_estado: est });
    ok("chofer", `estado → ${est}`, [200, est], [r.status, r.json?.carga?.estado]);
    if (i === 0) {
      const ev = await ganador.api("POST", "/api/cargas/evidencia", { carga_id: nuevaId, evento: "chofer_en_camino", estado_viaje: "En camino", lat: -32.94, lng: -60.65 });
      ok("chofer", "evidencia (evento chofer_en_camino)", 200, ev.status);
      const gps = await ganador.api("PATCH", "/api/cargas/gps", { carga_id: nuevaId, lat: -32.5, lng: -60.9, velocidad: 72 });
      ok("chofer", "GPS simulado: PATCH posición", 200, gps.status);
      const ver = await cli.api("GET", "/api/cargas/historial-cliente");
      const c = ver.json?.cargas?.find((x) => x.id === nuevaId);
      ok("cliente", "GPS visible para el cliente (lat/lng/velocidad)", [-32.5, -60.9, 72], [c?.lat, c?.lng, c?.velocidad_kmh]);
      const cm = await ganador.api("POST", "/api/chat/mensaje", { viaje_id: nuevaId, tipo_chat: "viaje", mensaje: "smoke chofer" });
      ok("chofer", "chat: chofer escribe en su viaje", 200, cm.status);
    }
  }
  const acr = await ganador.api("POST", "/api/chofer/billetera/acreditar", { viaje_id: nuevaId });
  ok("chofer", "billetera: acreditar viaje finalizado", [200, true], [acr.status, acr.json?.inserted === true]);
  const acr2 = await ganador.api("POST", "/api/chofer/billetera/acreditar", { viaje_id: nuevaId });
  ok("chofer", "billetera: NO acredita dos veces (idempotente)", [200, true], [acr2.status, acr2.json?.alreadyExists === true]);
  const bil = await ganador.api("GET", "/api/chofer/billetera");
  ok("chofer", "billetera (ruta migrada): incluye el movimiento nuevo con el monto del viaje", esperado.choferCobra, Number(bil.json?.data?.find((m) => String(m.viaje_id) === String(nuevaId))?.monto));
  const hch = await ganador.api("GET", "/api/cargas/historial-chofer");
  ok("chofer", "historial del chofer (ruta migrada) incluye el viaje", true, !!hch.json?.cargas?.some((c) => c.id === nuevaId));

  // ══ ADMIN ═════════════════════════════════════════════════════════════════
  const adm = await iniciarSesion(base, "admin");
  ok("admin", "login (rol admin)", "admin", adm.rol);
  const us = await adm.api("GET", "/api/admin/usuarios");
  const emails = (us.json?.usuarios ?? []).map((u) => u.email);
  ok("admin", "usuarios (ruta migrada): los 6 del seed y sin password", [true, false], [["admin", "cliente1", "cliente2", "chofer1", "chofer2", "chofer3"].every((k) => emails.includes(`${k}@tila-staging.invalid`)), /password/.test(us.texto)]);
  const cg = await adm.api("GET", "/api/admin/cargas");
  ok("admin", "cargas: ve todas (≥ 8) incluida la nueva finalizada", [true, true], [(cg.json?.cargas?.length ?? 0) >= 8, cg.json?.cargas?.find((c) => c.id === nuevaId)?.estado === "Viaje finalizado"]);
  const rs = await adm.api("GET", "/api/chat/resumen-admin");
  ok("admin", "chat: resumen de no leídos (ruta migrada) incluye el viaje 103", true, !!rs.json?.resumen?.["103"]);
  const am = await adm.api("POST", "/api/chat/mensaje", { viaje_id: 103, tipo_chat: "soporte_cliente", mensaje: `smoke admin ${modo}` });
  ok("admin", "chat: responde en soporte_cliente", 200, am.status);
  const cl = await cli.api("GET", "/api/chat/mensajes?viaje_id=103&tipo_chat=soporte_cliente");
  ok("cliente", "chat soporte: el cliente ve la respuesta del admin", true, !!cl.json?.data?.some((m) => m.mensaje === `smoke admin ${modo}`));
  const noAdm = await cli.api("GET", "/api/admin/cargas");
  ok("admin", "un cliente NO accede a /api/admin/cargas", 403, noAdm.status);
  if (supabaseUrl && anon) {
    const d = await fetch(`${supabaseUrl}/rest/v1/documentacion_chofer?select=tipo&chofer_id=eq.${ID.chofer1}`, { headers: { apikey: anon, authorization: `Bearer ${anon}` } });
    const j = await d.json().catch(() => []);
    ok("admin", "documentación de chofer1 (lectura directa como el panel actual): 12 archivos", 12, Array.isArray(j) ? j.length : `HTTP ${d.status}`);
  }

  // ══ AUTENTICACIÓN: matriz mínima por modo sobre una ruta migrada ══════════
  const solo = async (h) => (await fetch(`${base}/api/cargas/historial-cliente`, { headers: h })).status;
  const cookieSola = cli.cookie ? await solo({ cookie: cli.cookie }) : "sin-cookie-emitida";
  // "legacy-sin-secreto" (instancia de control del entorno local) no emite cookie: como legacy, pero sin sesión firmada
  const esperadoCookie = { legacy: 401, dual: 200, strict: 200 }[modo] ?? "sin-cookie-emitida";
  ok("auth", "solo cookie", esperadoCookie, cookieSola);
  ok("auth", "solo x-user-id", { legacy: 200, dual: 200, strict: 401 }[modo] ?? 200, await solo({ "x-user-id": cli.id }));
  ok("auth", "cookie + x-user-id (como el frontend)", 200, await solo(cli.headers()));
  ok("auth", "sin credenciales", 401, await solo({}));
}
process.exit(R.resumen() ? 1 : 0);
