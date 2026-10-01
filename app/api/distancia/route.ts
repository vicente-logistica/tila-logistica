import { NextResponse } from "next/server";
import { obtenerRutaPublicacion, puntosDesdeParametros, validarPuntosRuta } from "../../lib/geo/rutaPublicacion";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/distancia — km de la ruta para la vista previa de /publicar.
 *   ?punto=A&punto=B&punto=C   origen, paradas y destino en orden (UNA llamada a Directions)
 *   ?origen=A&destino=B        formato simple anterior (compatibilidad)
 * Responde { km, kmPorTramo }. Sólo distancia: no devuelve ni guarda place_id/coordenadas.
 */
export async function GET(req: Request) {
  try {
    const puntos = validarPuntosRuta(puntosDesdeParametros(new URL(req.url).searchParams));
    if (!puntos) {
      return NextResponse.json(
        { error: "Faltan origen o destino" },
        { status: 400 }
      );
    }

    const key = process.env.GOOGLE_SERVER_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "Falta GOOGLE_SERVER_API_KEY en variables de entorno" },
        { status: 500 }
      );
    }

    const ruta = await obtenerRutaPublicacion(puntos, key);
    if (!ruta.ok) {
      return NextResponse.json({ error: ruta.motivo }, { status: 400 });
    }

    return NextResponse.json({ km: ruta.kmTotal, kmPorTramo: ruta.kmPorTramo });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "ERROR_INTERNO",
        detalle: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
