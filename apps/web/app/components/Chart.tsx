/**
 * The pan-and-zoom surface.
 *
 * ── Why this is its own component, and why it holds no state ──────────
 *
 * Smoothness here is almost entirely about what does *not* happen. The
 * naive version keeps the zoom transform in React state, so every wheel
 * tick re-renders a few thousand nodes and the whole thing judders. This
 * one renders the chart once and lets d3-zoom write to the DOM directly:
 * the transform is a CSS transform on one wrapping `<g>`, set through a
 * ref, so React never hears about a zoom and nothing reconciles.
 *
 * ── Two things that were measured, not assumed ────────────────────────
 *
 * **`will-change: transform` made it fourteen times worse.** The usual
 * advice is to promote the layer up front so the first frame of a drag
 * has no hitch. On a `<g>` holding four thousand nodes it instead asks
 * Chrome to keep a texture the size of the whole drawing and re-raster
 * it on every scale change: p95 went from 33ms to 1133ms, which is a
 * visible one-second freeze mid-zoom. It is not here any more. The
 * general rule it came from is sound; it just does not survive a layer
 * this big.
 *
 * **Only about 6% of the nodes are ever on screen.** So `onViewport`
 * hands the visible rectangle back in content coordinates and the caller
 * renders what is inside it. The rectangle is padded by most of a
 * viewport in each direction and only reported when the view leaves that
 * padding, so an ordinary pan is still zero React renders — the cull
 * happens when you arrive somewhere new, not while you are moving.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, type ReactNode, type RefObject } from "react";
import { select } from "d3-selection";
// Imported for its side effect: d3-transition augments d3-selection's
// prototype with `.transition()`, which is what makes fit-to-view and
// centre-on glide rather than jump. Nothing here calls it by name.
import "d3-transition";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";

/** The area worth drawing, with the scale it was measured at. */
export type Rect = { x: number; y: number; w: number; h: number; k: number };

export type ChartHandle = {
  /** Frame the whole drawing, with a little air around it. */
  fit: (animate?: boolean) => void;
  /** Centre one point at the current scale, or at `scale` if given. */
  centreOn: (x: number, y: number, scale?: number, animate?: boolean) => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
};

type Props = {
  /** The drawing's own coordinate space. */
  contentWidth: number;
  contentHeight: number;
  /** Content is positioned in that space; the chart centres it for you. */
  children: ReactNode;
  ref?: RefObject<ChartHandle | null>;
  onViewChange?: (scale: number) => void;
  /** The area worth drawing, in content coordinates. See the note above. */
  onViewport?: (r: Rect) => void;
  /** Re-fit whenever this changes — a new layout, a new root person. */
  fitKey?: string;
  minScale?: number;
  maxScale?: number;
  className?: string;
};

