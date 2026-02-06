import { NextResponse } from "next/server";

const USER_AGENT =
  process.env.ICS_USER_AGENT ||
  "smart-slot-planner/1.0 (ics; contact: dev@example.com)";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("url");
  const url = raw ? raw.trim() : "";

  if (!url) {
    return NextResponse.json(
      { ok: false, error: "Parametre url manquant" },
      { status: 400 }
    );
  }

  if (!url.startsWith("https://")) {
    return NextResponse.json(
      { ok: false, error: "URL ICS invalide" },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/calendar,text/plain",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Timeout ou erreur lors du chargement ICS" },
      { status: 504 }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: "Impossible de charger le fichier ICS" },
      { status: 502 }
    );
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
    },
  });
}
