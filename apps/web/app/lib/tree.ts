/**
 * The graph, and the three ways of laying it out.
 *
 * Shared by server and client: the loader fetches and normalises, the
 * components lay out. No d3 here beyond `d3-hierarchy`, and the layouts
 * are plain maths so they can be reasoned about and unit-tested without
 * a DOM.
 */
import { hierarchy, tree as d3tree, type HierarchyNode } from "d3-hierarchy";

/* ── what the loader hands us ──────────────────────────────────────── */

export type Person = {
  id: string;
  public_id: string | null;
  display_name: string | null;
  sort_name: string | null;
  sex_recorded: string | null;
  is_living: boolean;
  portrait?: string | null;
  multiple_birth?: string | null;
  /** Filled from the conclusion birth/death events. */
  born?: string | null;
  died?: string | null;
  birth_place?: string | null;
};

export type Edge = { parent: string; child: string; lineage: string; status: string };
export type Union = { id: string; person_a: string; person_b: string };

export type TreeData = {
  slug: string;
  name: string;
  persons: Person[];
  edges: Edge[];
  unions: Union[];
  homePersonId: string | null;
};

/** Ready-to-query form, built once per page. */
export type Graph = {
  byId: Map<string, Person>;
  parentsOf: Map<string, Edge[]>;
  childrenOf: Map<string, Edge[]>;
  partnersOf: Map<string, string[]>;
  roots: Person[];
  /** Ids of people who have at least one adoptive parent. */
  adopted: Set<string>;
};

export function buildGraph(data: TreeData): Graph {
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  const parentsOf = new Map<string, Edge[]>();
  const childrenOf = new Map<string, Edge[]>();
  for (const e of data.edges) {
    // A disproven edge stays on file and off the chart: the point of
    // keeping it is the reasoning, not the line.
    if (e.status === "disproven") continue;
    (parentsOf.get(e.child) ?? parentsOf.set(e.child, []).get(e.child)!).push(e);
    (childrenOf.get(e.parent) ?? childrenOf.set(e.parent, []).get(e.parent)!).push(e);
  }
  const partnersOf = new Map<string, string[]>();
  for (const u of data.unions) {
    (partnersOf.get(u.person_a) ?? partnersOf.set(u.person_a, []).get(u.person_a)!).push(u.person_b);
    (partnersOf.get(u.person_b) ?? partnersOf.set(u.person_b, []).get(u.person_b)!).push(u.person_a);
  }
  const roots = data.persons.filter((p) => !parentsOf.has(p.id));
  // The pedigree standard brackets an adopted person wherever they
  // appear, not just on the edge that adopted them.
  const adopted = new Set<string>();
  for (const e of data.edges) if (e.lineage === "adoptive" && e.status !== "disproven") adopted.add(e.child);
  return { byId, parentsOf, childrenOf, partnersOf, roots, adopted };
}

/* ── the node every layout produces ────────────────────────────────── */

/**
 * One box or wedge on screen.
 *
 * `personId` is not unique across nodes, and that is the point: under
 * pedigree collapse the same ancestor legitimately occupies two
 * positions of one chart. `key` distinguishes the positions; `personId`
 * says who is in them, so hovering one can highlight the other.
 */
export type LaidOut = {
  key: string;
  personId: string;
  person: Person;
  depth: number;
  lineage: string | null;
};

export type BoxNode = LaidOut & { x: number; y: number };
export type WedgeNode = LaidOut & {
  a0: number; a1: number; r0: number; r1: number;
  /** Axis-aligned bounds, for culling. See `sectorBounds`. */
  bx: number; by: number; bw: number; bh: number;
};

/* ── walking the graph ─────────────────────────────────────────────── */

type Walked = { id: string; key: string; lineage: string | null; kids: Walked[] };

/**
 * The ancestors of one person, as a tree of positions.
 *
 * A DAG walked into a tree duplicates shared nodes, which is exactly
 * what a pedigree chart is supposed to do. `path` guards the line of
 * descent, not the whole walk: a person may appear twice in different
 * branches (the cousins' shared grandparents) but must never appear
 * inside their own subtree, which would be a cycle the database already
 * forbids — belt and braces against bad data arriving another way.
 *
 * Upward only. Descendants are laid out by `layoutDescendants`, which
 * walks families rather than people so the spouses are on the chart.
 */
