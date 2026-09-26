import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import L from 'leaflet';
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Polygon as PcPolygon, Ring as PcRing } from 'polygon-clipping';
// polygon-clipping ships an ESM bundle with a single default export (an object
// of the boolean ops); its .d.ts declares named exports, so we take the default
// and destructure the two ops we use. MIT, ~small.
const { difference, union } = polygonClipping;
import type { Annotation, Label, ParcelShape, SegmentHit, SegmentResponse, Tool } from '../types';
import { overlayStyle, haloColor, haloWidthOffset, vertex as vtok, zoom as ztok } from '../tokens';

type Point = [number, number];

// Bright, high-contrast selection accent (matches design tokens
// vertex.selected.fill / semantic.accent). Used for the selected-shape
// highlight and the selection bounding-box indicator.
const SEL_COLOR = '#4C8DFF';
// Bright magic-draw accent, distinct from SEL_COLOR — used for the dashed
// hover-detect preview and its floating confidence badge.
const MAGIC_COLOR = '#5EEAD4';
// Debounce (ms) between the pointer settling and firing a hover-detect call.
const HOVER_DEBOUNCE_MS = 180;
// Container-px the pointer must travel between mousedown and mouseup for the
// gesture to count as a drag-scribble rather than a click (commit-hovered).
const MAGIC_DRAG_PX = 6;
// How close (in on-screen CSS px) a click must land to a shape's geometry to
// select it when the click doesn't land directly on the (interactive) shape.
// Generous so the tiny ~10px canopies and 2px rows are easy to grab on a
// trackpad/touch.
const CLICK_TOLERANCE_PX = 24;
// Padding (CSS px) around the selected shape's extent for the highlight box.
const SEL_BOX_PAD_PX = 6;
// Minimum radius (CSS px) of the *invisible* hit target around a vertex /
// midpoint handle. The visible dot keeps its token radius; the touch area is
// enlarged to this so points are easy to grab on a trackpad/touch.
const HANDLE_HIT_RADIUS_PX = 11;
// When cycling the primary through stacked candidates, treat two clicks as
// "the same spot" if they land within this many CSS px of each other.
const CLICK_SAME_SPOT_PX = 6;
// Radius (on-screen CSS px) of the eraser brush. The swept disc of this radius
// is SUBTRACTED from the shapes under it (region boolean), so brushing over part
// of a shape carves a notch/crop rather than deleting the whole shape. Tunable.
const ERASE_RADIUS_PX = 18;
// Number of sides used to approximate each brush position as a polygon for the
// boolean subtract. 16 is round enough at these radii without heavy geometry.
const ERASE_CIRCLE_SIDES = 16;
// Simplify tolerance (tile px) for each erased result ring, and the hard cap on
// vertices per ring, so boolean output stays light after many brush strokes.
const ERASE_SIMPLIFY_PX = 1;
const ERASE_MAX_VERTS = 80;
// Result polygon rings below this area (tile px²) are slivers from the boolean
// op and are dropped rather than kept as tiny annotations.
const ERASE_MIN_POLY_AREA = 4;
// Container-px the pointer must travel between mousedown and mouseup for a Draw
// gesture to count as a pan rather than a vertex-placing click (pan stays on in
// draw mode). Same idea as MAGIC_DRAG_PX.
const DRAW_DRAG_PX = 6;
// How close (on-screen CSS px) a Draw click must land to the first vertex to
// close a polygon (>= 3 pts) instead of adding another vertex.
const DRAW_CLOSE_PX = 12;

// --- Screen-space geometry helpers (all in container/CSS px) ---
interface Pt2 {
  x: number;
  y: number;
}

// Squared distance from point p to segment ab.
function distToSegmentSq(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx;
  const ey = p.y - cy;
  return ex * ex + ey * ey;
}

// Project point p onto segment ab. Returns the clamped parameter t (0..1) and
// the perpendicular distance — used by the Cut tool to find the split point.
function projectOnSegment(p: Pt2, a: Pt2, b: Pt2): { t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return { t, dist: Math.hypot(p.x - cx, p.y - cy) };
}

