(() => {
  // Chrome serialises color-mix() as oklab(), so a naive "grab the first
  // three numbers" reads 0.915 as a red channel and reports a 1.19:1
  // failure on text that is really at 14:1. Everything is converted to
  // LINEAR rgb here and luminance is a dot product on that.
  const srgbLin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const oklabLin = (L, a, b) => {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3, m = m_ ** 3, s2 = s_ ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s2];
  };
  const parse = (str) => {
    if (!str) return null;
    const n = (str.match(/-?[\d.]+/g) || []).map(Number);
    if (n.length < 3) return null;
    if (str.startsWith("oklab")) {
      const m = /\/\s*([\d.]+)/.exec(str);
      return { lin: oklabLin(n[0], n[1], n[2]), a: m ? Number(m[1]) : 1 };
    }
    if (str.startsWith("color(")) return { lin: [n[0], n[1], n[2]].map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))), a: n[3] ?? 1 };
    if (str.startsWith("rgb")) return { lin: [n[0], n[1], n[2]].map(srgbLin), a: n[3] ?? 1 };
    return null;
  };
  const lum = (lin) => Math.max(0, 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]);
  const over = (fg, fa, bg) => fg.map((c, i) => c * fa + bg[i] * (1 - fa));
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };

  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.85) return c.lin;
      n = n.parentElement;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    return body ? body.lin : [1, 1, 1];
  };

  const out = [], seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
    if (!text) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.1) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;

    const isSvg = el.ownerSVGElement != null;
    const fgc = parse(isSvg ? s.fill : s.color);
    if (!fgc) continue;
    let bg = bgOf(el);
    if (isSvg) {
      const g = el.closest("g[class]");
      const shape = g && g.querySelector("path, rect, ellipse, circle");
      if (shape) { const f = parse(getComputedStyle(shape).fill); if (f && f.a > 0.85) bg = f.lin; }
    }
    const fg = fgc.a < 1 ? over(fgc.lin, fgc.a, bg) : fgc.lin;

    const px = parseFloat(s.fontSize);
    const large = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    const key = el.className + "|" + text.slice(0, 24);
    if (seen.has(key)) continue;
    seen.add(key);
    if (got < need) {
      out.push({ sel: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : ""),
                 text: text.slice(0, 30), px: px.toFixed(0), got: got.toFixed(2), need });
    }
  }
  return out.sort((a, b) => a.got - b.got);
})()
