export const TIPOS_VEHICULO_CHOFER = [
  "Moto", "Utilitario", "Furgón", "Pick-up",
  "Camión rígido", "Camión tractor", "Bitrén",
] as const;

export const DOCS_PERSONALES = [
  { tipo: "dni_frente", label: "DNI Frente", bucket: "documentacion-choferes" },
  { tipo: "dni_dorso", label: "DNI Dorso", bucket: "documentacion-choferes" },
  { tipo: "licencia", label: "Licencia de conducir", bucket: "documentacion-choferes" },
  { tipo: "antecedentes", label: "Certificado de antecedentes", bucket: "documentacion-choferes" },
] as const;

export const DOCS_VEHICULO = [
  { tipo: "cedula", label: "Cédula verde", bucket: "documentacion-choferes", campo: "cedula_verde_url" as const },
  { tipo: "seguro", label: "Seguro del vehículo", bucket: "documentacion-choferes", campo: "seguro_url" as const },
  { tipo: "vtv_rto", label: "VTV / RTO", bucket: "documentacion-choferes", campo: "vtv_rto_url" as const },
] as const;

export const FOTOS_VEHICULO = [
  { tipo: "foto_frente", label: "Frente", bucket: "vehiculos" },
  { tipo: "foto_lateral_izq", label: "Lateral izquierda", bucket: "vehiculos" },
  { tipo: "foto_lateral_der", label: "Lateral derecha", bucket: "vehiculos" },
  { tipo: "foto_trasera", label: "Trasera", bucket: "vehiculos" },
] as const;

export interface VehiculoRow {
  id: string;
  chofer_id: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  patente: string | null;
  tipo_vehiculo: string | null;
  cedula_verde_url: string | null;
  seguro_url: string | null;
  seguro_vencimiento: string | null;
  vtv_rto_url: string | null;
  vtv_rto_vencimiento: string | null;
  foto_vehiculo_url: string | null;
  estado_validacion: string | null;
  activo: boolean | null;
}

export function labelVehiculo(v: Partial<VehiculoRow> | null | undefined): string {
  if (!v) return "Vehículo pendiente";
  if (v.marca && v.modelo && v.patente) return `${v.marca} ${v.modelo} · ${v.patente}`;
  if (v.patente && v.tipo_vehiculo) return `${v.tipo_vehiculo} · ${v.patente}`;
  if (v.patente) return v.patente;
  if (v.tipo_vehiculo) return v.tipo_vehiculo;
  return "Vehículo incompleto";
}

export function vencimientoVigente(fecha: string | null | undefined): boolean {
  if (!fecha) return false;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const venc = new Date(fecha);
  venc.setHours(0, 0, 0, 0);
  return venc >= hoy;
}

export async function subirDocChofer(
  supabase: any,
  choferId: string,
  tipo: string,
  bucket: string,
  archivo: File,
): Promise<string | null> {
  const ext = archivo.name.split(".").pop() || "bin";
  const path = `${choferId}/${tipo}.${ext}`;
  const { error: errorUpload } = await supabase.storage.from(bucket).upload(path, archivo, { upsert: true });
  if (errorUpload) return null;
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
  const url = urlData.publicUrl as string;
  await supabase.from("documentacion_chofer").upsert(
    [{ chofer_id: choferId, tipo, url }],
    { onConflict: "chofer_id,tipo" },
  );
  return url;
}

export async function actualizarCampoVehiculo(
  supabase: any,
  vehiculoId: string,
  campo: keyof VehiculoRow,
  valor: string,
) {
  await supabase.from("vehiculos").update({ [campo]: valor, updated_at: new Date().toISOString() }).eq("id", vehiculoId);
}
