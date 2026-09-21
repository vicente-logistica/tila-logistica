// Datos de SEED de staging — TOTALMENTE INVENTADOS y deterministas. Ningún dato real de TILA.
//   · emails      : *@tila-staging.invalid (TLD reservado, no existe)
//   · teléfonos   : +54 11 0000 00NN (rango ficticio)   · DNI: 000000NN   · CUIT: 20-000000NN-0
//   · CBU/alias   : alias.staging.*                      · contraseñas: "Staging-<Rol>-1234" (solo para pruebas)
//   · documentos  : imágenes grises generadas al vuelo (ver png.mjs), sin datos personales
// Cada fila lleva id explícito → el seed es idempotente (upsert por id).
import { calcularTarifaTILA, estimarDuracion } from "../../../app/lib/tarifas.ts";
import { VERSIONES_LEGALES } from "../../../app/lib/versiones-legales.ts";

const NS = "57a91000-0000-4000-8000-";
const uid = (n) => `${NS}${String(n).padStart(12, "0")}`;
// ids UUID deterministas para las tablas cuyo `id` REAL es uuid (con enteros, Postgres real rechaza el seed: 22P02).
// Mismo prefijo que los usuarios (que usan 1–23): documentacion_chofer → uid(1000 + n) · mensajes_viaje → uid(2000 + n) · billetera_chofer → uid(3000 + n).
export const ID = {
  admin: uid(1), cliente1: uid(11), cliente2: uid(12), chofer1: uid(21), chofer2: uid(22), chofer3: uid(23),
};
export const CLAVES = {
  admin: "Staging-Admin-1234", cliente1: "Staging-Cliente1-1234", cliente2: "Staging-Cliente2-1234",
  chofer1: "Staging-Chofer1-1234", chofer2: "Staging-Chofer2-1234", chofer3: "Staging-Chofer3-1234",
};
export const EMAIL = (clave) => `${clave}@tila-staging.invalid`;
export const ROL = { admin: "admin", cliente1: "cliente", cliente2: "cliente", chofer1: "chofer", chofer2: "chofer", chofer3: "chofer" };
export const VEHICULO_ID = { chofer1: 5001, chofer2: 5002, chofer3: 5003 };

const BASE = Date.parse("2026-09-01T12:00:00.000Z");
const t = (min) => new Date(BASE + min * 60_000).toISOString();

/** Usuarios (sin contraseña): el aplicador agrega el hash bcrypt. */
export function usuarios(ahora = new Date().toISOString()) {
  const base = (k, n, extra) => ({
    id: ID[k], nombre: extra.nombre, email: EMAIL(k), telefono: `+54 11 0000 00${n}`, rol: ROL[k], acepta_terminos: true,
    fecha_aceptacion_terminos: t(0), created_at: t(0), dni: `000000${n}`, eliminado: false, online: false,
    estado_aprobacion: "aprobado", estado_doc: "completa", estado_validacion: "aprobado", ...extra.campos,
  });
  const chofer = (k, n, nombre, campos) => base(k, n, {
    nombre,
    campos: {
      cuit_cuil: `20-000000${n}-0`, licencia: `LIC-FICTICIA-${n}`, cnrt_ruta: `CNRT-FICTICIO-${n}`, metodo_cobro: "Transferencia bancaria",
      alias_cbu_cvu: `alias.staging.${k}`, titular_cuenta: `Titular Ficticio ${n}`, banco_billetera: "Banco Ficticio", zona_operativa: "Centro (ficticia)",
      seguro_carga: "Si", navegador_preferido: "google_maps", bateria_nivel: 80, bateria_cargando: false, ...campos,
    },
  });
  return [
    base("admin", "01", { nombre: "Admin Staging", campos: {} }),
    base("cliente1", "11", { nombre: "Cliente Uno Ficticio", campos: {} }),
    base("cliente2", "12", { nombre: "Cliente Dos Ficticio", campos: {} }),
    // chofer1: aprobado, ONLINE, camión rígido N2, docs completos → el chofer "operativo" de los flujos
    chofer("chofer1", "21", "Chofer Uno Ficticio (aprobado, online)", {
      online: true, ultima_senal_at: ahora, patente: "STG001", vehiculo: "Camión rígido", tipo_vehiculo: "Camión rígido", tipo_carroceria: "Baranda volcable", categoria_legal: "N2", capacidad_carga: "8000",
    }),
    // chofer2: aprobado, OFFLINE, utilitario N1, docs completos
    chofer("chofer2", "22", "Chofer Dos Ficticio (aprobado, offline)", {
      patente: "STG002", vehiculo: "Utilitario", tipo_vehiculo: "Utilitario", tipo_carroceria: "Furgón", categoria_legal: "N1", capacidad_carga: "1200",
    }),
    // chofer3: PENDIENTE de aprobación, docs parciales
    chofer("chofer3", "23", "Chofer Tres Ficticio (pendiente)", {
      estado_aprobacion: "pendiente", estado_validacion: "pendiente", estado_doc: "pendiente_actualizacion", patente: "STG003", vehiculo: "Pick-up", tipo_vehiculo: "Pick-up", tipo_carroceria: "Plataforma", categoria_legal: "N1", capacidad_carga: "900",
    }),
  ];
}

