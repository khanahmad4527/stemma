/**
 * Thin REST wrapper.
 *
 * A plain fetch client rather than the SDK, because this repo is meant to
 * be read and an opaque call chain teaches nobody how the Directus API
 * actually works.
 */
import { URL_BASE, ADMIN_EMAIL, ADMIN_PASSWORD } from "./env.js";

let token: string | null = null;

export function authHeader(): string {
  if (!token) throw new Error("not authenticated");
  return `Bearer ${token}`;
}

export async function login(): Promise<void> {
  const res = await fetch(`${URL_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = (await res.json()) as { data?: { access_token: string }; errors?: unknown };
  if (!res.ok || !body.data?.access_token) {
    throw new Error(`Login failed for ${ADMIN_EMAIL}: ${JSON.stringify(body.errors ?? body)}`);
  }
  token = body.data.access_token;
}

export type ApiError = { status: number; message: string; code?: string };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * How long to wait when the server says to wait.
 *
 * Directus answers a 429 with a `Retry-After` header and the figure in
 * the message besides. Reading the header first and falling back to the
 * sentence covers both the standard and what this server actually sends.
 * A small floor and a little more than asked for, because retrying at
 * precisely the moment the window opens puts every refused client back on
 * the wire simultaneously.
 */
function retryAfterMs(res: Response, message: string, attempt: number): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(250, seconds * 1000) + attempt * 100;
  }
  const stated = /retry after (\d+)ms/i.exec(message);
  if (stated?.[1]) return Math.max(250, Number(stated[1])) + attempt * 100;
  return 250 * 2 ** attempt;
}

const MAX_RETRIES = 6;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  attempt = 0,
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 429 && attempt < MAX_RETRIES) {
    // Read the body before sleeping: the message carries the figure, and
    // an unread body holds the connection open while we wait.
    const text = await res.text().catch(() => "");
    const message = (() => {
      try { return JSON.parse(text)?.errors?.[0]?.message ?? ""; } catch { return text; }
    })();
    await sleep(retryAfterMs(res, message, attempt));
    return request<T>(method, path, body, attempt + 1);
  }

  if (res.status === 204) return { ok: true, data: undefined as T };

  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const first = parsed?.errors?.[0];
    return {
      ok: false,
      error: {
        status: res.status,
        message: first?.message ?? res.statusText,
        code: first?.extensions?.code,
      },
    };
  }
  return { ok: true, data: parsed.data as T };
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  url: URL_BASE,
};

/** Throws with context. Use where a failure means the run cannot continue. */
export async function must<T>(
  label: string,
  p: Promise<{ ok: true; data: T } | { ok: false; error: ApiError }>,
): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${label}: ${r.error.status} ${r.error.message}`);
  return r.data;
}