function walk(graph: Graph, rootId: string, maxDepth: number): Walked | null {
  const root = graph.byId.get(rootId);
  if (!root) return null;
  const edgesOf = graph.parentsOf;
  const otherEnd = (e: Edge) => e.parent;

  const step = (id: string, key: string, lineage: string | null, depth: number, path: Set<string>): Walked => {
    const node: Walked = { id, key, lineage, kids: [] };
    if (depth >= maxDepth) return node;
    const edges = edgesOf.get(id) ?? [];
    const ordered = [...edges].sort((a, b) => order(graph, otherEnd(a)) - order(graph, otherEnd(b)));
    for (const [i, e] of ordered.entries()) {
      const next = otherEnd(e);
      if (path.has(next)) continue;
      node.kids.push(step(next, `${key}/${i}:${next}`, e.lineage, depth + 1, new Set(path).add(next)));
    }
    return node;
  };
  return step(rootId, `r:${rootId}`, null, 0, new Set([rootId]));
}

/** Oldest first where dates allow it, so siblings read in birth order. */
function order(graph: Graph, id: string): number {
  const born = graph.byId.get(id)?.born;
  const y = born ? Number(born.slice(0, 4)) : NaN;
  return Number.isFinite(y) ? y : 9999;
}

/* ── layout 1 and 3: pedigree and descendants ──────────────────────── */

export const BOX_W = 188;
export const BOX_H = 60;

/**
 * The pedigree: ancestors above, subject at the foot.
 *
 * Conventionally a pedigree is printed sideways — subject at the left,
 * ancestors fanning right — and that is how this started. Vertical is
 * the better default: generations stack the way people picture a family
 * tree, reading downward is reading forward in time in both this and
 * the descendant chart, and a deep line scrolls rather than running off
 * the side of the page.
 */
export function layoutPedigree(
  graph: Graph,
  rootId: string,
  maxDepth: number,
): { nodes: BoxNode[]; links: Array<{ from: BoxNode; to: BoxNode; lineage: string | null }>; width: number; height: number } {
  const walked = walk(graph, rootId, maxDepth);
  if (!walked) return { nodes: [], links: [], width: 0, height: 0 };

  const h = hierarchy<Walked>(walked, (d) => d.kids);
  d3tree<Walked>().nodeSize([BOX_W + 30, BOX_H + 86])(h as HierarchyNode<Walked>);

  const placed = new Map<string, BoxNode>();
  const nodes: BoxNode[] = [];
  h.each((n) => {
    const person = graph.byId.get(n.data.id);
    if (!person) return;
    // d3 lays out breadth on x and depth on y.
    const node: BoxNode = {
      key: n.data.key, personId: n.data.id, person, depth: n.depth, lineage: n.data.lineage,
      x: (n as { x: number }).x,
      // Ancestors climb, so the depth axis is negated and the subject
      // ends up at the foot.
      y: -(n as { y: number }).y,
    };
    placed.set(node.key, node);
    nodes.push(node);
  });

  const links: Array<{ from: BoxNode; to: BoxNode; lineage: string | null }> = [];
  h.each((n) => {
    if (!n.parent) return;
    const from = placed.get(n.parent.data.key);
    const to = placed.get(n.data.key);
    if (from && to) links.push({ from, to, lineage: n.data.lineage });
  });

  const minX = Math.min(...nodes.map((n) => n.x), 0);
  const minY = Math.min(...nodes.map((n) => n.y), 0);
  for (const n of nodes) { n.x -= minX; n.y -= minY; }
  return {
    nodes, links,
    width: Math.max(...nodes.map((n) => n.x), 0) + BOX_W,
    height: Math.max(...nodes.map((n) => n.y), 0) + BOX_H,
  };
}

/* ── layout 2: the fan ─────────────────────────────────────────────── */

// A three-quarter fan. The classic forms are 180° and 360°; 270° keeps
// the root readable at the centre while giving the outer rings enough
// arc to hold a name, which a semicircle does not past four generations.
export const FAN_SWEEP = Math.PI * 1.5;
export const RING = 78;
export const HUB = 76;

