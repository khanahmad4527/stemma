/**
 * Default list views, and the global bookmarks beside them.
 *
 * The one thing `d6s sync` never carries — `directus_presets` is excluded
 * upstream because bookmarks mix shared configuration with personal
 * preference. That exclusion is right for "Katarzyna sorted persons by
 * surname last Tuesday" and wrong for the two kinds of preset that are
 * configuration:
 *
 *   **A default view** — one per collection, no bookmark, no user, no
 *   role. Without it Directus shows whichever columns it finds first,
 *   which for `parentage` is four uuids.
 *
 *   **A global bookmark** — a named, saved query with no user and no
 *   role, so it appears in every operator's sidebar. These are the ones
 *   worth writing down, because each is a question the data model exists
 *   to answer and a new contributor would not know to ask: which people
 *   are suppressed from the public site and why, which parent edges are
 *   not by birth, which unions produced children without a marriage,
 *   which assertions are still assertions rather than conclusions.
 *
 * Both are reconciled on every run. Neither is deleted: an unrecognised
 * global bookmark is reported rather than removed, because the cost of
 * being wrong in that direction is somebody's saved work.
 */
import { api, login, must } from "./client.js";
import { log } from "./log.js";
import { BOOKMARK_ICON, BOOKMARK_COLOR } from "./authoring/_theme.js";

type View = { collection: string; fields: string[]; sort?: string[] };

const VIEWS: View[] = [
  { collection: "trees", fields: ["name", "slug", "is_public", "is_listed", "owner"], sort: ["name"] },
  { collection: "tree_members", fields: ["tree", "user", "role"], sort: ["tree"] },
  { collection: "tree_invitations", fields: ["tree", "email", "role", "status", "expires_at"], sort: ["-date_created"] },
  { collection: "persons", fields: ["display_name", "sex_recorded", "is_living", "is_restricted", "tree"], sort: ["sort_name"] },
  { collection: "person_names", fields: ["person", "type", "given", "surname", "sort_order"], sort: ["person", "sort_order"] },
  { collection: "couples", fields: ["person_a", "person_b", "tree"], sort: ["-date_created"] },
  { collection: "parentage", fields: ["parent", "child", "lineage", "status", "confidence"], sort: ["parent"] },
  { collection: "associations", fields: ["person_a", "type", "person_b", "date_original"], sort: ["person_a"] },
  { collection: "event_types", fields: ["label", "code", "applies_to", "category", "is_vital", "ends_life", "tree"], sort: ["sort"] },
  { collection: "events", fields: ["type", "subject_person", "subject_couple", "date_original", "place", "is_conclusion", "confidence"], sort: ["date_earliest"] },
  { collection: "event_participants", fields: ["event", "person", "role", "detail"], sort: ["event"] },
  { collection: "places", fields: ["name", "type", "parent_place", "has_public_reference"], sort: ["name"] },
  { collection: "place_names", fields: ["place", "name", "lang", "valid_from", "valid_to"], sort: ["place", "valid_from"] },
  { collection: "repositories", fields: ["name", "type", "url"], sort: ["name"] },
  { collection: "sources", fields: ["title", "author", "type", "repository"], sort: ["title"] },
  { collection: "citations", fields: ["source", "locator", "information", "evidence", "confidence"], sort: ["source"] },
  { collection: "citation_links", fields: ["citation", "collection", "item", "is_public_ok"], sort: ["citation"] },
  { collection: "media", fields: ["caption", "kind", "date_original", "licence", "publishable"], sort: ["-date_created"] },
  { collection: "media_subjects", fields: ["media", "person"], sort: ["media"] },
  { collection: "media_links", fields: ["media", "collection", "item"], sort: ["media"] },
];

type Bookmark = {
  name: string;
  collection: string;
  /** Why this one is worth a permanent place in the sidebar. */
  why: string;
  fields?: string[];
  sort?: string[];
  filter?: Record<string, unknown>;
  layout?: "tabular" | "cards" | "calendar";
  options?: Record<string, unknown>;
};

