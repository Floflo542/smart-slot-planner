import { NextResponse } from "next/server";

const USER_AGENT =
  process.env.GEOCODE_USER_AGENT ||
  "smart-slot-planner/1.0 (geocode; contact: dev@example.com)";
const GEOCODE_EMAIL = process.env.GEOCODE_EMAIL || "";
const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";
const DISTANCEMATRIX_GEOCODE_BASE_URL =
  process.env.DISTANCEMATRIX_GEOCODE_BASE_URL ||
  process.env.DISTANCEMATRIX_BASE_URL ||
  "https://api.distancematrix.ai";
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

  let dmError: string | null = null;

  if (DISTANCEMATRIX_GEOCODE_KEY) {
    const params = new URLSearchParams({
      address: q,
      key: DISTANCEMATRIX_GEOCODE_KEY,
      language: "fr",
      region: "be",
    });
    const url = `${DISTANCEMATRIX_GEOCODE_BASE_URL}/maps/api/geocode/json?${params.toString()}`;

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

    if (upstream.ok && json?.status === "OK" && json.results?.length) {
      const best = json.results[0];
      const lat = best.geometry?.location?.lat;
      const lon = best.geometry?.location?.lng;
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return NextResponse.json({
          ok: true,
          lat,
          lon,
          label: best.formatted_address || q,
        });
      }
      dmError = "Coordonnées invalides";
    } else {
      dmError = `DistanceMatrix: ${json?.status || upstream.status}`;
    }
  } else {
    dmError = "DISTANCEMATRIX_GEOCODE_KEY manquant";
  }

  const nominatimParams = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
    countrycodes: "be",
  });
  if (GEOCODE_EMAIL) {
    nominatimParams.set("email", GEOCODE_EMAIL);
  }
  const nominatimUrl = `${NOMINATIM_BASE_URL}/search?${nominatimParams.toString()}`;
  const nominatimRes = await fetch(nominatimUrl, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });
  const nominatimJson = (await nominatimRes.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;

  if (nominatimRes.ok && Array.isArray(nominatimJson) && nominatimJson.length) {
    const best = nominatimJson[0];
    const lat = Number.parseFloat(best.lat || "");
    const lon = Number.parseFloat(best.lon || "");
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return NextResponse.json({
        ok: true,
        lat,
        lon,
        label: best.display_name || q,
      });
    }
  }

  return NextResponse.json(
    { ok: false, error: `Adresse introuvable${dmError ? ` (${dmError})` : ""}` },
    { status: 404 }
  );
}
