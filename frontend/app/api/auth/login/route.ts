import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSession } from "../../_lib/auth";
import { ensureUsersTable, sql } from "../../_lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!sql) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL manquant" },
      { status: 500 }
    );
  }

  try {
    const payload = await req.json();
    const identifier = String(payload?.identifier || "").trim().toLowerCase();
    const password = String(payload?.password || "").trim();

    if (!identifier || !password) {
      return NextResponse.json(
        { ok: false, error: "Identifiant ou mot de passe manquant" },
        { status: 400 }
      );
    }

    await ensureUsersTable();
    const rows = (await sql`
      SELECT id, username, email, password_hash, ics_url, is_admin
      FROM users
      WHERE email = ${identifier} OR LOWER(username) = ${identifier}
      LIMIT 1
    `) as Array<{
      id: string;
      username: string;
      email: string;
      password_hash: string;
      ics_url: string;
      is_admin: boolean;
    }>;

    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "Compte introuvable" },
        { status: 401 }
      );
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { ok: false, error: "Mot de passe incorrect" },
        { status: 401 }
      );
    }

    await createSession({
      id: user.id,
      username: user.username,
      email: user.email,
      ics_url: user.ics_url,
      is_admin: Boolean(user.is_admin),
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        ics_url: user.ics_url,
        is_admin: Boolean(user.is_admin),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur connexion" },
      { status: 500 }
    );
  }
}