const BOOKMARKS: Bookmark[] = [
  {
    name: "Living people", collection: "persons",
    why: "The suppression set. Every row here is invisible to the public site, and `living_basis` says on whose authority.",
    filter: { is_living: { _eq: true } },
    fields: ["display_name", "tree", "living_basis", "is_restricted", "sex_recorded"],
    sort: ["tree", "sort_name"],
  },
  {
    name: "Recently edited", collection: "persons",
    why: "What changed, and who changed it — the reason the audit columns are on the form at all.",
    fields: ["display_name", "tree", "date_updated", "user_updated"],
    sort: ["-date_updated"],
  },
  {
    name: "Not by birth", collection: "parentage",
    why: "Adoptive, step, foster, guardian, donor and surrogate edges. The schema exists to hold these; this is where you see it holding them.",
    filter: { lineage: { _nin: ["birth"] } },
    fields: ["parent", "child", "lineage", "status", "confidence"],
    sort: ["lineage", "parent"],
  },
  {
    name: "Disputed & disproven", collection: "parentage",
    why: "A disproven line is kept, not deleted — the public filter excludes it and the record of the mistake survives.",
    filter: { status: { _in: ["disputed", "disproven"] } },
    fields: ["parent", "child", "lineage", "status", "notes"],
    sort: ["status"],
  },
  {
    name: "Unions with no marriage", collection: "couples",
    why: "Exactly the case that makes this `couples` and not `marriages`: a union that produced children and never produced a certificate is not missing data.",
    filter: { events: { _none: { type: { code: { _eq: "marriage" } } } } },
    fields: ["person_a", "person_b", "status", "tree"],
    sort: ["tree"],
  },
  {
    name: "Assertions, not conclusions", collection: "events",
    why: "Two censuses, two birth years, both kept. The Genealogical Proof Standard says resolve the conflict and record the reasoning; this is the queue of conflicts not yet resolved.",
    filter: { is_conclusion: { _eq: false } },
    fields: ["type", "subject_person", "date_original", "confidence", "place"],
    sort: ["subject_person"],
  },
  {
    name: "Undated events", collection: "events",
    why: "`date_original` survived and nothing parsed it into a range, so these sort nowhere and fall out of every date query.",
    filter: { date_earliest: { _null: true } },
    fields: ["type", "subject_person", "date_original", "date_qualifier", "place"],
    sort: ["type"],
  },
  {
    name: "Calendar", collection: "events",
    why: "The same rows against a calendar. Useful mostly for spotting a date that parsed into the wrong century.",
    layout: "calendar",
    options: { startDateField: "date_earliest", endDateField: "date_latest", template: "{{type.label}} — {{subject_person.display_name}}" },
  },
  {
    name: "Unlocated places", collection: "places",
    why: "No coordinates, so nothing can map them. A working queue rather than a fault.",
    filter: { lat: { _null: true } },
    fields: ["name", "type", "parent_place", "has_public_reference"],
    sort: ["name"],
  },
  {
    name: "Weak citations", collection: "citations",
    why: "GEDCOM QUAY 0 and 1 — unreliable, or questionable. Anything resting on these is resting on very little.",
    filter: { confidence: { _lte: 1 } },
    fields: ["source", "locator", "information", "evidence", "confidence"],
    sort: ["confidence", "source"],
  },
  {
    name: "Rights to settle", collection: "media",
    why: "Unknown licence or not cleared for publication. An empty list here is the goal, not a bug.",
    filter: { _or: [{ licence: { _eq: "unknown" } }, { publishable: { _eq: false } }] },
    fields: ["caption", "kind", "licence", "publishable", "copyright_holder"],
    sort: ["licence"],
  },
  {
    name: "Gallery", collection: "media",
    why: "Cards rather than rows, because the thing you are looking for in a photograph is the photograph.",
    layout: "cards",
    options: { imageSource: "file", title: "{{caption}}", subtitle: "{{date_original}}", size: 4, imageFit: "crop" },
  },
];

