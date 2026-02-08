import { NextResponse } from "next/server";

const USER_AGENT =
  process.env.GEOCODE_USER_AGENT ||
  "smart-slot-planner/1.0 (geocode; contact: dev@example.com)";
const DISTANCEMATRIX_GEOCODE_KEY =
  process.env.DISTANCEMATRIX_GEOCODE_KEY ||
  process.env.DISTANCEMATRIX_KEY ||
  "";

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

  if (!DISTANCEMATRIX_GEOCODE_KEY) {
    return NextResponse.json(
      { ok: false, error: "DISTANCEMATRIX_GEOCODE_KEY manquant" },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    address: q,
    key: DISTANCEMATRIX_GEOCODE_KEY,
    language: "fr",
    region: "be",
  });
  const url = `https://api.distancematrix.ai/maps/api/geocode/json?${params.toString()}`;

  const upstream = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  const json = (await upstream.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: {
        location?: { lat?: number; lng?: number };
      };
    }>;
    error_message?: string;
  };

  if (!upstream.ok || json?.status !== "OK") {
    return NextResponse.json(
      {
        ok: false,
        error: `Geocodage indisponible (${upstream.status})${json?.error_message ? `: ${json.error_message}` : ""}`,
      },
      { status: 502 }
    );
  }

  if (!json.results || json.results.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Adresse introuvable" },
      { status: 404 }
    );
  }

  const best = json.results[0];
  const lat = best.geometry?.location?.lat;
  const lon = best.geometry?.location?.lng;
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
    label: best.formatted_address || q,
  });
}
