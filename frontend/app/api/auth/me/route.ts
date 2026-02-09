import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSession, getSession } from "../../_lib/auth";
import { ensureUsersTable, sql } from "../../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Non authentifie" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, user: session });
}

export async function PATCH(req: Request) {
  if (!sql) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL manquant" },
      { status: 500 }
    );
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Non authentifie" }, { status: 401 });
  }

  try {
    const payload = await req.json();
    const icsUrl = payload?.ics_url ? String(payload.ics_url).trim() : "";
    const currentPassword = payload?.current_password
      ? String(payload.current_password).trim()
      : "";
    const newPassword = payload?.new_password
      ? String(payload.new_password).trim()
      : "";

    await ensureUsersTable();

    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json(
          { ok: false, error: "Mot de passe trop court (8 min)" },
          { status: 400 }
        );
      }
      const rows = (await sql`
        SELECT password_hash FROM users WHERE id = ${session.id} LIMIT 1
      `) as Array<{ password_hash: string }>;
      if (!rows.length) {
        return NextResponse.json(
          { ok: false, error: "Utilisateur introuvable" },
          { status: 404 }
        );
      }
      const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!valid) {
        return NextResponse.json(
          { ok: false, error: "Mot de passe actuel incorrect" },
          { status: 401 }
        );
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${session.id}`;
    }

    if (icsUrl) {
      if (!/^https:\/\/.+/i.test(icsUrl)) {
        return NextResponse.json(
          { ok: false, error: "Lien ICS invalide (https://...)" },
          { status: 400 }
        );
      }
      await sql`UPDATE users SET ics_url = ${icsUrl} WHERE id = ${session.id}`;
      session.ics_url = icsUrl;
    }

    await createSession(session);
    return NextResponse.json({ ok: true, user: session });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur mise a jour" },
      { status: 500 }
    );
  }
}