/**
 * Ancestors in polar coordinates.
 *
 * A classic fan assumes two parents and hands each half of its child's
 * arc. This model does not: a person may have a birth mother, a birth
 * father and two adoptive parents, and all four are ordinary. So an
 * arc is divided by however many parents there are — one parent takes
 * the whole width, three take a third each — which degrades gracefully
 * and keeps every wedge adjacent to its child.
 *
 * The consequence worth knowing: a wedge's angular size is not a claim
 * about anything, it is just the space left by the branch below it.
 */
export type Bounds = { minX: number; minY: number; width: number; height: number };

/**
 * The bounding box of an annular sector.
 *
 * The four corners are not enough: a sector that crosses an axis bulges
 * past them, so a wedge spanning due north reaches y = -r1 at a point
 * that is not one of its corners. Every cardinal angle inside the sweep
 * therefore contributes a point too. Getting this wrong culls wedges
 * that are on screen, which shows as pieces of the fan flickering away
 * at the edges.
 */
function sectorBounds(r0: number, r1: number, a0: number, a1: number) {
  const xs: number[] = [], ys: number[] = [];
  for (const r of [r0, r1]) for (const a of [a0, a1]) { xs.push(Math.cos(a) * r); ys.push(Math.sin(a) * r); }
  for (let k = -4; k <= 4; k++) {
    const a = (k * Math.PI) / 2;
    if (a >= Math.min(a0, a1) && a <= Math.max(a0, a1)) { xs.push(Math.cos(a) * r1); ys.push(Math.sin(a) * r1); }
  }
  const bx = Math.min(...xs), by = Math.min(...ys);
  return { bx, by, bw: Math.max(...xs) - bx, bh: Math.max(...ys) - by };
}

/**
 * How many wedges the fan will draw before it stops adding rings.
 *
 * Measured, not guessed: a fan holds a flat 60fps to about 255 wedges and
 * degrades past it — 511 gives 100ms frames, 1023 gives 167ms. A depth
 * cap would be the obvious response and it is the wrong one, because it
 * punishes the common case to protect the rare one. A *full* pedigree
 * doubles every ring and hits the budget at seven; a real one, which is
 * mostly gaps by the fifth generation, gets its twelve rings and never
 * notices this number exists.
 */
const WEDGE_BUDGET = 300;

