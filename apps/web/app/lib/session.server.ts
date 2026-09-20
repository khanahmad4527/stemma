/**
 * The signed-in member's Directus session.
 *
 * The access token lives in an httpOnly, SameSite=Lax cookie and is read
 * only by loaders on the server. No script on the page can reach it,
 * which matters more here than in most apps: that token can read every
 * living relative in every tree the member belongs to, and the whole
 * point of the access model is that those people are not published.
 *
 * Directus access tokens are short-lived (15 minutes by default), so the
 * refresh token rides along and `withDirectus` below renews silently.
 */
import { createCookieSessionStorage, redirect } from "react-router";

const secret = process.env.SESSION_SECRET;
if (!secret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "stemma_session",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secrets: [secret ?? "dev-only-not-a-secret"],
    // Set behind TLS. A `secure` cookie is simply never sent over plain
    // http, which presents as "signing in does nothing" rather than as
    // an error — so it follows NODE_ENV rather than being hard-coded.
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
  },
});

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export async function readSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function requireSession(request: Request): Promise<Session> {
  const session = await readSession(request);
  const access = session.get("access_token") as string | undefined;
  const refresh = session.get("refresh_token") as string | undefined;
  if (!access || !refresh) {
    const to = new URL(request.url).pathname;
    throw redirect(`/login?next=${encodeURIComponent(to)}`);
  }
  return { access_token: access, refresh_token: refresh, expires_at: Number(session.get("expires_at") ?? 0) };
}
