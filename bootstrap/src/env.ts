/**
 * Everything these scripts need from the outside world, resolved once.
 *
 * Its own module because `verify.ts` deliberately does not go through the
 * API client — it makes its own logins, as each role — and two copies of
 * a base URL or a demo password is one too many: change the seed and the
 * verifier stops being able to log in.
 */
import { fromRoot } from "./root.js";
import { readFileSync } from "node:fs";

/**
 * Read `.env` rather than trusting the caller to have exported it.
 * Anything already in the environment wins, so a one-off override at the
 * shell still works.
 */
function loadDotEnv(): void {
  let text: string;
  try {
    text = readFileSync(fromRoot(".env"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const key = m?.[1];
    if (!key || key in process.env) continue;
    let value = (m?.[2] ?? "").trim();
    const quote = value[0];
    if (value.length > 1 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadDotEnv();

/**
 * The port is declared once, in DIRECTUS_PORT. Declaring it again in
 * PUBLIC_URL and a separate DIRECTUS_URL is how a script ends up
 * provisioning somebody else's Directus after a port move.
 */
export const PORT = process.env.DIRECTUS_PORT ?? "9057";
export const URL_BASE = process.env.DIRECTUS_URL ?? `http://localhost:${PORT}`;

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@stemma.dev";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

/** Every seeded account shares one password. */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "StemmaDemo!2026";

/**
 * Direct database access, for the DDL Directus has no endpoint for.
 *
 * This is the half of provisioning that `d6s sync` does not reach and
 * never will: CHECK constraints, unique indexes over expressions, and
 * the recursive trigger that stops a person becoming their own ancestor.
 * Environment Sync moves collections, fields, policies and flows. It does
 * not move a line of DDL, so this connection is not an optimisation —
 * it is the only way those rules exist at all.
 *
 * The host reaches the container on a loopback-published port; Directus
 * reaches it as `database:5432` over the compose network and never uses
 * these.
 */
export const DB_HOST = process.env.DB_HOST ?? "127.0.0.1";
export const DB_PORT = Number(process.env.DB_PORT ?? 9433);
export const DB_DATABASE = process.env.DB_DATABASE ?? "stemma";
export const DB_USER = process.env.DB_USER ?? "stemma";
export const DB_PASSWORD = process.env.DB_PASSWORD ?? "";
