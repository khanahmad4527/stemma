/**
 * The three drawings.
 *
 * All three are pure: given a laid-out set of nodes they return SVG and
 * nothing else — no state, no effects, no measurement. That is what lets
 * `Chart` render them once and never touch React again during a pan.
 *
 * Deliberately no drop shadows and no filters. Ten nodes with a blur
 * filter cost more per frame than a thousand hairline strokes, and an
 * archival look — paper, ink, rules — is both the faster thing to draw
 * and the right thing for a family record.
 */
import { memo } from "react";
import {
  BOX_W, BOX_H, HUB, lifespan, initials,
  type BoxNode, type WedgeNode, type CanopyNode, type Branch, type Unit, type Person,
} from "~/lib/tree";

/* ── shared bits ───────────────────────────────────────────────────── */

const DASH: Record<string, string> = {
  adoptive: "6 4", step: "2 5", foster: "2 5", guardian: "2 5", donor: "8 3 2 3", surrogate: "8 3 2 3",
};

/** A line's kind is its dash, so a chart prints legibly in black and white. */
const dashFor = (lineage: string | null): string | undefined => (lineage ? DASH[lineage] : undefined);

function Name({ p, width, size = 14 }: { p: Person; width: number; size?: number }) {
  const years = lifespan(p);
  return (
    <>
      <text className="node-name" x={width / 2} y={-2} textAnchor="middle" fontSize={size}>
        {p.display_name ?? "—"}
      </text>
      {years && (
        <text className="node-years" x={width / 2} y={15} textAnchor="middle" fontSize={size - 3}>
          {years}
        </text>
      )}
    </>
  );
}

/* ── the cartouche ─────────────────────────────────────────────────── */

/**
 * A chamfered octagon: the frame a name gets in the Tapestry theme.
 *
 * Eight sides rather than a rounded rectangle because a chamfer is what
 * gets embroidered — a curve in gold thread has to be stepped anyway, so
 * woven heraldry cuts corners instead of rounding them. It is also two
 * dozen bytes of path with no arcs in it, which keeps a thousand of them
 * cheap to raster.
 */
function octagon(w: number, h: number, c: number): string {
  return `M${c},0 L${w - c},0 L${w},${c} L${w},${h - c} L${w - c},${h} L${c},${h} L0,${h - c} L0,${c} Z`;
}

const diamond = (x: number, y: number, r: number): string =>
  `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`;

/**
 * The frame, drawn once per node.
 *
 * Plain in the archive themes — a rectangle is the right amount of
 * ceremony for a finding aid. In Tapestry it gains a second rule inside
 * the first, a lozenge at each of the four chamfers and a fleuron top
 * and bottom: the grammar of a woven cartouche, and about nine extra
 * path commands rather than a filter or an image.
 */
function Frame({ ornate, living }: { ornate: boolean; living: boolean }) {
  if (!ornate) return <rect width={BOX_W} height={BOX_H} rx={7} />;
  const c = 11, inset = 4.5;
  return (
    <>
      <path className="cartouche" d={octagon(BOX_W, BOX_H, c)} />
      <path className="cartouche-inner"
            d={octagon(BOX_W - inset * 2, BOX_H - inset * 2, c - inset)}
            transform={`translate(${inset},${inset})`} />
      <g className="flourish">
        <path d={diamond(c, c, 2.6)} />
        <path d={diamond(BOX_W - c, c, 2.6)} />
        <path d={diamond(c, BOX_H - c, 2.6)} />
        <path d={diamond(BOX_W - c, BOX_H - c, 2.6)} />
        {/* A pearl at the crown instead of a lozenge marks the living.
            They are the people the public filter hides, so the chart
            should say which they are without a legend. */}
        {living
          ? <circle className="pearl" cx={BOX_W / 2} cy={0} r={3.6} />
          : <path d={diamond(BOX_W / 2, 0, 3.4)} />}
        <path d={diamond(BOX_W / 2, BOX_H, 3.4)} />
      </g>
    </>
  );
}

/* ── boxes: pedigree and descendants ───────────────────────────────── */

type BoxProps = {
  nodes: BoxNode[];
  links: Array<{ from: BoxNode; to: BoxNode; lineage: string | null }>;
  rootId: string;
  focusId: string | null;
  ornate: boolean;
  /** Who carries adoption brackets. */
  adopted: Set<string>;
  onPick: (personId: string) => void;
};

