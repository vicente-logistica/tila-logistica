export const TIPOS_VEHICULO_CHOFER = [
  "Moto", "Utilitario", "Furgón", "Pick-up",
  "Camión rígido", "Camión tractor", "Bitrén",
] as const;

export const DOCS_PERSONALES = [
  { tipo: "dni_frente",          label: "DNI Frente",                   bucket: "documentacion-choferes" },
  { tipo: "dni_dorso",           label: "DNI Dorso",                    bucket: "documentacion-choferes" },
  { tipo: "licencia",            label: "Licencia de conducir",         bucket: "documentacion-choferes" },
  { tipo: "antecedentes_penales", label: "Certificado de antecedentes", bucket: "documentacion-choferes" },
] as const;

export const DOCS_VEHICULO = [
  { tipo: "cedula_verde", label: "Cédula verde",        bucket: "documentacion-choferes", campo: "cedula_verde_url" as const },
  { tipo: "seguro",       label: "Seguro del vehículo", bucket: "documentacion-choferes", campo: "seguro_url"        as const },
  { tipo: "vtv_rto",      label: "VTV / RTO",           bucket: "documentacion-choferes", campo: "vtv_rto_url"       as const },
] as const;

export const FOTOS_VEHICULO = [
  { tipo: "foto_frente",            label: "Frente",            bucket: "vehiculos" },
  { tipo: "foto_lateral_izquierda", label: "Lateral izquierda", bucket: "vehiculos" },
  { tipo: "foto_lateral_derecha",   label: "Lateral derecha",   bucket: "vehiculos" },
  { tipo: "foto_trasera",           label: "Trasera",           bucket: "vehiculos" },
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

  console.log("[TILA-DOC] PASO 2 — ANTES upload Storage", {
    choferId,
    tipo,
    bucket,
    path,
    archivo: {
      name: archivo.name,
      size: archivo.size,
      type: archivo.type,
      lastModified: archivo.lastModified,
    },
  });

  try {
    const { data: dataUpload, error: errorUpload } = await supabase.storage
      .from(bucket)
      .upload(path, archivo, { upsert: true });

    console.log("[TILA-DOC] PASO 2 — DESPUÉS upload Storage", {
      ok: !errorUpload,
      dataUpload,
      errorUpload: errorUpload
        ? { message: errorUpload.message, name: errorUpload.name, statusCode: (errorUpload as any).statusCode }
        : null,
    });

    if (errorUpload) {
      alert(errorUpload.message);
      return null;
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    const url = urlData.publicUrl as string;

    console.log("[TILA-DOC] PASO 3 — getPublicUrl", {
      path,
      bucket,
      urlData,
      url,
    });

    // UPSERT en documentacion_chofer vía API server-side — nunca directo con anon key
    console.log("[TILA-DOC] PASO 4 — UPSERT vía /api/chofer/documentacion", { tipo, url });
    const apiRes = await fetch("/api/chofer/documentacion", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": choferId },
      body: JSON.stringify({ tipo, url }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}));
      console.error("[TILA-DOC] PASO 4 — error API", err);
      alert(err?.error ?? "Error al guardar documentación");
      return null;
    }

    console.log("[TILA-DOC] PASO 4 — OK vía API");

    console.log("[TILA-DOC] OK — subida completa", { tipo, url });
    return url;
  } catch (err: any) {
    console.error("[TILA-DOC] EXCEPCIÓN en subirDocChofer", err);
    alert(err?.message || String(err));
    return null;
  }
}

