/**
 * Branding, which `d6s sync` half-carries.
 *
 * `directus_settings` is in the sync; `directus_files` is not — the CLI
 * excludes it deliberately, because an environment's uploads are not its
 * configuration. So the settings row travels and the two images it points
 * at do not, and a pushed environment would render a broken logo and keep
 * the file ids of a database it has never met. This script is the other
 * half: it uploads the marks, finds them again by title on a re-run, and
 * writes the ids into settings. Run it after `pnpm build`, before
 * `pnpm pull`.
 *
 * ── The colours are measured, and they live next door ──────────────────
 *
 * Every value written here comes from `authoring/_theme.ts`, which states
 * what each one had to clear and why, and `pnpm theme` re-measures them.
 * Nothing in this file picks a colour.
 *
 * ── The logo has to be readable by nobody ──────────────────────────────
 *
 * The login screen is anonymous, so the logo and favicon are fetched
 * without a token. Stemma's public file policy answers only for files
 * whose tree is public *and* whose `is_public_ok` a media row has set —
 * which is exactly right for photographs and exactly wrong for a logo,
 * since a logo has no tree and no media row. Hence the `Brand` folder and
 * the second arm of the public `directus_files` filter in `access.ts`:
 * branding is public because it is branding, and it is identified by
 * where it lives rather than by a flag that means something else.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, authHeader, login, must } from "./client.js";
import { log } from "./log.js";
import { URL_BASE } from "./env.js";
import {
  BRAND_FOLDER, PROJECT_COLOR, PRIMARY_LIGHT, PRIMARY_DARK, MODULE_BAR,
  BOOKMARK_COLOR, BOOKMARK_TEXT_LIGHT, BOOKMARK_TEXT_DARK,
} from "./authoring/_theme.js";

const BRAND = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "brand");

type Asset = { file: string; title: string; type: string };

const ASSETS: Asset[] = [
  { file: "stemma-mark.svg", title: "Stemma mark", type: "image/svg+xml" },
  { file: "stemma-favicon.svg", title: "Stemma favicon", type: "image/svg+xml" },
];

async function brandFolder(): Promise<string> {
  const found = await must<Array<{ id: string }>>(
    "find brand folder",
    api.get(`/folders?limit=1&fields=id&filter[name][_eq]=${BRAND_FOLDER}`),
  );
  const existing = found[0]?.id;
  if (existing) return existing;
  const made = await must<{ id: string }>("create brand folder", api.post("/folders", { name: BRAND_FOLDER }));
  log.made(`folder ${BRAND_FOLDER}`);
  return made.id;
}

/**
 * Upload once, then *reconcile* — not skip.
 *
 * Found by title, so a re-run does not pile up copies. But finding it and
 * leaving it alone is the bug `applyField` already avoids for field meta:
 * the first mark was drawn with `stroke="currentColor"`, which resolves
 * to black when Directus loads the SVG through an `<img>`, and the fix in
 * the repo could not reach an instance that already had the old bytes.
 * Deleting and re-uploading is not available either — `directus_settings`
 * has a foreign key onto both files, so the delete answers 500.
 *
 * So the current bytes are fetched and compared, and only a difference
 * triggers the multipart PATCH that replaces them. The file id survives,
 * which is what the settings row and every cached URL point at.
 */
async function upload(asset: Asset, folder: string): Promise<string | null> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(BRAND, asset.file));
  } catch {
    log.fail(`  ${asset.file} is missing from bootstrap/assets/brand`);
    return null;
  }
  const blob = (): Blob => new Blob([new Uint8Array(bytes)], { type: asset.type });

  const found = await must<Array<{ id: string }>>(
    `find ${asset.title}`,
    api.get(`/files?limit=1&fields=id&filter[title][_eq]=${encodeURIComponent(asset.title)}`),
  );
  const existing = found[0]?.id;

  if (existing) {
    const current = await fetch(`${URL_BASE}/assets/${existing}`, { headers: { authorization: authHeader() } });
    const same = current.ok && Buffer.from(await current.arrayBuffer()).equals(bytes);
    if (same) { log.skip(`  ${asset.title}`); return existing; }

    const patch = new FormData();
    patch.append("file", blob(), asset.file);
    const res = await fetch(`${URL_BASE}/files/${existing}`, {
      method: "PATCH", headers: { authorization: authHeader() }, body: patch,
    });
    if (!res.ok) { log.fail(`  replace ${asset.file}: ${res.status} ${await res.text()}`); return existing; }
    log.made(`  ${asset.title} (bytes replaced)`);
    return existing;
  }

  const form = new FormData();
  form.append("title", asset.title);
  form.append("folder", folder);
  form.append("file", blob(), asset.file);
  const res = await fetch(`${URL_BASE}/files`, { method: "POST", headers: { authorization: authHeader() }, body: form });
  if (!res.ok) { log.fail(`  upload ${asset.file}: ${res.status} ${await res.text()}`); return null; }
  const id = ((await res.json()) as { data: { id: string } }).data.id;
  log.made(`  ${asset.title}`);
  return id;
}

/**
 * The note under the login form. Markdown, and the one place an operator
 * meeting this instance for the first time is told what it is.
 */
