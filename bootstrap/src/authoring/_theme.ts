/**
 * How the Data Studio looks: one colour, six folders, and the numbers
 * behind both.
 *
 * ── One colour, not six ────────────────────────────────────────────────
 *
 * The first version gave each of the six domains its own hue, searched so
 * the set cleared a separation floor. The gates passed and the result was
 * still wrong: a sidebar of violet, green, crimson, blue, ochre and teal
 * is a paintbox, and hue was doing work the folder grouping and the
 * per-collection icon already do better. Twenty collections do not become
 * easier to scan by being six colours — they become easier to scan by
 * being six *groups*, which they now are.
 *
 * So every collection, every folder and every bookmark takes
 * `COLLECTION_COLOR`, and the distinctions are carried by things that
 * survive greyscale: the group a row sits in, and the icon on it. Which
 * is the rule the charts already follow — facts are carried by shape, and
 * colour is never the only channel.
 *
 * ── The colours are the web app's, and they are measured ───────────────
 *
 * `#2A78D6` is `--accent` from `apps/web/app/app.css`, so the admin and
 * the site are recognisably one product. Every value below was measured
 * against the surface it is actually painted on, and `pnpm theme` re-runs
 * those measurements and fails the build.
 *
 *   COLLECTION_COLOR  paints an icon on four different chrome
 *                     backgrounds, because the admin follows the OS.
 *                     WCAG 1.4.11 puts non-text contrast at 3:1, and
 *                     #2A78D6 clears it on all four, worst 3.46. The
 *                     obvious alternative #1F66BE does not — it falls to
 *                     2.69 on the dark raised surface.
 *
 *   PRIMARY_LIGHT     Directus uses one `primary` for both a button fill
 *                     and link *text*, so it has to clear 4.5:1 in both
 *                     directions. #2A78D6 is only 4.42 as text on white,
 *                     which is why the light theme steps down to #1F66BE
 *                     — 5.67 as text, 5.67 with white on it. `app.css`
 *                     made the same split, `--accent` for fills and
 *                     `--accent-text` for text, for the same reason.
 *
 *   PRIMARY_DARK      #6FA8F0, the web app's dark `--accent`: 7.06 as
 *                     text on the dark shell, 7.72 with dark text on it.
 *
 *   MODULE_BAR        white icons at 15.63:1.
 *
 *   PROJECT_COLOR     sits behind the white mark. A logo is a graphic, so
 *                     the floor is 3:1; it measures 4.42.
 */
import type { Collection } from "./_helpers.js";

/**
 * The one colour every collection, folder and bookmark carries.
 * `--accent` from the web app's Garden theme.
 */
export const COLLECTION_COLOR = "#2A78D6";

/** Behind the white mark, on the login screen and in the nav header. */
export const PROJECT_COLOR = "#2A78D6";

/** Directus paints `primary` as both a fill and as text, hence two values. */
export const PRIMARY_LIGHT = "#1F66BE";
export const PRIMARY_DARK = "#6FA8F0";

/** The leftmost module rail, in the same hue family as the rest. */
export const MODULE_BAR = "#14243A";

/**
 * The folder the logo lives in.
 *
 * It sits here rather than in `brand.ts` because `access.ts` needs the
 * name to write the public file policy, and both of those modules run a
 * `main()` on import — so the constant has to come from somewhere that
 * does nothing when you import it. The colours are here for the same
 * reason: `pnpm theme` measures them without provisioning anything.
 */
export const BRAND_FOLDER = "Brand";

/**
 * A folder collection gets a folder icon — always, and the same one.
 *
 * A folder is chrome, not content. Six expressive icons made the folders
 * compete with the collections nested inside them, which are the things
 * you are actually looking for. The label says which folder it is; the
 * icon only needs to say *that it is a folder*.
 */
export const FOLDER_ICON = "folder";

