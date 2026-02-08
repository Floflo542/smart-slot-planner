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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      overview: "false",
      geometries: "geojson",
    });

    if (departAt) {
      const parsed = new Date(departAt);
      if (!Number.isNaN(parsed.getTime())) {
        const safe = parsed.getTime() < Date.now() ? new Date() : parsed;
        const formatted = safe.toISOString().replace(/\.\d{3}Z$/, "Z");
        params.set("depart_at", formatted);
      }
    }

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.lon},${from.lat};${to.lon},${to.lat}?${params.toString()}`;
    const upstream = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });

    const json = await upstream.json();
    if (!upstream.ok || !json?.routes?.length) {
      return NextResponse.json(
        { ok: false, error: "Aucune route disponible (Mapbox)" },
        { status: 502 }
      );
    }

    const durationSec = Number(json.routes[0].duration);
    if (!Number.isFinite(durationSec)) {
      return NextResponse.json(
        { ok: false, error: "Duree invalide (Mapbox)" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      duration_sec: durationSec,
      duration_min: durationSec / 60,
      provider: "mapbox",
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
