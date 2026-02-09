import { NextResponse } from "next/server";
import { getSession } from "../../_lib/auth";
import { ensureUsersTable, sql } from "../../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  if (!sql) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL manquant" },
      { status: 500 }
    );
  }
  const session = await getSession();
  if (!session || !session.is_admin) {
    return NextResponse.json({ ok: false, error: "Interdit" }, { status: 403 });
  }

  try {
    await ensureUsersTable();
    const rows = (await sql`
      SELECT id, username, email, ics_url, is_admin, created_at
      FROM users
      ORDER BY created_at DESC
    `) as Array<{
      id: string;
      username: string;
      email: string;
      ics_url: string;
      is_admin: boolean;
      created_at: string;
    }>;
    return NextResponse.json({ ok: true, items: rows });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur admin" },
      { status: 500 }
    );
  }
}
