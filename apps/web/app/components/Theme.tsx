/**
 * Choosing a theme, and not flashing the wrong one on the way in.
 *
 * The choice lives in `localStorage` and is written to `data-theme` on
 * `<html>`. Because the app is server-rendered, the server cannot know
 * what the browser chose — so a blocking inline script applies it before
 * first paint. Doing it in an effect instead means a visible flash of
 * parchment before the tapestry arrives, every single load.
 */
import { useCallback, useEffect, useState } from "react";

export const THEMES = [
  { id: "light", label: "Garden", hint: "Bright and green — the default" },
  { id: "dark", label: "Dusk", hint: "The same garden at night" },
  { id: "tapestry", label: "Tapestry", hint: "Gold thread on a blackened green ground" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

const KEY = "stemma-theme";

/** Runs before first paint. Kept tiny and defensive — it is inline. */
export const NO_FLASH = `try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}`;

export function useTheme(): [Theme | null, (t: Theme) => void] {
  // Null until mounted: the server has no idea, and rendering a guess
  // would make the first client render disagree with the HTML.
  const [theme, set] = useState<Theme | null>(null);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme") as Theme | null;
    if (attr) { set(attr); return; }
    set(window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  const choose = useCallback((t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(KEY, t); } catch { /* private window: honour it for this session only */ }
    set(t);
  }, []);

  return [theme, choose];
}

export function ThemePicker() {
  const [theme, choose] = useTheme();
  return (
    <div className="segmented themes" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} type="button" title={t.hint}
                aria-pressed={theme === t.id}
                onClick={() => choose(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Whether the ornate frames are on. Drives SVG, so it cannot be CSS alone. */
export function useOrnate(): boolean {
  const [ornate, set] = useState(false);
  useEffect(() => {
    const read = () => set(document.documentElement.getAttribute("data-theme") === "tapestry");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return ornate;
}
