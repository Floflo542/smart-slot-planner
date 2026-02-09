import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

export type SessionUser = {
  id: string;
  username: string;
  email: string;
  ics_url: string;
  is_admin: boolean;
};

const AUTH_SECRET = process.env.AUTH_SECRET || "";
const SESSION_COOKIE = "ssp_session";
const encoder = new TextEncoder();

export async function createSession(user: SessionUser) {
  if (!AUTH_SECRET) {
    throw new Error("AUTH_SECRET manquant");
  }
  const token = await new SignJWT({
    id: user.id,
    username: user.username,
    email: user.email,
    ics_url: user.ics_url,
    is_admin: user.is_admin,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encoder.encode(AUTH_SECRET));

  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export async function getSession(): Promise<SessionUser | null> {
  if (!AUTH_SECRET) {
    return null;
  }
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encoder.encode(AUTH_SECRET));
    if (!payload || typeof payload !== "object") return null;
    return {
      id: String(payload.id || ""),
      username: String(payload.username || ""),
      email: String(payload.email || ""),
      ics_url: String(payload.ics_url || ""),
      is_admin: Boolean(payload.is_admin),
    };
  } catch {
    return null;
  }
}

export function clearSession() {
  cookies().set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}