/** A preset row Directus accepts, whether it is a default view or a bookmark. */
const body = (p: {
  collection: string; bookmark: string | null; icon?: string; color?: string;
  layout: string; fields?: string[]; sort?: string[];
  filter?: Record<string, unknown> | null; options?: Record<string, unknown>;
}): Record<string, unknown> => ({
  bookmark: p.bookmark,
  collection: p.collection,
  role: null,
  user: null,
  layout: p.layout,
  layout_query: { [p.layout]: { ...(p.fields ? { fields: p.fields } : {}), ...(p.sort ? { sort: p.sort } : {}) } },
  layout_options: { [p.layout]: p.options ?? (p.layout === "tabular" ? { widths: {} } : {}) },
  filter: p.filter ?? null,
  search: null,
  ...(p.icon ? { icon: p.icon } : {}),
  ...(p.color ? { color: p.color } : {}),
});

type Row = { id: number; bookmark: string | null; user: string | null; role: string | null; collection: string };

export async function applyPresets(): Promise<void> {
  const existing = await must<Row[]>(
    "list presets",
    api.get("/presets?limit=-1&fields=id,bookmark,user,role,collection"),
  );
  const global = existing.filter((p) => p.user === null && p.role === null);
  const defaults = new Map(global.filter((p) => !p.bookmark).map((p) => [p.collection, p.id]));
  const marks = new Map(global.filter((p) => p.bookmark).map((p) => [`${p.collection}::${p.bookmark}`, p.id]));

  log.step("Default list views");
  for (const v of VIEWS) {
    const payload = body({
      collection: v.collection, bookmark: null, layout: "tabular",
      fields: v.fields, sort: v.sort ?? v.fields.slice(0, 1),
    });
    const id = defaults.get(v.collection);
    const r = id !== undefined ? await api.patch(`/presets/${id}`, payload) : await api.post("/presets", payload);
    if (!r.ok) log.fail(`default view for ${v.collection} — ${r.error.message}`);
    else if (id !== undefined) log.skip(`default view for ${v.collection}`);
    else log.made(`default view for ${v.collection}`);
  }

  log.step("Global bookmarks");
  for (const b of BOOKMARKS) {
    const layout = b.layout ?? "tabular";
    const payload = body({
      collection: b.collection, bookmark: b.name, icon: BOOKMARK_ICON, color: BOOKMARK_COLOR,
      layout, fields: b.fields, sort: b.sort, filter: b.filter ?? null, options: b.options,
    });
    const id = marks.get(`${b.collection}::${b.name}`);
    const r = id !== undefined ? await api.patch(`/presets/${id}`, payload) : await api.post("/presets", payload);
    if (!r.ok) log.fail(`bookmark "${b.name}" — ${r.error.message}`);
    else if (id !== undefined) log.skip(`bookmark "${b.name}"`);
    else log.made(`bookmark "${b.name}" (${b.collection})`);
  }

  // Reported, never removed. A stale bookmark is clutter; a deleted one
  // that somebody meant to keep is not recoverable from here.
  const declared = new Set(BOOKMARKS.map((b) => `${b.collection}::${b.name}`));
  const strays = global.filter((p) => p.bookmark && !declared.has(`${p.collection}::${p.bookmark}`));
  for (const s of strays) {
    log.warn(`global bookmark "${s.bookmark}" on ${s.collection} is not declared here — delete it in the Data Studio, or add it to BOOKMARKS`);
  }
}

async function main(): Promise<void> {
  log.step(`Connecting to ${api.url}`);
  await login();
  await applyPresets();
  const failed = log.failures();
  if (failed) { log.warn(`${failed} preset(s) failed`); process.exitCode = 1; return; }
  log.done(`${VIEWS.length} default views, ${BOOKMARKS.length} global bookmarks`);
}

main().catch((err) => {
  log.fail(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