/** Vehículos (uno por chofer). Las URLs de documentos se completan con la base de Storage del destino. */
export function vehiculos(baseStorage) {
  const u = (chofer, tipo, bucket = "documentacion-choferes") => `${baseStorage}/storage/v1/object/public/${bucket}/${ID[chofer]}/${tipo}.png`;
  const v = (k, marca, modelo, anio, patente, tipoV, kg, completo) => ({
    id: VEHICULO_ID[k], chofer_id: ID[k], marca, modelo, anio, patente, tipo_vehiculo: tipoV, capacidad_kg: kg, activo: true,
    estado_validacion: completo ? "aprobado" : "pendiente", seguro_vencimiento: "2027-12-31", vtv_rto_vencimiento: "2027-12-31",
    created_at: t(1), updated_at: t(1),
    ...(completo ? { cedula_verde_url: u(k, "cedula_verde"), seguro_url: u(k, "seguro"), vtv_rto_url: u(k, "vtv_rto"), foto_vehiculo_url: u(k, "foto_frente", "vehiculos") } : {}),
  });
  return [
    v("chofer1", "Marca Ficticia", "Modelo R", 2020, "STG001", "Camión rígido", 8000, true),
    v("chofer2", "Marca Ficticia", "Modelo U", 2021, "STG002", "Utilitario", 1200, true),
    v("chofer3", "Marca Ficticia", "Modelo P", 2019, "STG003", "Pick-up", 900, false),
  ];
}

export const TIPOS_DOC_PERSONAL = ["dni_frente", "dni_dorso", "licencia", "antecedentes_penales"];
export const TIPOS_DOC_VEHICULO = ["cedula_verde", "seguro", "vtv_rto"];
export const TIPOS_FOTO = ["foto_frente", "foto_lateral_izquierda", "foto_lateral_derecha", "foto_trasera"];

/** Documentación ficticia: choferes 1 y 2 completa; chofer3 parcial. Devuelve filas y la lista de archivos a subir. */
export function documentacion(baseStorage) {
  const filas = [], archivos = [];
  let id = 1;
  const agregar = (k, tipo, bucket) => {
    const ruta = `${ID[k]}/${tipo}.png`;
    archivos.push({ bucket, ruta });
    filas.push({ id: uid(1000 + id++), chofer_id: ID[k], tipo, url: `${baseStorage}/storage/v1/object/public/${bucket}/${ruta}`, created_at: t(2) });
  };
  for (const k of ["chofer1", "chofer2"]) {
    for (const tp of [...TIPOS_DOC_PERSONAL, ...TIPOS_DOC_VEHICULO]) agregar(k, tp, "documentacion-choferes");
    for (const tp of TIPOS_FOTO) agregar(k, tp, "vehiculos");
    filas.push({ id: uid(1000 + id++), chofer_id: ID[k], tipo: "antecedentes_codigo", url: `COD-FICTICIO-${k}`, created_at: t(2) });
  }
  for (const tp of ["dni_frente", "dni_dorso"]) agregar("chofer3", tp, "documentacion-choferes");
  return { filas, archivos };
}

// ── Cargas ───────────────────────────────────────────────────────────────────
const CIUDADES = {
  rosario: [-32.9442, -60.6505], cordoba: [-31.4201, -64.1888], caba: [-34.6037, -58.3816], laplata: [-34.9205, -57.9536],
  sanluis: [-33.2950, -66.3356], mendoza: [-32.8895, -68.8458], santafe: [-31.6333, -60.7000],
};
export const CIUDAD = CIUDADES;