export function layoutFan(
  graph: Graph,
  rootId: string,
  maxDepth: number,
): { nodes: WedgeNode[]; radius: number; bounds: Bounds; shownDepth: number; capped: boolean } {
  const walked = walk(graph, rootId, maxDepth);
  if (!walked) return { nodes: [], radius: 0, bounds: { minX: 0, minY: 0, width: 0, height: 0 }, shownDepth: 0, capped: false };

  let nodes: WedgeNode[] = [];
  const start = -Math.PI / 2 - FAN_SWEEP / 2;

  const place = (n: Walked, depth: number, a0: number, a1: number): void => {
    const person = graph.byId.get(n.id);
    if (!person) return;
    const r0 = depth === 0 ? 0 : HUB + (depth - 1) * RING;
    const r1 = depth === 0 ? HUB : HUB + depth * RING;
    nodes.push({
      key: n.key, personId: n.id, person, depth, lineage: n.lineage,
      a0, a1, r0, r1,
      // The hub is drawn as a full disc, so its bounds are the disc's.
      ...(depth === 0
        ? { bx: -r1, by: -r1, bw: r1 * 2, bh: r1 * 2 }
        : sectorBounds(r0, r1, a0, a1)),
    });
    if (!n.kids.length) return;
    const each = (a1 - a0) / n.kids.length;
    for (const [i, kid] of n.kids.entries()) place(kid, depth + 1, a0 + i * each, a0 + (i + 1) * each);
  };
  place(walked, 0, start, start + FAN_SWEEP);

  // Spend the budget outward: keep whole rings, never part of one, so
  // the fan ends at a clean edge rather than with holes in it.
  const perDepth = new Map<number, number>();
  for (const n of nodes) perDepth.set(n.depth, (perDepth.get(n.depth) ?? 0) + 1);
  let shownDepth = 0, running = 0, capped = false;
  for (let d = 0; d <= maxDepth; d++) {
    const c = perDepth.get(d) ?? 0;
    // Out of ancestors is not the same as out of budget, and saying
    // "showing 3" to somebody whose tree only goes back three
    // generations reads as a limit that is not there.
    if (c === 0) break;
    if (d > 0 && running + c > WEDGE_BUDGET) { capped = true; break; }
    running += c; shownDepth = d;
  }
  if (capped) nodes = nodes.filter((n) => n.depth <= shownDepth);

  const maxRing = Math.max(...nodes.map((n) => n.r1), HUB);

  /*
   * The real extent, not the circumscribed circle.
   *
   * A 270° fan leaves a quarter of its bounding square empty at the
   * bottom, and framing by radius pushes the drawing visibly off-centre
   * to make room for nothing. Sampling the swept arc gives the box the
   * chart actually occupies.
   */
  let minX = -HUB, maxX = HUB, minY = -HUB, maxY = HUB;
  for (let i = 0; i <= 96; i++) {
    const a = start + (FAN_SWEEP * i) / 96;
    const x = Math.cos(a) * maxRing, y = Math.sin(a) * maxRing;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = 24;
  return {
    nodes, radius: maxRing, shownDepth, capped,
    bounds: { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 },
  };
}

/* ── labels ────────────────────────────────────────────────────────── */

/**
 * The years under a name.
 *
 * `date_original` is what the source said and is what a person's own
 * page shows. A chart has room for four characters, so this takes the
 * year off the parsed range instead — and says nothing at all rather
 * than guessing when there is no range, because a blank is honest and
 * "c. 1850" invented from nowhere is not.
 */
/* ── the canopy ────────────────────────────────────────────────────── */

export const MEDALLION = 58;

/**
 * The horizontal slot each medallion gets, and why it is not the
 * medallion's own width.
 *
 * The name is drawn under the portrait, centred, and a name is much
 * wider than a 58px disc — "Susannah Fennimore" is about 120px at 13px.
 * Spacing siblings by the disc alone ran their labels into each other,
 * so a couple read as "Albert AshcombElizabeth Callow". The slot is the
 * label's width, not the picture's.
 *
 * `CANOPY_LABEL` is the backstop for the name that is longer still: it
 * ellipsizes at render time, and the full name stays in the node's
 * `aria-label` and in the person panel, so nothing is lost — only
 * shortened where it would otherwise collide.
 */
export const CANOPY_SLOT = 148;
export const CANOPY_LABEL = 21;

/** Shorten to fit the slot, on a word boundary where one is close enough. */
export function fitLabel(name: string, max = CANOPY_LABEL): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max - 7 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
}

export type CanopyNode = LaidOut & {
  x: number; y: number; r: number;
  /** Which line from the root this hangs off: 0,1,2 tinted, -1 neutral. */
  branch: number;
};
export type Branch = { from: CanopyNode; to: CanopyNode; lineage: string | null; width: number };

/**
 * Ancestors as an actual tree: a trunk, boughs, and faces in the canopy.
 *
 * The other three layouts are diagrams. This one is a picture — the
 * arrangement a family would have painted on a wall, with the living
 * person at the root and the generations opening overhead. It is the
 * same walk as the pedigree; only the geometry and the drawing differ.
 *
 * Two things make it read as a tree rather than as a graph drawn
 * upwards. Generations are spaced *further* apart as they rise, because
 * a real canopy opens out rather than stacking evenly. And every bough
 * carries a width derived from how much of the tree hangs off it, so the
 * trunk is thick and the twigs are thin — which is what the eye actually
 * uses to tell a tree from a diagram.
 */
