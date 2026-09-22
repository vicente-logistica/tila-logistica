// Supabase SIMULADO (subconjunto de PostgREST) para validar TILA en local SIN tocar producción.
// - Datos de prueba inventados en memoria (usuarios cliente / chofer / admin).
// - No implementa Storage ni Realtime (la app cae al polling, igual que hoy si Realtime no entrega eventos).
// - GET /__log devuelve las requests recibidas; POST /__reset reinicia los datos.
// Uso: node scripts/validacion-local/mock-supabase.mjs [puerto=4545]
import http from "node:http";

export const IDS = {
  admin:   "aaaaaaaa-0000-4000-8000-000000000001",
  cliente: "cccccccc-0000-4000-8000-000000000001",
  chofer:  "dddddddd-0000-4000-8000-000000000001",
};
export const CLAVES = { admin: "Admin-Prueba-1234", cliente: "Cliente-Prueba-1234", chofer: "Chofer-Prueba-1234" };
export const EMAILS = { admin: "admin.prueba@tila.invalid", cliente: "cliente.prueba@tila.invalid", chofer: "chofer.prueba@tila.invalid" };

const DOCS = ["dni_frente", "dni_dorso", "licencia", "antecedentes_penales", "seguro", "cedula_verde", "vtv_rto",
  "foto_frente", "foto_lateral_izquierda", "foto_lateral_derecha", "foto_trasera"];

async function crearBase() {
  const bcrypt = (await import("bcryptjs")).default;
  const ahora = new Date().toISOString();
  const base = (rol, nombre, extra = {}) => ({
    id: IDS[rol], nombre, email: EMAILS[rol], password: bcrypt.hashSync(CLAVES[rol], 4), telefono: "1100000000", rol,
    acepta_terminos: true, created_at: ahora, dni: "99999999", cuit_cuil: "20-99999999-9", licencia: "LIC-PRUEBA",
    antecedentes: "SECRETO", alias_cbu_cvu: "alias.prueba", titular_cuenta: "Titular Prueba", banco_billetera: "Banco Prueba",
    metodo_cobro: "cbu", cnrt_ruta: "CNRT-PRUEBA", vtv_rto: "VTV-PRUEBA", estado_validacion: "aprobado",
    online: false, estado_aprobacion: "aprobado", eliminado: false, estado_doc: "completa", ...extra,
  });
  return {
    usuarios: [
      base("admin", "Admin de Prueba"),
      base("cliente", "Cliente de Prueba"),
      base("chofer", "Chofer de Prueba", {
        patente: "AA000BB", vehiculo: "Camión rígido", tipo_vehiculo: "Camión rígido", categoria_legal: "N2",
        vehiculo_activo_id: 1, navegador_preferido: "google_maps", bateria_nivel: 80, bateria_cargando: false,
      }),
    ],
    cargas: [
      { id: 1, cliente_id: IDS.cliente, chofer_id: null, estado: "pendiente", origen: "Rosario, Santa Fe", destino: "Córdoba, Córdoba",
        vehiculo: "Camión rígido - N2", tipo_vehiculo: "Camión rígido", categoria_legal: "N2", peso: "5t", tipo_carga: "Carga común",
        detalles: "Carga de prueba", km_estimados: 400, precio_base: 900000, precio_cliente: 967500, pago_chofer: 832500,
        comision_plataforma: 135000, pago_estado: "pendiente_pago", pagado_cliente: false, tracking: false,
        oculto_cliente: false, oculto_chofer: false, created_at: ahora },
      { id: 2, cliente_id: IDS.cliente, chofer_id: IDS.chofer, estado: "Viaje finalizado", origen: "Pilar, Buenos Aires", destino: "Corrientes, Corrientes",
        vehiculo: "Camión rígido - N2", tipo_vehiculo: "Camión rígido", categoria_legal: "N2", peso: "8t", tipo_carga: "Carga común",
        detalles: "Viaje histórico de prueba", km_estimados: 900, precio_base: 2000000, precio_cliente: 2150000, pago_chofer: 1850000,
        comision_plataforma: 300000, pago_estado: "pagado", pagado_cliente: true, tracking: false,
        oculto_cliente: false, oculto_chofer: false, created_at: "2026-08-01T10:00:00.000Z", hora_finalizacion: "2026-08-02T10:00:00.000Z" },
    ],
    paradas_viaje: [
      { id: 1, carga_id: 1, orden: 0, tipo: "retiro", direccion: "Rosario, Santa Fe", estado: "pendiente" },
      { id: 2, carga_id: 1, orden: 1, tipo: "entrega", direccion: "Córdoba, Córdoba", estado: "pendiente" },
    ],
    vehiculos: [
      { id: 1, chofer_id: IDS.chofer, marca: "Iveco", modelo: "Tector", anio: 2020, patente: "AA000BB", color: "blanco",
        tipo_vehiculo: "Camión rígido", capacidad_kg: 8000, cedula_verde_url: "http://mock.invalid/cv.jpg", seguro_url: "http://mock.invalid/s.jpg",
        seguro_vencimiento: "2030-01-01", vtv_rto_url: "http://mock.invalid/v.jpg", vtv_rto_vencimiento: "2030-01-01",
        foto_vehiculo_url: "http://mock.invalid/f.jpg", estado_validacion: "aprobado", activo: true, created_at: ahora, updated_at: ahora },
    ],
    documentacion_chofer: DOCS.map((tipo, i) => ({ id: i + 1, chofer_id: IDS.chofer, tipo, url: `http://mock.invalid/${tipo}.jpg`, created_at: ahora })),
    billetera_chofer: [{ id: 1, chofer_id: IDS.chofer, viaje_id: 2, monto: 1850000, created_at: "2026-08-02T10:05:00.000Z" }],
    mensajes_viaje: [],
    viaje_evidencias: [],
    consentimientos_legales: [],
  };
}

