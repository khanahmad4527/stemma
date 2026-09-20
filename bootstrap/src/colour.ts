/**
 * Contrast and perceptual distance, with no side effects.
 *
 * Its own module because two callers need it and neither can import the
 * other: `theme.ts` measures the colours the Data Studio *declares*, and
 * `verify.ts` measures the ones the live instance actually holds. Both
 * files run a `main()`, so the shared maths has to come from somewhere
 * that does nothing when you import it.
 *
 * The same arithmetic lives in `apps/web/checks/contrast-audit.js`, which
 * cannot share this file — it runs inside a browser page, against colours
 * resolved by CSS rather than written down. That one has the harder job
 * (Chrome serialises `color-mix()` as `oklab()`, and a naive parser reads
 * it as an rgb triple); this one only ever sees hex.
 */

const channels = (hex: string): [number, number, number] => [1, 3, 5]
  .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio, 1..21. Order of the arguments does not matter. */
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * OKLab, not CIELAB. It is the space whose distances match what people
 * report seeing, which is the whole point of a separation floor.
 */
export const oklab = (hex: string): [number, number, number] => {
  const [r, g, b] = channels(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
};

/** Scaled by 100 so the familiar "floor of 15" reads as 15 and not 0.15. */
export const deltaE = (a: string, b: string): number => {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
};

/** The four surfaces the Data Studio ever paints an icon on. */
export const LIGHT_CHROME = { "light": "#FFFFFF", "light-sunk": "#F0F4F9" };
export const DARK_CHROME = { "dark": "#161B1D", "dark-rise": "#21262A" };
export const CHROME = { ...LIGHT_CHROME, ...DARK_CHROME };

/** WCAG 1.4.11 — icons and other non-text graphics. */
export const GRAPHIC = 3.0;
/** WCAG 1.4.3 — body text. */
export const BODY = 4.5;
/** The normal-vision floor for telling two categorical colours apart. */
export const SEPARATION = 15.0;
