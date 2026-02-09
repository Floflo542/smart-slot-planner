import { NextResponse } from "next/server";
import { randomBytes, createHash, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { getSession } from "../../_lib/auth";
import { ensureResetTable, ensureUsersTable, sql } from "../../_lib/db";

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
      SELECT id, username, email, ics_url, home_address, day_start, day_end, is_admin, approved, created_at
      FROM users
      ORDER BY created_at DESC
    `) as Array<{
      id: string;
      username: string;
      email: string;
      ics_url: string;
      home_address: string;
      day_start: string;
      day_end: string;
      is_admin: boolean;
      approved: boolean;
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

export async function POST(req: Request) {
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
    const payload = await req.json();
    const userId = String(payload?.user_id || "").trim();
    const action = String(payload?.action || "").trim();

    if (!userId || !action) {
      return NextResponse.json(
        { ok: false, error: "Parametres manquants" },
        { status: 400 }
      );
    }

    if (action === "reset_link") {
      const baseUrl =
        process.env.APP_BASE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
      if (!baseUrl) {
        return NextResponse.json(
          { ok: false, error: "APP_BASE_URL manquant" },
          { status: 500 }
        );
      }

      await ensureResetTable();
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const resetId = randomUUID();
      const expires = new Date(Date.now() + 1000 * 60 * 60);
      await sql`
        INSERT INTO password_resets (id, user_id, token_hash, expires_at)
        VALUES (${resetId}, ${userId}, ${tokenHash}, ${expires.toISOString()})
      `;

      const resetLink = `${baseUrl.replace(/\/$/, "")}/reset?token=${rawToken}`;
      return NextResponse.json({ ok: true, reset_link: resetLink });
    }

    if (action === "set_password") {
      const newPassword = String(payload?.new_password || "").trim();
      if (newPassword.length < 8) {
        return NextResponse.json(
          { ok: false, error: "Mot de passe trop court (8 min)" },
          { status: 400 }
        );
      }
      await ensureUsersTable();
      const hash = await bcrypt.hash(newPassword, 10);
      await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${userId}`;
      return NextResponse.json({ ok: true });
    }

    if (action === "approve") {
      await ensureUsersTable();
      await sql`UPDATE users SET approved = TRUE WHERE id = ${userId}`;
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      if (userId === session.id) {
        return NextResponse.json(
          { ok: false, error: "Impossible de supprimer votre compte admin" },
          { status: 400 }
        );
      }
      await sql`DELETE FROM resellers WHERE user_id = ${userId}`;
      await sql`DELETE FROM password_resets WHERE user_id = ${userId}`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, error: "Action inconnue" },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur admin" },
      { status: 500 }
    );
  }
}
