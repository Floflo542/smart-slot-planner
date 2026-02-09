import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "../_lib/auth";
import { ensureResellersTable, sql } from "../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  if (!sql) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL manquant" },
      { status: 500 }
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Non authentifie" },
      { status: 401 }
    );
  }

  try {
    await ensureResellersTable();
    const rows = (await sql`
      SELECT id, name, address, notes
      FROM resellers
      WHERE user_id = ${session.id}
      ORDER BY created_at DESC
    `) as Array<{
      id: string;
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

  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Non authentifie" },
      { status: 401 }
    );
  }

  try {
    const payload = await req.json();
    const name = String(payload?.name || "").trim();
    const address = String(payload?.address || "").trim();
    const notes = payload?.notes ? String(payload.notes).trim() : null;

    if (!name || !address) {
      return NextResponse.json(
        { ok: false, error: "Champs manquants" },
        { status: 400 }
      );
    }

    await ensureResellersTable();
    const id = randomUUID();
    await sql`
      INSERT INTO resellers (id, user_id, name, address, notes)
      VALUES (${id}, ${session.id}, ${name}, ${address}, ${notes})
    `;
    return NextResponse.json({
      ok: true,
      item: { id, name, address, notes },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur base de donnees" },
      { status: 500 }
    );
  }
}