function valorFila(v) { return v === null || v === undefined ? "null" : String(v); }

function coincide(fila, col, expr) {
  let negar = false;
  let e = expr;
  if (e.startsWith("not.")) { negar = true; e = e.slice(4); }
  const i = e.indexOf(".");
  const op = e.slice(0, i);
  const val = e.slice(i + 1);
  const v = valorFila(fila[col]);
  let r;
  switch (op) {
    case "eq": r = v === val; break;
    case "neq": r = v !== val; break;
    case "is": r = (val === "null" && (fila[col] === null || fila[col] === undefined)) || (val === "true" && fila[col] === true) || (val === "false" && fila[col] === false); break;
    case "in": r = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(v); break;
    case "gt": r = Number(v) > Number(val); break;
    case "gte": r = Number(v) >= Number(val); break;
    case "lt": r = Number(v) < Number(val); break;
    case "lte": r = Number(v) <= Number(val); break;
    case "like": case "ilike": r = new RegExp("^" + val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", op === "ilike" ? "i" : "").test(v); break;
    default: throw new Error(`operador no soportado por el mock: ${op}`);
  }
  return negar ? !r : r;
}

const RESERVADAS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

export async function iniciarMock(puerto = 4545) {
  let db = await crearBase();
  let log = [];
  const secuencias = () => Object.fromEntries(Object.entries(db).map(([t, f]) => [t, Math.max(0, ...f.map((x) => (typeof x.id === "number" ? x.id : 0)))]));
  let seq = secuencias();

  const servidor = http.createServer(async (req, res) => {
    const origen = req.headers.origin || "*";
    const cors = {
      "Access-Control-Allow-Origin": origen, "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] || "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS", "Access-Control-Expose-Headers": "Content-Range",
    };
    const enviar = (status, cuerpo, extra = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...cors, ...extra });
      res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo));
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

    const url = new URL(req.url, `http://127.0.0.1:${puerto}`);
    if (url.pathname === "/__log") return enviar(200, log);
    if (url.pathname === "/__reset") {
      db = await crearBase();
      // ?vacio=1 → mismas tablas pero sin filas (para probar el seed de staging sobre una base limpia)
      if (url.searchParams.get("vacio") === "1") for (const t of Object.keys(db)) db[t] = [];
      seq = secuencias(); log = [];
      return enviar(200, { ok: true });
    }
    if (url.pathname === "/storage/v1/bucket") return enviar(200, { name: "simulado" }); // crear/listar buckets: siempre OK

    const m = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    log.push({ metodo: req.method, ruta: url.pathname, consulta: url.search.slice(0, 160) });
    // Storage simulado: acepta subidas y devuelve una imagen mínima al pedirla (no guarda nada).
    if (url.pathname.startsWith("/storage/v1/object/")) {
      if (req.method === "POST" || req.method === "PUT") {
        await new Promise((r) => { req.on("end", r); req.resume(); }); // descartar el cuerpo
        return enviar(200, { Id: crypto.randomUUID(), Key: url.pathname.replace("/storage/v1/object/", "") });
      }
      res.writeHead(200, { "Content-Type": "image/png", ...cors });
      return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));
    }
    if (!m) return enviar(404, { message: "no soportado por el mock", ruta: url.pathname });
    const tabla = m[1];
    if (!db[tabla]) return enviar(404, { code: "PGRST205", message: `Could not find the table 'public.${tabla}' in the schema cache`, details: null, hint: null });

    let cuerpo = null;
    if (req.method === "POST" || req.method === "PATCH") {
      const trozos = [];
      for await (const t of req) trozos.push(t);
      try { cuerpo = JSON.parse(Buffer.concat(trozos).toString("utf8") || "null"); } catch { return enviar(400, { message: "JSON inválido" }); }
    }
    const prefer = String(req.headers.prefer || "");
    const quiereRep = prefer.includes("return=representation");
    const quiereObjeto = String(req.headers.accept || "").includes("vnd.pgrst.object+json");

    try {
      const filtrar = (filas) => {
        let r = filas;
        for (const [k, v] of url.searchParams) {
          if (RESERVADAS.has(k)) continue;
          if (k === "or") {
            // or=(col.op.val,col.op.val)  — solo condiciones planas, sin anidar
            const conds = v.replace(/^\(|\)$/g, "").split(",").map((c) => { const i = c.indexOf("."); return [c.slice(0, i), c.slice(i + 1)]; });
            r = r.filter((f) => conds.some(([col, expr]) => coincide(f, col, expr)));
            continue;
          }
          if (k === "and") throw new Error("filtro and no soportado por el mock");
          r = r.filter((f) => coincide(f, k, v));
        }
        return r;
      };
      const responderFilas = (filas, status = 200, extra = {}) => {
        if (quiereObjeto) {
          if (filas.length !== 1) return enviar(406, { code: "PGRST116", details: `The result contains ${filas.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" });
          return enviar(status, filas[0], extra);
        }
        return enviar(status, filas, extra);
      };
      const proyectar = (filas) => {
        const sel = (url.searchParams.get("select") || "*").trim();
        if (sel === "*" || sel.includes("(")) return filas;
        const cols = sel.split(",").map((c) => c.trim());
        return filas.map((f) => Object.fromEntries(cols.map((c) => [c, f[c]])));
      };

      if (req.method === "GET" || req.method === "HEAD") {
        let filas = filtrar(db[tabla]);
        const total = filas.length;
        const orden = url.searchParams.get("order");
        if (orden) {
          const [col, dir] = orden.split(".");
          filas = [...filas].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1));
        }
        const off = Number(url.searchParams.get("offset") || 0);
        const lim = url.searchParams.get("limit");
        filas = filas.slice(off, lim ? off + Number(lim) : undefined);
        const cr = { "Content-Range": total ? `${off}-${off + filas.length - 1}/${total}` : "*/0" };
        if (req.method === "HEAD") { res.writeHead(200, { ...cors, ...cr }); return res.end(); }
        return responderFilas(proyectar(filas), 200, cr);
      }

      if (req.method === "POST") {
        const lote = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
        const creadas = [];
        const conflicto = url.searchParams.get("on_conflict");
        for (const fila of lote) {
          let existente = null;
          if (prefer.includes("resolution=merge-duplicates") && conflicto) {
            const cols = conflicto.split(",");
            existente = db[tabla].find((x) => cols.every((c) => valorFila(x[c]) === valorFila(fila[c])));
          }
          if (existente) { Object.assign(existente, fila); creadas.push(existente); continue; }
          const nueva = { ...fila };
          if (nueva.id === undefined) nueva.id = tabla === "usuarios" ? crypto.randomUUID() : ++seq[tabla];
          if (!nueva.created_at) nueva.created_at = new Date().toISOString();
          db[tabla].push(nueva);
          creadas.push(nueva);
        }
        return quiereRep ? responderFilas(proyectar(creadas), 201) : enviar(201, undefined);
      }

      if (req.method === "PATCH") {
        const filas = filtrar(db[tabla]);
        for (const f of filas) Object.assign(f, cuerpo);
        return quiereRep ? responderFilas(proyectar(filas), 200) : enviar(204, undefined);
      }

      if (req.method === "DELETE") {
        const filas = filtrar(db[tabla]);
        db[tabla] = db[tabla].filter((f) => !filas.includes(f));
        return quiereRep ? responderFilas(filas, 200) : enviar(204, undefined);
      }
      return enviar(405, { message: "método no soportado" });
    } catch (e) {
      return enviar(400, { message: String(e.message || e) });
    }
  });

  await new Promise((r) => servidor.listen(puerto, "127.0.0.1", r));
  return { servidor, puerto, cerrar: () => new Promise((r) => servidor.close(r)) };
}

if (import.meta.url === new URL(process.argv[1], "file://").href || process.argv[1]?.endsWith("mock-supabase.mjs")) {
  const puerto = Number(process.argv[2] || 4545);
  await iniciarMock(puerto);
  console.log(`[mock-supabase] escuchando en http://127.0.0.1:${puerto} (datos de prueba en memoria)`);
}
