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
    const homeAddress = payload?.home_address
      ? String(payload.home_address).trim()
      : "";
    const dayStart = payload?.day_start ? String(payload.day_start).trim() : "";
    const dayEnd = payload?.day_end ? String(payload.day_end).trim() : "";
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

    if (homeAddress) {
      await sql`UPDATE users SET home_address = ${homeAddress} WHERE id = ${session.id}`;
      session.home_address = homeAddress;
    }

    if (dayStart || dayEnd) {
      if (!/^\d{2}:\d{2}$/.test(dayStart || session.day_start)) {
        return NextResponse.json(
          { ok: false, error: "Heure debut invalide (HH:MM)" },
          { status: 400 }
        );
      }
      if (!/^\d{2}:\d{2}$/.test(dayEnd || session.day_end)) {
        return NextResponse.json(
          { ok: false, error: "Heure fin invalide (HH:MM)" },
          { status: 400 }
        );
      }
      const nextStart = dayStart || session.day_start;
      const nextEnd = dayEnd || session.day_end;
      if (nextStart >= nextEnd) {
        return NextResponse.json(
          { ok: false, error: "L'heure de fin doit etre apres l'heure de debut" },
          { status: 400 }
        );
      }
      await sql`UPDATE users SET day_start = ${nextStart}, day_end = ${nextEnd} WHERE id = ${session.id}`;
      session.day_start = nextStart;
      session.day_end = nextEnd;
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
