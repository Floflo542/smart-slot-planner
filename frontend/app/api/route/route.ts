import { NextResponse } from "next/server";

const DISTANCEMATRIX_DISTANCE_KEY =
  process.env.DISTANCEMATRIX_DISTANCE_KEY ||
  process.env.DISTANCEMATRIX_KEY ||
  "";

function parseLatLon(value: string | null) {
  if (!value) return null;
  const [latStr, lonStr] = value.split(",").map((part) => part.trim());
  const lat = Number.parseFloat(latStr);
  const lon = Number.parseFloat(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export async function GET(req: Request) {
  if (!DISTANCEMATRIX_DISTANCE_KEY) {
    return NextResponse.json(
      { ok: false, error: "DISTANCEMATRIX_DISTANCE_KEY manquant" },
      { status: 500 }
    );
  }
  const { searchParams } = new URL(req.url);
  const from = parseLatLon(searchParams.get("from"));
  const to = parseLatLon(searchParams.get("to"));
  const departAt = searchParams.get("depart_at");

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
      origins: `${from.lat},${from.lon}`,
      destinations: `${to.lat},${to.lon}`,
      key: DISTANCEMATRIX_DISTANCE_KEY,
    });
    if (departAt) {
      const dep = new Date(departAt);
      if (!Number.isNaN(dep.getTime())) {
        params.set("departure_time", Math.floor(dep.getTime() / 1000).toString());
      }
    }

    const url = `https://api.distancematrix.ai/maps/api/distancematrix/json?${params.toString()}`;
    const upstream = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });

    const json = await upstream.json();
    const element = json?.rows?.[0]?.elements?.[0];
    if (!upstream.ok || json?.status !== "OK" || element?.status !== "OK") {
      return NextResponse.json(
        { ok: false, error: "Aucune route disponible (DistanceMatrix)" },
        { status: 502 }
      );
    }

    const durationSec = Number(
      element?.duration_in_traffic?.value ?? element?.duration?.value
    );
    if (!Number.isFinite(durationSec)) {
      return NextResponse.json(
        { ok: false, error: "Duree invalide (DistanceMatrix)" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      duration_sec: durationSec,
      duration_min: durationSec / 60,
      provider: "distancematrix",
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
