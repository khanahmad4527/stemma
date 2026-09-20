/**
 * The contrast check for the Data Studio's own colours.
 *
 * `apps/web` has `pnpm contrast`, which drives a browser because the
 * question there is "what colour was actually painted" and CSS can only
 * answer that by being rendered. This one needs no browser: the admin's
 * colours are literals in `_theme.ts`, and what each one has to clear
 * depends only on where Directus paints it. What it shares with the other
 * check is the part that matters — it fails the run, and it is
 * falsifiable.
 *
 * ── Why a contrast check and not a palette check ───────────────────────
 *
 * This file used to assert OKLab dE >= 15 between six domain hues. Those
 * six are now one colour, so a separation floor over a one-element set
 * would be a check that cannot fail, which this project calls decoration.
 * What is left is the gate that still bites, widened to cover the
 * branding and bookmark colours the old version never looked at — and it
 * does bite: #1F66BE, the obvious single colour to use everywhere, fails
 * the icon gate at 2.69:1 on the dark raised surface.
 *
 * ── Which floor applies where ──────────────────────────────────────────
 *
 * A collection icon, a bookmark icon and a logo are non-text, so WCAG
 * 1.4.11 gives them 3:1. `primary` is painted as link text as well as a
 * button fill, so it takes the 4.5:1 body-text floor in both directions.
 * The admin follows the OS, so anything in the chrome is measured on
 * light *and* dark.
 *
 * The dE 15 separation floor is asserted once, where it can be met and
 * where it means something: between the bookmark colour and the
 * collection colour, because "is this a collection or a saved view" is
 * the question that sidebar actually poses. `verify.ts` checks the same
 * rule against what the instance holds, plus that the custom CSS which
 * colours the label is installed.
 */
import {
  COLLECTION_COLOR, PROJECT_COLOR, PRIMARY_LIGHT, PRIMARY_DARK, MODULE_BAR,
  DOMAINS, FOLDERS, FOLDER_ICON,
  BOOKMARK_ICON, BOOKMARK_COLOR, BOOKMARK_TEXT_LIGHT, BOOKMARK_TEXT_DARK,
  NAV_SHELL_LIGHT, NAV_SHELL_DARK,
} from "./authoring/_theme.js";
import {
  contrast, deltaE, CHROME, LIGHT_CHROME, DARK_CHROME, GRAPHIC, BODY, SEPARATION,
} from "./colour.js";
import { log } from "./log.js";

let failed = 0;

/** Every surface in `on` must clear `floor`, and the worst is reported. */
function gate(what: string, color: string, on: Record<string, string>, floor: number): void {
  const measured = Object.entries(on).map(([surface, bg]) => ({ surface, ratio: contrast(color, bg) }));
  const worst = measured.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const line = `${what.padEnd(34)} ${color}  worst ${worst.ratio.toFixed(2)} on ${worst.surface} (floor ${floor})`;
  if (worst.ratio < floor) { log.fail(line); failed++; } else log.info(line);
}

function main(): void {
  log.step("Collection and folder icons — one colour");
  gate("the one colour, on all chrome", COLLECTION_COLOR, CHROME, GRAPHIC);

  log.step("Accent — Directus paints `primary` as fill AND as link text");
  gate("light: as text", PRIMARY_LIGHT, LIGHT_CHROME, BODY);
  gate("light: white on it", "#FFFFFF", { [PRIMARY_LIGHT]: PRIMARY_LIGHT }, BODY);
  gate("dark: as text", PRIMARY_DARK, DARK_CHROME, BODY);
  gate("dark: dark text on it", "#0B1116", { [PRIMARY_DARK]: PRIMARY_DARK }, BODY);

  log.step("Chrome");
  gate("module bar, white icons on it", "#FFFFFF", { [MODULE_BAR]: MODULE_BAR }, BODY);
  gate("project colour, white mark on it", "#FFFFFF", { [PROJECT_COLOR]: PROJECT_COLOR }, GRAPHIC);

  log.step(`Bookmarks — one "${BOOKMARK_ICON}" icon, one colour, unlike the collections`);
  gate("the icon, on all chrome", BOOKMARK_COLOR, CHROME, GRAPHIC);
  gate("the label, light nav shell", BOOKMARK_TEXT_LIGHT, { "light shell": NAV_SHELL_LIGHT }, BODY);
  gate("the label, dark nav shell", BOOKMARK_TEXT_DARK, { "dark shell": NAV_SHELL_DARK }, BODY);

  // The separation that matters is bookmark-vs-collection, not
  // bookmark-vs-bookmark: twelve saved views nested under twenty
  // collections, and the question is which kind of row this is. Which
  // means the floor is reachable here, so it is asserted rather than
  // noted — the version that gave each bookmark its own hue could only
  // manage dE 6.3 and had to explain itself instead.
  const apart = deltaE(BOOKMARK_COLOR, COLLECTION_COLOR);
  if (apart < SEPARATION) {
    log.fail(`bookmarks are dE ${apart.toFixed(1)} from collections, under ${SEPARATION} — the two kinds would not read apart`);
    failed++;
  } else {
    log.info(`${"bookmark vs collection".padEnd(34)} dE ${apart.toFixed(1)} (floor ${SEPARATION})`);
  }

  log.step("Structure");
  /*
   * "Every folder's icon equals FOLDER_ICON" would be a tautology —
   * `FOLDERS` is built from that constant, so both sides move together
   * and the check cannot fail. It was written that way first and proved
   * it by not failing when FOLDER_ICON was set to `hub`. So the assertion
   * is against a fixed list instead: whatever the constant is set to has
   * to be an icon that actually depicts the thing. The colour equivalent
   * is `verify.ts`'s job, against the live instance, because comparing a
   * declaration to itself says nothing.
   */
  const DEPICTS_A_FOLDER = [
    "folder", "folder_open", "folder_shared", "folder_special", "folder_copy",
    "snippet_folder", "topic", "create_new_folder", "drive_folder_upload",
  ];
  const DEPICTS_A_BOOKMARK = ["bookmark", "bookmarks", "bookmark_border", "turned_in", "label", "star"];

  if (!DEPICTS_A_FOLDER.includes(FOLDER_ICON)) {
    log.fail(`FOLDER_ICON is "${FOLDER_ICON}", which does not depict a folder — a nav folder is chrome and should look like one`);
    failed++;
  } else log.info(`${FOLDERS.length} folders, all "${FOLDER_ICON}"`);

  if (!DEPICTS_A_BOOKMARK.includes(BOOKMARK_ICON)) {
    log.fail(`BOOKMARK_ICON is "${BOOKMARK_ICON}", which does not read as a saved view`);
    failed++;
  } else log.info(`every bookmark on "${BOOKMARK_ICON}" in ${BOOKMARK_COLOR}`);

  const domains = Object.keys(DOMAINS).length;
  if (domains !== FOLDERS.length) { log.fail(`${domains} domains but ${FOLDERS.length} folders`); failed++; }
  else log.info(`${domains} domains, ${FOLDERS.length} folders`);

  if (failed > 0) {
    log.warn(`${failed} colour check(s) failed — measure a replacement before shipping this`);
    process.exitCode = 1;
    return;
  }
  log.done(`${Object.keys(CHROME).length} chrome surfaces, 11 gates, all clear`);
}

main();