/**
 * An elbow from a child up to a parent.
 *
 * Orthogonal rather than curved: a chart is read by following a line
 * from one person to another, and right angles are easier for the eye
 * to follow than a bundle of béziers that all bend the same way.
 */
function elbow(child: BoxNode, parent: BoxNode): string {
  const x1 = child.x + BOX_W / 2, x2 = parent.x + BOX_W / 2;
  const y1 = child.y, y2 = parent.y + BOX_H;
  const mid = y1 + (y2 - y1) / 2;
  return `M${x1},${y1} V${mid} H${x2} V${y2}`;
}

export const Boxes = memo(function Boxes({ nodes, links, rootId, focusId, ornate, adopted, onPick }: BoxProps) {
  return (
    <>
      <g className="links" fill="none">
        {links.map((l) => (
          <path key={`${l.from.key}->${l.to.key}`} d={elbow(l.from, l.to)}
                strokeDasharray={dashFor(l.lineage)} />
        ))}
      </g>
      <g className="nodes">
        {nodes.map((n) => {
          const isRoot = n.personId === rootId;
          const isFocus = n.personId === focusId;
          return (
            <g key={n.key} transform={`translate(${n.x},${n.y})`}
               className={`node${isRoot ? " is-root" : ""}${isFocus ? " is-focus" : ""}${n.person.is_living ? " is-living" : ""}`}
               data-no-pan tabIndex={0} role="button"
               aria-label={`${n.person.display_name ?? "Unnamed"}${lifespan(n.person) ? `, ${lifespan(n.person)}` : ""}`}
               onClick={() => onPick(n.personId)}
               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(n.personId); } }}>
              <Frame ornate={ornate} living={n.person.is_living} />
              <g className="glyph" transform={`translate(19,${BOX_H / 2})`}>
                <PersonSymbol person={n.person} r={8} adopted={adopted.has(n.personId)} />
              </g>
              <g transform={`translate(15,${BOX_H / 2})`}>
                <Name p={n.person} width={BOX_W} />
              </g>
              {n.person.is_living && !ornate && <circle className="living-dot" cx={BOX_W - 11} cy={11} r={3} />}
            </g>
          );
        })}
      </g>
    </>
  );
});

/* ── the fan ───────────────────────────────────────────────────────── */

const polar = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];

/**
 * An annular wedge.
 *
 * The hub is a disc, not a wedge. Drawing the root as a slice of its own
 * sweep gives a 270° pie with a notch cut out of it, which is what this
 * did at first and looked like a rendering bug rather than a person.
 */
function wedgePath(w: WedgeNode): string {
  const [x0, y0] = polar(w.r0, w.a0), [x1, y1] = polar(w.r1, w.a0);
  const [x2, y2] = polar(w.r1, w.a1), [x3, y3] = polar(w.r0, w.a1);
  const big = w.a1 - w.a0 > Math.PI ? 1 : 0;
  if (w.r0 === 0) {
    const r = w.r1;
    return `M${-r},0 A${r},${r} 0 1 1 ${r},0 A${r},${r} 0 1 1 ${-r},0 Z`;
  }
  return `M${x0},${y0} L${x1},${y1} A${w.r1},${w.r1} 0 ${big} 1 ${x2},${y2} L${x3},${y3} A${w.r0},${w.r0} 0 ${big} 0 ${x0},${y0} Z`;
}

/**
 * Where a wedge's label goes, and which way up.
 *
 * Three cases, and the rule is just "use the longer dimension":
 *
 *   hub     the root sits in a disc, so the name is centred and wrapped.
 *   arc     a wide, shallow wedge carries its name *along* the ring, on
 *           a `textPath`. Straight text tangent to the arc overflows the
 *           wedge at its ends, which is what collided the inner ring's
 *           names together; following the curve cannot.
 *   radial  a narrow, deep wedge reads outward from the centre.
 *
 * Text on a path runs upside down over the bottom of a circle, so the
 * arc is drawn anticlockwise when its midpoint is below the axis.
 */
type Placement =
  | { kind: "hub" }
  | { kind: "arc"; d: string; room: number }
  | { kind: "radial"; transform: string; room: number };

