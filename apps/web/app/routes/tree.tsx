import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import type { Route } from "./+types/tree";
import { withDirectus } from "~/lib/directus.server";
import { loadTree, type TreeRow } from "~/lib/queries.server";
import { DEMO, snapshot } from "~/lib/demo.server";
import {
  buildGraph, layoutPedigree, layoutFan, layoutCanopy, layoutDescendants, kinTest, lifespan, BOX_W, BOX_H,
  type Person, type TreeData,
} from "~/lib/tree";
import { Chart, type ChartHandle, type Rect } from "~/components/Chart";
import { Boxes, Fan, Canopy, Families, sexPath } from "~/components/Layouts";
import { ThemePicker, useOrnate } from "~/components/Theme";
import { IS_DEMO } from "~/lib/demo";
import type { PersonDetail } from "./person";

/* ── loading ───────────────────────────────────────────────────────── */

export function meta({ data }: Route.MetaArgs) {
  const name = (data as { tree?: TreeRow } | undefined)?.tree?.name;
  return [{ title: name ? `${name} · Stemma` : "Stemma" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const slug = params.slug;
  if (DEMO) {
    const frozen = (await snapshot()).tree[slug];
    if (!frozen) throw new Response("Not found", { status: 404 });
    return new Response(JSON.stringify(frozen), { headers: { "content-type": "application/json" } });
  }
  const { result, setCookie } = await withDirectus(request, (get) => loadTree(get, slug));
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json", ...(setCookie ? { "Set-Cookie": setCookie } : {}) },
  });
}

/* ── the view ──────────────────────────────────────────────────────── */

/** Whoever has the most generations above them — the richest pedigree. */
function deepest(graph: ReturnType<typeof buildGraph>, persons: Person[]): string | null {
  let best: string | null = null, bestDepth = -1;
  for (const p of persons) {
    const seen = new Set<string>();
    let front = [p.id], d = 0;
    while (front.length && d < 40) {
      const next: string[] = [];
      for (const id of front) {
        for (const e of graph.parentsOf.get(id) ?? []) {
          if (seen.has(e.parent)) continue;
          seen.add(e.parent); next.push(e.parent);
        }
      }
      if (!next.length) break;
      front = next; d++;
    }
    if (d > bestDepth) { bestDepth = d; best = p.id; }
  }
  return best;
}

type Mode = "pedigree" | "fan" | "canopy" | "descendants";
const MODES: Array<{ id: Mode; label: string; key: string }> = [
  { id: "pedigree", label: "Pedigree", key: "1" },
  { id: "fan", label: "Fan", key: "2" },
  { id: "canopy", label: "Tree", key: "3" },
  { id: "descendants", label: "Descendants", key: "4" },
];

