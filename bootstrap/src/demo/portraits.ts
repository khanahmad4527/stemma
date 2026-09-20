/**
 * The demo portraits.
 *
 * Silhouette cameos, not faces: demo data for a family archive should
 * not contain pictures of people who do not exist and cannot consent,
 * and a cameo is what a nineteenth-century family actually had made.
 * They live in `bootstrap/assets/portraits/` and are uploaded once; the file
 * id is remembered by title so re-seeding does not pile up copies.
 *
 * Each upload also gets a `media` row, because that is what decides
 * whether a file may ever be public — `directus_files.is_public_ok` is
 * set by a trigger from it, and an unclaimed file is public to nobody.
 */
import { readdirSync, readFileSync } from "node:fs";
import { api, authHeader, must } from "../client.js";
import { log } from "../log.js";
import { URL_BASE } from "../env.js";
import { uid, upsert } from "./shared.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Beside the package that reads them, not at the repo root. */
const PORTRAITS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "portraits");

export async function uploadPortraits(tree: string): Promise<string[]> {
  let names: string[];
  try {
    names = readdirSync(PORTRAITS).filter((f) => f.endsWith(".png")).sort();
  } catch {
    log.warn("no assets/portraits directory — charts will fall back to initials");
    return [];
  }
  if (!names.length) return [];

  const existing = await must<Array<{ id: string; title: string }>>(
    "list files", api.get("/files?limit=-1&fields=id,title&filter[title][_starts_with]=Cameo"),
  );
  const byTitle = new Map(existing.map((f) => [f.title, f.id]));

  const ids: string[] = [];
  let made = 0;
  for (const name of names) {
    const title = `Cameo ${name.replace(/\D+/g, "")}`;
    let id = byTitle.get(title);
    if (!id) {
      const form = new FormData();
      form.append("title", title);
      const bytes = readFileSync(join(PORTRAITS, name));
      form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), name);
      const res = await fetch(`${URL_BASE}/files`, { method: "POST", headers: { authorization: authHeader() }, body: form });
      if (!res.ok) { log.fail(`upload ${name}: ${res.status}`); continue; }
      id = ((await res.json()) as { data: { id: string } }).data.id;
      made++;
    }
    ids.push(id);
    // The media row is what makes the file publishable at all.
    await upsert("media", uid(`media:${title}`), {
      tree, file: id, kind: "photo", caption: `${title} — a demo silhouette, not a photograph of a real person`,
      licence: "cc0", publishable: true,
    });
  }
  log.made(`${ids.length} portraits (${made} newly uploaded)`);
  return ids;
}
