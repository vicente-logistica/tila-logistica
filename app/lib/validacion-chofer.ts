import {
  DOCS_PERSONALES,
  DOCS_VEHICULO,
  VehiculoRow,
  vencimientoVigente,
} from "./vehiculos";

export interface ResultadoValidacion {
  puedeOnline: boolean;
  acciones: string[];
}

const hoyIso = () => new Date().toISOString().slice(0, 10);

export function evaluarDocumentacionPersonal(docs: Record<string, string>): string[] {
  const faltantes: string[] = [];
  for (const doc of DOCS_PERSONALES) {
    if (!docs[doc.tipo]) faltantes.push(`Subí ${doc.label.toLowerCase()}`);
  }
  // El código del certificado de antecedentes es obligatorio además del archivo
  if (!docs["antecedentes_codigo"]) {
    faltantes.push("Ingresá el código del certificado de antecedentes");
  }
  return faltantes;
}

export function evaluarVehiculo(v: VehiculoRow | null | undefined): string[] {
  const faltantes: string[] = [];
  if (!v) return ["Registrá un vehículo"];
  if (!v.marca?.trim()) faltantes.push("Completá la marca del vehículo");
  if (!v.modelo?.trim()) faltantes.push("Completá el modelo del vehículo");
  if (!v.anio) faltantes.push("Completá el año del vehículo");
  if (!v.patente?.trim()) faltantes.push("Completá la patente");
  if (!v.tipo_vehiculo?.trim()) faltantes.push("Seleccioná el tipo de vehículo");
  if (!v.cedula_verde_url) faltantes.push("Subí la cédula verde");
  if (!v.seguro_url) faltantes.push("Subí el seguro del vehículo");
  if (!v.vtv_rto_url) faltantes.push("Subí la VTV / RTO");
  if (!v.seguro_vencimiento) faltantes.push("Indicá la fecha de vencimiento del seguro");
  else if (!vencimientoVigente(v.seguro_vencimiento)) faltantes.push("Seguro vencido — renovalo para conectarte");
  if (!v.vtv_rto_vencimiento) faltantes.push("Indicá la fecha de vencimiento de VTV / RTO");
  else if (!vencimientoVigente(v.vtv_rto_vencimiento)) faltantes.push("VTV / RTO vencida — renovala para conectarte");
  return faltantes;
}

export function evaluarChoferOnline(input: {
  vehiculoActivo: VehiculoRow | null;
  docsPersonales: Record<string, string>;
  vehiculoActivoId: string | null;
}): ResultadoValidacion {
  const acciones: string[] = [];

  if (!input.vehiculoActivoId) acciones.push("Seleccioná el vehículo con el que vas a operar");
  acciones.push(...evaluarVehiculo(input.vehiculoActivo));
  acciones.push(...evaluarDocumentacionPersonal(input.docsPersonales));

  const unicas = [...new Set(acciones)];
  return { puedeOnline: unicas.length === 0, acciones: unicas };
}

export { hoyIso };
