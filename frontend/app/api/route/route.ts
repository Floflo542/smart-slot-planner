import { NextResponse } from "next/server";

const GRAPHHOPPER_API_KEY = process.env.GRAPHHOPPER_API_KEY || "";

function parseLatLon(value: string | null) {
  if (!value) return null;
  const [latStr, lonStr] = value.split(",").map((part) => part.trim());
  const lat = Number.parseFloat(latStr);
  const lon = Number.parseFloat(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export async function GET(req: Request) {
  if (!GRAPHHOPPER_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "GRAPHHOPPER_API_KEY manquant" },
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
    const params = new URLSearchParams({
      key: GRAPHHOPPER_API_KEY,
      profile: "car",
      points_encoded: "false",
      locale: "fr",
    });
    params.append("point", `${from.lat},${from.lon}`);
    params.append("point", `${to.lat},${to.lon}`);

    const ghUrl = `https://graphhopper.com/api/1/route?${params.toString()}`;
    const upstream = await fetch(ghUrl, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });

    const json = await upstream.json();
    const durationMs = Number(json?.paths?.[0]?.time);
    const durationSec = durationMs / 1000;
    if (!upstream.ok || !Number.isFinite(durationSec)) {
      return NextResponse.json(
        { ok: false, error: "Aucune route disponible (GraphHopper)" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      duration_sec: durationSec,
      duration_min: durationSec / 60,
      provider: "graphhopper",
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
