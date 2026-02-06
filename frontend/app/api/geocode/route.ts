import { NextResponse } from "next/server";

const USER_AGENT =
  process.env.GEOCODE_USER_AGENT ||
  "smart-slot-planner/1.0 (geocode; contact: dev@example.com)";
const GEOCODE_EMAIL = process.env.GEOCODE_EMAIL || "dev@example.com";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("q");
  const q = raw ? raw.trim() : "";

  if (!q) {
    return NextResponse.json(
      { ok: false, error: "Paramètre q manquant" },
      { status: 400 }
    );
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=1&countrycodes=be&email=${encodeURIComponent(
    GEOCODE_EMAIL
  )}&q=${encodeURIComponent(q)}`;

  const upstream = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "fr,nl,en",
    },
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: "Service de géocodage indisponible" },
      { status: 502 }
    );
  }

  const data = (await upstream.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;

  if (!data.length) {
    return NextResponse.json(
      { ok: false, error: "Adresse introuvable" },
      { status: 404 }
    );
  }

  const best = data[0];
  const lat = Number.parseFloat(best.lat);
  const lon = Number.parseFloat(best.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { ok: false, error: "Coordonnées invalides" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    lat,
    lon,
    label: best.display_name,
  });
}
