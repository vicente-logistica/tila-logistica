// Compara las columnas que USA el código (inventario-esquema.generado.json) con las que DOCUMENTA BACKUP_RECOVERY_PLAN.md
// y con las columnas REALES de `usuarios`, `documentacion_chofer`, `vehiculos`, `viaje_evidencias` y `paradas_viaje` que se
// observaron en la auditoría (lectura con la anon key: solo nombres de columnas).
// Uso: node scripts/staging/comparar-con-doc.mjs
import fs from "node:fs";

const inv = JSON.parse(fs.readFileSync("docs/staging/inventario-esquema.generado.json", "utf8")).tablas;
const md = fs.readFileSync("BACKUP_RECOVERY_PLAN.md", "utf8");

// ── columnas documentadas: tablas "### `tabla`" seguidas de filas "| `col` | tipo | ..." ──
const doc = {};
let actual = null;
for (const l of md.split(/\r?\n/)) {
  const h = /^###\s+`([a-z_]+)`/.exec(l);
  if (h) { actual = h[1]; doc[actual] = {}; continue; }
  if (/^##\s/.test(l)) actual = null;
  const f = /^\|\s*`([a-z_]+)`\s*\|\s*([^|]*)\|/.exec(l);
  if (actual && f) doc[actual][f[1]] = f[2].trim();
}

// ── columnas REALES observadas (auditoría 18/09, solo nombres) ─────────────────
const reales = {
  usuarios: "id,nombre,email,password,telefono,rol,acepta_terminos,created_at,cuit,contacto,direccion,deposito,dni,cuit_cuil,licencia,cnrt_ruta,antecedentes,patente,vehiculo,capacidad_carga,seguro_vehiculo,seguro_carga,vtv_rto,metodo_cobro,alias_cbu_cvu,titular_cuenta,banco_billetera,estado_validacion,online,zona_operativa,estado_aprobacion,eliminado,bateria_nivel,bateria_cargando,ultima_senal_at,categoria_legal,tipo_vehiculo,tipo_carroceria,navegador_preferido,vehiculo_activo_id,fecha_aceptacion_terminos,estado_doc",
  documentacion_chofer: "id,chofer_id,tipo,url,created_at",
  vehiculos: "id,chofer_id,marca,modelo,anio,color,patente,tipo_vehiculo,capacidad_kg,cedula_verde_url,seguro_url,seguro_vencimiento,vtv_rto_url,vtv_rto_vencimiento,foto_vehiculo_url,estado_validacion,motivo_rechazo,activo,created_at,updated_at",
  viaje_evidencias: "id,carga_id,usuario_id,rol_usuario,evento,estado_viaje,lat,lng,nombre_receptor,observacion,foto_url,created_at,tipo_operacion,tipo_carga,entrego_nombre,recibio_nombre,parada_id",
  paradas_viaje: "id,carga_id,orden,tipo,direccion,lat,lng,estado,completada_at,created_at",
};
// consentimientos_legales: el código escribe estas columnas (app/lib/consentimiento.ts)
inv.consentimientos_legales = { union: "usuario_id,tipo_documento,version_documento,fecha_hora,ip_address,user_agent,metodo".split(",") };

const fila = (t, a) => `  ${t.padEnd(24)} ${a}`;
console.log("tabla                    usada por el código pero NO en el documento del repo → (¿existe en BD real?)\n");
for (const t of Object.keys(inv).sort()) {
  const usadas = inv[t].union;
  const d = Object.keys(doc[t] ?? {});
  const r = reales[t] ? reales[t].split(",") : null;
  const faltaDoc = usadas.filter((c) => !d.includes(c) && c !== "exact");
  const confirmadasReal = r ? faltaDoc.filter((c) => r.includes(c)) : [];
  const noConfirmadas = r ? faltaDoc.filter((c) => !r.includes(c)) : faltaDoc;
  console.log(fila(t, `documentada=${d.length ? "sí" : "NO"} | usadas=${usadas.length} | sin documentar=${faltaDoc.length}`));
  if (faltaDoc.length) console.log(`      sin documentar: ${faltaDoc.join(", ")}`);
  if (r) console.log(`      → confirmadas en BD real: ${confirmadasReal.join(", ") || "-"} | NO confirmadas: ${noConfirmadas.join(", ") || "-"}`);
  else console.log(`      → sin observación real (la anon key no la ve): hace falta dump del esquema`);
  if (r) {
    const doc_no_real = d.filter((c) => !r.includes(c));
    if (doc_no_real.length) console.log(`      documentadas pero AUSENTES en la BD real observada: ${doc_no_real.join(", ")}`);
  }
}