const PUBLIC_NOTE =
  "**Stemma** — a multi-tenant genealogy backend.\n\n" +
  "A family tree is a directed acyclic graph, not a tree: cousins marry, and the same " +
  "ancestor legitimately appears twice in one chart. Living people are suppressed by a " +
  "stored flag, not a computed filter, so the public rule stays a flat indexable comparison.";

/**
 * The one thing the theme system cannot reach: the bookmark *label*.
 *
 * Directus's theme rules colour the nav as a whole — `navigation.list.
 * foreground` hits every row, collections included — and a preset's own
 * `color` only reaches its icon, which at 16px is not much of a signal.
 * There is no theme rule for "a saved view's text". So this is
 * `directus_settings.custom_css`, which is the sanctioned hook and needs
 * no extension: a custom module cannot restyle the nav anyway, since the
 * nav is not its to render.
 *
 * ── Only the *global* bookmarks, and how ───────────────────────────────
 *
 * `.bookmark` is a real class Directus puts on the anchor — a collection
 * is `a.v-list-item.link`, a bookmark is `a.v-list-item.link.clickable.
 * bookmark`. But it is on *every* bookmark, and a personal one that a
 * contributor saved for themselves is not ours to restyle.
 *
 * There is no DOM hook for the difference. A global preset and a personal
 * one render byte-for-byte alike — same classes, same attributes, the
 * only difference is the `?bookmark=<id>` in the href, and ids differ per
 * environment. That was checked by creating a personal bookmark and
 * diffing the two anchors, not assumed.
 *
 * What *is* in the DOM is the preset's own colour, which Directus writes
 * onto the icon as an inline custom property: `style="--v-icon-color:
 * #BB7E00"`. Every global bookmark here carries that exact value because
 * `presets.ts` sets it, and a personal one carries whatever its owner
 * picked, or nothing. So the rule keys off the data rather than off a
 * position: `:has()` matches the icon, and the label follows the icon it
 * belongs to. If a contributor happens to choose the same gold, their
 * label matches too — which is not wrong, it is the colour meaning what
 * it says.
 *
 * `:has()` is Chrome 105+, Safari 15.4+, Firefox 121+. Where it is not
 * supported the selector simply does not match and the label falls back
 * to the default foreground, which is the right way round: no colour
 * rather than the wrong one.
 *
 * Two rules, because no single colour is 4.5:1 text on both a near-white
 * and a near-black shell — the luminance windows do not overlap.
 * Directus marks the resolved appearance on the body (`body.light` /
 * `body.dark`) even when the setting is `auto`, which is what makes the
 * split expressible here.
 */
const BOOKMARK_ROW = `.content-navigation .v-list-item.bookmark:has(.v-icon[style*="${BOOKMARK_COLOR}"]) .v-list-item-content`;

const CUSTOM_CSS = [
  "/* Written by `pnpm brand` — edit bootstrap/src/brand.ts, not here. */",
  "/* Global bookmarks are saved views, not collections. The icon colour",
  "   comes from the preset; the label needs CSS, because no theme rule",
  "   distinguishes a bookmark row from a collection row. The :has()",
  "   matches this project's own bookmark colour, so a contributor's",
  "   personal bookmark keeps the default foreground. */",
  `body.light ${BOOKMARK_ROW} {`,
  `  color: ${BOOKMARK_TEXT_LIGHT};`,
  "}",
  `body.dark ${BOOKMARK_ROW} {`,
  `  color: ${BOOKMARK_TEXT_DARK};`,
  "}",
].join("\n");

export async function applyBrand(): Promise<void> {
  log.step("Brand assets");
  const folder = await brandFolder();
  const logo = await upload(ASSETS[0] as Asset, folder);
  const favicon = await upload(ASSETS[1] as Asset, folder);

  log.step("Project settings");
  const settings: Record<string, unknown> = {
    project_name: "Stemma",
    project_descriptor: "Family trees",
    project_color: PROJECT_COLOR,
    project_url: process.env["WEB_URL"] ?? "http://localhost:8060",
    public_note: PUBLIC_NOTE,
    default_appearance: "auto",

    // Only the rules that were actually measured. Everything else stays
    // on the shipped theme, because an override nobody checked is how an
    // admin ends up with 2.9:1 text and no test that says so.
    theme_light_overrides: {
      primary: PRIMARY_LIGHT,
      navigation: { modules: { background: MODULE_BAR } },
    },
    theme_dark_overrides: {
      primary: PRIMARY_DARK,
      navigation: { modules: { background: MODULE_BAR } },
    },

    custom_css: CUSTOM_CSS,

    ...(logo ? { project_logo: logo } : {}),
    ...(favicon ? { public_favicon: favicon } : {}),
  };

  const r = await api.patch("/settings", settings);
  if (!r.ok) { log.fail(`settings: ${r.error.message}`); return; }
  log.made(`Stemma · ${PROJECT_COLOR}${logo ? " · logo" : ""}${favicon ? " · favicon" : ""}`);
}

async function main(): Promise<void> {
  log.step(`Connecting to ${api.url}`);
  await login();
  await applyBrand();
  const failed = log.failures();
  if (failed) { log.warn(`${failed} step(s) failed`); process.exitCode = 1; return; }
  log.done("branding applied — now `pnpm pull`");
}

main().catch((err) => {
  log.fail(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
