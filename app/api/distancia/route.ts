process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const origen = searchParams.get("origen");
    const destino = searchParams.get("destino");

    if (!origen || !destino) {
      return NextResponse.json(
        { error: "Faltan origen o destino" },
        { status: 400 }
      );
    }

    const key = "AIzaSyB-eO21BtF2EVvtC8p2MGXFVJg7X9xd1nk";

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
      `${origen}, Argentina`
    )}&destination=${encodeURIComponent(
      `${destino}, Argentina`
    )}&mode=driving&language=es&region=ar&key=${key}`;

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

    const data = await response.json();

    if (data.status !== "OK") {
      return NextResponse.json(
        {
          error: data.status,
          detalle: data.error_message || data,
        },
        { status: 400 }
      );
    }

    const leg = data.routes[0].legs[0];
    const km = Math.ceil(leg.distance.value / 1000);

    return NextResponse.json({
      km,
      texto: leg.distance.text,
      duracion: leg.duration.text,
      origen: leg.start_address,
      destino: leg.end_address,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "ERROR_INTERNO",
        detalle: error?.message || String(error),
        causa: error?.cause || null,
      },
      { status: 500 }
    );
  }
}