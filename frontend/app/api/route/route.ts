import { NextResponse } from "next/server";

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";

function parseLatLon(value: string | null) {
  if (!value) return null;
  const [latStr, lonStr] = value.split(",").map((part) => part.trim());
  const lat = Number.parseFloat(latStr);
  const lon = Number.parseFloat(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export async function GET(req: Request) {
  if (!MAPBOX_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "MAPBOX_TOKEN manquant" },
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

  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    overview: "false",
    geometries: "geojson",
  });

  if (departAt) {
    params.set("depart_at", departAt);
  }

  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.lon},${from.lat};${to.lon},${to.lat}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Erreur appel Mapbox" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  const json = await upstream.json();
  if (!upstream.ok || !json?.routes?.length) {
    return NextResponse.json(
      { ok: false, error: "Aucune route disponible" },
      { status: 502 }
    );
  }

  const durationSec = Number(json.routes[0].duration);
  if (!Number.isFinite(durationSec)) {
    return NextResponse.json(
      { ok: false, error: "Duree invalide" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    duration_sec: durationSec,
    duration_min: durationSec / 60,
  });
}
