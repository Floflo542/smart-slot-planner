import { NextResponse } from "next/server";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { ensureResetTable, ensureUsersTable, sql } from "../../_lib/db";

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
    const token = String(payload?.token || "").trim();
    const password = String(payload?.password || "").trim();
    if (!token || !password) {
      return NextResponse.json(
        { ok: false, error: "Token ou mot de passe manquant" },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { ok: false, error: "Mot de passe trop court (8 min)" },
        { status: 400 }
      );
    }

    await ensureResetTable();
    await ensureUsersTable();
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const rows = (await sql`
      SELECT id, user_id, expires_at, used_at
      FROM password_resets
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `) as Array<{
      id: string;
      user_id: string;
      expires_at: string;
      used_at: string | null;
    }>;

    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "Token invalide" },
        { status: 400 }
      );
    }

    const reset = rows[0];
    if (reset.used_at) {
      return NextResponse.json(
        { ok: false, error: "Token deja utilise" },
        { status: 400 }
      );
    }
    if (new Date(reset.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { ok: false, error: "Token expire" },
        { status: 400 }
      );
    }

    const hash = await bcrypt.hash(password, 10);
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${reset.user_id}`;
    await sql`UPDATE password_resets SET used_at = NOW() WHERE id = ${reset.id}`;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur reset mot de passe" },
      { status: 500 }
    );
  }
}