export function layoutCanopy(
  graph: Graph,
  rootId: string,
  maxDepth: number,
): { nodes: CanopyNode[]; branches: Branch[]; trunk: string; width: number; height: number } {
  const walked = walk(graph, rootId, maxDepth);
  if (!walked) return { nodes: [], branches: [], trunk: "", width: 0, height: 0 };

  const h = hierarchy<Walked>(walked, (d) => d.kids);
  d3tree<Walked>().nodeSize([CANOPY_SLOT, 1])(h as HierarchyNode<Walked>);

  // Rings open out as they rise. Even spacing reads as a flow chart.
  const deepest = Math.max(...h.descendants().map((n) => n.depth), 1);
  const rise = (d: number) => {
    let y = 0;
    for (let i = 0; i < d; i++) y += 116 + i * 26;
    return y;
  };
  const total = rise(deepest);

  // Which line from the root each node belongs to. Only three are
  // tinted: a fourth hue fails the normal-vision separation floor, so
  // the fourth line and beyond go neutral rather than get an invented
  // colour. See the palette note in app.css.
  const branchOf = new Map<string, number>();
  h.each((n) => {
    if (n.depth === 0) { branchOf.set(n.data.key, -1); return; }
    if (n.depth === 1) {
      const i = (n.parent?.children ?? []).indexOf(n);
      branchOf.set(n.data.key, i < 3 ? i : -1);
      return;
    }
    branchOf.set(n.data.key, branchOf.get(n.parent!.data.key) ?? -1);
  });

  const placed = new Map<string, CanopyNode>();
  const nodes: CanopyNode[] = [];
  h.each((n) => {
    const person = graph.byId.get(n.data.id);
    if (!person) return;
    const node: CanopyNode = {
      key: n.data.key, personId: n.data.id, person, depth: n.depth, lineage: n.data.lineage,
      branch: branchOf.get(n.data.key) ?? -1,
      x: (n as { x: number }).x,
      y: total - rise(n.depth),
      // The root is the biggest face; the canopy tapers with distance.
      r: (MEDALLION / 2) * (n.depth === 0 ? 1.18 : Math.max(0.62, 1 - n.depth * 0.07)),
    };
    placed.set(node.key, node);
    nodes.push(node);
  });

  // How much hangs off each bough, for its thickness.
  const weight = new Map<string, number>();
  h.eachAfter((n) => {
    const own = 1 + (n.children ?? []).reduce((a, c) => a + (weight.get(c.data.key) ?? 1), 0);
    weight.set(n.data.key, own);
  });
  const heaviest = Math.max(...weight.values(), 1);

  const branches: Branch[] = [];
  h.each((n) => {
    if (!n.parent) return;
    const from = placed.get(n.parent.data.key), to = placed.get(n.data.key);
    if (!from || !to) return;
    const w = weight.get(n.data.key) ?? 1;
    branches.push({ from, to, lineage: n.data.lineage, width: 3 + 13 * Math.sqrt(w / heaviest) });
  });

  const xs = nodes.map((n) => n.x);
  const minX = Math.min(...xs) - MEDALLION, maxX = Math.max(...xs) + MEDALLION;
  for (const n of nodes) n.x -= minX;
  const trunkRoot = placed.get(walked.key);
  return {
    nodes, branches,
    trunk: trunkRoot ? `${trunkRoot.x}` : "",
    width: maxX - minX,
    // Room under the root for the trunk to stand in.
    height: total + MEDALLION * 2 + 64,
  };
}

export function lifespan(p: Person): string {
  const y = (d?: string | null) => (d ? d.slice(0, 4) : "");
  const b = y(p.born), d = y(p.died);
  if (!b && !d) return p.is_living ? "living" : "";
  if (p.is_living) return b ? `b. ${b}` : "living";
  if (b && d) return `${b} – ${d}`;
  if (b) return `b. ${b}`;
  return `d. ${d}`;
}