// Minimum distance (px) from p to a poly's edges. Closed polygons include the
// wrap-around edge; polylines only their consecutive segments.
function minDistToPoly(p: Pt2, poly: Pt2[], closed: boolean): number {
  if (poly.length === 0) return Infinity;
  if (poly.length === 1) {
    return Math.hypot(p.x - poly[0].x, p.y - poly[0].y);
  }
  let best = Infinity;
  const segCount = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d = distToSegmentSq(p, a, b);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Drop erased shapes that fell below their minimum vertex count (a polygon
// needs 3, a polyline 2 — matching deleteVertex) and return fresh point-array
// copies so React sees new references for the preview/commit.
function pruneErased(anns: Annotation[]): Annotation[] {
  return anns
    .filter((a) => a.points.length >= (a.shape_type === 'polyline' ? 2 : 3))
    .map((a) => ({ ...a, points: [...a.points] }));
}

// --- Region-subtract eraser geometry (all in tile-pixel space) ---
// One brush sample: a disc center (tile px) + its radius (tile px, so a mid-drag
// zoom change still maps the on-screen ERASE_RADIUS_PX correctly).
interface BrushSample {
  c: Point;
  r: number;
}

// Approximate a disc as a closed N-gon ring (tile px) for the boolean op.
function circleRing(cx: number, cy: number, r: number, sides: number): PcRing {
  const ring: PcRing = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  ring.push([ring[0][0], ring[0][1]]); // close
  return ring;
}

// Union of every brush sample into one MultiPolygon region (the swept area).
function buildBrushRegion(samples: BrushSample[]): MultiPolygon | null {
  if (samples.length === 0) return null;
  const polys: PcPolygon[] = samples.map((s) => [circleRing(s.c[0], s.c[1], s.r, ERASE_CIRCLE_SIDES)]);
  try {
    return union(polys[0], ...polys.slice(1));
  } catch {
    return null;
  }
}

// Shoelace area of a ring (absolute, tile px²). Ring may or may not be closed.
function ringArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(sum) / 2;
}

// Perpendicular distance from p to segment ab (tile px), for RDP simplify.
function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Ramer–Douglas–Peucker simplify of an open point list (tile px).
function rdp(points: Point[], eps: number): Point[] {
  if (points.length <= 2) return points.slice();
  let maxD = 0;
  let idx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

// Simplify + cap-vertex a closed polygon ring coming out of the boolean op.
// Input ring is closed (last == first, as polygon-clipping emits); returns an
// OPEN ring (no duplicate closing vertex) ready to store as annotation points.
function cleanRing(closedRing: PcRing): Point[] {
  // Drop the duplicate closing coord.
  let open: Point[] = closedRing.slice(0, -1).map((p) => [p[0], p[1]] as Point);
  if (open.length < 3) return open;
  // RDP on the closed loop: simplify with the first point pinned at both ends.
  const loop: Point[] = [...open, open[0]];
  let simplified = rdp(loop, ERASE_SIMPLIFY_PX);
  simplified = simplified.slice(0, -1); // reopen
  if (simplified.length >= 3) open = simplified;
  // Hard cap: uniformly decimate if still too dense.
  if (open.length > ERASE_MAX_VERTS) {
    const step = open.length / ERASE_MAX_VERTS;
    const capped: Point[] = [];
    for (let i = 0; i < ERASE_MAX_VERTS; i++) capped.push(open[Math.floor(i * step)]);
    open = capped;
  }
  return open;
}

// Is tile-space point covered by any brush sample (within its radius)? Used to
// split polylines: covered vertices are dropped, breaking the line into runs.
function coveredByBrush(pt: Point, samples: BrushSample[]): boolean {
  for (const s of samples) {
    if (Math.hypot(pt[0] - s.c[0], pt[1] - s.c[1]) <= s.r) return true;
  }
  return false;
}

// Axis-aligned bbox of a point list (tile px).
function bboxOf(pts: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

function bboxOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function sameRing(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}

// Ray-casting point-in-polygon test (screen px).
function pointInPolygon(p: Pt2, poly: Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface MapCanvasProps {
  rasterUrl: string;
  height: number; // tile pixel height (usually 2048)
  width: number;
  annotations: Annotation[];
  selectedId: string | null;
  // Full selection set (always includes the primary `selectedId`). Every id in
  // it gets the bright highlight + bounding box; the primary drives vertex edit.
  selectedIds: string[];
  selectedVertex: number | null;
  // Multi-point selection on the selected shape (includes the primary vertex).
  selectedVertices?: number[];
  // Move a group of vertices of one shape by (dx, dy) tile px.
  onMoveVertices?: (id: string, idxs: number[], dx: number, dy: number) => void;
  // Shift+drag box over points of the selected shape.
  onBoxSelectVertices?: (idxs: number[]) => void;
  visibility: Record<Label, boolean>;
  // Read-only vineyard parcel outlines for this tile (tile px) + toggle.
  parcels?: ParcelShape[];
  showParcels?: boolean;
  // Overlay fill/stroke opacity multiplier (0..1). Applied to the whole vector
  // overlay pane so the user can dim labels and see the imagery underneath
  // (e.g. check a plant is really there). Vertex handles stay full opacity.
  overlayOpacity?: number;
  // Active editing tool (mutually exclusive). The parent forces 'select' in
  // read-only mode, so a non-select tool here always means editing is allowed.
  //  - 'magic': the map does NOT pan on drag and click-select is suspended;
  //    hovering debounces a point-mode detect (`onMagicDetect`) shown as a
  //    dashed preview (click commits via `onMagicCommit`), and dragging records
  //    a freehand scribble handed to `onMagicScribble` on mouse-up.
  //  - 'cut': a click hit-tests the nearest polyline and calls `onCutLine` with
  //    the segment index + split point (pan stays enabled — cut is click-only).
  //  - 'erase': the map does NOT pan; a drag sweeps a circular brush whose
  //    swept area is SUBTRACTED (polygon boolean) from the shapes under it —
  //    carving notches, cropping edges, or splitting a shape in two, and only
  //    deleting a shape when the brush fully covers it
  //    (`onEraseStart`/`onErasePreview`/`onEraseCommit`).
  //  - 'join': pan stays enabled (click-only); a click hit-tests the nearest
  //    visible polyline and calls `onJoinPick` with its id (or null on a miss).
  //    The parent merges the two picked rows into one continuous polyline.
  //  - 'draw': pan STAYS enabled (a small movement threshold tells a click that
  //    places a vertex from a drag that pans); a click places a vertex, the
  //    live shape follows the pointer, and double-click / closing a polygon /
  //    the `drawCtlRef.finish()` bridge commits via `onDrawCommit`.
  tool?: Tool;
  // Read-only mode (another labeler holds the lock). Selection/pan/opacity still
  // work; draggable vertex + midpoint handles are suppressed so nothing edits.
  readOnly?: boolean;
  onMagicScribble?: (path: Point[]) => void;
  // Point-mode detect for the hover preview. Returns the shape that would be
  // labeled (or {found:false}); `signal` aborts a superseded request.
  onMagicDetect?: (path: Point[], signal: AbortSignal) => Promise<SegmentResponse>;
  // Commit the currently-hovered preview shape (fired on click in magic mode).
  onMagicCommit?: (result: SegmentHit) => void;
  // Surface a detect error (network/abort-safe) to the parent for a toast.
  onMagicError?: (err: unknown) => void;
  // Cut tool: split the polyline `id` at `splitPoint` (tile px), inserted after
  // vertex `segIndex`. The parent creates the two resulting polylines.
  onCutLine?: (id: string, segIndex: number, splitPoint: Point) => void;
  // Cut tool: a click that didn't land on any polyline (for a gentle hint).
  onCutMiss?: () => void;
  // Cut a ROAD (inter-row polygon) along the line through two clicked points.
  onCutPolygon?: (id: string, a: Point, b: Point) => void;
  onCutPending?: () => void;
  // Join tool: the nearest visible polyline to a click (tile-px hit-test), or
  // null when the click landed on nothing / only a polygon. The parent tracks
  // the pending row and merges the two picked polylines.
  // Candidate roads under the click, best first (empty = miss).
  onJoinPick?: (ids: string[]) => void;
  // Erase tool: called on brush-down to snapshot the undo baseline.
  onEraseStart?: () => void;
  // Erase tool: live-preview the cropped annotations during the drag (no undo
  // push). Fired on each brush move that removes at least one vertex.
  onErasePreview?: (annotations: Annotation[]) => void;
  // Erase tool: commit the final cropped annotations on mouse-up as ONE undo
  // step. `changed` is false when the drag removed nothing (no-op / no undo).
  onEraseCommit?: (annotations: Annotation[], changed: boolean) => void;
  // Draw tool: geometry the in-progress shape should form ('polyline' for rows,
  // 'polygon' otherwise). Drives the close-on-first-vertex affordance + min pts.
  drawShape?: 'polygon' | 'polyline';
  // Draw tool: stroke/fill color for the live preview (the draw-as label color).
  drawColor?: string;
  // Draw tool: commit the finished shape's points (tile px) as a new annotation.
  onDrawCommit?: (points: Point[]) => void;
  // Draw tool: MapCanvas populates this with imperative controls the parent's
  // keyboard handler calls — finish (Enter), removeLast (Backspace), cancel
  // (Esc; returns true when a shape was in progress). Mirrors `pickRef`.
  drawCtlRef?: MutableRefObject<{
    finish: () => void;
    removeLast: () => void;
    cancel: () => boolean;
  } | null>;
  onSelectAnnotation: (id: string | null) => void;
  // Ctrl/Cmd+click: toggle a shape in the multi-selection.
  onToggleAnnotation?: (id: string) => void;
  // TileViewer passes a ref that MapCanvas populates with a resolver returning
  // the id of the shape currently under the pointer (same nearest/containing
  // hit-test as click), used by the SPACE multi-select toggle. null = nothing.
  pickRef?: MutableRefObject<(() => string | null) | null>;
  onSelectVertex: (idx: number | null, additive?: boolean) => void;
  onMoveVertex: (id: string, idx: number, point: Point) => void;
  onInsertVertex: (id: string, afterIdx: number, point: Point) => void;
  onCoord: (x: number, y: number) => void;
}

export function MapCanvas(props: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayGroupRef = useRef<L.LayerGroup | null>(null);
  const parcelGroupRef = useRef<L.LayerGroup | null>(null);
  const selBoxGroupRef = useRef<L.LayerGroup | null>(null);
  const handleGroupRef = useRef<L.LayerGroup | null>(null);
  const selectedLayerRef = useRef<L.Polygon | L.Polyline | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Last pointer position (container/CSS px), updated cheaply on mousemove so
  // the SPACE handler can resolve "the shape under the pointer" without
  // hit-testing on every move.
  const lastPointerRef = useRef<Pt2 | null>(null);
  // Remembers the previous click so repeated clicks at ~the same spot cycle the
  // primary through overlapping candidates instead of re-picking the same one.
  const lastClickRef = useRef<{ x: number; y: number; ids: string[]; index: number } | null>(null);

  // --- Magic-draw scribble state (all in tile-pixel space via ll2p) ---
  const drawingRef = useRef(false);
  const scribbleRef = useRef<Point[]>([]);
  const previewLayerRef = useRef<L.Polyline | null>(null);
  // Distinguishes a click (commit hovered preview) from a drag (scribble POST).
  const dragStartRef = useRef<Pt2 | null>(null);
  const dragMovedRef = useRef(false);

  // --- Eraser brush state (region-subtract) ---
  // True while a brush drag is in progress (mousedown..mouseup in erase mode).
  const erasingRef = useRef(false);
  // Immutable snapshot of the annotations at brush-down. Every preview is
  // recomputed by subtracting the growing brush region from THIS base (not the
  // previewed result), so the crop is stable and the whole drag is one step.
  const eraseBaseAnnsRef = useRef<Annotation[]>([]);
  // Brush samples (disc centers + radii, tile px) swept during the drag.
  const eraseSamplesRef = useRef<BrushSample[]>([]);
  // Latest computed result set (base with the region subtracted); committed on
  // mouse-up. Whether the drag changed anything (drives the single commit).
  const eraseOutRef = useRef<Annotation[]>([]);
  const eraseChangedRef = useRef(false);
  // Live brush circle position (container/CSS px); null hides it.
  const [brush, setBrush] = useState<Pt2 | null>(null);

  // --- Draw tool state (all points in tile-pixel space via ll2p) ---
  // Placed vertices of the in-progress shape.
  const drawPointsRef = useRef<Point[]>([]);
  // Current pointer position (tile px) for the live "rubber-band" segment.
  const drawCursorRef = useRef<Point | null>(null);
  // Its own layer group (preview path + closing hint + vertex dots), separate
  // from overlays/handles so annotation redraws never clear it.
  const drawGroupRef = useRef<L.LayerGroup | null>(null);
  // Click-vs-pan disambiguation for the draw gesture (pan stays enabled).
  const drawDragStartRef = useRef<Pt2 | null>(null);
  const drawDragMovedRef = useRef(false);

  // --- Magic-draw hover-preview state ---
  const hoverTimerRef = useRef<number | null>(null);
  const hoverAbortRef = useRef<AbortController | null>(null);
  const hoverPreviewRef = useRef<L.Polygon | L.Polyline | null>(null);
  // The shape currently previewed under the pointer; committed on click.
  const hoveredResultRef = useRef<SegmentHit | null>(null);
  // Floating badge (label + confidence%) anchored at the cursor. React state so
  // it renders in the DOM; only updates a few times/sec (debounced), never per
  // raw mousemove.
  const [badge, setBadge] = useState<{ label: Label; confidence: number; x: number; y: number } | null>(
    null,
  );

  // Stable teardown for the hover preview — callable from both the map event
  // handlers (init effect) and the magic-mode toggle effect.
  const clearHoverRef = useRef<() => void>(() => {});
  clearHoverRef.current = () => {
    const map = mapRef.current;
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    hoverAbortRef.current?.abort();
    hoverAbortRef.current = null;
    if (hoverPreviewRef.current && map) map.removeLayer(hoverPreviewRef.current);
    hoverPreviewRef.current = null;
    hoveredResultRef.current = null;
    setBadge(null);
  };

  const H = props.height || 2048;

  const p2ll = (pt: Point): L.LatLngExpression => [H - pt[1], pt[0]];
  const ll2p = (ll: L.LatLng): Point => [ll.lng, H - ll.lat];

  // Collect every visible annotation whose geometry is under / within tolerance
  // of point `p` (container px), ordered best-first: smallest containing polygon
  // first (most specific), then nearest edge within tolerance. This is the
  // single source of truth for both click selection and the SPACE picker.
  const collectCandidates = (p: Pt2): string[] => {
    const map = mapRef.current;
    if (!map) return [];
    const anns = propsRef.current.annotations;
    const vis = propsRef.current.visibility;
    const containing: { id: string; area: number }[] = [];
    const near: { id: string; dist: number }[] = [];

    for (const ann of anns) {
      if (vis[ann.label] === false) continue; // never select a hidden label
      if (ann.points.length === 0) continue;
      const closed = ann.shape_type !== 'polyline';
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const poly: Pt2[] = ann.points.map((pt) => {
        const cp = map.latLngToContainerPoint(p2ll(pt) as L.LatLngExpression);
        if (cp.x < minX) minX = cp.x;
        if (cp.y < minY) minY = cp.y;
        if (cp.x > maxX) maxX = cp.x;
        if (cp.y > maxY) maxY = cp.y;
        return { x: cp.x, y: cp.y };
      });
      const area = Math.max(1, (maxX - minX) * (maxY - minY));
      const contains = closed && pointInPolygon(p, poly);
      const dist = minDistToPoly(p, poly, closed);
      if (contains) containing.push({ id: ann.id, area });
      else if (dist <= CLICK_TOLERANCE_PX) near.push({ id: ann.id, dist });
    }
    containing.sort((a, b) => a.area - b.area); // smallest (most specific) first
    near.sort((a, b) => a.dist - b.dist); // nearest first
    return [...containing.map((c) => c.id), ...near.map((n) => n.id)];
  };

  const sameIds = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  // Plain click: single-select, replacing the set. Repeated clicks at the same
  // spot cycle the primary through the stacked candidates so a shape hidden
  // under another can be reached. Empty space (no candidate) clears selection.
  const pickAndSelectRef = useRef<(p: Pt2, additive?: boolean) => void>(() => {});
  pickAndSelectRef.current = (p: Pt2, additive?: boolean) => {
    const ids = collectCandidates(p);
    // Ctrl/Cmd+click: add/remove the shape under the cursor to/from the
    // multi-selection instead of replacing it.
    if (additive) {
      if (ids.length) propsRef.current.onToggleAnnotation?.(ids[0]);
      return;
    }
    if (ids.length === 0) {
      lastClickRef.current = null;
      propsRef.current.onSelectAnnotation(null);
      return;
    }
    const last = lastClickRef.current;
    let index = 0;
    if (
      last &&
      Math.hypot(p.x - last.x, p.y - last.y) <= CLICK_SAME_SPOT_PX &&
      sameIds(last.ids, ids)
    ) {
      index = (last.index + 1) % ids.length;
    }
    lastClickRef.current = { x: p.x, y: p.y, ids, index };
    propsRef.current.onSelectAnnotation(ids[index]);
  };

  // Resolver for the SPACE toggle: the top-most shape under the last pointer
  // position, or null when the pointer isn't over/near any shape.
  const pickAtPointerRef = useRef<() => string | null>(() => null);
  pickAtPointerRef.current = () => {
    const p = lastPointerRef.current;
    if (!p) return null;
    const ids = collectCandidates(p);
    return ids.length ? ids[0] : null;
  };
  if (props.pickRef) props.pickRef.current = () => pickAtPointerRef.current();

  // --- Cut tool: hit-test a click to the nearest visible polyline, project it
  // onto the closest segment, and hand the split (segment index + tile-px point)
  // to the parent. Polygons are ignored (Cut only splits lines).
  // Road cut in progress: the road picked by the 1st click + that point.
  const roadCutRef = useRef<{ id: string; a: Point; marker: L.CircleMarker } | null>(null);
  const clearRoadCut = () => {
    roadCutRef.current?.marker.remove();
    roadCutRef.current = null;
  };
  const cutAtRef = useRef<(p: Pt2) => void>(() => {});
  cutAtRef.current = (p: Pt2) => {
    const map = mapRef.current;
    if (!map) return;
    // 2nd click of a road cut: split the road along the line through both points.
    if (roadCutRef.current) {
      const { id, a } = roadCutRef.current;
      const b = ll2p(map.containerPointToLatLng(L.point(p.x, p.y)));
      clearRoadCut();
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) return; // same spot: cancel
      propsRef.current.onCutPolygon?.(id, a, b);
      return;
    }
    const anns = propsRef.current.annotations;
    const vis = propsRef.current.visibility;
    let best: { id: string; segIndex: number; dist: number; split: Point } | null = null;
    for (const ann of anns) {
      if (ann.shape_type !== 'polyline') continue; // only lines
      if (vis[ann.label] === false) continue; // never cut a hidden shape
      if (ann.points.length < 2) continue;
      const cpts = ann.points.map((pt) =>
        map.latLngToContainerPoint(p2ll(pt) as L.LatLngExpression),
      );
      for (let i = 0; i < cpts.length - 1; i++) {
        const a = { x: cpts[i].x, y: cpts[i].y };
        const b = { x: cpts[i + 1].x, y: cpts[i + 1].y };
        const { t, dist } = projectOnSegment(p, a, b);
        if (dist <= CLICK_TOLERANCE_PX && (!best || dist < best.dist)) {
          const sx = a.x + t * (b.x - a.x);
          const sy = a.y + t * (b.y - a.y);
          const split = ll2p(map.containerPointToLatLng(L.point(sx, sy)));
          best = { id: ann.id, segIndex: i, dist, split };
        }
      }
    }
    // Is the click inside a road (inter-row polygon)? A click inside a road
    // cuts the ROAD unless it is practically on a line (rows run right next to
    // roads, so the generous line tolerance would otherwise always win).
    const ON_LINE_PX = 6;
    if (!best || best.dist > ON_LINE_PX) {
      let road: { id: string; area: number } | null = null;
      for (const ann of anns) {
        if (ann.label !== 'interrow_area' || ann.shape_type === 'polyline') continue;
        if (vis[ann.label] === false || ann.points.length < 3) continue;
        const cpts = ann.points.map((pt) => {
          const cp = map.latLngToContainerPoint(p2ll(pt) as L.LatLngExpression);
          return { x: cp.x, y: cp.y };
        });
        if (!pointInPolygon(p, cpts)) continue;
        let area = 0;
        for (let k = 0, m = cpts.length - 1; k < cpts.length; m = k++) area += (cpts[m].x + cpts[k].x) * (cpts[m].y - cpts[k].y);
        area = Math.abs(area / 2);
        if (!road || area < road.area) road = { id: ann.id, area };
      }
      if (road) {
        const a = ll2p(map.containerPointToLatLng(L.point(p.x, p.y)));
        const marker = L.circleMarker(p2ll(a) as L.LatLngExpression, {
          pane: 'drawPane', radius: 6, color: '#fff', weight: 2, fillColor: '#FF5A5A', fillOpacity: 1, interactive: false,
        }).addTo(map);
        roadCutRef.current = { id: road.id, a, marker };
        propsRef.current.onCutPending?.();
        return;
      }
    }
    if (!best) {
      propsRef.current.onCutMiss?.();
      return;
    }
    propsRef.current.onCutLine?.(best.id, best.segIndex, best.split);
  };
  // Leaving the Cut tool drops a half-made road cut.
  useEffect(() => {
    if (props.tool !== 'cut') clearRoadCut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tool]);

  // --- Eraser tool (region-subtract brush) ---
  // Monotonic suffix for the fresh ids of split pieces during a drag.
  const eraseIdRef = useRef(0);

  // Snapshot the base annotations + mark the undo baseline, then stroke once.
  const startEraseRef = useRef<(p: Pt2) => void>(() => {});
  startEraseRef.current = (p: Pt2) => {
    erasingRef.current = true;
    eraseChangedRef.current = false;
    eraseSamplesRef.current = [];
    eraseBaseAnnsRef.current = propsRef.current.annotations.map((a) => ({
      ...a,
      points: a.points.map((pt) => [pt[0], pt[1]] as Point),
    }));
    eraseOutRef.current = eraseBaseAnnsRef.current;
    propsRef.current.onEraseStart?.();
    applyEraseRef.current(p);
  };

  // tile-px radius matching the on-screen ERASE_RADIUS_PX at container point c.
  const tileRadiusAt = (c: Pt2): number => {
    const map = mapRef.current;
    if (!map) return ERASE_RADIUS_PX;
    const t0 = ll2p(map.containerPointToLatLng(L.point(c.x, c.y)));
    const t1 = ll2p(map.containerPointToLatLng(L.point(c.x + ERASE_RADIUS_PX, c.y)));
    return Math.hypot(t1[0] - t0[0], t1[1] - t0[1]) || ERASE_RADIUS_PX;
  };

  // Append brush sample(s) for the current cursor (interpolating on fast drags
  // so the swept region has no gaps), then recompute the crop preview.
  const applyEraseRef = useRef<(cursor: Pt2) => void>(() => {});
  applyEraseRef.current = (cursor: Pt2) => {
    const map = mapRef.current;
    if (!map) return;
    const tile = ll2p(map.containerPointToLatLng(L.point(cursor.x, cursor.y)));
    const r = tileRadiusAt(cursor);
    const samples = eraseSamplesRef.current;
    const last = samples[samples.length - 1];
    if (last) {
      const gap = Math.hypot(tile[0] - last.c[0], tile[1] - last.c[1]);
      if (gap < r * 0.35) return; // barely moved — region unchanged, skip recompute
      const spacing = Math.max(r * 0.6, 0.5);
      const steps = Math.floor(gap / spacing);
      for (let i = 1; i < steps; i++) {
        const t = (i * spacing) / gap;
        samples.push({
          c: [last.c[0] + (tile[0] - last.c[0]) * t, last.c[1] + (tile[1] - last.c[1]) * t],
          r,
        });
      }
    }
    samples.push({ c: tile, r });
    recomputeEraseRef.current();
  };

  // Recompute the preview by subtracting the swept brush region from the frozen
  // base. Polygons -> boolean difference (notch/crop/split/whole-cover-delete);
  // polylines -> drop covered vertices, splitting into runs. Rebuilt from base
  // each stroke so the crop is stable and the whole drag is one undo step.
  const recomputeEraseRef = useRef<() => void>(() => {});
  recomputeEraseRef.current = () => {
    const samples = eraseSamplesRef.current;
    const base = eraseBaseAnnsRef.current;
    if (samples.length === 0) return;
    const region = buildBrushRegion(samples);
    if (!region) return;
    // Region bbox for a cheap per-shape overlap gate.
    let rMinX = Infinity;
    let rMinY = Infinity;
    let rMaxX = -Infinity;
    let rMaxY = -Infinity;
    for (const poly of region)
      for (const ring of poly)
        for (const pt of ring) {
          if (pt[0] < rMinX) rMinX = pt[0];
          if (pt[1] < rMinY) rMinY = pt[1];
          if (pt[0] > rMaxX) rMaxX = pt[0];
          if (pt[1] > rMaxY) rMaxY = pt[1];
        }
    const regionBBox = { minX: rMinX, minY: rMinY, maxX: rMaxX, maxY: rMaxY };
    const vis = propsRef.current.visibility;
    const out: Annotation[] = [];
    let changed = false;
    const freshId = () => `erase-${Date.now()}-${eraseIdRef.current++}`;

    for (const ann of base) {
      // Hidden labels + empty shapes are never touched.
      if (vis[ann.label] === false || ann.points.length === 0) {
        out.push(ann);
        continue;
      }
      const annBBox = bboxOf(ann.points);
      if (!bboxOverlap(annBBox, regionBBox)) {
        out.push(ann);
        continue;
      }

      if (ann.shape_type === 'polyline') {
        // ROW eraser: cut out exactly the stretch of the line under the brush.
        // Rows are straight 2-point lines, so we densify each segment, drop the
        // covered samples, and rebuild each surviving run as a line from its
        // first to last sample (plus any original bend points inside it).
        const step = Math.max(0.5, Math.min(...samples.map((q) => q.r)) / 3);
        const dense: { p: Point; orig: boolean }[] = [];
        const P = ann.points;
        for (let k = 0; k < P.length - 1; k++) {
          const a = P[k];
          const b = P[k + 1];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const n = Math.max(1, Math.ceil(len / step));
          for (let t = 0; t < n; t++) {
            dense.push({ p: [a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n], orig: t === 0 });
          }
        }
        dense.push({ p: P[P.length - 1], orig: true });
        const runs: Point[][] = [];
        let run: { p: Point; orig: boolean }[] = [];
        const flush = () => {
          if (run.length >= 2) {
            const pts: Point[] = [run[0].p];
            for (let k = 1; k < run.length - 1; k++) if (run[k].orig) pts.push(run[k].p);
            pts.push(run[run.length - 1].p);
            if (Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) >= 2) runs.push(pts);
          }
          run = [];
        };
        for (const d of dense) {
          if (coveredByBrush(d.p, samples)) flush();
          else run.push(d);
        }
        flush();
        const untouched = !dense.some((d) => coveredByBrush(d.p, samples));
        if (untouched) {
          out.push(ann);
          continue;
        }
        changed = true;
        runs.forEach((pts, i) =>
          out.push({ ...ann, id: i === 0 ? ann.id : freshId(), points: pts }),
        );
        continue; // no runs => the whole row was erased
      }

      // The eraser only works on ROWS now; polygons are left untouched.
      out.push(ann);
      continue;

      // Polygon: subtract the swept region (boolean difference).
      const closed: [number, number][] = ann.points.map((p) => [p[0], p[1]]);
      closed.push([ann.points[0][0], ann.points[0][1]]);
      const subject: PcPolygon = [closed];
      let result: MultiPolygon;
      try {
        result = difference(subject, region!);
      } catch {
        out.push(ann);
        continue;
      }
      // Keep each result polygon's exterior ring (index 0), simplified + capped;
      // drop holes and sub-threshold slivers. This app stores simple polygons.
      const rings: Point[][] = [];
      for (const poly of result) {
        if (poly.length === 0) continue;
        if (ringArea(poly[0]) < ERASE_MIN_POLY_AREA) continue;
        const cleaned = cleanRing(poly[0]);
        if (cleaned.length >= 3 && ringArea(cleaned) >= ERASE_MIN_POLY_AREA) rings.push(cleaned);
      }
      if (rings.length === 0) {
        changed = true; // region fully covered the shape => delete it
        continue;
      }
      const origArea = ringArea(ann.points);
      let totalArea = 0;
      for (const ring of rings) totalArea += ringArea(ring);
      const unchanged =
        rings.length === 1 &&
        (sameRing(rings[0], ann.points) ||
          Math.abs(origArea - totalArea) <= Math.max(1, origArea * 0.01));
      if (unchanged) {
        out.push(ann); // bbox overlapped but no real area removed — keep exact geometry
        continue;
      }
      changed = true;
      rings.forEach((pts, i) =>
        out.push({ ...ann, id: i === 0 ? ann.id : freshId(), points: pts }),
      );
    }

    eraseOutRef.current = out;
    if (changed) {
      eraseChangedRef.current = true;
      propsRef.current.onErasePreview?.(pruneErased(out));
    }
  };

  // Commit the whole drag as one undo step (or a no-op when nothing changed).
  const finishEraseRef = useRef<() => void>(() => {});
  finishEraseRef.current = () => {
    if (!erasingRef.current) return;
    erasingRef.current = false;
    const out = eraseOutRef.current;
    const changed = eraseChangedRef.current;
    eraseSamplesRef.current = [];
    eraseBaseAnnsRef.current = [];
    eraseOutRef.current = [];
    eraseChangedRef.current = false;
    propsRef.current.onEraseCommit?.(pruneErased(out), changed);
  };

  // --- Join tool: hit-test a click to the nearest visible polyline (rows),
  // then hand its id to the parent, which tracks the pending row and merges the
  // two picked lines. Polygons are ignored (join only merges rows).
  const joinAtRef = useRef<(p: Pt2) => void>(() => {});
  joinAtRef.current = (p: Pt2) => {
    const map = mapRef.current;
    if (!map) return;
    const anns = propsRef.current.annotations;
    const vis = propsRef.current.visibility;
    const cands: { id: string; dist: number }[] = [];
    for (const ann of anns) {
      // Join works on ROADS only: inter-row polygons.
      if (ann.label !== 'interrow_area' || ann.shape_type === 'polyline') continue;
      if (vis[ann.label] === false) continue;
      if (ann.points.length < 3) continue;
      const cpts: Pt2[] = ann.points.map((pt) => {
        const cp = map.latLngToContainerPoint(p2ll(pt) as L.LatLngExpression);
        return { x: cp.x, y: cp.y };
      });
      // Containing roads win (smallest area first, so a click inside an
      // overlapped piece picks THAT piece); otherwise nearest edge in tolerance.
      let dist: number;
      if (pointInPolygon(p, cpts)) {
        let area = 0;
        for (let k = 0, m = cpts.length - 1; k < cpts.length; m = k++) {
          area += (cpts[m].x + cpts[k].x) * (cpts[m].y - cpts[k].y);
        }
        dist = -1e9 + Math.abs(area / 2); // negative: always beats edge hits
      } else {
        dist = minDistToPoly(p, cpts, true);
        if (dist > CLICK_TOLERANCE_PX) continue;
      }
      cands.push({ id: ann.id, dist });
    }
    cands.sort((a, b) => a.dist - b.dist);
    propsRef.current.onJoinPick?.(cands.map((c) => c.id));
  };

  // --- Draw tool ---
  // Redraw the in-progress shape: dashed path through placed points + cursor,
  // a faint closing hint for polygons, and vertex dots (first one enlarged as
  // the close target). Colored with the draw-as label's color.
  const renderDrawRef = useRef<() => void>(() => {});
  renderDrawRef.current = () => {
    const map = mapRef.current;
    const group = drawGroupRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const pts = drawPointsRef.current;
    const cursor = drawCursorRef.current;
    if (pts.length === 0 && !cursor) return;
    const shape = propsRef.current.drawShape ?? 'polygon';
    const color = propsRef.current.drawColor ?? SEL_COLOR;
    const placedLL = pts.map(p2ll);
    const pathLL = cursor ? [...placedLL, p2ll(cursor)] : placedLL;
    if (pathLL.length >= 2) {
      L.polyline(pathLL, {
        color,
        weight: 3,
        opacity: 0.95,
        dashArray: '6 5',
        interactive: false,
        className: 'draw-preview',
        pane: 'drawPane', // own pane: not dimmed by the opacity slider
      }).addTo(group);
    }
    // Polygon closing hint: from the moving end back to the first vertex.
    if (shape === 'polygon' && pts.length >= 2) {
      const endLL = cursor ? p2ll(cursor) : placedLL[placedLL.length - 1];
      L.polyline([endLL, placedLL[0]], {
        color,
        weight: 2,
        opacity: 0.5,
        dashArray: '3 5',
        interactive: false,
        className: 'draw-preview-close',
        pane: 'drawPane', // own pane: not dimmed by the opacity slider
      }).addTo(group);
    }
    pts.forEach((pt, i) => {
      L.circleMarker(p2ll(pt), {
        radius: i === 0 ? 6 : 4,
        color: '#FFFFFF',
        weight: 2,
        opacity: 1,
        fillColor: color,
        fillOpacity: 1,
        interactive: false,
        className: 'draw-vertex',
        pane: 'drawPane', // own pane: not dimmed by the opacity slider
      }).addTo(group);
    });
  };

  // Clear all in-progress draw state + preview layers.
  const clearDrawRef = useRef<() => void>(() => {});
  clearDrawRef.current = () => {
    drawPointsRef.current = [];
    drawCursorRef.current = null;
    drawDragStartRef.current = null;
    drawDragMovedRef.current = false;
    drawGroupRef.current?.clearLayers();
  };

  // Commit the shape if it meets its minimum vertex count (3 polygon / 2
  // polyline), else silently discard the too-small in-progress shape.
  const finishDrawRef = useRef<() => void>(() => {});
  finishDrawRef.current = () => {
    if (propsRef.current.readOnly) return;
    const shape = propsRef.current.drawShape ?? 'polygon';
    const min = shape === 'polyline' ? 2 : 3;
    const pts = drawPointsRef.current;
    if (pts.length < min) {
      clearDrawRef.current();
      return;
    }
    const out = pts.map((p) => [p[0], p[1]] as Point);
    clearDrawRef.current();
    propsRef.current.onDrawCommit?.(out);
  };

  // Append a vertex at a container point — or close the polygon when the click
  // lands near the first vertex.
  const addDrawVertexRef = useRef<(p: Pt2) => void>(() => {});
  addDrawVertexRef.current = (containerPt: Pt2) => {
    const map = mapRef.current;
    if (!map || propsRef.current.readOnly) return;
    const shape = propsRef.current.drawShape ?? 'polygon';
    const pts = drawPointsRef.current;
    if (shape === 'polygon' && pts.length >= 3) {
      const firstCp = map.latLngToContainerPoint(p2ll(pts[0]) as L.LatLngExpression);
      if (Math.hypot(firstCp.x - containerPt.x, firstCp.y - containerPt.y) <= DRAW_CLOSE_PX) {
        finishDrawRef.current();
        return;
      }
    }
    const raw = ll2p(map.containerPointToLatLng(L.point(containerPt.x, containerPt.y)));
    // Clamp to the image: shapes can never extend past the tile edge.
    const W = propsRef.current.width || 2048;
    const Hh = propsRef.current.height || 2048;
    const tilePt: Point = [Math.min(Math.max(raw[0], 0), W), Math.min(Math.max(raw[1], 0), Hh)];
    pts.push(tilePt);
    // Rows are straight: 2 clicks (start + end) and the line is done.
    if (shape === 'polyline' && pts.length >= 2) {
      finishDrawRef.current();
      return;
    }
    renderDrawRef.current();
  };

  // Remove the last placed vertex (Backspace).
  const removeLastDrawRef = useRef<() => void>(() => {});
  removeLastDrawRef.current = () => {
    if (drawPointsRef.current.length === 0) return;
    drawPointsRef.current.pop();
    renderDrawRef.current();
  };

  // Cancel the in-progress shape. Returns true iff a shape was being drawn (so
  // the parent knows whether Esc consumed the shape or should exit the tool).
  const cancelDrawRef = useRef<() => boolean>(() => false);
  cancelDrawRef.current = () => {
    const had = drawPointsRef.current.length > 0;
    clearDrawRef.current();
    return had;
  };

  // Expose the imperative bridge for the parent's keyboard handler.
  if (props.drawCtlRef) {
    props.drawCtlRef.current = {
      finish: () => finishDrawRef.current(),
      removeLast: () => removeLastDrawRef.current(),
      cancel: () => cancelDrawRef.current(),
    };
  }

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [H, props.width || 2048],
    ];
    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -5,
      maxZoom: ztok.maxZoom ?? 5,
      zoomControl: true,
      attributionControl: false,
    });
    // Dedicated pane for the in-progress Draw preview, above the vector
    // overlays and NOT affected by the overlay-opacity slider.
    const drawPane = map.createPane('drawPane');
    drawPane.style.zIndex = '650';
    drawPane.style.pointerEvents = 'none';
    // Parcel outlines sit just under the label overlays and never take clicks.
    const parcelPane = map.createPane('parcelPane');
    parcelPane.style.zIndex = '450'; // above labels (non-interactive), below handles
    parcelPane.style.pointerEvents = 'none';
    parcelGroupRef.current = L.layerGroup().addTo(map);

    // Shift+drag on the map = box-select points of the selected shape (replaces
    // Leaflet's default shift+drag box-zoom).
    map.boxZoom.disable();
    let boxStart: L.Point | null = null;
    let boxRect: L.Rectangle | null = null;
    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      const oe = e.originalEvent as MouseEvent;
      const pr = propsRef.current;
      if (!oe.shiftKey || pr.readOnly || (pr.tool && pr.tool !== 'select') || !pr.selectedId) return;
      boxStart = e.containerPoint;
      map.dragging.disable();
      boxRect = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
        color: '#4C8DFF', weight: 1, dashArray: '4 3', fillOpacity: 0.08, interactive: false, pane: 'drawPane',
      }).addTo(map);
    });
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!boxStart || !boxRect) return;
      boxRect.setBounds(L.latLngBounds(map.containerPointToLatLng(boxStart), e.latlng));
    });
    map.on('mouseup', (e: L.LeafletMouseEvent) => {
      if (!boxStart) return;
      const a = boxStart;
      const b = e.containerPoint;
      boxStart = null;
      boxRect?.remove();
      boxRect = null;
      map.dragging.enable();
      const pr = propsRef.current;
      const ann = pr.annotations.find((x) => x.id === pr.selectedId);
      if (!ann) return;
      const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
      const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      if (x1 - x0 < 3 && y1 - y0 < 3) return;
      const idxs: number[] = [];
      ann.points.forEach((pt, i) => {
        const cp = map.latLngToContainerPoint(p2ll(pt) as L.LatLngExpression);
        if (cp.x >= x0 && cp.x <= x1 && cp.y >= y0 && cp.y <= y1) idxs.push(i);
      });
      pr.onBoxSelectVertices?.(idxs);
    });
    L.imageOverlay(props.rasterUrl, bounds).addTo(map);
    map.fitBounds(bounds);

    overlayGroupRef.current = L.layerGroup().addTo(map);
    // Selection bounding-box indicator sits above overlays but below handles.
    selBoxGroupRef.current = L.layerGroup().addTo(map);
    handleGroupRef.current = L.layerGroup().addTo(map);
    // Draw-tool preview group, added last so the in-progress shape sits on top.
    drawGroupRef.current = L.layerGroup().addTo(map);

    // Live preview polyline for the magic scribble (kept in the overlay group's
    // sibling pane; created lazily on first mousedown).
    const clearPreview = () => {
      if (previewLayerRef.current) {
        map.removeLayer(previewLayerRef.current);
        previewLayerRef.current = null;
      }
    };

    // Draw (or replace) the dashed hover-preview of a detected shape and anchor
    // the confidence badge at the cursor.
    const drawHoverPreview = (res: SegmentHit, at: Pt2) => {
      if (hoverPreviewRef.current) map.removeLayer(hoverPreviewRef.current);
      const closed = res.shape_type !== 'polyline';
      const latlngs = res.points.map(p2ll);
      const opts: L.PolylineOptions = {
        color: MAGIC_COLOR,
        weight: 3,
        opacity: 1,
        dashArray: '7 5',
        fill: closed,
        fillColor: MAGIC_COLOR,
        fillOpacity: closed ? 0.2 : 0,
        interactive: false,
        className: 'magic-preview',
      };
      const layer = closed ? L.polygon(latlngs, opts) : L.polyline(latlngs, opts);
      layer.addTo(map);
      hoverPreviewRef.current = layer;
      hoveredResultRef.current = res;
      setBadge({ label: res.label, confidence: res.confidence, x: at.x, y: at.y });
    };

    // Fire a debounced point-mode detect for the current cursor. Aborts any
    // in-flight request first so only the latest hover resolves.
    const runHoverDetect = (tilePt: Point, at: Pt2) => {
      const fn = propsRef.current.onMagicDetect;
      if (!fn) return;
      hoverAbortRef.current?.abort();
      const ctrl = new AbortController();
      hoverAbortRef.current = ctrl;
      fn([tilePt], ctrl.signal)
        .then((resp) => {
          if (ctrl.signal.aborted) return;
          if ('found' in resp && resp.found === false) {
            // Nothing here — drop the preview but stay in hover mode.
            if (hoverPreviewRef.current) map.removeLayer(hoverPreviewRef.current);
            hoverPreviewRef.current = null;
            hoveredResultRef.current = null;
            setBadge(null);
            return;
          }
          drawHoverPreview(resp as SegmentHit, at);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (err && (err as { name?: string }).name === 'AbortError') return;
          propsRef.current.onMagicError?.(err);
        });
    };

    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      // Eraser: begin a brush drag (snapshot + first stroke).
      if (propsRef.current.tool === 'erase') {
        startEraseRef.current({ x: e.containerPoint.x, y: e.containerPoint.y });
        return;
      }
      // Draw: record the gesture start so mouse-up can tell a click (place a
      // vertex) from a drag (pan). Panning stays enabled — no preventDefault.
      if (propsRef.current.tool === 'draw') {
        drawDragStartRef.current = { x: e.containerPoint.x, y: e.containerPoint.y };
        drawDragMovedRef.current = false;
        return;
      }
      if (propsRef.current.tool !== 'magic') return;
      // A gesture starts: cancel any pending hover fetch but KEEP the drawn
      // preview so a click (no drag) can commit it. Track the start point to
      // classify click-vs-drag on mouse-up.
      if (hoverTimerRef.current != null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      hoverAbortRef.current?.abort();
      hoverAbortRef.current = null;
      dragStartRef.current = { x: e.containerPoint.x, y: e.containerPoint.y };
      dragMovedRef.current = false;
      // Start a fresh scribble. Convert pointer -> tile-pixel via the SAME ll2p
      // used for annotation vertices so a magic polygon lines up with SAM ones.
      drawingRef.current = true;
      scribbleRef.current = [ll2p(e.latlng)];
      clearPreview();
      previewLayerRef.current = L.polyline([e.latlng], {
        color: MAGIC_COLOR,
        weight: 3,
        opacity: 0.95,
        dashArray: '4 4',
        interactive: false,
        className: 'magic-scribble',
      }).addTo(map);
    });

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      const pt = ll2p(e.latlng);
      propsRef.current.onCoord(Math.round(pt[0]), Math.round(pt[1]));
      // Cheap: just remember the container point for the SPACE picker. No
      // hit-testing here.
      lastPointerRef.current = { x: e.containerPoint.x, y: e.containerPoint.y };
      // Eraser: move the live brush circle and, mid-drag, crop under it.
      if (propsRef.current.tool === 'erase') {
        const c = { x: e.containerPoint.x, y: e.containerPoint.y };
        setBrush(c);
        if (erasingRef.current) applyEraseRef.current(c);
        return;
      }
      // Draw: track the cursor for the rubber-band preview, and promote the
      // gesture to a pan once it travels past the threshold (suppresses the
      // vertex-placing click on mouse-up).
      if (propsRef.current.tool === 'draw') {
        drawCursorRef.current = pt;
        const start = drawDragStartRef.current;
        if (
          start &&
          !drawDragMovedRef.current &&
          Math.hypot(e.containerPoint.x - start.x, e.containerPoint.y - start.y) > DRAW_DRAG_PX
        ) {
          drawDragMovedRef.current = true;
        }
        renderDrawRef.current();
        return;
      }
      if (drawingRef.current) {
        scribbleRef.current.push(pt);
        previewLayerRef.current?.setLatLngs(scribbleRef.current.map(p2ll));
        // Once the pointer travels enough this is a real drag → drop the hover
        // preview so the drag-scribble result takes precedence.
        const start = dragStartRef.current;
        if (!dragMovedRef.current && start) {
          if (Math.hypot(e.containerPoint.x - start.x, e.containerPoint.y - start.y) > MAGIC_DRAG_PX) {
            dragMovedRef.current = true;
            clearHoverRef.current();
          }
        }
        return;
      }
      // Hover-detect (magic mode, not mid-gesture): debounce, then detect.
      if (propsRef.current.tool === 'magic') {
        const at = { x: e.containerPoint.x, y: e.containerPoint.y };
        if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = window.setTimeout(() => {
          hoverTimerRef.current = null;
          runHoverDetect(pt, at);
        }, HOVER_DEBOUNCE_MS);
      }
    });

    const finishScribble = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const path = scribbleRef.current;
      scribbleRef.current = [];
      clearPreview();
      const wasDrag = dragMovedRef.current;
      dragMovedRef.current = false;
      dragStartRef.current = null;
      if (wasDrag && path.length >= 2) {
        // Real drag-scribble → POST the whole path and commit its result.
        clearHoverRef.current();
        propsRef.current.onMagicScribble?.(path);
      } else {
        // Click (no meaningful drag) → commit the currently-hovered preview.
        const res = hoveredResultRef.current;
        if (res) propsRef.current.onMagicCommit?.(res);
        clearHoverRef.current();
      }
    };
    map.on('mouseup', (e: L.LeafletMouseEvent) => {
      if (propsRef.current.tool === 'erase') {
        finishEraseRef.current();
        return;
      }
      // Draw: a click (no meaningful drag) places a vertex; a drag was a pan.
      if (propsRef.current.tool === 'draw') {
        if (!drawDragMovedRef.current) {
          addDrawVertexRef.current({ x: e.containerPoint.x, y: e.containerPoint.y });
        }
        drawDragStartRef.current = null;
        drawDragMovedRef.current = false;
        return;
      }
      finishScribble();
    });
    // Draw: double-click finishes. Leaflet's two preceding clicks each placed a
    // vertex at ~the same spot, so drop the duplicate last one before finishing.
    map.on('dblclick', () => {
      if (propsRef.current.tool !== 'draw') return;
      if (drawPointsRef.current.length > 0) drawPointsRef.current.pop();
      finishDrawRef.current();
    });
    // Ending the drag outside the map (mouseup off-canvas) still commits.
    map.on('mouseout', () => {
      if (propsRef.current.tool === 'erase') setBrush(null);
    });

    // Map-level click: forgiving hit-test so users don't need pixel-perfect
    // clicks on tiny SAM shapes / thin rows. Per-shape handlers stopPropagation
    // and route through the same picker, so overlap-cycling works everywhere.
    // Suspended while the magic-draw tool is active (commit is handled on
    // mouse-up so it works whether or not Leaflet emits a synthetic click).
    map.on('click', (e: L.LeafletMouseEvent) => {
      const t = propsRef.current.tool;
      // magic/erase/draw handle the pointer on mouse up/down, not via click.
      if (t === 'magic' || t === 'erase' || t === 'draw') return;
      if (t === 'cut') {
        cutAtRef.current({ x: e.containerPoint.x, y: e.containerPoint.y });
        return;
      }
      if (t === 'join') {
        joinAtRef.current({ x: e.containerPoint.x, y: e.containerPoint.y });
        return;
      }
      pickAndSelectRef.current(
        { x: e.containerPoint.x, y: e.containerPoint.y },
        !!((e.originalEvent as MouseEvent)?.ctrlKey || (e.originalEvent as MouseEvent)?.metaKey),
      );
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vineyard parcel outlines (read-only, dashed amber), toggled from Layers.
  useEffect(() => {
    const g = parcelGroupRef.current;
    if (!g) return;
    g.clearLayers();
    if (!props.showParcels || !props.parcels) return;
    for (const pc of props.parcels) {
      if (pc.points.length < 3) continue;
      L.polygon(pc.points.map((q) => p2ll(q as Point)), {
        pane: 'parcelPane',
        color: '#FFD23F',
        weight: 2.5,
        opacity: 0.95,
        dashArray: '8 6',
        fill: true,
        fillColor: '#FFD23F',
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.parcels, props.showParcels, H]);

  // Dim/brighten all vector overlays via the overlay pane's CSS opacity — cheap
  // and instant (no redraw), so the user can peek at the imagery under labels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pane = map.getPane('overlayPane');
    if (pane) pane.style.opacity = String(props.overlayOpacity ?? 1);
  }, [props.overlayOpacity, props.annotations, props.height]);

  // Tool mode: magic and erase disable map panning (a drag is a gesture, not a
  // pan) and swap the cursor; cut and select keep panning. Leaving a tool tears
  // down that tool's in-flight state so switching is always clean.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = props.tool ?? 'select';
    const el = containerRef.current;

    // Panning: only magic + erase suppress it (both drive drags themselves).
    // Draw KEEPS panning (a click threshold separates vertex-place from pan).
    if (t === 'magic' || t === 'erase') map.dragging.disable();
    else map.dragging.enable();

    // Draw: suppress double-click-to-zoom so a finishing double-click doesn't
    // also zoom the map. Restore it for every other tool.
    if (t === 'draw') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();

    // Cursor affordance per tool.
    el?.classList.toggle('magic-active', t === 'magic');
    el?.classList.toggle('cut-active', t === 'cut');
    el?.classList.toggle('erase-active', t === 'erase');
    el?.classList.toggle('join-active', t === 'join');
    el?.classList.toggle('draw-active', t === 'draw');

    // Leaving magic: abort any in-flight scribble + hover preview.
    if (t !== 'magic') {
      drawingRef.current = false;
      scribbleRef.current = [];
      dragStartRef.current = null;
      dragMovedRef.current = false;
      if (previewLayerRef.current) {
        map.removeLayer(previewLayerRef.current);
        previewLayerRef.current = null;
      }
      clearHoverRef.current();
    }

    // Leaving erase: finalize an in-progress brush drag (so its edits aren't
    // lost) and hide the brush circle.
    if (t !== 'erase') {
      if (erasingRef.current) finishEraseRef.current();
      setBrush(null);
    }

    // Leaving draw: discard any in-progress shape + preview.
    if (t !== 'draw') clearDrawRef.current();
  }, [props.tool]);

  // Redraw overlays when annotations / visibility / selection change.
  useEffect(() => {
    const group = overlayGroupRef.current;
    if (!group) return;
    group.clearLayers();
    selectedLayerRef.current = null;
    const selSet = new Set(props.selectedIds);

    for (const ann of props.annotations) {
      if (props.visibility[ann.label] === false) continue;
      const latlngs = ann.points.map(p2ll);
      const style = overlayStyle(ann.label, ann.attributes);
      const isSel = selSet.has(ann.id);
      const isPrimary = ann.id === props.selectedId;
      const closed = ann.shape_type !== 'polyline';

      // Halo (drawn under): same geometry, wider, dark.
      const haloOpts: L.PolylineOptions = {
        color: haloColor,
        weight: style.strokeWidth + haloWidthOffset,
        opacity: 1,
        fill: false,
        interactive: false,
        dashArray: style.dashArray ?? undefined,
      };
      const halo = closed ? L.polygon(latlngs, haloOpts) : L.polyline(latlngs, haloOpts);
      group.addLayer(halo);

      // Colored stroke + fill on top. When selected, use an unmistakable
      // zoom-independent highlight: bright accent stroke with a clear minimum
      // weight and a strong fill so even a ~10px shape reads as selected.
      const mainOpts: L.PolylineOptions = {
        color: isSel ? SEL_COLOR : style.stroke,
        weight: isSel
          ? Math.max(style.strokeWidth + (isPrimary ? 4 : 3), isPrimary ? 6 : 5)
          : style.strokeWidth,
        fillColor: isSel ? SEL_COLOR : style.stroke,
        fillOpacity: closed ? (isSel ? (isPrimary ? 0.4 : 0.35) : 0.18) : 0,
        fill: closed,
        dashArray: isSel ? undefined : style.dashArray ?? undefined,
        opacity: 1,
      };
      const main = closed ? L.polygon(latlngs, mainOpts) : L.polyline(latlngs, mainOpts);
      // Route on-shape clicks through the same forgiving picker as the map so
      // overlap-cycling works when clicking directly on stacked shapes too.
      main.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        const t = propsRef.current.tool;
        if (t === 'magic' || t === 'erase' || t === 'draw') return; // select suspended
        if (t === 'cut') {
          cutAtRef.current({ x: e.containerPoint.x, y: e.containerPoint.y });
          return;
        }
        if (t === 'join') {
          joinAtRef.current({ x: e.containerPoint.x, y: e.containerPoint.y });
          return;
        }
        pickAndSelectRef.current(
        { x: e.containerPoint.x, y: e.containerPoint.y },
        !!((e.originalEvent as MouseEvent)?.ctrlKey || (e.originalEvent as MouseEvent)?.metaKey),
      );
      });
      group.addLayer(main);

      if (isSel) {
        // Raise selected shapes above neighbours so highlights aren't occluded;
        // the primary drives vertex editing / live-drag.
        main.bringToFront();
        if (isPrimary) selectedLayerRef.current = main;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.annotations, props.visibility, props.selectedId, props.selectedIds, H]);

  // Redraw vertex + midpoint handles for the selected annotation.
  // Handles are size/zoom-aware: on small on-screen shapes they would cover the
  // polygon entirely (SAM vineyard polys have 20-50 verts but are ~10-25px on
  // screen), so we only draw them once the shape is large enough to edit.
  useEffect(() => {
    const group = handleGroupRef.current;
    const boxGroup = selBoxGroupRef.current;
    const map = mapRef.current;
    if (!group || !boxGroup || !map) return;

    // Minimum on-screen (CSS px) size of the selected shape's bounding box
    // before per-vertex handles are worth drawing.
    const MIN_ONSCREEN_PX = 70;
    // Above this vertex count, midpoint "ghost" add-handles double the clutter,
    // so we suppress them (rows/simple polys keep theirs).
    const MAX_MIDPOINT_VERTS = 16;

    // On-screen bounding box (container/CSS px) of an annotation's points.
    const bboxOf = (pts: Point[]) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const pt of pts) {
        const cp = map.latLngToContainerPoint(p2ll(pt) as L.LatLngExpression);
        if (cp.x < minX) minX = cp.x;
        if (cp.y < minY) minY = cp.y;
        if (cp.x > maxX) maxX = cp.x;
        if (cp.y > maxY) maxY = cp.y;
      }
      return { minX, minY, maxX, maxY };
    };

    const render = () => {
      group.clearLayers();
      boxGroup.clearLayers();
      const ids = propsRef.current.selectedIds;
      if (!ids || ids.length === 0) return;

      // Selection bounding-box indicator for EVERY selected shape: a bright
      // dashed rectangle a few px outside the shape's extent. Drawn at ANY size
      // so even a ~10px SAM shape gets an obvious box at fit-to-tile zoom.
      for (const id of ids) {
        const ann = propsRef.current.annotations.find((a) => a.id === id);
        if (!ann || propsRef.current.visibility[ann.label] === false) continue;
        if (ann.points.length === 0) continue;
        const { minX, minY, maxX, maxY } = bboxOf(ann.points);
        const tl = map.containerPointToLatLng(
          L.point(minX - SEL_BOX_PAD_PX, minY - SEL_BOX_PAD_PX),
        );
        const br = map.containerPointToLatLng(
          L.point(maxX + SEL_BOX_PAD_PX, maxY + SEL_BOX_PAD_PX),
        );
        L.rectangle(L.latLngBounds(tl, br), {
          color: SEL_COLOR,
          weight: 2,
          opacity: 1,
          dashArray: '6 4',
          fill: false,
          interactive: false,
          className: 'selection-box',
        }).addTo(boxGroup);
      }

      // Read-only: selection boxes above are fine (viewing), but never draw the
      // draggable vertex/midpoint handles — no geometry edits while locked.
      if (propsRef.current.readOnly) return;

      // Per-vertex handles render ONLY when exactly one shape is selected (the
      // primary), and only once it's large enough to edit (the 70px gate that
      // avoids the "black blob" of overlapping handles on tiny shapes).
      if (ids.length !== 1) return;
      const ann = propsRef.current.annotations.find((a) => a.id === ids[0]);
      if (!ann || propsRef.current.visibility[ann.label] === false) return;
      const closed = ann.shape_type !== 'polyline';
      const pts = ann.points;
      if (pts.length === 0) return;
      // Edit handles only in Select mode — in Join/Cut/Erase/Draw they would
      // swallow clicks meant for the tool (e.g. the 2nd road in Join).
      const tl = propsRef.current.tool;
      if (tl && tl !== 'select') return;
      const { minX, minY, maxX, maxY } = bboxOf(pts);
      const onScreenSize = Math.max(maxX - minX, maxY - minY);
      if (onScreenSize < MIN_ONSCREEN_PX) return;

      renderHandles(group, ann, closed, pts, MAX_MIDPOINT_VERTS);
    };

    render();
    map.on('zoomend moveend', render);
    return () => {
      map.off('zoomend moveend', render);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.annotations, props.selectedId, props.selectedIds, props.selectedVertex, props.selectedVertices, props.visibility, props.readOnly, props.tool, H]);

  // Draw the per-vertex draggable handles (+ midpoint add-handles on low-vertex
  // shapes) for one annotation into the given layer group.
  function renderHandles(
    group: L.LayerGroup,
    ann: Annotation,
    closed: boolean,
    pts: Point[],
    maxMidpointVerts: number,
  ) {
    const selectedVertex = propsRef.current.selectedVertex;
    const vGroup = propsRef.current.selectedVertices ?? [];

    // Vertex handles (draggable).
    pts.forEach((pt, idx) => {
      const state = idx === selectedVertex || vGroup.includes(idx) ? vtok.selected : vtok.default;
      const r = state.radius;
      // Visible dot keeps its token radius; the marker's icon (its hit target)
      // is enlarged with a transparent ring so points are easy to grab.
      const hit = Math.max(r, HANDLE_HIT_RADIUS_PX);
      const icon = L.divIcon({
        className: '',
        html: `<div class="vertex-hit" style="width:${hit * 2}px;height:${hit * 2}px;"><div class="vertex-handle" style="width:${r * 2}px;height:${r * 2}px;background:${state.fill};border:${state.strokeWidth}px solid ${state.stroke};"></div></div>`,
        iconSize: [hit * 2, hit * 2],
        iconAnchor: [hit, hit],
      });
      const marker = L.marker(p2ll(pt), { icon, draggable: true, keyboard: false });
      // Shift+click toggles the point in/out of the multi-point selection;
      // a plain click selects just this point (unless it's already part of a
      // group you are about to drag).
      marker.on('mousedown', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        const additive = !!(e.originalEvent as MouseEvent)?.shiftKey;
        const grp = propsRef.current.selectedVertices ?? [];
        if (additive) propsRef.current.onSelectVertex(idx, true);
        else if (!grp.includes(idx)) propsRef.current.onSelectVertex(idx);
      });
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
      });
      // Keep the dragged point inside the image: it stops at the edge.
      const clampPt = (q: Point): Point => {
        const W = propsRef.current.width || 2048;
        const Hh = propsRef.current.height || 2048;
        return [Math.min(Math.max(q[0], 0), W), Math.min(Math.max(q[1], 0), Hh)];
      };
      // Group drag: if this point is part of a multi-point selection, the
      // whole group moves by the same delta (clamped so none leave the image).
      const groupNow = () => {
        const g = propsRef.current.selectedVertices ?? [];
        return g.length > 1 && g.includes(idx) ? g : null;
      };
      const groupDelta = (raw: Point): [number, number] => {
        const g = groupNow();
        const W = propsRef.current.width || 2048;
        const Hh = propsRef.current.height || 2048;
        let dx = raw[0] - pt[0];
        let dy = raw[1] - pt[1];
        if (g) {
          for (const i of g) {
            const [x, y] = pts[i];
            dx = Math.min(Math.max(dx, -x), W - x);
            dy = Math.min(Math.max(dy, -y), Hh - y);
          }
        }
        return [dx, dy];
      };
      marker.on('drag', () => {
        const g = groupNow();
        const layer = selectedLayerRef.current;
        if (g) {
          const [dx, dy] = groupDelta(ll2p(marker.getLatLng()));
          marker.setLatLng(p2ll([pt[0] + dx, pt[1] + dy]) as L.LatLngExpression);
          if (!layer) return;
          const set = new Set(g);
          (layer as L.Polyline).setLatLngs(
            pts.map((q, i) => (set.has(i) ? p2ll([q[0] + dx, q[1] + dy]) : p2ll(q))),
          );
          return;
        }
        const c = clampPt(ll2p(marker.getLatLng()));
        marker.setLatLng(p2ll(c) as L.LatLngExpression); // pin the handle at the edge
        // live-update the selected path geometry for visual feedback
        if (!layer) return;
        const current = [...pts];
        current[idx] = c;
        (layer as L.Polyline).setLatLngs(current.map(p2ll));
      });
      marker.on('dragend', () => {
        const g = groupNow();
        if (g && propsRef.current.onMoveVertices) {
          const [dx, dy] = groupDelta(ll2p(marker.getLatLng()));
          propsRef.current.onMoveVertices(ann.id, g, dx, dy);
          return;
        }
        propsRef.current.onMoveVertex(ann.id, idx, clampPt(ll2p(marker.getLatLng())));
      });
      group.addLayer(marker);
    });

    // Midpoint "ghost" add handles — skipped on dense polygons where they
    // double the on-shape clutter (kept for rows / simple low-vertex shapes).
    if (pts.length > maxMidpointVerts) return;
    const segCount = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const r = vtok.midpointAdd.radius;
      const hit = Math.max(r, HANDLE_HIT_RADIUS_PX);
      const icon = L.divIcon({
        className: '',
        html: `<div class="vertex-hit" style="width:${hit * 2}px;height:${hit * 2}px;"><div class="vertex-handle" style="width:${r * 2}px;height:${r * 2}px;background:${vtok.midpointAdd.fill};border:${vtok.midpointAdd.strokeWidth}px solid ${vtok.midpointAdd.stroke};"></div></div>`,
        iconSize: [hit * 2, hit * 2],
        iconAnchor: [hit, hit],
      });
      const marker = L.marker(p2ll(mid), { icon, interactive: true, keyboard: false });
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        propsRef.current.onInsertVertex(ann.id, i, mid);
      });
      group.addLayer(marker);
    }
  }

  return (
    <>
      <div className="map-canvas" ref={containerRef} />
      {props.tool === 'erase' && brush && (
        // Live eraser brush: a circle centered on the cursor. Non-interactive so
        // it never intercepts the drag; aria-hidden (purely visual affordance).
        <div
          className="erase-brush"
          style={{
            left: brush.x,
            top: brush.y,
            width: ERASE_RADIUS_PX * 2,
            height: ERASE_RADIUS_PX * 2,
          }}
          aria-hidden="true"
        />
      )}
      {badge && (
        // Transient visual hint following the cursor; aria-hidden so screen
        // readers aren't spammed on every hover — commit announces via toast.
        <div
          className="magic-badge"
          style={{ left: badge.x, top: badge.y }}
          aria-hidden="true"
        >
          {badge.label} · {Math.round(badge.confidence * 100)}%
        </div>
      )}
    </>
  );
}
