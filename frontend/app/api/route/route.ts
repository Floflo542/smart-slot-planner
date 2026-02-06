import { NextResponse } from "next/server";

const ORS_API_KEY = process.env.ORS_API_KEY || "";

function parseLatLon(value: string | null) {
  if (!value) return null;
  const [latStr, lonStr] = value.split(",").map((part) => part.trim());
  const lat = Number.parseFloat(latStr);
  const lon = Number.parseFloat(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export async function GET(req: Request) {
  if (!ORS_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "ORS_API_KEY manquant" },
      { status: 500 }
    );
  }
  const { searchParams } = new URL(req.url);
  const from = parseLatLon(searchParams.get("from"));
  const to = parseLatLon(searchParams.get("to"));

  if (!from || !to) {
    return NextResponse.json(
      { ok: false, error: "Parametres from/to invalides" },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const orsUrl =
      "https://api.openrouteservice.org/v2/directions/driving-car";
    const upstream = await fetch(orsUrl, {
      method: "POST",
      headers: {
        Authorization: ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const json = await upstream.json();
    const durationSec = Number(
      json?.features?.[0]?.properties?.summary?.duration
    );
    if (!upstream.ok || !Number.isFinite(durationSec)) {
      return NextResponse.json(
        { ok: false, error: "Aucune route disponible (OpenRouteService)" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      duration_sec: durationSec,
      duration_min: durationSec / 60,
      provider: "ors",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Erreur appel trafic" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