/** El módulo de tarifas de la app imprime un console.log por cálculo: se silencia solo durante el cálculo. */
function tarifaSilenciosa(entrada) {
  const log = console.log;
  console.log = () => {};
  try { return calcularTarifaTILA(entrada); } finally { console.log = log; }
}

function carga(id, o) {
  const tar = tarifaSilenciosa({ distanciaKm: o.km, tipoVehiculo: o.tipoVehiculo, tipoCarga: "general", duracionHoras: estimarDuracion(o.km, o.tipoVehiculo), cantidadParadas: o.paradas ?? 1 });
  return {
    id, cliente_id: ID[o.cliente], chofer_id: o.chofer ? ID[o.chofer] : null, estado: o.estado,
    origen: o.origen, destino: o.destino, vehiculo: `${o.tipoVehiculo} - ${o.categoria}`, categoria_legal: o.categoria, tipo_vehiculo: o.tipoVehiculo,
    tipo_carroceria: o.carroceria ?? null, peso: o.peso ?? "2 t", tipo_carga: "Carga común", detalles: `Carga ficticia de staging #${id}`, km_estimados: o.km,
    precio_base: tar.subtotalAntesComision, precio_cliente: tar.precioCliente, pago_chofer: tar.choferCobra, comision_plataforma: tar.comisionTila,
    pago_estado: o.pago ?? "pagado", pagado_cliente: (o.pago ?? "pagado") === "pagado", tracking: !!o.tracking, oculto_cliente: false, oculto_chofer: false,
    created_at: t(o.min), ...(o.extra ?? {}),
  };
}

/** Cargas para todos los estados del flujo. */
export function cargas(ahora = new Date().toISOString()) {
  return [
    carga(101, { cliente: "cliente1", estado: "pendiente", origen: "Rosario, Santa Fe", destino: "Córdoba, Córdoba", km: 400, tipoVehiculo: "Camión rígido", categoria: "N2", carroceria: "Baranda volcable", pago: "pendiente_pago", paradas: 3, min: 10 }),
    carga(102, { cliente: "cliente2", estado: "pendiente", origen: "CABA, Buenos Aires", destino: "La Plata, Buenos Aires", km: 60, tipoVehiculo: "Utilitario", categoria: "N1", carroceria: "Furgón", pago: "pagado", min: 20 }),
    carga(103, { cliente: "cliente1", chofer: "chofer1", estado: "En camino", origen: "Rosario, Santa Fe", destino: "Santa Fe, Santa Fe", km: 170, tipoVehiculo: "Camión rígido", categoria: "N2", carroceria: "Baranda volcable", tracking: true, paradas: 2, min: 30,
      extra: { hora_aceptacion: t(35), hora_inicio: t(40), lat: CIUDADES.rosario[0], lng: CIUDADES.rosario[1], velocidad: 0, velocidad_kmh: 0, gps_actualizado: ahora } }),
    carga(104, { cliente: "cliente2", chofer: "chofer2", estado: "Viaje finalizado", origen: "Mendoza, Mendoza", destino: "San Luis, San Luis", km: 260, tipoVehiculo: "Utilitario", categoria: "N1", carroceria: "Furgón", min: -2000,
      extra: { hora_aceptacion: t(-1990), hora_inicio: t(-1980), hora_finalizacion: t(-1700) } }),
    carga(105, { cliente: "cliente1", estado: "Cancelado por chofer", origen: "Córdoba, Córdoba", destino: "Rosario, Santa Fe", km: 400, tipoVehiculo: "Camión rígido", categoria: "N2", carroceria: "Baranda volcable", pago: "pagado", min: -1000 }),
    carga(106, { cliente: "cliente2", chofer: "chofer2", estado: "Chofer asignado", origen: "CABA, Buenos Aires", destino: "Rosario, Santa Fe", km: 300, tipoVehiculo: "Utilitario", categoria: "N1", carroceria: "Furgón", min: 50, extra: { hora_aceptacion: t(55) } }),
    carga(107, { cliente: "cliente1", chofer: "chofer1", estado: "Viaje finalizado", origen: "Santa Fe, Santa Fe", destino: "Córdoba, Córdoba", km: 340, tipoVehiculo: "Camión rígido", categoria: "N2", carroceria: "Baranda volcable", min: -3000,
      extra: { hora_aceptacion: t(-2990), hora_inicio: t(-2980), hora_finalizacion: t(-2600) } }),
  ];
}