/**
 * Bookmarks are a different *kind* of thing from collections, and the
 * colour says so.
 *
 * Twelve saved views sit nested under the twenty collections they open,
 * so the question the eye is asking in that sidebar is "is this a
 * collection or a saved view?" — not "which of the twelve is this?", to
 * which the label right beside it is the answer. So all twelve share one
 * icon *and* one colour, and the colour is chosen to be unmistakably not
 * the collections' blue: gold against #2A78D6 is dE 30.4, twice the
 * separation floor, and warm against cool reads before you focus on it.
 *
 * An earlier version gave each bookmark its own hue. That answered the
 * question nobody was asking, could not clear the separation floor with
 * twelve categories anyway (min dE 6.3), and put a rainbow back in a
 * sidebar that had just had one taken out.
 *
 * Three values because the icon and the label have different jobs. The
 * icon is a graphic, so one value clears 3:1 on all four chrome surfaces
 * at once. The label is *text* at 4.5:1, and no single colour clears that
 * on both a near-white and a near-black shell — the luminance windows do
 * not overlap — so light and dark get their own, exactly as `primary`
 * does. `brand.ts` writes them into `custom_css`.
 */
export const BOOKMARK_ICON = "bookmark";

/** The icon. 3.12:1 at worst on the four chrome surfaces. */
export const BOOKMARK_COLOR = "#BB7E00";

/** The label, on the light nav shell (#f7fafc): 5.49:1. */
export const BOOKMARK_TEXT_LIGHT = "#8A5D00";

/** The label, on the dark nav shell (#161b22): 8.19:1. */
export const BOOKMARK_TEXT_DARK = "#E0A94A";

/** The two shells the nav label is ever painted on. */
export const NAV_SHELL_LIGHT = "#F7FAFC";
export const NAV_SHELL_DARK = "#161B22";

export type DomainKey = "tenancy" | "graph" | "events" | "places" | "evidence" | "media";

type Domain = {
  /** The nav folder's collection name — what children set `meta.group` to. */
  folder: string;
  /** `$t:` key for the folder's note. */
  note: string;
  /**
   * What the sidebar calls it. Not a `$t:` key: a collection's name comes
   * from `meta.translations`, which is the one label Directus does not
   * resolve through `directus_translations`. Without it the folder reads
   * "Stemma Tenancy", the key with the underscores taken out.
   */
  label: string;
  sort: number;
};

export const DOMAINS: Record<DomainKey, Domain> = {
  tenancy:  { folder: "stemma_tenancy",  label: "Trees & Access",         note: "$t:stemma_folder_tenancy",  sort: 1 },
  graph:    { folder: "stemma_graph",    label: "People & Relationships", note: "$t:stemma_folder_graph",    sort: 2 },
  events:   { folder: "stemma_events",   label: "Events & Dates",         note: "$t:stemma_folder_events",   sort: 3 },
  places:   { folder: "stemma_places",   label: "Places",                 note: "$t:stemma_folder_places",   sort: 4 },
  evidence: { folder: "stemma_evidence", label: "Sources & Evidence",     note: "$t:stemma_folder_evidence", sort: 5 },
  media:    { folder: "stemma_media",    label: "Media",                  note: "$t:stemma_folder_media",    sort: 6 },
};

/**
 * The collection meta every collection shares, so a new one cannot be
 * added without landing in a domain and taking the one colour.
 */
export const inDomain = (
  key: DomainKey,
  o: { icon: string; note: string; sort: number; display_template?: string; hidden?: boolean },
): Record<string, unknown> => ({
  icon: o.icon,
  note: o.note,
  color: COLLECTION_COLOR,
  group: DOMAINS[key].folder,
  sort: o.sort,
  ...(o.display_template ? { display_template: o.display_template } : {}),
  ...(o.hidden ? { hidden: true } : {}),
});

/**
 * The nav folders themselves.
 *
 * A Directus folder is a collection with no table — `schema: null` — and
 * it exists only so the sidebar has somewhere to nest. They are not part
 * of the data model, which is why `verify.ts` counts collections that
 * have a schema rather than rows in `/collections`.
 */
export const FOLDERS: Collection[] = (Object.keys(DOMAINS) as DomainKey[]).map((key) => {
  const d = DOMAINS[key];
  return {
    collection: d.folder,
    meta: {
      icon: FOLDER_ICON, color: COLLECTION_COLOR, note: d.note, sort: d.sort, collapse: "open",
      translations: [{ language: "en-US", translation: d.label, singular: d.label, plural: d.label }],
    },
    fields: [],
  };
});
