/**
 * Every call this app makes to Directus.
 *
 * Read-only by design: the site browses a tree, and editing stays in the
 * Data Studio, which already has a designed form for all twenty
 * collections. So there is no mutation path here to get wrong.
 */
import { redirect } from "react-router";
import { readSession, sessionStorage, type Session } from "./session.server.js";

export const DIRECTUS_URL = process.env.DIRECTUS_URL ?? "http://localhost:9057";

type Ok<T> = { data: T };

export class DirectusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { errors?: Array<{ message: string }> };
    throw new DirectusError(res.status, body.errors?.[0]?.message ?? res.statusText);
  }
  return ((await res.json()) as Ok<T>).data;
}

export async function signIn(email: string, password: string) {
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { access_token: string; refresh_token: string; expires: number };
    errors?: Array<{ message: string }>;
  };
  if (!res.ok || !body.data) {
    // Directus says "Invalid user credentials." for both a wrong password
    // and an address that does not exist, and that is the right answer —
    // distinguishing them tells a stranger which relatives have accounts.
    throw new DirectusError(res.status, body.errors?.[0]?.message ?? "Could not sign in");
  }
  return body.data;
}

async function refresh(token: string) {
  const res = await fetch(`${DIRECTUS_URL}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: token, mode: "json" }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { access_token: string; refresh_token: string; expires: number } };
  return body.data ?? null;
}

/**
 * Runs a read against Directus as the signed-in member, renewing the
 * access token first if it is about to expire.
 *
 * A renewed token has to reach the browser, so this returns the cookie
 * header alongside the result and the loader sets it. Without that the
 * session would expire fifteen minutes after sign-in no matter how
 * active the member was.
 */
export async function withDirectus<T>(
  request: Request,
  run: (get: <R>(path: string) => Promise<R>) => Promise<T>,
): Promise<{ result: T; setCookie?: string }> {
  const session = await readSession(request);
  let access = session.get("access_token") as string | undefined;
  const refreshToken = session.get("refresh_token") as string | undefined;
  const expiresAt = Number(session.get("expires_at") ?? 0);
  if (!access || !refreshToken) {
    const to = new URL(request.url).pathname;
    throw redirect(`/login?next=${encodeURIComponent(to)}`);
  }

  let setCookie: string | undefined;
  // A minute's grace, so a long loader does not expire mid-flight.
  if (Date.now() > expiresAt - 60_000) {
    const renewed = await refresh(refreshToken);
    if (!renewed) {
      const to = new URL(request.url).pathname;
      throw redirect(`/login?next=${encodeURIComponent(to)}`, {
        headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
      });
    }
    access = renewed.access_token;
    session.set("access_token", renewed.access_token);
    session.set("refresh_token", renewed.refresh_token);
    session.set("expires_at", Date.now() + renewed.expires);
    setCookie = await sessionStorage.commitSession(session);
  }

  const token = access;
  try {
    const result = await run(<R,>(path: string) => call<R>(path, token));
    return { result, setCookie };
  } catch (e) {
    if (e instanceof DirectusError && e.status === 401) {
      const to = new URL(request.url).pathname;
      throw redirect(`/login?next=${encodeURIComponent(to)}`, {
        headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
      });
    }
    throw e;
  }
}

export async function sessionFrom(data: Awaited<ReturnType<typeof signIn>>, request: Request) {
  const session = await readSession(request);
  session.set("access_token", data.access_token);
  session.set("refresh_token", data.refresh_token);
  session.set("expires_at", Date.now() + data.expires);
  return sessionStorage.commitSession(session);
}

export type { Session };
