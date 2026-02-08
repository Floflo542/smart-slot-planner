import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

async function ensureTable() {
  if (!sql) {
    throw new Error("DATABASE_URL manquant");
  }
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

  if (!sql) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL manquant" },
      { status: 500 }
    );
  }

  try {
    await ensureTable();
    const rows = (await sql`
      SELECT id, commercial, name, address, notes
      FROM resellers
      WHERE commercial = ${commercial}
      ORDER BY created_at DESC
    `) as Array<{
      id: string;
      commercial: string;
      name: string;
      address: string;
      notes: string | null;
    }>;
    return NextResponse.json({ ok: true, items: rows });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur base de donnees" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  if (!sql) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL manquant" },
      { status: 500 }
    );
  }

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
