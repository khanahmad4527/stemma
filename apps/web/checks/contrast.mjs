/**
 * Readability, as a check that can fail.
 *
 * The first version of this theme failed WCAG AA in 45 places across two
 * themes, and the worst offenders were the dates — the thing a genealogy
 * interface exists to show. Nobody noticed by looking, which is the
 * point: contrast is not a thing eyes are good at judging, especially
 * one's own.
 *
 * So it is measured. This drives a real browser, walks every element
 * that renders text in every theme, resolves the colour actually painted
 * (including SVG `fill` and `color-mix`, which Chrome serialises as
 * `oklab`), and fails the run if anything sits below 4.5:1 for body text
 * or 3:1 for large text.
 *
 *   pnpm --filter @stemma/web contrast
 *
 * Needs the site running (`pnpm web`) and the demo tree seeded.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const AUDIT = readFileSync(new URL("./contrast-audit.js", import.meta.url), "utf8");
const BASE = process.env.WEB_URL ?? "http://localhost:8060";
const EMAIL = process.env.DEMO_EMAIL ?? "owner@stemma.example.com";
const PASSWORD = process.env.DEMO_PASSWORD ?? "StemmaDemo!2026";
const THEMES = ["light", "dark", "tapestry"];

const browser = await chromium.launch();
let failing = 0;
console.log(`\n  Contrast against ${BASE}\n`);

for (const theme of THEMES) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme === "light" ? "light" : "dark",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL("**/"), page.click('button[type="submit"]')]);
  await page.evaluate((t) => localStorage.setItem("stemma-theme", t), theme);

  const report = async (label) => {
    const fails = await page.evaluate(AUDIT);
    failing += fails.length;
    const mark = fails.length ? "\x1b[31mFAIL\x1b[0m" : "\x1b[32mPASS\x1b[0m";
    console.log(`  ${mark}  ${theme} · ${label}`);
    for (const f of fails) {
      console.log(`        ${f.got.padStart(5)}:1 (needs ${f.need})  ${f.px}px  ${f.sel.slice(0, 44).padEnd(44)} "${f.text}"`);
    }
  };

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await report("your trees");

  await page.goto(`${BASE}/kowalski`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  // With a person selected, so the panel is measured too.
  await page.locator(".node, .wedge").first().click({ force: true });
  await page.waitForTimeout(800);
  await report("pedigree + panel");

  await page.keyboard.press("2");
  await page.waitForTimeout(1000);
  await report("fan");

  await page.keyboard.press("3");
  await page.waitForTimeout(1200);
  await report("tree");

  await page.keyboard.press("4");
  await page.waitForTimeout(1200);
  await report("descendants");

  await ctx.close();
}

console.log(failing === 0
  ? `\n  \x1b[32mEvery piece of text clears WCAG AA in all ${THEMES.length} themes\x1b[0m\n`
  : `\n  \x1b[31m${failing} below the contrast floor\x1b[0m\n`);
await browser.close();
process.exitCode = failing === 0 ? 0 : 1;