function placement(w: WedgeNode): Placement | null {
  if (w.depth === 0) return { kind: "hub" };
  const mid = (w.a0 + w.a1) / 2;
  const r = (w.r0 + w.r1) / 2;
  const arc = (w.a1 - w.a0) * r;
  const depth = w.r1 - w.r0;
  if (arc < 24 && depth < 30) return null;

  if (arc >= depth) {
    // Below the horizontal axis the text would hang upside down, so the
    // path is swept the other way and the glyphs ride the outside of it.
    const flip = Math.sin(mid) > 0;
    const [a0, a1] = flip ? [w.a1, w.a0] : [w.a0, w.a1];
    const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
    const big = Math.abs(w.a1 - w.a0) > Math.PI ? 1 : 0;
    return { kind: "arc", d: `M${x0},${y0} A${r},${r} 0 ${big} ${flip ? 0 : 1} ${x1},${y1}`, room: arc };
  }

  const deg = (mid * 180) / Math.PI;
  const upsideDown = deg > 90 || deg < -90;
  const [x, y] = polar(r, mid);
  return {
    kind: "radial",
    transform: `translate(${x},${y}) rotate(${deg + 90 + (upsideDown ? 180 : 0)})`,
    room: depth,
  };
}

/** How much name fits before it has to be cut. */
function clamp(name: string, room: number, size: number): string {
  const chars = Math.floor(room / (size * 0.52));
  if (name.length <= chars) return name;
  if (chars < 4) return "";
  return `${name.slice(0, chars - 1).trimEnd()}\u2026`;
}

/** The hub holds a name on one line and the years under it. */
function hubLines(name: string): [string, string | null] {
  if (name.length <= 15) return [name, null];
  const at = name.lastIndexOf(" ", Math.ceil(name.length / 2) + 4);
  if (at < 3) return [clamp(name, HUB * 1.7, 14), null];
  return [name.slice(0, at), name.slice(at + 1)];
}