export function initials(p: Person): string {
  const n = (p.display_name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")).toUpperCase();
}

/* ── descendants, with the people who married in ───────────────────── */

export const SPOUSE_GAP = 30;

export type Unit = {
  key: string;
  /** The person this unit descends from, then anyone they partnered. */
  members: BoxNode[];
  /** Already drawn elsewhere on this chart, so shown without its family. */
  repeat: boolean;
  /** Where a child's line leaves from: the middle of the union bar. */
  joinX: number;
  joinY: number;
  /** Union bars between adjacent members, and whether the pair are kin. */
  bars: Array<{ x1: number; x2: number; y: number; consanguineous: boolean }>;
};

/**
 * A descendant chart that shows who married in.
 *
 * The other layouts draw one person per node, which is right for
 * ancestors and wrong here: a descendant chart with no spouses is a list
 * of blood relatives, and the person who married into the family — who
 * is half of every couple in it — simply does not appear.
 *
 * So the unit of layout is the *couple*, not the person. Children hang
 * off the union bar between two people rather than off each parent
 * separately, which is both how a family tree is drawn and a quarter of
 * the lines.
 *
 * Note what is derived and not stored. GEDCOM makes a `FAM` record the
 * node and hangs people off it; this schema deliberately does not, for
 * all the reasons in the brief. But a *drawing* does need families, so
 * they are computed here from `couples` and `parentage` at render time —
 * the same argument as siblings, which are derived and never stored.
 */
export function layoutDescendants(
  graph: Graph,
  rootId: string,
  maxDepth: number,
  isKin: (a: string, b: string) => boolean,
): {
  units: Unit[]; nodes: BoxNode[];
  links: Array<{ from: Unit; to: BoxNode; lineage: string | null; x: number; y: number }>;
  width: number; height: number;
} {
  type UnitSpec = {
    key: string; ids: string[]; kids: UnitSpec[]; lineage: string | null; repeat: boolean;
    /** For each kid, which of this unit's members are its parents. */
    kidParents?: string[][];
  };

  /*
   * Draw each family once.
   *
   * When two people who both descend from the root marry each other —
   * cousins, which is the case this schema exists to handle — their
   * union sits in two lines of descent at once, and expanding both
   * duplicates the whole subtree below it. An ancestor chart *should*
   * repeat a person (that is pedigree collapse, and it is the truth);
   * a descendant chart repeating an entire branch is just noise.
   *
   * So a person is expanded the first time they are reached and shown
   * alone afterwards, marked, with a note that the family is drawn
   * elsewhere.
   */
  const expanded = new Set<string>();

  const build = (id: string, key: string, lineage: string | null, depth: number, path: Set<string>): UnitSpec => {
    if (expanded.has(id)) return { key, ids: [id], kids: [], lineage, repeat: true };
    expanded.add(id);
    // Partners who are not themselves on the path, so a couple is never
    // drawn twice in one line of descent.
    const partners = (graph.partnersOf.get(id) ?? []).filter((p) => !path.has(p));
    const ids = [id, ...partners];
    for (const p of partners) expanded.add(p);
    const spec: UnitSpec = { key, ids, kids: [], lineage, repeat: false };
    if (depth >= maxDepth) return spec;

    // Every child of anyone in the unit, once, oldest first.
    const seen = new Set<string>();
    const kids: Array<{ id: string; lineage: string }> = [];
    for (const m of ids) {
      for (const e of graph.childrenOf.get(m) ?? []) {
        if (seen.has(e.child) || path.has(e.child)) continue;
        seen.add(e.child);
        kids.push({ id: e.child, lineage: e.lineage });
      }
    }
    kids.sort((a, b) => order(graph, a.id) - order(graph, b.id));
    spec.kidParents = kids.map((k) =>
      (graph.parentsOf.get(k.id) ?? []).map((e) => e.parent).filter((pid) => ids.includes(pid)));
    for (const [i, k] of kids.entries()) {
      const next = new Set(path);
      for (const m of ids) next.add(m);
      next.add(k.id);
      spec.kids.push(build(k.id, `${key}/${i}:${k.id}`, k.lineage, depth + 1, next));
    }
    return spec;
  };

  const rootSpec = build(rootId, `r:${rootId}`, null, 0, new Set([rootId]));
  const widthOf = (u: UnitSpec) => u.ids.length * BOX_W + (u.ids.length - 1) * SPOUSE_GAP;

  const h = hierarchy<UnitSpec>(rootSpec, (d) => d.kids);
  // A unit is as wide as its couple, so the tidy layout reserves room
  // for the spouse rather than letting them overlap the next sibling.
  d3tree<UnitSpec>()
    .nodeSize([BOX_W + 30, BOX_H + 96])
    .separation((a, b) => {
      const need = (widthOf(a.data) + widthOf(b.data)) / 2 + 34;
      return need / (BOX_W + 30);
    })(h as HierarchyNode<UnitSpec>);

  const units: Unit[] = [];
  const nodes: BoxNode[] = [];
  const byKey = new Map<string, Unit>();

  h.each((n) => {
    const cx = (n as { x: number }).x, y = (n as { y: number }).y;
    const w = widthOf(n.data);
    let x = cx - w / 2;
    const members: BoxNode[] = [];
    for (const id of n.data.ids) {
      const person = graph.byId.get(id);
      if (!person) { x += BOX_W + SPOUSE_GAP; continue; }
      const node: BoxNode = {
        key: `${n.data.key}#${id}`, personId: id, person, depth: n.depth,
        lineage: id === n.data.ids[0] ? n.data.lineage : null, x, y,
      };
      members.push(node); nodes.push(node);
      x += BOX_W + SPOUSE_GAP;
    }
    const bars: Unit["bars"] = [];
    for (let i = 0; i + 1 < members.length; i++) {
      const a = members[i]!, b = members[i + 1]!;
      bars.push({ x1: a.x + BOX_W, x2: b.x, y: a.y + BOX_H / 2, consanguineous: isKin(a.personId, b.personId) });
    }
    const unit: Unit = {
      key: n.data.key, members, repeat: n.data.repeat,
      // Children leave from under the union, or from under a lone person.
      joinX: bars.length ? (bars[0]!.x1 + bars[0]!.x2) / 2 : cx,
      joinY: y + BOX_H,
      bars,
    };
    units.push(unit); byKey.set(unit.key, unit);
  });

  /*
   * Each child leaves from the union it actually belongs to.
   *
   * A man with two wives has two sets of children, and hanging all of
   * them off one point says they are half-siblings of nobody — the
   * chart would be asserting a family that did not exist. So the drop
   * point is the bar between *that child's* two parents, and a child of
   * only one member drops from under that person.
   */
  const links: Array<{ from: Unit; to: BoxNode; lineage: string | null; x: number; y: number }> = [];
  h.each((n) => {
    if (!n.parent) return;
    const from = byKey.get(n.parent.data.key);
    const to = byKey.get(n.data.key)?.members[0];
    if (!from || !to) return;
    const idx = (n.parent.children ?? []).indexOf(n);
    const parents = n.parent.data.kidParents?.[idx] ?? [];
    const at = from.members.map((m, i) => (parents.includes(m.personId) ? i : -1)).filter((i) => i >= 0);
    let x = from.joinX;
    if (at.length === 1) x = from.members[at[0]!]!.x + BOX_W / 2;
    else if (at.length >= 2) {
      const bar = from.bars[Math.min(...at)];
      if (bar) x = (bar.x1 + bar.x2) / 2;
    }
    links.push({ from, to, lineage: n.data.lineage, x, y: from.joinY });
  });

  const minX = Math.min(...nodes.map((n) => n.x), 0);
  for (const n of nodes) n.x -= minX;
  for (const u of units) { u.joinX -= minX; for (const b of u.bars) { b.x1 -= minX; b.x2 -= minX; } }
  for (const l of links) l.x -= minX;
  return {
    units, nodes, links,
    width: Math.max(...nodes.map((n) => n.x), 0) + BOX_W,
    height: Math.max(...nodes.map((n) => n.y), 0) + BOX_H,
  };
}

/**
 * Are these two also related by descent?
 *
 * A union between kin is drawn with a doubled line, which is the
 * pedigree standard's way of saying so — and it is the thing that
 * explains why an ancestor shows up twice further up the chart. The walk
 * is bounded because a tree is finite and the edges are acyclic.
 */
export function kinTest(graph: Graph): (a: string, b: string) => boolean {
  const cache = new Map<string, boolean>();
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>();
    let front = [id];
    for (let d = 0; d < 24 && front.length; d++) {
      const next: string[] = [];
      for (const cur of front) {
        for (const e of graph.parentsOf.get(cur) ?? []) {
          if (!DESCENT.has(e.lineage) || out.has(e.parent)) continue;
          out.add(e.parent); next.push(e.parent);
        }
      }
      front = next;
    }
    return out;
  };
  return (a, b) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const A = ancestors(a), B = ancestors(b);
    let shared = A.has(b) || B.has(a);
    if (!shared) for (const x of A) if (B.has(x)) { shared = true; break; }
    cache.set(key, shared);
    return shared;
  };
}

const DESCENT = new Set(["birth", "adoptive", "donor", "surrogate"]);