export function Chart({
  contentWidth, contentHeight, children, ref,
  onViewChange, onViewport, fitKey = "", minScale = 0.06, maxScale = 4, className,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const behaviour = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const frame = useRef<number | null>(null);
  const lastScale = useRef(1);
  /** What the caller has been told to draw. Null until the first report. */
  const drawn = useRef<Rect | null>(null);

  /** Writes the transform. The one hot path in the app. */
  const paint = useCallback((t: ZoomTransform) => {
    const g = gRef.current, svg = svgRef.current;
    if (!g || !svg) return;
    g.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;

    const scaleMoved = Math.abs(t.k - lastScale.current) >= 0.001;
    if (scaleMoved) lastScale.current = t.k;

    // Has the view left the area the caller was told to draw?
    let escaped: Rect | null = null;
    if (onViewport) {
      const { width, height } = svg.getBoundingClientRect();
      const vis: Rect = { x: -t.x / t.k, y: -t.y / t.k, w: width / t.k, h: height / t.k, k: t.k };
      const d = drawn.current;
      // A big scale change matters even when the view stayed inside the
      // padded rect: what is too small to be worth drawing has changed.
      const sameDetail = d && Math.abs(Math.log2(d.k / t.k)) < 0.5;
      const inside = d && sameDetail && vis.x >= d.x && vis.y >= d.y
        && vis.x + vis.w <= d.x + d.w && vis.y + vis.h <= d.y + d.h;
      if (!inside) {
        const padX = vis.w * 0.7, padY = vis.h * 0.7;
        escaped = { x: vis.x - padX, y: vis.y - padY, w: vis.w + padX * 2, h: vis.h + padY * 2, k: t.k };
        drawn.current = escaped;
      }
    }

    if (!scaleMoved && !escaped) return;
    // Both notifications ride one animation frame: neither a zoom readout
    // nor a re-cull may make the zoom itself slower.
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const k = t.k, rect = escaped;
    frame.current = requestAnimationFrame(() => {
      if (scaleMoved) onViewChange?.(k);
      if (rect) onViewport?.(rect);
    });
  }, [onViewChange, onViewport]);

  useEffect(() => {
    const svg = svgRef.current;
    const g = gRef.current;
    if (!svg || !g) return;

    g.style.transformOrigin = "0 0";

    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([minScale, maxScale])
      // The default treats a trackpad's many small deltas the same as a
      // mouse wheel's few large ones, which makes a trackpad feel
      // sluggish and a mouse feel violent. Dividing the line-mode delta
      // and easing the pixel-mode one evens them out.
      .wheelDelta((event: WheelEvent) => {
        const mode = event.deltaMode;
        const px = mode === 1 ? event.deltaY * 16 : mode === 2 ? event.deltaY * 400 : event.deltaY;
        return -px * (event.ctrlKey ? 0.012 : 0.0022);
      })
      // Let a click on a node be a click. Without this, every mousedown
      // starts a drag and selecting a person becomes a game of nerves.
      .filter((event: Event) => {
        if ((event as MouseEvent).button != null && (event as MouseEvent).button !== 0) return false;
        if (event.type === "wheel") return true;
        const target = event.target as Element | null;
        return !target?.closest("[data-no-pan]");
      })
      .on("zoom", (event: { transform: ZoomTransform }) => paint(event.transform));

    behaviour.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    return () => {
      select(svg).on(".zoom", null);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [paint, minScale, maxScale]);

  const fit = useCallback((animate = true) => {
    const svg = svgRef.current, z = behaviour.current;
    if (!svg || !z || contentWidth <= 0 || contentHeight <= 0) return;
    const { width, height } = svg.getBoundingClientRect();
    if (!width || !height) return;
    const pad = 72;
    const k = Math.min((width - pad * 2) / contentWidth, (height - pad * 2) / contentHeight, 1.1);
    const scale = Math.max(minScale, Math.min(maxScale, k));
    const t = zoomIdentity
      .translate(width / 2 - (contentWidth * scale) / 2, height / 2 - (contentHeight * scale) / 2)
      .scale(scale);
    const sel = select(svg);
    if (animate) sel.transition().duration(480).call(z.transform, t);
    else sel.call(z.transform, t);
  }, [contentWidth, contentHeight, minScale, maxScale]);

  useImperativeHandle(ref, () => ({
    fit,
    centreOn(x, y, scale, animate = true) {
      const svg = svgRef.current, z = behaviour.current;
      if (!svg || !z) return;
      const { width, height } = svg.getBoundingClientRect();
      const k = scale ?? lastScale.current;
      const t = zoomIdentity.translate(width / 2 - x * k, height / 2 - y * k).scale(k);
      const sel = select(svg);
      if (animate) sel.transition().duration(520).call(z.transform, t);
      else sel.call(z.transform, t);
    },
    zoomBy(factor) {
      const svg = svgRef.current, z = behaviour.current;
      if (!svg || !z) return;
      select(svg).transition().duration(220).call(z.scaleBy, factor);
    },
    reset() { fit(true); },
  }), [fit]);

  // Re-frame on a new layout or a new root, and on resize.
  useEffect(() => {
    drawn.current = null;
    const id = requestAnimationFrame(() => fit(false));
    return () => cancelAnimationFrame(id);
  }, [fitKey, fit]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return; }
      fit(false);
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <svg ref={svgRef} className={className} role="application"
         aria-label="Family tree. Drag to pan, scroll to zoom."
         style={{ width: "100%", height: "100%", display: "block", cursor: "grab", touchAction: "none" }}>
      <g ref={gRef}>{children}</g>
    </svg>
  );
}