export const Fan = memo(function Fan({
  nodes, rootId, focusId, minRoom, onPick,
}: {
  nodes: WedgeNode[]; rootId: string; focusId: string | null;
  /**
   * Below this much room, in content units, a wedge is drawn without a
   * label.
   *
   * Text on a path is the expensive thing in this chart — far more than
   * the wedge itself — and a nine-ring fan framed to fit was laying out
   * five hundred labels three pixels tall. They cost 150ms frames and
   * nobody could read one. The caller sets this from the current scale,
   * so they reappear on the way in.
   */
  minRoom: number;
  onPick: (id: string) => void;
}) {
  const shown = nodes.map((w) => {
    const p = placement(w);
    return { w, p: p && p.kind !== "hub" && p.room < minRoom ? null : p };
  });
  return (
    <g className="fan-wedges">
      <defs>
        {shown.map(({ w, p }) =>
          p?.kind === "arc" ? <path key={`d${w.key}`} id={`arc-${w.key}`} d={p.d} /> : null)}
      </defs>
      {shown.map(({ w, p }) => {
        const years = lifespan(w.person);
        const full = w.person.display_name ?? "\u2014";
        const isRoot = w.personId === rootId;
        const isFocus = w.personId === focusId;
        const size = w.depth === 0 ? 15 : 11.5;
        return (
          <g key={w.key}
             className={`wedge gen-${Math.min(w.depth, 9)}${isRoot ? " is-root" : ""}${isFocus ? " is-focus" : ""}${w.person.is_living ? " is-living" : ""}`}
             data-no-pan tabIndex={0} role="button"
             aria-label={`${full}${years ? `, ${years}` : ""}, generation ${w.depth}`}
             onClick={() => onPick(w.personId)}
             onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(w.personId); } }}>
            <path d={wedgePath(w)} />
            {p?.kind === "hub" && (() => {
              const [a, b] = hubLines(full);
              return (
                <g className="wedge-label" pointerEvents="none">
                  <text textAnchor="middle" y={b ? -6 : 0} fontSize={size}>{a}</text>
                  {b && <text textAnchor="middle" y={11} fontSize={size}>{b}</text>}
                  {years && <text textAnchor="middle" y={b ? 27 : 17} fontSize={10.5} className="wedge-years">{years}</text>}
                </g>
              );
            })()}
            {p?.kind === "arc" && (
              <g className="wedge-label" pointerEvents="none">
                <text fontSize={size} dy={years ? -1.5 : 3.5}>
                  <textPath href={`#arc-${w.key}`} startOffset="50%" textAnchor="middle">
                    {clamp(full, p.room, size)}
                  </textPath>
                </text>
                {years && (
                  <text fontSize={9.5} dy={10} className="wedge-years">
                    <textPath href={`#arc-${w.key}`} startOffset="50%" textAnchor="middle">{years}</textPath>
                  </text>
                )}
              </g>
            )}
            {p?.kind === "radial" && (
              <g transform={p.transform} className="wedge-label" pointerEvents="none">
                <text textAnchor="middle" y={3.5} fontSize={size}>{clamp(full, p.room, size)}</text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
});

/* ── the pedigree symbols ──────────────────────────────────────────── */

/**
 * Sex, death and adoption, drawn the way genetics draws them.
 *
 * These are not invented. They are the NSGC standardized pedigree
 * nomenclature (Bennett et al., 2022 revision): a square is male, a
 * circle female, a diamond a sex that is unknown or unrecorded; a
 * diagonal stroke means the person is dead; square brackets around the
 * symbol mean adopted, and the line to an adoptive parent is dashed
 * where a birth parent's is solid.
 *
 * Using the standard rather than something prettier buys three things.
 * A genealogist or a genetic counsellor can read the chart without a
 * legend. None of it is colour — so it survives a printer, a photocopier
 * and every kind of colour-blindness, which matters because the
 * alternative convention for sex is pink and blue, and that is both a
 * stereotype and invisible to the commonest CVD.
 *
 * `sex_recorded` is what a document recorded, never a claim about
 * identity — the column is named that way for the same reason.
 */
export const SEX_SHAPES: Record<string, string> = {
  male: "square", female: "circle", intersex: "diamond", unknown: "diamond",
};

export function sexPath(sex: string | null | undefined, r: number): string {
  switch (SEX_SHAPES[sex ?? "unknown"] ?? "diamond") {
    case "square": return `M${-r},${-r} H${r} V${r} H${-r} Z`;
    case "diamond": return `M0,${-r * 1.28} L${r * 1.28},0 L0,${r * 1.28} L${-r * 1.28},0 Z`;
    default: return `M${-r},0 a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
  }
}

/**
 * One person's symbol: the shape, the death stroke, the brackets.
 *
 * `children` is whatever goes inside — a portrait, initials, nothing.
 */
export function PersonSymbol({
  person, r, adopted, children,
}: { person: Person; r: number; adopted: boolean; children?: React.ReactNode }) {
  const shape = SEX_SHAPES[person.sex_recorded ?? "unknown"] ?? "diamond";
  const b = r * (shape === "diamond" ? 1.5 : 1.28);
  return (
    <>
      {/* Brackets first, so the symbol sits inside them. */}
      {adopted && (
        <g className="brackets">
          <path d={`M${-b},${-r * 0.72} L${-b - 5},${-r * 0.72} L${-b - 5},${r * 0.72} L${-b},${r * 0.72}`} />
          <path d={`M${b},${-r * 0.72} L${b + 5},${-r * 0.72} L${b + 5},${r * 0.72} L${b},${r * 0.72}`} />
        </g>
      )}
      <path className="symbol" d={sexPath(person.sex_recorded, r)} />
      {children}
      {/* Lower-left to upper-right, as the standard draws it — and kept
          inside the symbol's own corners. Overshooting looked like a
          strike-through of the name below it. */}
      {!person.is_living && (() => {
        const e = shape === "square" ? r * 1.12 : shape === "diamond" ? r * 1.0 : r * 0.78;
        return <line className="deceased" x1={-e} y1={e} x2={e} y2={-e} />;
      })()}
      {person.sex_recorded === "unknown" && (
        <text className="sex-unknown" textAnchor="middle" y={r * 0.38} fontSize={r * 0.95}>?</text>
      )}
    </>
  );
}

/* ── the canopy ────────────────────────────────────────────────────── */

/**
 * A tapered bough between two medallions.
 *
 * Two cubic curves and a cap, filled rather than stroked, so the limb
 * can be thick where it leaves the trunk and thin where it arrives. The
 * control points are vertical, which is what makes a branch leave its
 * parent going up and arrive at its child coming down — the shape a
 * bough actually makes, rather than a diagonal.
 */
function bough(b: Branch): string {
  const { from, to, width } = b;
  const w1 = width / 2, w2 = Math.max(1.6, width * 0.42) / 2;
  const dy = (from.y - to.y) * 0.46;
  return [
    `M${from.x - w1},${from.y}`,
    `C${from.x - w1},${from.y - dy} ${to.x - w2},${to.y + dy} ${to.x - w2},${to.y}`,
    `L${to.x + w2},${to.y}`,
    `C${to.x + w2},${to.y + dy} ${from.x + w1},${from.y - dy} ${from.x + w1},${from.y}`,
    "Z",
  ].join(" ");
}

/** A leaf, pointing along the bough it grows from. */
const LEAF = "M0,0 Q7,-6 15,0 Q7,6 0,0";

function leavesOn(b: Branch, seed: number): Array<{ x: number; y: number; a: number; s: number }> {
  const out: Array<{ x: number; y: number; a: number; s: number }> = [];
  // Deterministic: a chart that reshuffles its leaves on every re-render
  // shimmers, and re-renders happen whenever the panel opens.
  const rnd = (n: number) => { const x = Math.sin(seed * 97.3 + n * 41.7) * 43758.5453; return x - Math.floor(x); };
  const n = b.width > 9 ? 5 : 4;
  for (let i = 0; i < n; i++) {
    const t = 0.18 + (i + rnd(i) * 0.7) * (0.66 / n);
    const x = b.from.x + (b.to.x - b.from.x) * t;
    const y = b.from.y + (b.to.y - b.from.y) * t;
    const side = i % 2 === 0 ? 1 : -1;
    out.push({ x, y, a: side * (34 + rnd(i + 9) * 52), s: 0.78 + rnd(i + 3) * 0.55 });
  }
  return out;
}

export const Canopy = memo(function Canopy({
  nodes, branches, trunkX, baseY, rootId, focusId, graph, onPick,
}: {
  nodes: CanopyNode[]; branches: Branch[]; trunkX: number; baseY: number;
  rootId: string; focusId: string | null;
  graph: { adopted: Set<string> };
  onPick: (id: string) => void;
}) {
  const root = nodes.find((n) => n.depth === 0);
  return (
    <g className="canopy">
      {/* The trunk the whole thing stands on. */}
      {root && (
        <path className="trunk"
              d={`M${trunkX - 26},${baseY} C${trunkX - 20},${root.y + 70} ${trunkX - 15},${root.y + 40} ${trunkX - 13},${root.y}
                  L${trunkX + 13},${root.y} C${trunkX + 15},${root.y + 40} ${trunkX + 20},${root.y + 70} ${trunkX + 26},${baseY} Z`} />
      )}
      <g className="boughs">
        {branches.map((b) => (
          <path key={`${b.from.key}->${b.to.key}`} d={bough(b)}
                className={b.lineage && b.lineage !== "birth" ? `bough lineage-${b.lineage}` : "bough"} />
        ))}
      </g>
      <g className="leaves">
        {branches.flatMap((b, i) =>
          leavesOn(b, i).map((l, j) => (
            <path key={`${b.to.key}-l${j}`} d={LEAF}
                  transform={`translate(${l.x},${l.y}) rotate(${l.a}) scale(${l.s})`} />
          )))}
      </g>
      <g className="medallions">
        {nodes.map((n) => {
          const isRoot = n.personId === rootId;
          const isFocus = n.personId === focusId;
          const cls = [
            "medallion", `branch-${n.branch >= 0 ? n.branch : "n"}`,
            isRoot ? "is-root" : "", isFocus ? "is-focus" : "",
            n.person.is_living ? "is-living" : "",
          ].filter(Boolean).join(" ");
          const clip = `clip-${n.key.replace(/[^a-zA-Z0-9]/g, "")}`;
          return (
            <g key={n.key} transform={`translate(${n.x},${n.y})`} className={cls}
               data-no-pan tabIndex={0} role="button"
               aria-label={`${n.person.display_name ?? "Unnamed"}${lifespan(n.person) ? `, ${lifespan(n.person)}` : ""}`}
               onClick={() => onPick(n.personId)}
               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(n.personId); } }}>
              <PersonSymbol person={n.person} r={n.r} adopted={graph.adopted.has(n.personId)}>
                {n.person.portrait ? (
                  <>
                    <defs>
                      <clipPath id={clip}><path d={sexPath(n.person.sex_recorded, n.r - 2)} /></clipPath>
                    </defs>
                    <image clipPath={`url(#${clip})`} href={`/portrait/${n.person.portrait}`}
                           x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2}
                           preserveAspectRatio="xMidYMid slice" />
                  </>
                ) : n.person.sex_recorded !== "unknown" ? (
                  <text className="initials" textAnchor="middle" y={n.r * 0.32} fontSize={n.r * 0.84}>
                    {initials(n.person)}
                  </text>
                ) : null}
              </PersonSymbol>
              <text className="medallion-name" textAnchor="middle" y={n.r + 19} fontSize={13}>
                {n.person.display_name ?? "—"}
              </text>
              {lifespan(n.person) && (
                <text className="medallion-years" textAnchor="middle" y={n.r + 34} fontSize={11}>
                  {lifespan(n.person)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
});

/* ── descendants, with the people who married in ───────────────────── */

/**
 * A descendant chart drawn as families.
 *
 * Two things here that the single-person layouts cannot show. A union
 * bar joins the couple, so the person who married into the family is on
 * the chart rather than implied. And a doubled bar means the pair are
 * also related by descent — the pedigree standard's mark for
 * consanguinity, and the thing that explains why one ancestor turns up
 * twice further up.
 */
export const Families = memo(function Families({
  units, links, rootId, focusId, ornate, adopted, onPick,
}: {
  units: Unit[];
  links: Array<{ from: Unit; to: BoxNode; lineage: string | null; x: number; y: number }>;
  rootId: string; focusId: string | null; ornate: boolean;
  adopted: Set<string>;
  onPick: (id: string) => void;
}) {
  return (
    <>
      <g className="links" fill="none">
        {links.map((l) => {
          const y1 = l.y, y2 = l.to.y, mid = y1 + (y2 - y1) / 2;
          return (
            <path key={`${l.from.key}->${l.to.key}`}
                  d={`M${l.x},${y1} V${mid} H${l.to.x + BOX_W / 2} V${y2}`}
                  strokeDasharray={dashFor(l.lineage)} />
          );
        })}
      </g>
      <g className="unions" fill="none">
        {units.flatMap((u) =>
          u.bars.map((b, i) => (
            <g key={`${u.key}-b${i}`} className={b.consanguineous ? "union is-kin" : "union"}>
              {/* Doubled when the partners are also kin. */}
              {b.consanguineous ? (
                <>
                  <path d={`M${b.x1},${b.y - 2.5} H${b.x2}`} />
                  <path d={`M${b.x1},${b.y + 2.5} H${b.x2}`} />
                </>
              ) : (
                <path d={`M${b.x1},${b.y} H${b.x2}`} />
              )}
              {/* Each union drops its own stem toward its own children. */}
              <path d={`M${(b.x1 + b.x2) / 2},${b.y} V${u.joinY}`} />
            </g>
          )))}
      </g>
      <g className="nodes">
        {units.flatMap((u) =>
          u.members.map((n, i) => {
            const isRoot = n.personId === rootId;
            const isFocus = n.personId === focusId;
            // The first member descends from above; the rest married in.
            const married = i > 0;
            return (
              <g key={n.key} transform={`translate(${n.x},${n.y})`}
                 className={`node${isRoot ? " is-root" : ""}${isFocus ? " is-focus" : ""}${n.person.is_living ? " is-living" : ""}${married ? " married-in" : ""}${u.repeat ? " is-repeat" : ""}`}
                 data-no-pan tabIndex={0} role="button"
                 aria-label={`${n.person.display_name ?? "Unnamed"}${married ? ", married in" : ""}${u.repeat ? ", family shown elsewhere on this chart" : ""}${lifespan(n.person) ? `, ${lifespan(n.person)}` : ""}`}
                 onClick={() => onPick(n.personId)}
                 onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(n.personId); } }}>
                <Frame ornate={ornate} living={n.person.is_living} />
                <g className="glyph" transform={`translate(19,${BOX_H / 2})`}>
                  <PersonSymbol person={n.person} r={8} adopted={adopted.has(n.personId)} />
                </g>
                <g transform={`translate(15,${BOX_H / 2})`}>
                  <Name p={n.person} width={BOX_W} />
                </g>
                {n.person.is_living && !ornate && <circle className="living-dot" cx={BOX_W - 11} cy={11} r={3} />}
                {/* Their family is on the chart already, further up. */}
                {u.repeat && (
                  <text className="repeat-mark" x={BOX_W - 10} y={BOX_H - 8} textAnchor="end" fontSize={10}>
                    also above
                  </text>
                )}
              </g>
            );
          }))}
      </g>
    </>
  );
});