export function paradas() {
  const p = (id, carga_id, orden, tipo, direccion, [lat, lng], estado = "pendiente") => ({ id, carga_id, orden, tipo, direccion, lat, lng, estado, ...(estado === "completada" ? { completada_at: t(45) } : {}), created_at: t(11) });
  return [
    p(1, 101, 0, "retiro", "Rosario, Santa Fe", CIUDADES.rosario), p(2, 101, 1, "parada", "Santa Fe, Santa Fe", CIUDADES.santafe), p(3, 101, 2, "entrega", "Córdoba, Córdoba", CIUDADES.cordoba),
    p(4, 103, 0, "retiro", "Rosario, Santa Fe", CIUDADES.rosario, "completada"), p(5, 103, 1, "entrega", "Santa Fe, Santa Fe", CIUDADES.santafe),
  ];
}

/** Mensajes de las tres vías (viaje / soporte_cliente / soporte_chofer), leídos y no leídos. */
export function mensajes() {
  const m = (id, viaje, tipo, k, texto, leido, min) => ({ id: uid(2000 + id), viaje_id: viaje, tipo_chat: tipo, remitente_id: ID[k], remitente_rol: ROL[k], remitente_nombre: k === "admin" ? "Admin Staging" : k, mensaje: texto, leido, created_at: t(min) });
  return [
    m(1, 103, "viaje", "cliente1", "Hola, ¿ya salió de Rosario?", true, 41), m(2, 103, "viaje", "chofer1", "Sí, ya estoy en camino.", true, 42), m(3, 103, "viaje", "cliente1", "Perfecto, gracias.", false, 43),
    m(4, 103, "soporte_cliente", "cliente1", "Consulta de facturación (ficticia).", true, 44), m(5, 103, "soporte_cliente", "admin", "Te respondemos en el día.", false, 45),
    m(6, 103, "soporte_chofer", "chofer1", "Consulta de documentación (ficticia).", false, 46),
    m(7, 104, "viaje", "cliente2", "Entrega recibida, gracias.", true, -1700), m(8, 104, "viaje", "chofer2", "De nada.", true, -1699),
  ];
}

export function billetera() {
  const c = cargas();
  const pc = (id) => c.find((x) => x.id === id).pago_chofer;
  return [
    { id: uid(3001), chofer_id: ID.chofer2, viaje_id: "104", monto: pc(104), created_at: t(-1690) },
    { id: uid(3002), chofer_id: ID.chofer1, viaje_id: "107", monto: pc(107), created_at: t(-2590) },
  ];
}

export function evidencias(baseStorage) {
  const e = (id, carga_id, evento, estado_viaje, min, [lat, lng]) => ({ id, carga_id, evento, rol_usuario: "chofer", usuario_id: ID.chofer1, estado_viaje, lat, lng, created_at: t(min) });
  return [
    e(1, 103, "viaje_aceptado", "Chofer asignado", 35, CIUDADES.rosario), e(2, 103, "chofer_en_camino", "En camino", 40, CIUDADES.rosario),
    { ...e(3, 103, "carga_retirada", "Carga retirada", 44, CIUDADES.rosario), tipo_operacion: "carga", entrego_nombre: "Depósito Ficticio", foto_url: `${baseStorage}/storage/v1/object/public/documentacion-choferes/evidencias/103/carga_1.png` },
  ];
}

export function consentimientos() {
  const filas = []; let id = 1;
  for (const k of Object.keys(ID)) {
    const docs = ROL[k] === "chofer" ? ["terminos", "privacidad", "contrato_transportista"] : ["terminos", "privacidad"];
    for (const d of docs) filas.push({ id: id++, usuario_id: ID[k], tipo_documento: d, version_documento: VERSIONES_LEGALES[d], fecha_hora: t(0), ip_address: "203.0.113.10", user_agent: "seed-staging", metodo: "seed_staging" });
  }
  return filas;
}

/** Polilínea ficticia Rosario → Santa Fe para la simulación de GPS del viaje 103 (interpolación lineal). */
export function rutaGps(pasos = 20, desde = CIUDADES.rosario, hasta = CIUDADES.santafe) {
  return Array.from({ length: pasos + 1 }, (_, i) => ({ lat: +(desde[0] + (hasta[0] - desde[0]) * (i / pasos)).toFixed(6), lng: +(desde[1] + (hasta[1] - desde[1]) * (i / pasos)).toFixed(6), velocidad: i === 0 || i === pasos ? 0 : 70 }));
}