export default function TreeView({ loaderData }: Route.ComponentProps) {
  const { tree, data } = loaderData as { tree: TreeRow; data: TreeData };
  const graph = useMemo(() => buildGraph(data), [data]);

  // Where to open, and in which layout.
  //
  // A pedigree of somebody with no recorded parents is one lonely box,
  // which is a poor first impression and, worse, looks like the app is
  // broken. So the opening view follows the data: the tree's home person
  // if it has one, otherwise whoever sits deepest in it — and the layout
  // starts on descendants when that person has no ancestors to draw.
  const opening = useMemo(() => {
    const id = data.homePersonId && graph.byId.has(data.homePersonId)
      ? data.homePersonId
      : deepest(graph, data.persons);
    const hasAncestors = (graph.parentsOf.get(id ?? "") ?? []).length > 0;
    return { id: id ?? "", mode: (hasAncestors ? "pedigree" : "descendants") as Mode };
  }, [graph, data]);

  const [mode, setMode] = useState<Mode>(opening.mode);
  const [rootId, setRootId] = useState(opening.id);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [depth, setDepth] = useState(5);
  const maxDepth = 14;
  const effectiveDepth = Math.min(depth, maxDepth);
  const [scale, setScale] = useState(1);
  const [viewport, setViewport] = useState<Rect | null>(null);
  const chart = useRef<ChartHandle>(null);
  const ornate = useOrnate();

  const isKin = useMemo(() => kinTest(graph), [graph]);
  const boxes = useMemo(
    () => (mode === "pedigree" ? layoutPedigree(graph, rootId, effectiveDepth) : null),
    [graph, rootId, mode, effectiveDepth]);
  // Descendants are laid out as families, so the people who married in
  // are on the chart rather than implied.
  const families = useMemo(
    () => (mode === "descendants" ? layoutDescendants(graph, rootId, effectiveDepth, isKin) : null),
    [graph, rootId, mode, effectiveDepth, isKin]);
  const fan = useMemo(() => (mode === "fan" ? layoutFan(graph, rootId, effectiveDepth) : null),
    [graph, rootId, mode, effectiveDepth]);
  const canopy = useMemo(() => (mode === "canopy" ? layoutCanopy(graph, rootId, effectiveDepth) : null),
    [graph, rootId, mode, effectiveDepth]);

  /*
   * Draw what is on screen.
   *
   * A twelve-generation pedigree is 4095 boxes and about 6% of them are
   * ever visible; handing the browser the other 94% costs a re-raster on
   * every zoom for nothing. The rectangle already has most of a viewport
   * of padding around it, so this changes only when the view arrives
   * somewhere new — not while it is moving.
   *
   * The fan needs it too — it measured p95 583ms at four thousand wedges,
   * which the first reading of "p50 16.7ms" hid. Its wedges carry their
   * own bounds because a sector's extent is not its corners.
   */
  const drawn = useMemo(() => {
    if (!boxes) return null;
    if (!viewport) return boxes;
    const vx = viewport.x, vy = viewport.y, vr = vx + viewport.w, vb = vy + viewport.h;
    const near = (n: { x: number; y: number }) =>
      n.x + BOX_W >= vx && n.x <= vr && n.y + BOX_H >= vy && n.y <= vb;
    const nodes = boxes.nodes.filter(near);
    // A link is kept when either end is near: a line into an off-screen
    // parent still has to be drawn, or the chart frays at the edges.
    const links = boxes.links.filter((l) => near(l.from) || near(l.to));
    return { ...boxes, nodes, links };
  }, [boxes, viewport]);

  /*
   * The fan needs level-of-detail as well as culling, and it is the more
   * important of the two.
   *
   * Culling cannot help a fan framed to fit: every wedge really is on
   * screen. What is *not* true is that they are worth drawing — the
   * twelfth ring of a full pedigree is two thousand wedges sharing 4400
   * units of arc, about one screen pixel each at that zoom. Dropping
   * anything under a pixel and a half costs nothing visible and is the
   * difference between 933ms frames and 17ms ones. Zoom in and they come
   * back, because the threshold is in screen pixels, not content units.
   */
  const fanDrawn = useMemo(() => {
    if (!fan) return null;
    if (!viewport) return fan.nodes;
    const vx = viewport.x + fan.bounds.minX, vy = viewport.y + fan.bounds.minY;
    const vr = vx + viewport.w, vb = vy + viewport.h;
    const floor = 1.5 / viewport.k;
    return fan.nodes.filter((n) => {
      if (n.depth > 0 && (n.a1 - n.a0) * n.r1 < floor) return false;
      return n.bx + n.bw >= vx && n.bx <= vr && n.by + n.bh >= vy && n.by <= vb;
    });
  }, [fan, viewport]);

  const size = fan ? { w: fan.bounds.width, h: fan.bounds.height }
    : canopy ? { w: canopy.width, h: canopy.height }
    : families ? { w: families.width, h: families.height }
    : { w: boxes?.width ?? 0, h: boxes?.height ?? 0 };

  useEffect(() => { setViewport(null); }, [mode, rootId, effectiveDepth]);

  const pick = useCallback((id: string) => setFocusId(id), []);
  const reroot = useCallback((id: string) => { setRootId(id); setFocusId(id); }, []);

  // Keyboard: layouts, fit, search, dismiss. Cheap to add, and the
  // difference between a demo and something somebody uses all evening.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const m = MODES.find((x) => x.key === e.key);
      if (m) { setMode(m.id); return; }
      if (e.key === "f") chart.current?.fit();
      else if (e.key === "Escape") setFocusId(null);
      else if (e.key === "+" || e.key === "=") chart.current?.zoomBy(1.3);
      else if (e.key === "-") chart.current?.zoomBy(1 / 1.3);
      else if (e.key === "/") { e.preventDefault(); document.getElementById("tree-search")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rootPerson = graph.byId.get(rootId);
  const laidOut = fan ? fan.nodes.length : canopy ? canopy.nodes.length
    : families ? families.units.length : (boxes?.nodes.length ?? 0);

  return (
    <div className="shell">
      <header className="bar">
        <Link className="mark" to="/">Stemma <span>· {tree.name}</span></Link>
        <div className="segmented" role="group" aria-label="Layout">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}
                    title={`${m.label}  (${m.key})`}>
              {m.label}
            </button>
          ))}
        </div>
        <Search persons={data.persons} onPick={reroot} />
        <div className="spacer" />
        <ThemePicker />
        {!IS_DEMO && (
          <Form method="post" action="/logout"><button className="btn quiet" type="submit">Sign out</button></Form>
        )}
      </header>

      <div className="canvas">
        <Chart ref={chart} contentWidth={size.w} contentHeight={size.h}
               fitKey={`${mode}:${rootId}:${effectiveDepth}`} onViewChange={setScale}
               onViewport={mode === "pedigree" || mode === "fan" ? setViewport : undefined}>
          {fan ? (
            <g transform={`translate(${-fan.bounds.minX},${-fan.bounds.minY})`}>
              <Fan nodes={fanDrawn ?? fan.nodes} rootId={rootId} focusId={focusId}
                   minRoom={viewport ? 34 / viewport.k : 0} onPick={pick} />
            </g>
          ) : families ? (
            <Families units={families.units} links={families.links} rootId={rootId} focusId={focusId}
                      ornate={ornate} adopted={graph.adopted} onPick={pick} />
          ) : canopy ? (
            <Canopy nodes={canopy.nodes} branches={canopy.branches}
                    trunkX={Number(canopy.trunk) || canopy.width / 2} baseY={canopy.height}
                    rootId={rootId} focusId={focusId} graph={graph} onPick={pick} />
          ) : drawn ? (
            <Boxes nodes={drawn.nodes} links={drawn.links}
                   rootId={rootId} focusId={focusId} ornate={ornate} adopted={graph.adopted} onPick={pick} />
          ) : null}
        </Chart>

        <Legend mode={mode} />

        <div className="depth">
          <label htmlFor="gens">Generations</label>
          <input id="gens" type="range" min={2} max={maxDepth} value={effectiveDepth}
                 onChange={(e) => setDepth(Number(e.target.value))} />
          <output htmlFor="gens">{effectiveDepth}</output>
          {fan?.capped && (
            <span className="capped" title="Further rings would be thinner than their own outline, so they are not drawn">
              showing {fan.shownDepth}
            </span>
          )}
        </div>

        <div className="controls">
          <div className="zoom-readout" aria-live="off">{Math.round(scale * 100)}%</div>
          <div className="group">
            <button type="button" onClick={() => chart.current?.zoomBy(1.35)} aria-label="Zoom in" title="Zoom in  (+)">+</button>
            <button type="button" onClick={() => chart.current?.zoomBy(1 / 1.35)} aria-label="Zoom out" title="Zoom out  (−)">−</button>
            <button type="button" onClick={() => chart.current?.fit()} aria-label="Fit to view" title="Fit to view  (f)">⤢</button>
          </div>
        </div>

        {focusId && (
          <PersonPanel slug={tree.slug} personId={focusId} graph={graph}
                       isRoot={focusId === rootId} onClose={() => setFocusId(null)}
                       onPick={pick} onReroot={reroot} />
        )}

        {!rootPerson ? (
          <div className="centred">
            <div>
              <h1>Nothing to draw</h1>
              <p style={{ color: "var(--ink-faint)" }}>This tree has no people in it yet.</p>
            </div>
          </div>
        ) : laidOut <= 1 ? (
          // A layout with only its root in it is correct and looks
          // broken. Saying which direction is empty, and offering the
          // one that is not, is the difference between "no data" and
          // "this app does not work".
          <Nowhere person={rootPerson} mode={mode} graph={graph} persons={data.persons}
                   onMode={setMode} onRoot={reroot} />
        ) : null}
      </div>
    </div>
  );
}

