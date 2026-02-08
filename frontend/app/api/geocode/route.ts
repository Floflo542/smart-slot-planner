import { NextResponse } from "next/server";

const USER_AGENT =
  process.env.GEOCODE_USER_AGENT ||
  "smart-slot-planner/1.0 (geocode; contact: dev@example.com)";
const GEOCODE_EMAIL = process.env.GEOCODE_EMAIL || "";
const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";

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

  let primaryError: string | null = null;

  if (MAPBOX_TOKEN) {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      q
    )}.json?access_token=${encodeURIComponent(
      MAPBOX_TOKEN
    )}&limit=1&country=be&language=fr&types=address,place,postcode,locality`;

    const upstream = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    const json = (await upstream.json()) as {
      features?: Array<{
        center: [number, number];
        place_name: string;
      }>;
      message?: string;
    };

    if (upstream.ok && json?.features?.length) {
      const best = json.features[0];
      const [lon, lat] = best.center || [];
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return NextResponse.json({
          ok: true,
          lat,
          lon,
          label: best.place_name || q,
        });
      }
      primaryError = "Coordonnées invalides";
    } else {
      primaryError = `Mapbox: ${upstream.status}${json?.message ? `: ${json.message}` : ""}`;
    }
  } else {
    primaryError = "MAPBOX_TOKEN manquant";
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
    {
      ok: false,
      error: `Adresse introuvable${primaryError ? ` (${primaryError})` : ""}`,
    },
    { status: 404 }
  );
}
