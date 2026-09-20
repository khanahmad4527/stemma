/**
 * Freeze the demo trees for the static showcase.
 *
 * Signs in to a running Directus, asks it for exactly what the three
 * loaders ask for — the same functions, from `app/lib/queries.server.ts`,
 * so the snapshot cannot drift from the live app — and writes one JSON
 * file plus the portraits.
 *
 * ── It names the trees, rather than exporting what it finds ────────────
 *
 * `DEMO_SLUGS` is a literal list of the three invented families. The
 * author's own family lives in a gitignored seed in the same database,
 * and a snapshot that exported every tree it could read would publish it
 * the first time somebody ran this on a machine where it had been
 * seeded. Excluded by construction, not by remembering to.
 *
 * ── It signs in as a member, not as the admin ──────────────────────────
 *
 * So what lands in the file is what a signed-in member of those trees can
 * see, through the same permissions as the running site. It is invented
 * data either way, but there is no reason for a build step to hold more
 * than the page it is building would.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTree, loadTrees, loadPerson, type Get } from "../app/lib/queries.server.js";
import { DEMO_SLUGS, type Snapshot } from "../app/lib/demo.server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..");
const DIRECTUS = process.env["DIRECTUS_URL"] ?? "http://localhost:9057";
const EMAIL = process.env["DEMO_EMAIL"] ?? "owner@stemma.example.com";
const PASSWORD = process.env["DEMO_PASSWORD"] ?? "";

async function main(): Promise<void> {
  const auth = await fetch(`${DIRECTUS}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const token = ((await auth.json()) as { data?: { access_token: string } }).data?.access_token;
  if (!token) throw new Error(`Cannot sign in to ${DIRECTUS} as ${EMAIL} — is it running, and is DEMO_PASSWORD set?`);

  const get: Get = async <T,>(path: string): Promise<T> => {
    const res = await fetch(`${DIRECTUS}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return ((await res.json()) as { data: T }).data;
  };

  const all = await loadTrees(get);
  // The picker must offer the demo trees and nothing else.
  const trees = all.trees.filter((t) => (DEMO_SLUGS as readonly string[]).includes(t.slug));
  const counts = Object.fromEntries(trees.map((t) => [t.id, all.counts[t.id] ?? 0]));

  const snapshot: Snapshot = {
    takenAt: new Date().toISOString(),
    trees: { trees, me: { first_name: "A", last_name: "visitor", email: "demo" }, counts },
    tree: {},
    person: {},
  };

  const portraits = new Set<string>();
  for (const slug of DEMO_SLUGS) {
    const one = await loadTree(get, slug);
    snapshot.tree[slug] = one;
    for (const p of one.data.persons) {
      snapshot.person[p.id] = await loadPerson(get, p.id);
      if (p.portrait) portraits.add(p.portrait);
    }
    console.log(`  ${slug.padEnd(10)} ${one.data.persons.length} people, ${one.data.edges.length} edges`);
  }

  await mkdir(join(WEB, "demo-data"), { recursive: true });
  await writeFile(join(WEB, "demo-data", "snapshot.json"), JSON.stringify(snapshot));

  /*
   * Portraits become ordinary files. On the live site they are proxied
   * through a route because the Directus token is in an httpOnly cookie;
   * here there is no token and no server, so they are served flat and
   * `public/_headers` gives them a content type, since the chart asks for
   * `/portrait/<uuid>` with no extension.
   */
  const dir = join(WEB, "public", "portrait");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const id of portraits) {
    const res = await fetch(`${DIRECTUS}/assets/${id}?width=256&height=256&fit=cover&format=webp`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) { console.warn(`  portrait ${id}: ${res.status}`); continue; }
    await writeFile(join(dir, id), Buffer.from(await res.arrayBuffer()));
  }
  await writeFile(join(WEB, "public", "_headers"),
    "/portrait/*\n  Content-Type: image/webp\n  Cache-Control: public, max-age=31536000, immutable\n");

  const people = Object.keys(snapshot.person).length;
  console.log(`\n  ${DEMO_SLUGS.length} trees, ${people} people, ${portraits.size} portraits`);
  console.log(`  demo-data/snapshot.json — ${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