/* ── nothing to draw ───────────────────────────────────────────────── */

function Nowhere({
  person, mode, graph, persons, onMode, onRoot,
}: {
  person: Person; mode: Mode; graph: ReturnType<typeof buildGraph>; persons: Person[];
  onMode: (m: Mode) => void; onRoot: (id: string) => void;
}) {
  const wanted = mode === "descendants" ? "children" : "parents";
  const other: Mode = mode === "descendants" ? "pedigree" : "descendants";
  const otherHas = mode === "descendants"
    ? (graph.parentsOf.get(person.id) ?? []).length > 0
    : (graph.childrenOf.get(person.id) ?? []).length > 0;

  // Somebody in this tree for whom the current layout is not empty.
  const suggestion = useMemo(() => {
    const has = mode === "descendants" ? graph.childrenOf : graph.parentsOf;
    let best: Person | null = null, most = 0;
    for (const p of persons) {
      const n = (has.get(p.id) ?? []).length;
      if (n > most) { most = n; best = p; }
    }
    return best;
  }, [graph, persons, mode]);

  return (
    <div className="nowhere">
      <p>
        <strong>{person.display_name ?? "This person"}</strong> has no {wanted} recorded,
        so there is nothing for this chart to draw.
      </p>
      <div className="row">
        {otherHas && (
          <button className="btn" type="button" onClick={() => onMode(other)}>
            Show their {other === "pedigree" ? "ancestors" : "descendants"}
          </button>
        )}
        {suggestion && suggestion.id !== person.id && (
          <button className="btn" type="button" onClick={() => onRoot(suggestion.id)}>
            Centre on {suggestion.display_name}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── search ────────────────────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

function Search({ persons, onPick }: { persons: Person[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // Accent-blind, because "Wisniewska" must find "Wiśniewska" — the same
  // reason the database indexes an unaccented form.
  const index = useMemo(() => persons.map((p) => ({ p, hay: norm(p.display_name ?? "") })), [persons]);
  const hits = useMemo(() => {
    const needle = norm(q.trim());
    if (needle.length < 2) return [];
    return index.filter((x) => x.hay.includes(needle)).slice(0, 40).map((x) => x.p);
  }, [index, q]);

  return (
    <div className="search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input id="tree-search" type="search" placeholder="Search names  /" value={q} autoComplete="off"
             onChange={(e) => { setQ(e.target.value); setOpen(true); }}
             onFocus={() => setOpen(true)} aria-label="Search people in this tree" />
      {open && q.trim().length >= 2 && (
        <ol>
          {hits.length === 0 && <li className="none">No one by that name.</li>}
          {hits.map((p) => (
            <li key={p.id}>
              {/* Focus leaves the field on selection. Keeping it there
                  meant every keyboard shortcut silently stopped working
                  after a search, because the handler ignores keys typed
                  into an input. */}
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        onPick(p.id); setOpen(false); setQ("");
                        (e.currentTarget.closest(".search")?.querySelector("input") as HTMLInputElement | null)?.blur();
                      }}>
                <span className="s-name">{p.display_name ?? "—"}</span>
                <span className="s-years">{lifespan(p)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ── legend ────────────────────────────────────────────────────────── */

function Legend({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const sym = (d: string, extra?: React.ReactNode) => (
    <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">
      <path className="symbol" d={d} />{extra}
    </svg>
  );
  return (
    <div className={`legend${open ? " open" : ""}`}>
      <button type="button" className="legend-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Key {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="legend-body">
          {/*
            * Not invented: the NSGC standardized pedigree nomenclature.
            * Saying so matters — a genealogist or a genetic counsellor
            * already reads these, and anyone else can look them up.
            */}
          <div className="legend-group">
            <div className="row">{sym(sexPath("male", 7))} male</div>
            <div className="row">{sym(sexPath("female", 7))} female</div>
            <div className="row">{sym(sexPath("intersex", 7))} intersex</div>
            <div className="row">
              {sym(sexPath("unknown", 7), <text className="sex-unknown" textAnchor="middle" y="3" fontSize="9">?</text>)}
              sex not recorded
            </div>
            <div className="row">
              {sym(sexPath("female", 7), <line className="deceased" x1="-9" y1="9" x2="9" y2="-9" />)}
              deceased
            </div>
            <div className="row">
              {sym(sexPath("male", 6), <g className="brackets">
                <path d="M-9,-5 L-11,-5 L-11,5 L-9,5" /><path d="M9,-5 L11,-5 L11,5 L9,5" /></g>)}
              adopted
            </div>
          </div>
          <div className="legend-group">
            <div className="row">
              <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--link)" strokeWidth="1.5" /></svg>
              birth parent
            </div>
            <div className="row">
              <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--link)" strokeWidth="1.5" strokeDasharray="6 4" /></svg>
              adoptive parent
            </div>
            <div className="row">
              <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--link)" strokeWidth="1.5" strokeDasharray="2 5" /></svg>
              step · foster · guardian
            </div>
          </div>
          {mode === "fan" && <div className="legend-note">Rings are generations; colour fades into the past.</div>}
          {mode === "canopy" && <div className="legend-note">Colour marks which line you descend through.</div>}
          <div className="legend-note src">Symbols follow the NSGC standardized pedigree nomenclature.</div>
        </div>
      )}
    </div>
  );
}

/* ── the person panel ──────────────────────────────────────────────── */

const LINEAGE_WORD: Record<string, string> = {
  birth: "", adoptive: "adoptive", step: "step", foster: "foster",
  guardian: "guardian", donor: "donor", surrogate: "surrogate", sealing: "sealing", other: "other",
};

function PersonPanel({
  slug, personId, graph, isRoot, onClose, onPick, onReroot,
}: {
  slug: string; personId: string; graph: ReturnType<typeof buildGraph>;
  isRoot: boolean; onClose: () => void; onPick: (id: string) => void; onReroot: (id: string) => void;
}) {
  const fetcher = useFetcher<PersonDetail>();
  const load = fetcher.load;
  useEffect(() => { load(`/${slug}/p/${personId}`); }, [load, slug, personId]);

  const person = graph.byId.get(personId);
  const detail = fetcher.data;
  if (!person) return null;

  const parents = (graph.parentsOf.get(personId) ?? []);
  const children = (graph.childrenOf.get(personId) ?? []);
  const partners = (graph.partnersOf.get(personId) ?? []);

  const Rel = ({ id, note }: { id: string; note?: string }) => {
    const p = graph.byId.get(id);
    if (!p) return null;
    return (
      <li className="rel">
        <button type="button" onClick={() => onPick(id)}>{p.display_name ?? "—"}</button>
        {note && <span className="tag">{note}</span>}
        <span style={{ color: "var(--ink-faint)", fontSize: 13 }}>{lifespan(p)}</span>
      </li>
    );
  };

  return (
    <aside className="panel" aria-label={`Details for ${person.display_name ?? "this person"}`}>
      <button className="btn quiet close" onClick={onClose} aria-label="Close">✕</button>
      <div>
        <h2>{person.display_name ?? "Unnamed"}</h2>
        <div className="years">{lifespan(person) || "no dates recorded"}</div>
      </div>

      {!isRoot && (
        <button className="btn root-btn" type="button" onClick={() => onReroot(personId)}>
          Centre the chart here
        </button>
      )}

      {person.is_living && (
        <p className="living">
          Recorded as living. Nothing about this person is visible to anyone outside the tree —
          not their name, not their dates, and not the lines that connect them.
        </p>
      )}

      {detail?.names && detail.names.length > 1 && (
        <section>
          <h3>Names</h3>
          <ul>
            {detail.names.map((n) => (
              <li key={n.id} className="rel">
                <span>{[n.given, n.particle, n.surname, n.patronymic].filter(Boolean).join(" ") || n.nickname || "—"}</span>
                <span className="tag">{n.type}</span>
                {n.script_original && <span style={{ color: "var(--ink-faint)" }}>{n.script_original}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(parents.length > 0 || children.length > 0 || partners.length > 0) && (
        <section>
          <h3>Family</h3>
          {parents.length > 0 && (
            <>
              <div className="muted">Parents</div>
              <ul>{parents.map((e) => <Rel key={`p${e.parent}${e.lineage}`} id={e.parent} note={LINEAGE_WORD[e.lineage] || undefined} />)}</ul>
            </>
          )}
          {partners.length > 0 && (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Partners</div>
              <ul>{partners.map((id) => <Rel key={`u${id}`} id={id} />)}</ul>
            </>
          )}
          {children.length > 0 && (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Children</div>
              <ul>{children.map((e) => <Rel key={`c${e.child}${e.lineage}`} id={e.child} note={LINEAGE_WORD[e.lineage] || undefined} />)}</ul>
            </>
          )}
        </section>
      )}

      <section>
        <h3>Events</h3>
        {fetcher.state === "loading" && !detail && <p className="muted">Loading…</p>}
        {detail && detail.events.length === 0 && <p className="muted">Nothing recorded yet.</p>}
        {detail?.events.map((e) => (
          <div className="event" key={e.id}>
            <span className="what">
              {e.type?.label ?? "Event"}
              {e.value ? <span style={{ fontWeight: 400 }}> — {e.value}</span> : null}
              {/* Of several assertions of one fact, the concluded one. */}
              {e.is_conclusion && <span className="tag" style={{ marginLeft: 6 }}>concluded</span>}
            </span>
            {/* The source's own words, never the parsed range. */}
            {e.date_original && <span className="when">{e.date_original}</span>}
            {(e.place?.name || e.place_original) && (
              <span className="where">{e.place_original ?? e.place?.name}</span>
            )}
          </div>
        ))}
      </section>

      {detail?.biography && (
        <section>
          <h3>Biography</h3>
          <p style={{ margin: 0, lineHeight: 1.6, fontSize: 14 }}>{detail.biography}</p>
        </section>
      )}

      {detail !== undefined && detail.citations > 0 && (
        <section>
          <h3>Evidence</h3>
          <p className="muted">
            {detail.citations} citation{detail.citations === 1 ? "" : "s"} recorded against this person.
          </p>
        </section>
      )}
    </aside>
  );
}
