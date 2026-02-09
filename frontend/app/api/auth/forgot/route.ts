import { NextResponse } from "next/server";
import { randomBytes, createHash, randomUUID } from "crypto";
import { ensureResetTable, ensureUsersTable, sql } from "../../_lib/db";

export const runtime = "nodejs";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || "";
const INTERNAL_RESET_MODE = process.env.INTERNAL_RESET_MODE === "true";

function resolveBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

export async function POST(req: Request) {
  if (!sql) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL manquant" },
      { status: 500 }
    );
  }
  const emailEnabled = Boolean(RESEND_API_KEY && RESEND_FROM);

  try {
    const payload = await req.json();
    const email = String(payload?.email || "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Email manquant" },
        { status: 400 }
      );
    }

    await ensureUsersTable();
    const rows = (await sql`
      SELECT id, username, email FROM users WHERE email = ${email} LIMIT 1
    `) as Array<{ id: string; username: string; email: string }>;

    if (!rows.length) {
      return NextResponse.json({ ok: true });
    }

    const user = rows[0];
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const resetId = randomUUID();
    const expires = new Date(Date.now() + 1000 * 60 * 60);

    await ensureResetTable();
    await sql`
      INSERT INTO password_resets (id, user_id, token_hash, expires_at)
      VALUES (${resetId}, ${user.id}, ${tokenHash}, ${expires.toISOString()})
    `;

    const baseUrl = resolveBaseUrl();
    if (!baseUrl) {
      return NextResponse.json(
        { ok: false, error: "APP_BASE_URL manquant" },
        { status: 500 }
      );
    }

    const resetLink = `${baseUrl.replace(/\/$/, "")}/reset?token=${rawToken}`;
    if (emailEnabled && !INTERNAL_RESET_MODE) {
      const { Resend } = await import("resend");
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: RESEND_FROM,
        to: email,
        subject: "Réinitialisation de mot de passe",
        html: `<p>Bonjour ${user.username},</p><p>Voici votre lien de réinitialisation :</p><p><a href="${resetLink}">${resetLink}</a></p><p>Ce lien expire dans 1 heure.</p>`,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, reset_link: resetLink });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Erreur envoi email" },
      { status: 500 }
    );
  }
}
