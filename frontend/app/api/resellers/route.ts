import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS resellers (
      id TEXT PRIMARY KEY,
      commercial TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const commercial = (searchParams.get("commercial") || "").trim();
  if (!commercial) {
    return NextResponse.json(
      { ok: false, error: "Parametre commercial manquant" },
      { status: 400 }
    );
  }

  try {
    await ensureTable();
    const { rows } = await sql<{
      id: string;
      commercial: string;
      name: string;
      address: string;
      notes: string | null;
    }>`
      SELECT id, commercial, name, address, notes
      FROM resellers
      WHERE commercial = ${commercial}
      ORDER BY created_at DESC
    `;
    return NextResponse.json({ ok: true, items: rows });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur base de donnees" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const commercial = String(payload?.commercial || "").trim();
    const name = String(payload?.name || "").trim();
    const address = String(payload?.address || "").trim();
    const notes = payload?.notes ? String(payload.notes).trim() : null;

    if (!commercial || !name || !address) {
      return NextResponse.json(
        { ok: false, error: "Champs manquants" },
        { status: 400 }
      );
    }

    await ensureTable();
    const id = randomUUID();
    await sql`
      INSERT INTO resellers (id, commercial, name, address, notes)
      VALUES (${id}, ${commercial}, ${name}, ${address}, ${notes})
    `;
    return NextResponse.json({
      ok: true,
      item: { id, commercial, name, address, notes },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur base de donnees" },
      { status: 500 }
    );
  }
}
