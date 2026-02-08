import { NextResponse } from "next/server";

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";
const MAX_POINTS = 40;

type Point = {
  lat: number;
  lon: number;
};

function parsePoints(value: string) {
  return value
    .split("|")
    .map((raw) => {
      const [latStr, lonStr] = raw.split(",").map((part) => part.trim());
      const lat = Number.parseFloat(latStr);
      const lon = Number.parseFloat(lonStr);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon } satisfies Point;
    })
    .filter((point): point is Point => Boolean(point));
}

function guessMapZoom(points: Point[]) {
  if (points.length <= 1) return 13;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lonSpan = Math.max(...lons) - Math.min(...lons);
  const span = Math.max(latSpan, lonSpan);
  if (span < 0.02) return 14;
  if (span < 0.05) return 12;
  if (span < 0.15) return 11;
  if (span < 0.3) return 10;
  return 9;
}

export async function GET(req: Request) {
  if (!MAPBOX_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "MAPBOX_TOKEN manquant" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawPoints = (searchParams.get("points") || "").trim();
  const sizeRaw = (searchParams.get("size") || "900x420").trim();
  const size = /^\d+x\d+$/.test(sizeRaw) ? sizeRaw : "900x420";

  if (!rawPoints) {
    return NextResponse.json(
      { ok: false, error: "Parametre points manquant" },
      { status: 400 }
    );
  }

  const points = parsePoints(rawPoints).slice(0, MAX_POINTS);
  if (!points.length) {
    return NextResponse.json(
      { ok: false, error: "Points invalides" },
      { status: 400 }
    );
  }

  const overlay = points
    .map((p) => `pin-l+ff4d4d(${p.lon},${p.lat})`)
    .join(",");

  const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlay}/auto/${size}?access_token=${encodeURIComponent(
    MAPBOX_TOKEN
  )}&logo=false&attribution=false`;

  const upstream = await fetch(url, { cache: "no-store" });
  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: "Mapbox indisponible" },
      { status: 502 }
    );
  }

  const buffer = await upstream.arrayBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") || "image/png",
      "cache-control": "no-store",
    },
  });
}
