import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { createSession } from "../../_lib/auth";
import { ensureUsersTable, sql } from "../../_lib/db";

export const runtime = "nodejs";

const ADMIN_EMAIL = "florian.monoyer@unox.com";

function isValidUsername(value: string) {
  return /^[a-z0-9]+[._-]?[a-z0-9]+$/i.test(value) && value.includes(".");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidIcs(value: string) {
  return /^https:\/\/.+/i.test(value);
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
    const username = String(payload?.username || "").trim().toLowerCase();
    const email = String(payload?.email || "").trim().toLowerCase();
    const password = String(payload?.password || "").trim();
    const icsUrl = String(payload?.ics_url || payload?.icsUrl || "").trim();
    const homeAddress = String(payload?.home_address || payload?.homeAddress || "").trim();
    const dayStart = String(payload?.day_start || payload?.dayStart || "").trim();
    const dayEnd = String(payload?.day_end || payload?.dayEnd || "").trim();

    if (!username || !email || !password || !icsUrl || !homeAddress || !dayStart || !dayEnd) {
      return NextResponse.json(
        { ok: false, error: "Champs manquants" },
        { status: 400 }
      );
    }
    if (!isValidUsername(username)) {
      return NextResponse.json(
        { ok: false, error: "Nom utilisateur invalide (prenom.nom)" },
        { status: 400 }
      );
    }
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { ok: false, error: "Email invalide" },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { ok: false, error: "Mot de passe trop court (8 min)" },
        { status: 400 }
      );
    }
    if (!isValidIcs(icsUrl)) {
      return NextResponse.json(
        { ok: false, error: "Lien ICS invalide (https://...)" },
        { status: 400 }
      );
    }
    if (!/^\d{2}:\d{2}$/.test(dayStart) || !/^\d{2}:\d{2}$/.test(dayEnd)) {
      return NextResponse.json(
        { ok: false, error: "Horaires invalides (HH:MM)" },
        { status: 400 }
      );
    }
    if (dayStart >= dayEnd) {
      return NextResponse.json(
        { ok: false, error: "L'heure de fin doit etre apres l'heure de debut" },
        { status: 400 }
      );
    }

    await ensureUsersTable();
    const exists =
      await sql`SELECT id FROM users WHERE email = ${email} OR username = ${username} LIMIT 1`;
    if (exists.length) {
      return NextResponse.json(
        { ok: false, error: "Compte deja existant" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = randomUUID();
    const isAdmin =
      email === ADMIN_EMAIL || username.toLowerCase() === "florian.monoyer";
    const approved = isAdmin;

    await sql`
      INSERT INTO users (id, username, email, password_hash, ics_url, home_address, day_start, day_end, is_admin, approved)
      VALUES (${id}, ${username}, ${email}, ${passwordHash}, ${icsUrl}, ${homeAddress}, ${dayStart}, ${dayEnd}, ${isAdmin}, ${approved})
    `;

    if (approved) {
      await createSession({
        id,
        username,
        email,
        ics_url: icsUrl,
        home_address: homeAddress,
        day_start: dayStart,
        day_end: dayEnd,
        is_admin: isAdmin,
      });
    }

    return NextResponse.json({
      ok: true,
      approved,
      user: {
        id,
        username,
        email,
        ics_url: icsUrl,
        home_address: homeAddress,
        day_start: dayStart,
        day_end: dayEnd,
        is_admin: isAdmin,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur creation compte" },
      { status: 500 }
    );
  }
}
