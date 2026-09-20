/**
 * The static showcase.
 *
 * `pnpm demo:snapshot` freezes the three seeded demo trees into
 * `demo-data/snapshot.json`, and a build with `VITE_DEMO=1` reads that
 * instead of calling Directus. The result prerenders to flat files: no
 * server, no database, no sign-in, nothing to keep alive — which is what
 * a portfolio link needs and what a live instance is a bad way to be.
 *
 * ── This is not the anonymous public site ──────────────────────────────
 *
 * CLAUDE.md records a logged-out front end backed by the public policy as
 * an explicit non-goal, and this is not that. There is no policy here and
 * no backend to apply one: it is frozen, invented data with the login
 * removed, and the only thing it proves is what the charts look like. The
 * distinction matters because the two would be maintained very
 * differently — one is a feature with a privacy boundary to keep proving,
 * this is a screenshot that happens to pan and zoom.
 *
 * ── Only invented people are in it ─────────────────────────────────────
 *
 * The snapshot names the three demo tree slugs explicitly rather than
 * exporting whatever it finds. Anything real — the author's own family,
 * which lives in a gitignored seed — is excluded by construction and not
 * by remembering to.
 */
import type { PersonDetail } from "~/routes/person";
import type { TreeData } from "~/lib/tree";
import type { TreeRow, TreeListRow, Me } from "~/lib/queries.server";

/**
 * Optional-chained because this module is also imported by
 * `scripts/snapshot.ts`, which runs under plain Node where
 * `import.meta.env` does not exist at all.
 */
export const DEMO = (import.meta as { env?: Record<string, string | undefined> }).env?.["VITE_DEMO"] === "1";

/** The three seeded trees, and nothing else, ever. */
export const DEMO_SLUGS = ["kowalski", "ashcombe", "vance"] as const;

export type Snapshot = {
  takenAt: string;
  trees: { trees: TreeListRow[]; me: Me; counts: Record<string, number> };
  tree: Record<string, { tree: TreeRow; data: TreeData }>;
  person: Record<string, PersonDetail>;
};

let cached: Snapshot | null = null;

/**
 * Read from disk rather than imported as a module, for two reasons: a
 * normal build must not fail merely because the snapshot has never been
 * taken, and an import would make the bundler inline a megabyte of JSON
 * into a build that has no use for it. With `ssr: false` the loaders run
 * only while prerendering, so none of this reaches the browser either
 * way.
 */
export async function snapshot(): Promise<Snapshot> {
  if (cached) return cached;
  const { readFile } = await import("node:fs/promises");
  const path = new URL("../../demo-data/snapshot.json", import.meta.url);
  cached = JSON.parse(await readFile(path, "utf8")) as Snapshot;
  return cached;
}
