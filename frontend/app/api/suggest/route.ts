import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const rawBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  const base = rawBase.trim().replace(/\/$/, "");

  if (!base) {
    return NextResponse.json(
      { ok: false, error: "NEXT_PUBLIC_API_BASE_URL missing" },
      { status: 500 }
    );
  }

  const body = await req.text();
  const upstream = await fetch(`${base}/suggest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
    },
  });
}