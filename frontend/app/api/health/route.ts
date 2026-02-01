import { NextResponse } from "next/server";

export async function GET() {
  const rawBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  const base = rawBase.trim().replace(/\/$/, "");

  if (!base) {
    return NextResponse.json(
      { ok: false, error: "NEXT_PUBLIC_API_BASE_URL missing" },
      { status: 500 }
    );
  }

  const url = `${base}/health`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 502 }
    );
  }
}
