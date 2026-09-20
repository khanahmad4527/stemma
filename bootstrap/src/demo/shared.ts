/**
 * The bits every demo tree needs.
 *
 * Ids are derived from a string rather than random, so re-seeding
 * updates rows instead of making new ones and a chart does not reshuffle
 * between runs.
 */
import { createHash } from "node:crypto";
import { api } from "../client.js";
import { log } from "../log.js";

/** A stable uuid v4-shaped id for any label. */
export function uid(label: string): string {
  const h = createHash("sha1").update(label).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), "4" + h.slice(13, 16),
          ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20), h.slice(20, 32)].join("-");
}

export type Row = Record<string, unknown>;

export async function upsert(collection: string, id: string, row: Row): Promise<void> {
  const found = await api.get(`/items/${collection}/${id}`);
  const r = found.ok
    ? await api.patch(`/items/${collection}/${id}`, row)
    : await api.post(`/items/${collection}`, { id, ...row });
  if (!r.ok) log.fail(`${collection}/…${id.slice(-6)} — ${r.error.message}`);
}

export type D = { original: string; qualifier: string; earliest?: string; latest?: string };
export const when = (d: D): Row => ({
  date_original: d.original, date_qualifier: d.qualifier,
  date_earliest: d.earliest ?? null, date_latest: d.latest ?? null, date_calendar: "gregorian",
});
export const exact = (iso: string, original?: string): D => ({
  original: original ?? iso, qualifier: "exact", earliest: iso, latest: iso,
});
export const inYear = (y: number): D => ({
  original: `${y}`, qualifier: "about", earliest: `${y}-01-01`, latest: `${y}-12-31`,
});
export const about = (y: number, spread = 5): D => ({
  original: `abt ${y}`, qualifier: "about", earliest: `${y - spread}-01-01`, latest: `${y + spread}-12-31`,
});

/** Deterministic pseudo-randomness, so a tree looks the same every run. */
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

export const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
