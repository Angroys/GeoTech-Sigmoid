import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import type {
  Annotation,
  AnnotationIn,
  Label,
  SegmentHint,
  SegmentHit,
  Tool,
  VerificationStatus,
} from '../types';
import { MapCanvas } from '../viewer/MapCanvas';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { CollabBar } from '../components/CollabBar';
import { useCollab } from '../collab';
import { overlayStyle } from '../tokens';
import type { LockInfo } from '../types';

type Point = [number, number];

// Class palette for the panel. Maps UI classes -> backend labels. In select
// mode a button relabels the selection; in draw mode it picks the "draw-as"
// label. Hotkeys 1-5 mirror the `key` field.
const CLASSES: { key: number; label: Label; name: string }[] = [
  { key: 1, label: 'row', name: 'rows' },
  { key: 2, label: 'vineyard', name: 'canopies' },
  { key: 3, label: 'interrow_area', name: 'inter-row' },
  { key: 4, label: 'waste', name: 'waste' },
  { key: 5, label: 'dead_vine', name: 'dead vine' },
];
const ALL_LABELS: Label[] = ['row', 'vineyard', 'interrow_area', 'waste', 'dead_vine'];
const LABEL_NAME: Record<Label, string> = {
  row: 'rows',
  vineyard: 'canopies',
  interrow_area: 'inter-row',
  waste: 'waste',
  dead_vine: 'dead vine',
};
// Each label's natural geometry: rows are lines, everything else is an area.
// The Draw tool consults this to decide polyline vs polygon.
const LABEL_SHAPE: Record<Label, 'polygon' | 'polyline'> = {
  row: 'polyline',
  vineyard: 'polygon',
  interrow_area: 'polygon',
  waste: 'polygon',
  dead_vine: 'polygon',
};
// Fully-visible layer map (used by init + "Show all"), derived from ALL_LABELS.
const allVisible = (): Record<Label, boolean> =>
  ALL_LABELS.reduce((acc, l) => ({ ...acc, [l]: true }), {} as Record<Label, boolean>);

function swatchColor(label: Label): string {
  return overlayStyle(label, {}).stroke;
}

// Magic-draw hint override (segmented control). `auto` lets the backend guess.
const HINTS: { key: SegmentHint; name: string }[] = [
  { key: 'auto', name: 'Auto' },
  { key: 'canopy', name: 'Canopy' },
  { key: 'waste', name: 'Waste' },
  { key: 'road', name: 'Road' },
];

// The backend sends numeric annotation ids and numeric attribute values
// (e.g. area_m2, length_m, score). The UI treats id as a string (`.slice`,
// keys) and renders attribute values in text inputs, so normalize both to
// strings on load/save to avoid `x.slice is not a function` render crashes.
// crypto.randomUUID() only exists in secure contexts (HTTPS / localhost). The
// app is served over plain HTTP on the LAN/Headscale IP, where it is undefined
// and throws — which silently broke the Draw tool. Use a safe local id instead.
let _idSeq = 0;
// Monotone-chain convex hull (tile px). Used to join road pieces into one strip.
function convexHull(pts: Point[]): Point[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function newId(): string {
  _idSeq += 1;
  return `new-${Date.now().toString(36)}-${_idSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAnnotations(anns: Annotation[]): Annotation[] {
  return anns.map((a) => ({
    ...a,
    id: String(a.id),
    attributes: Object.fromEntries(
      Object.entries(a.attributes ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]),
    ),
  }));
}

export function TileViewer() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { clientId, name: displayName, setCurrentTile } = useCollab();

  // Read-only when another labeler holds this tile's lock. All mutations funnel
  // through `commit`, so guarding that (via readOnlyRef) blocks every edit path.
  const [readOnly, setReadOnly] = useState(false);
  const [lockedBy, setLockedBy] = useState<LockInfo | null>(null);
  const readOnlyRef = useRef(false);
  readOnlyRef.current = readOnly;
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Full selection set. `selectedId` is the PRIMARY/active member (drives vertex
  // editing + which shape's attributes the panel focuses); `selectedIds` always
  // includes it. Panel/class/tag/delete edits apply to every id in this set.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  // Multi-point selection on the selected shape (Shift+click / Shift+drag box).
  const [vertexGroup, setVertexGroup] = useState<number[]>([]);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<VerificationStatus>('unchecked');
  const [visibility, setVisibility] = useState<Record<Label, boolean>>(allVisible);
  const [height, setHeight] = useState(2048);
  const [width, setWidth] = useState(2048);
  // Overlay opacity multiplier (0..1); dim to peek at imagery under labels.
  const [overlayOpacity, setOverlayOpacity] = useState(1);
  const [coord, setCoord] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tileOrder, setTileOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');
  // Active editing tool (select / magic / cut / erase). Mutually exclusive;
  // `magicMode` is derived so the existing magic-draw wiring stays unchanged.
  const [tool, setTool] = useState<Tool>('select');
  const magicMode = tool === 'magic';
  // Which label the Draw tool lays down. Geometry follows LABEL_SHAPE[drawLabel].
  const [drawLabel, setDrawLabel] = useState<Label>('vineyard');
  // Imperative bridge to MapCanvas's in-progress drawing (finish / remove last
  // vertex / cancel), driven from the keyboard handler. Mirrors `pickRef`.
  const drawCtlRef = useRef<{
    finish: () => void;
    removeLast: () => void;
    cancel: () => boolean;
  } | null>(null);
  // Magic-draw class hint override + in-flight detect state.
  const [magicHint, setMagicHint] = useState<SegmentHint>('auto');
  const [detecting, setDetecting] = useState(false);

  // Resolver populated by MapCanvas: returns the id of the shape under the
  // pointer (or null), used by the SPACE multi-select toggle.
  const pickRef = useRef<(() => string | null) | null>(null);
  // Undo baseline captured at eraser brush-down so the whole drag commits as
  // one step (erase previews mutate `annotations` without touching undo).
  const eraseBaseRef = useRef<Annotation[] | null>(null);
  // Join tool: the first-picked row (polyline) id, highlighted as pending until
  // a second row is clicked (then merged) or the pick is cleared (Esc / same
  // line / leaving the tool).
  const joinPendingRef = useRef<string | null>(null);

  // Keep a ref of state used inside keyboard handler to avoid stale closures.
  const stateRef = useRef({
    annotations,
    selectedId,
    selectedIds,
    selectedVertex,
    vertexGroup,
    undoStack,
    redoStack,
    dirty,
    tool,
  });
  stateRef.current = {
    annotations,
    selectedId,
    selectedIds,
    selectedVertex,
    vertexGroup,
    undoStack,
    redoStack,
    dirty,
    tool,
  };

  const selected = useMemo(
    () => annotations.find((a) => a.id === selectedId) ?? null,
    [annotations, selectedId],
  );

  // Load tile data.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setSelectedIds([]);
    setSelectedVertex(null);
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    try {
      const [ann, geo, st] = await Promise.all([
        api.getAnnotations(name),
        api.tileGeo(name).catch(() => null),
        api.getStatus(name).catch(() => null),
      ]);
      setAnnotations(normalizeAnnotations(ann.annotations));
      if (geo) {
        setHeight(geo.height || 2048);
        setWidth(geo.width || 2048);
      }
      if (st) setStatus(st.verification_status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Claim / read-only / release ----
  // On open, try to take the lock. ok:false → read-only (someone else holds it).
  // Report the tile to presence so our lock is kept alive by the heartbeat, and
  // release it on unmount / navigate-away / tab close.
  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setCurrentTile(name);
    setReadOnly(false);
    setLockedBy(null);

    (async () => {
      try {
        const res = await api.claimTile(name, clientId, displayNameRef.current || 'Anonymous');
        if (cancelled) return;
        if (res.ok) {
          setReadOnly(false);
          setLockedBy(null);
        } else {
          setReadOnly(true);
          setLockedBy(res.locked_by);
          setTool('select');
        }
      } catch {
        // Collab endpoint down → don't block labeling; allow editing.
        if (!cancelled) setReadOnly(false);
      }
    })();

    // Best-effort release if the whole tab goes away (fetch may be cut short,
    // but the server also expires locks when our heartbeat stops).
    const onLeave = () => {
      api.releaseTile(name, clientId).catch(() => {});
    };
    window.addEventListener('pagehide', onLeave);

    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', onLeave);
      setCurrentTile(null);
      api.releaseTile(name, clientId).catch(() => {});
    };
  }, [name, clientId, setCurrentTile]);

  useEffect(() => {
    api.listTiles().then((r) => setTileOrder(r.tiles.map((t) => t.name).sort())).catch(() => {});
  }, []);

  // ---- Mutation helpers with undo/redo ----
  // Image size for clamping (read inside stable callbacks).
  const sizeRef = useRef({ w: 2048, h: 2048 });
  sizeRef.current = { w: width || 2048, h: height || 2048 };
  const commit = useCallback((updater: (prev: Annotation[]) => Annotation[]) => {
    if (readOnlyRef.current) return; // locked by someone else — no edits
    setAnnotations((prev) => {
      // Every edit goes through here: clamp all points to the image bounds so
      // no shape (drag, move, cut, join, draw) can extend past the tile edge.
      const { w, h } = sizeRef.current;
      const next = updater(prev).map((a) => {
        let out = false;
        for (const [x, y] of a.points) if (x < 0 || y < 0 || x > w || y > h) { out = true; break; }
        if (!out) return a;
        return {
          ...a,
          points: a.points.map(([x, y]) => [Math.min(Math.max(x, 0), w), Math.min(Math.max(y, 0), h)] as Point),
        };
      });
      setUndoStack((u) => [...u, prev]);
      setRedoStack([]);
      setDirty(true);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const prev = u[u.length - 1];
      setRedoStack((r) => [...r, stateRef.current.annotations]);
      setAnnotations(prev);
      setDirty(true);
      return u.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setUndoStack((u) => [...u, stateRef.current.annotations]);
      setAnnotations(next);
      setDirty(true);
      return r.slice(0, -1);
    });
  }, []);

  const moveVertex = useCallback(
    (id: string, idx: number, point: Point) => {
      commit((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, points: a.points.map((p, i) => (i === idx ? point : p)) }
            : a,
        ),
      );
    },
    [commit],
  );

  // Select a point; with `additive` (Shift) toggle it in the multi-point group.
  const selectVertex = useCallback((idx: number | null, additive?: boolean) => {
    if (idx == null) {
      setSelectedVertex(null);
      setVertexGroup([]);
      return;
    }
    if (additive) {
      setVertexGroup((g) => {
        const base = g.length ? g : stateRef.current.selectedVertex != null ? [stateRef.current.selectedVertex] : [];
        const next = base.includes(idx) ? base.filter((i) => i !== idx) : [...base, idx];
        setSelectedVertex(next.length ? next[next.length - 1] : null);
        return next;
      });
      return;
    }
    setSelectedVertex(idx);
    setVertexGroup([idx]);
  }, []);

  const moveVertices = useCallback(
    (id: string, idxs: number[], dx: number, dy: number) => {
      const set = new Set(idxs);
      commit((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, points: a.points.map((p, i) => (set.has(i) ? ([p[0] + dx, p[1] + dy] as Point) : p)) }
            : a,
        ),
      );
    },
    [commit],
  );

  const boxSelectVertices = useCallback((idxs: number[]) => {
    setVertexGroup(idxs);
    setSelectedVertex(idxs.length ? idxs[0] : null);
    if (idxs.length) toast.push(`${idxs.length} point${idxs.length > 1 ? 's' : ''} selected`, 'info');
  }, [toast]);

  // A different shape = a fresh point selection.
  useEffect(() => {
    setVertexGroup([]);
  }, [selectedId]);

  const insertVertex = useCallback(
    (id: string, afterIdx: number, point: Point) => {
      commit((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const pts = [...a.points];
          pts.splice(afterIdx + 1, 0, point);
          return { ...a, points: pts };
        }),
      );
      setSelectedVertex(afterIdx + 1);
    },
    [commit],
  );

  const deleteVertex = useCallback(() => {
    const { selectedId: sid, selectedVertex: sv, vertexGroup: vg } = stateRef.current;
    if (sid == null || sv == null) return;
    const del = new Set(vg && vg.length ? [...vg, sv] : [sv]);
    commit((prev) =>
      prev.map((a) => {
        if (a.id !== sid) return a;
        const min = a.shape_type === 'polyline' ? 2 : 3;
        const kept = a.points.filter((_, i) => !del.has(i));
        if (kept.length < min) return a; // would destroy the shape — keep it
        return { ...a, points: kept };
      }),
    );
    setSelectedVertex(null);
    setVertexGroup([]);
  }, [commit]);

  const deleteAnnotation = useCallback(() => {
    const ids = stateRef.current.selectedIds;
    if (ids.length === 0) return;
    const idset = new Set(ids);
    commit((prev) => prev.filter((a) => !idset.has(a.id)));
    setSelectedId(null);
    setSelectedIds([]);
    setSelectedVertex(null);
  }, [commit]);

  const setClass = useCallback(
    (label: Label) => {
      const ids = stateRef.current.selectedIds;
      if (ids.length === 0) return;
      const idset = new Set(ids);
      commit((prev) => prev.map((a) => (idset.has(a.id) ? { ...a, label } : a)));
    },
    [commit],
  );

  const setAttr = useCallback(
    (key: string, value: string) => {
      const ids = stateRef.current.selectedIds;
      if (ids.length === 0 || key === '') return;
      const idset = new Set(ids);
      commit((prev) =>
        prev.map((a) =>
          idset.has(a.id) ? { ...a, attributes: { ...a.attributes, [key]: value } } : a,
        ),
      );
    },
    [commit],
  );

  const removeAttr = useCallback(
    (key: string) => {
      const ids = stateRef.current.selectedIds;
      if (ids.length === 0) return;
      const idset = new Set(ids);
      commit((prev) =>
        prev.map((a) => {
          if (!idset.has(a.id)) return a;
          const rest = { ...a.attributes };
          delete rest[key];
          return { ...a, attributes: rest };
        }),
      );
    },
    [commit],
  );

  const toggleAttrForCurrentClass = useCallback(
    (which: 'A' | 'B') => {
      const sel = stateRef.current.annotations.find(
        (a) => a.id === stateRef.current.selectedId,
      );
      if (!sel) return;
      if (sel.label === 'row') {
        setAttr('row_structure', which === 'A' ? 'regular' : 'disrupted');
      } else if (sel.label === 'interrow_area') {
        setAttr('interrow_cover', which === 'A' ? 'bare_soil' : 'mixed');
      }
    },
    [setAttr],
  );

  // ---- Magic draw ----
  // Commit a detected shape as a NEW annotation: append via `commit` (undo +
  // dirty), auto-select it, and toast. Shared by the hover-click and the
  // drag-scribble paths so both produce identical annotations.
  const commitSegment = useCallback(
    (res: SegmentHit) => {
      const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newAnn: Annotation = {
        id,
        tile_name: name,
        label: res.label,
        shape_type: res.shape_type,
        points: res.points,
        attributes: { confidence: String(res.confidence), reason: res.reason, source: 'magic' },
        source: 'magic',
        occluded: 0,
        z_order: 0,
      };
      commit((prev) => [...prev, newAnn]);
      setSelectedId(id);
      setSelectedIds([id]);
      setSelectedVertex(null);
      toast.push(`Added ${res.label} (${Math.round(res.confidence * 100)}%)`, 'success');
    },
    [name, commit, toast],
  );

  // ---- Draw tool ----
  // Finish handler for the Draw tool: append the just-drawn shape as a NEW
  // annotation (one undo step), auto-select it, toast. Geometry type follows the
  // chosen label's form. Editable/relabelable/savable like any other annotation.
  const commitDrawing = useCallback(
    (points: Point[]) => {
      if (readOnlyRef.current) return;
      const newAnn: Annotation = {
        id: newId(),
        tile_name: name,
        label: drawLabel,
        shape_type: LABEL_SHAPE[drawLabel],
        points,
        attributes: { source: 'manual' },
        source: 'manual',
        occluded: 0,
        z_order: 0,
      };
      commit((prev) => [...prev, newAnn]);
      setVisibility((v) => (v[drawLabel] ? v : { ...v, [drawLabel]: true }));
      setSelectedId(newAnn.id);
      setSelectedIds([newAnn.id]);
      setSelectedVertex(null);
      toast.push(`Added ${LABEL_NAME[drawLabel]}`, 'success');
    },
    [name, drawLabel, commit, toast],
  );

  // Hover-preview detect (point mode). Returns the raw response so MapCanvas can
  // draw the dashed preview; `signal` aborts a superseded hover request.
  const magicDetect = useCallback(
    (path: Point[], signal: AbortSignal) => api.segment(name, path, magicHint, signal),
    [name, magicHint],
  );

  const magicError = useCallback(
    (e: unknown) => {
      toast.push(`Detect failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    },
    [toast],
  );

  // Drag-scribble: POST the whole freehand path, then commit the detected shape.
  const handleMagicScribble = useCallback(
    async (path: Point[]) => {
      if (path.length === 0 || detecting) return;
      setDetecting(true);
      try {
        const resp = await api.segment(name, path, magicHint);
        if ('found' in resp && resp.found === false) {
          toast.push('No object detected there.', 'info');
        } else {
          commitSegment(resp as SegmentHit);
        }
      } catch (e) {
        toast.push(`Detect failed: ${e instanceof Error ? e.message : e}`, 'error');
      } finally {
        setDetecting(false);
      }
    },
    [name, magicHint, detecting, commitSegment, toast],
  );

  // ---- Cut tool ----
  // Split a polyline at `splitPoint` (inserted after vertex `segIndex`) into two
  // new polylines that inherit the original's label/attributes/source. Ids are
  // generated OUTSIDE `commit` (like commitSegment) so the updater stays pure.
  const cutLine = useCallback(
    (id: string, segIndex: number, splitPoint: Point) => {
      if (readOnlyRef.current) return;
      const src = stateRef.current.annotations.find((a) => a.id === id);
      if (!src || src.shape_type !== 'polyline') {
        toast.push('Cut only splits lines.', 'info');
        return;
      }
      const pts = src.points;
      if (segIndex < 0 || segIndex >= pts.length - 1) return;
      const firstPts = [...pts.slice(0, segIndex + 1), splitPoint];
      const secondPts = [splitPoint, ...pts.slice(segIndex + 1)];
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const mk = (points: Point[], suffix: string): Annotation => ({
        ...src,
        id: `cut-${stamp}-${suffix}`,
        shape_type: 'polyline',
        points,
        attributes: { ...src.attributes },
      });
      // Each part must keep >= 2 points to be a valid polyline; drop any that don't.
      const parts: Annotation[] = [];
      if (firstPts.length >= 2) parts.push(mk(firstPts, 'a'));
      if (secondPts.length >= 2) parts.push(mk(secondPts, 'b'));
      if (parts.length === 0) return;
      const ids = parts.map((p) => p.id);
      commit((prev) => {
        const idx = prev.findIndex((a) => a.id === id);
        if (idx === -1) return prev;
        const next = [...prev];
        next.splice(idx, 1, ...parts);
        return next;
      });
      setSelectedId(ids[0]);
      setSelectedIds(ids);
      setSelectedVertex(null);
      toast.push('Line split', 'success');
    },
    [commit, toast],
  );

  // ---- Eraser tool ----
  // The drag is a single undo step: MapCanvas snapshots the working set and
  // streams live previews (no undo push); we capture the pre-drag baseline on
  // start and push it once on commit.
  const eraseStart = useCallback(() => {
    if (readOnlyRef.current) return;
    eraseBaseRef.current = stateRef.current.annotations;
  }, []);

  const erasePreview = useCallback((next: Annotation[]) => {
    if (readOnlyRef.current) return;
    setAnnotations(next); // live crop; NOT pushed to the undo stack
  }, []);

  const eraseCommit = useCallback((next: Annotation[], changed: boolean) => {
    if (readOnlyRef.current) return;
    const base = eraseBaseRef.current;
    eraseBaseRef.current = null;
    if (!changed) {
      if (base) setAnnotations(base); // nothing erased — restore untouched state
      return;
    }
    if (base) {
      setUndoStack((u) => [...u, base]); // one undo step for the whole drag
      setRedoStack([]);
    }
    setDirty(true);
    setAnnotations(next);
  }, []);

  // ---- Join tool ----
  // Clear the pending row highlight (and its selection, if it's still the
  // pending one — don't disturb a selection the user made in another tool).
  const clearJoinPending = useCallback(() => {
    const p = joinPendingRef.current;
    if (p == null) return;
    joinPendingRef.current = null;
    setSelectedId((cur) => (cur === p ? null : cur));
    setSelectedIds((cur) => (cur.length === 1 && cur[0] === p ? [] : cur));
  }, []);

  // Join ROADS (inter-row polygons): the result is ONE continuous inter-row
  // covering every picked piece AND the gap between them (e.g. a road split by
  // a tree). Inter-rows are straight strips along one corridor, so the convex
  // hull of all their vertices is exactly the full strip with the gap filled.
  const joinRoads = useCallback(
    (ids: string[]) => {
      if (readOnlyRef.current) return;
      const anns = stateRef.current.annotations;
      const picked = ids
        .map((id) => anns.find((x) => x.id === id))
        .filter((x): x is Annotation => !!x && x.label === 'interrow_area' && x.shape_type !== 'polyline');
      if (picked.length < 2) {
        toast.push('Join needs at least two inter-rows (roads).', 'info');
        return;
      }
      const W = width || 2048;
      const H = height || 2048;
      const all: Point[] = picked.flatMap((a) => a.points);
      const hull = convexHull(all).map(
        ([x, y]) => [Math.min(Math.max(x, 0), W), Math.min(Math.max(y, 0), H)] as Point,
      );
      if (hull.length < 3) return;
      const first = picked[0];
      const id = newId();
      const newAnn: Annotation = {
        ...first,
        id,
        shape_type: 'polygon',
        points: hull,
        attributes: { ...first.attributes },
      };
      const drop = new Set(picked.map((a) => a.id));
      commit((prev) => {
        const idx = prev.findIndex((x) => x.id === first.id);
        const filtered = prev.filter((x) => !drop.has(x.id));
        const insertAt = idx === -1 ? filtered.length : Math.min(idx, filtered.length);
        filtered.splice(insertAt, 0, newAnn);
        return filtered;
      });
      setSelectedId(id);
      setSelectedIds([id]);
      setSelectedVertex(null);
      toast.push(`Inter-rows joined (${picked.length} → 1)`, 'success');
    },
    [commit, toast, width, height],
  );

  // Join-tool click from MapCanvas: `id` is the nearest visible polyline, or
  // null on a miss. First click remembers + highlights the row; the second
  // (different) row triggers the merge. Same line / null clears or hints.
  const handleJoinPick = useCallback(
    (ids: string[]) => {
      if (readOnlyRef.current) return;
      // Overlapping road pieces: if the best hit is the already-picked road,
      // use the next road under the click instead.
      const pend = joinPendingRef.current;
      const id = (pend != null ? ids.find((x) => x !== pend) : undefined) ?? ids[0] ?? null;
      if (!id) {
        toast.push('Join works on inter-rows (roads) — click a road.', 'info');
        return;
      }
      const ann = stateRef.current.annotations.find((x) => x.id === id);
      if (!ann || ann.label !== 'interrow_area') {
        toast.push('Join works on inter-rows (roads) only.', 'info');
        return;
      }
      const pending = joinPendingRef.current;
      if (pending == null) {
        joinPendingRef.current = id;
        setSelectedId(id);
        setSelectedIds([id]);
        setSelectedVertex(null);
        toast.push('Pick the second road to join.', 'info');
        return;
      }
      if (pending === id) {
        clearJoinPending(); // clicked the same line — cancel
        return;
      }
      joinPendingRef.current = null;
      joinRoads([pending, id]);
    },
    [toast, clearJoinPending, joinRoads],
  );

  // Leaving the Join tool clears any pending pick.
  useEffect(() => {
    if (tool !== 'join') clearJoinPending();
  }, [tool, clearJoinPending]);

  // ---- Save / verify / navigation ----
  const saveInFlight = useRef(false);
  const saveAgain = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const save = useCallback(async (manual = true) => {
    if (readOnlyRef.current) {
      if (manual) toast.push('Read-only — this tile is locked by another user, cannot save', 'error');
      return;
    }
    // Never run two saves at once; remember to save again after this one.
    if (saveInFlight.current) {
      saveAgain.current = true;
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    const snapshot = stateRef.current.annotations;
    try {
      const payload: AnnotationIn[] = snapshot.map((a) => ({
        label: a.label,
        shape_type: a.shape_type,
        points: a.points,
        attributes: a.attributes,
        source: a.source,
        occluded: a.occluded,
        z_order: a.z_order,
      }));
      await api.putAnnotations(name, payload);
      // PUT fully replaces the tile server-side, so we keep the local shapes
      // (and their ids/selection/undo) as-is. Only clear "dirty" if nothing
      // was edited while this save was in flight — otherwise save again.
      if (stateRef.current.annotations === snapshot) setDirty(false);
      else saveAgain.current = true;
      setSaveError(false);
      // Saving edits implies work in progress.
      if (status === 'unchecked') {
        try {
          await api.putStatus(name, 'in_progress');
          setStatus('in_progress');
        } catch {
          /* non-fatal */
        }
      }
      if (manual) toast.push('Saved', 'success');
    } catch (e) {
      setSaveError(true);
      toast.push(`Save failed: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
      if (saveAgain.current) {
        saveAgain.current = false;
        void saveRef.current(false);
      }
    }
  }, [name, status, toast]);
  const saveRef = useRef(save);
  saveRef.current = save;

  // ---- Autosave: 1.2s after the last change, and when leaving the tile ----
  useEffect(() => {
    if (!dirty || readOnly) return;
    const t = window.setTimeout(() => void saveRef.current(false), 1200);
    return () => window.clearTimeout(t);
  }, [dirty, annotations, readOnly]);

  useEffect(() => {
    // Flush unsaved edits when navigating away from this tile / unmounting.
    return () => {
      if (stateRef.current.dirty && !readOnlyRef.current) void saveRef.current(false);
    };
  }, [name]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (stateRef.current.dirty && !readOnlyRef.current) {
        void saveRef.current(false);
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Reject a bad tile (poor imagery / unusable labels): it leaves everyone's
  // queue, moves to the Invalid tab, its lock is released, and it is excluded
  // from CVAT/GeoTIFF exports. Reversible by reopening it.
  const invalidate = useCallback(async () => {
    if (readOnlyRef.current) return;
    if (!window.confirm('Mark this image as INVALID? It will be removed from the queue and excluded from exports.')) return;
    try {
      await api.putStatus(name, 'invalid');
      setStatus('invalid');
      toast.push('Marked invalid', 'success');
      navigate('/');
    } catch (e) {
      toast.push(`Invalidate failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  }, [name, toast, navigate]);

  const restoreTile = useCallback(async () => {
    try {
      await api.putStatus(name, 'in_progress');
      setStatus('in_progress');
      toast.push('Restored to queue', 'success');
    } catch (e) {
      toast.push(`Restore failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  }, [name, toast]);

  const verify = useCallback(async () => {
    if (readOnlyRef.current) return;
    try {
      await api.putStatus(name, 'verified');
      setStatus('verified');
      toast.push('Marked verified', 'success');
      // Verified auto-releases the lock server-side; the tile now lives in Done.
      navigate('/');
    } catch (e) {
      toast.push(`Verify failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  }, [name, toast, navigate]);

  const gotoNeighbor = useCallback(
    (dir: -1 | 1) => {
      if (tileOrder.length === 0) return;
      const idx = tileOrder.indexOf(name);
      if (idx === -1) return;
      const next = idx + dir;
      if (next < 0 || next >= tileOrder.length) return;
      navigate(`/tile/${encodeURIComponent(tileOrder[next])}`);
    },
    [tileOrder, name, navigate],
  );

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const meta = e.metaKey || e.ctrlKey;
      // Save/undo ALWAYS work, whatever has focus (sliders/inputs used to
      // swallow Ctrl+S so the browser's "save page" ran instead).
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      // Only skip single-key hotkeys while the user is TYPING text. Sliders,
      // checkboxes, radios and buttons must not block Enter/Backspace/D/1-5.
      const tag = target.tagName;
      const inputType = (target as HTMLInputElement).type;
      const isTextEntry =
        tag === 'TEXTAREA' ||
        target.isContentEditable ||
        (tag === 'INPUT' && ['text', 'search', 'number', 'email', 'password', 'url', 'tel'].includes(inputType));
      if (isTextEntry) return;

      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta) return; // leave other cmd/ctrl combos to the browser

      // SPACE = toggle-add the shape under the pointer into the selection set
      // (accumulate multi-select) without clearing the rest, and make it the
      // new primary. Always preventDefault so the page never scrolls/pans.
      if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') {
        e.preventDefault();
        const id = pickRef.current ? pickRef.current() : null;
        if (!id) return; // nothing under pointer: no-op (but no scroll)
        const prev = stateRef.current.selectedIds;
        const has = prev.includes(id);
        const next = has ? prev.filter((x) => x !== id) : [...prev, id];
        setSelectedIds(next);
        if (has) {
          // Removed: if it was the primary, promote another remaining member.
          if (stateRef.current.selectedId === id) {
            setSelectedId(next.length ? next[next.length - 1] : null);
          }
        } else {
          setSelectedId(id); // added: it becomes the new primary
        }
        setSelectedVertex(null);
        return;
      }

      // 1-5 set the draw-as label while the Draw tool is active, otherwise
      // relabel the current selection.
      const applyLabel = (label: Label) => {
        if (stateRef.current.tool === 'draw') setDrawLabel(label);
        else setClass(label);
      };

      switch (e.key) {
        case '1':
          applyLabel('row');
          break;
        case '2':
          applyLabel('vineyard');
          break;
        case '3':
          applyLabel('interrow_area');
          break;
        case '4':
          applyLabel('waste');
          break;
        case '5':
          applyLabel('dead_vine');
          break;
        case 'q':
        case 'Q':
          toggleAttrForCurrentClass('A');
          break;
        case 'w':
        case 'W':
          toggleAttrForCurrentClass('B');
          break;
        case 'c':
        case 'C':
          if (!readOnlyRef.current) setTool((t) => (t === 'cut' ? 'select' : 'cut'));
          break;
        case 'e':
        case 'E':
          if (!readOnlyRef.current) setTool((t) => (t === 'erase' ? 'select' : 'erase'));
          break;
        case 'j':
        case 'J':
          if (readOnlyRef.current) break;
          {
            const sel = stateRef.current.selectedIds;
            const anns = stateRef.current.annotations;
            const roads = sel.filter((id) => anns.find((a) => a.id === id)?.label === 'interrow_area');
            if (roads.length >= 2) {
              joinRoads(roads); // Space-multi-selected roads + J = join them all
              break;
            }
          }
          setTool((t) => (t === 'join' ? 'select' : 'join'));
          break;
        case 'd':
        case 'D':
          if (!readOnlyRef.current) setTool((t) => (t === 'draw' ? 'select' : 'draw'));
          break;
        case 'Enter':
          // Draw tool: finish the in-progress shape.
          if (stateRef.current.tool === 'draw') {
            e.preventDefault();
            drawCtlRef.current?.finish();
          }
          break;
        case 'v':
        case 'V':
          void verify();
          break;
        case '[':
          gotoNeighbor(-1);
          break;
        case ']':
          gotoNeighbor(1);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          // Draw tool: Backspace removes the last placed vertex.
          if (stateRef.current.tool === 'draw') drawCtlRef.current?.removeLast();
          else if (stateRef.current.selectedVertex != null) deleteVertex();
          else if (stateRef.current.selectedId != null) deleteAnnotation();
          break;
        case 'Escape':
          // Join tool: first Esc clears a pending row pick (if any) before it
          // falls through to returning to the select tool.
          if (stateRef.current.tool === 'join' && joinPendingRef.current != null) {
            clearJoinPending();
            break;
          }
          // Draw tool: first Esc cancels the in-progress shape (if any), a
          // second one returns to the select tool.
          if (stateRef.current.tool === 'draw') {
            const hadShape = drawCtlRef.current?.cancel();
            if (!hadShape) setTool('select');
          } else if (stateRef.current.tool !== 'select') {
            // Esc returns to the select tool first (MapCanvas tears down any
            // magic preview / erase brush on the transition).
            setTool('select');
          } else if (stateRef.current.selectedId != null || stateRef.current.selectedIds.length > 0) {
            setSelectedId(null);
            setSelectedIds([]);
            setSelectedVertex(null);
          } else {
            navigate('/');
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    save,
    verify,
    undo,
    redo,
    setClass,
    toggleAttrForCurrentClass,
    deleteVertex,
    deleteAnnotation,
    gotoNeighbor,
    navigate,
    clearJoinPending,
    joinRoads,
  ]);

  const tileIdx = tileOrder.indexOf(name);

  return (
    <div className="viewer">
      <div className="toolbar">
        <Link to="/" className="btn btn--ghost">
          ‹ Nav
        </Link>
        <span className="mono" style={{ fontWeight: 600 }}>
          {name}
        </span>
        <StatusBadge status={status} />
        {dirty && (
          <span className="dirty-dot" title="Unsaved changes">
            ● unsaved
          </span>
        )}
        <CollabBar />
        <span className="spacer" />
        <div className="magic-tool" role="group" aria-label="Editing tools">
          <Button
            variant={tool === 'cut' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={tool === 'cut'}
            disabled={readOnly}
            onClick={() => setTool((t) => (t === 'cut' ? 'select' : 'cut'))}
            title="Cut line — click a canopy/row line to split it in two (C)"
          >
            ✂ Cut <span className="hotkey">C</span>
          </Button>
          <Button
            variant={tool === 'erase' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={tool === 'erase'}
            disabled={readOnly}
            onClick={() => setTool((t) => (t === 'erase' ? 'select' : 'erase'))}
            title="Erase rows — brush over a row line to cut that stretch out (E)"
          >
            ⌫ Erase rows <span className="hotkey">E</span>
          </Button>
          <Button
            variant={tool === 'join' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={tool === 'join'}
            disabled={readOnly}
            onClick={() => setTool((t) => (t === 'join' ? 'select' : 'join'))}
            title="Join rows — click two vine rows to merge them into one line (J)"
          >
            ⛓ Join <span className="hotkey">J</span>
          </Button>
          <Button
            variant={tool === 'draw' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={tool === 'draw'}
            disabled={readOnly}
            onClick={() => setTool((t) => (t === 'draw' ? 'select' : 'draw'))}
            title="Draw — click to place points; rows draw as lines, everything else as areas. Double-click or Enter to finish (D)"
          >
            ＋ Add polygon <span className="hotkey">D</span>
          </Button>
          <div
            className="segmented"
            role="radiogroup"
            aria-label="Magic draw class hint"
            aria-disabled={!magicMode || readOnly}
          >
            {HINTS.map((h) => (
              <button
                key={h.key}
                type="button"
                role="radio"
                aria-checked={magicHint === h.key}
                className="segmented__item"
                disabled={!magicMode || readOnly}
                onClick={() => setMagicHint(h.key)}
                title={`Force class: ${h.name}`}
              >
                {h.name}
              </button>
            ))}
          </div>
          {detecting && (
            <span className="magic-detecting" role="status" aria-live="polite">
              detecting…
            </span>
          )}
        </div>
        <span className="spacer" />
        <Button
          variant="ghost"
          size="sm"
          disabled={tileIdx <= 0}
          onClick={() => gotoNeighbor(-1)}
          title="Previous tile ( [ )"
        >
          [ Prev
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={tileIdx === -1 || tileIdx >= tileOrder.length - 1}
          onClick={() => gotoNeighbor(1)}
          title="Next tile ( ] )"
        >
          Next ]
        </Button>
        <Button
          variant="primary"
          onClick={() => void save()}
          loading={saving}
          disabled={readOnly}
          title="Save (Ctrl/⌘+S) — edits also autosave"
        >
          Save ⌘S
        </Button>
        <span
          className={`save-status ${saveError ? 'is-error' : dirty || saving ? 'is-pending' : 'is-ok'}`}
          role="status"
          aria-live="polite"
          onClick={saveError ? () => void save() : undefined}
          title={saveError ? 'Click to retry' : undefined}
        >
          {readOnly
            ? 'Read-only'
            : saveError
              ? 'Save failed — retry'
              : saving
                ? 'Saving…'
                : dirty
                  ? 'Unsaved…'
                  : 'Saved ✓'}
        </span>
        {tool === 'draw' && !readOnly && (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => drawCtlRef.current?.finish()}
              title="Finish the shape (Enter / double-click / click first point)"
            >
              ✓ Finish shape
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => drawCtlRef.current?.cancel()}
              title="Cancel the shape in progress (Esc)"
            >
              ✕ Cancel
            </Button>
          </>
        )}
        {status === 'invalid' ? (
          <Button variant="ghost" onClick={() => void restoreTile()} disabled={readOnly} title="Put this tile back in the queue">
            ↺ Restore
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="btn-invalidate"
            onClick={() => void invalidate()}
            disabled={readOnly}
            title="Mark this image as invalid (bad imagery / unusable) — excluded from exports"
          >
            ⊘ Invalidate
          </Button>
        )}
        <Button
          variant="verify"
          onClick={() => void verify()}
          disabled={readOnly}
          title="Mark verified (V)"
        >
          ✓ Verify
        </Button>
      </div>

      {readOnly && (
        <div className="readonly-banner" role="status" aria-live="polite">
          🔒 Locked by {lockedBy?.name ?? 'another labeler'} — read only. You can view,
          pan and toggle layers, but not edit.
        </div>
      )}

      <div className="viewer__body">
        <div className="map-wrap">
          {loading && <div className="empty-state">Loading tile…</div>}
          {error && <div className="empty-state error-band">Failed to load: {error}</div>}
          {!loading && !error && (
            <MapCanvas
              rasterUrl={api.rasterUrl(name)}
              height={height}
              width={width}
              annotations={annotations}
              selectedId={selectedId}
              selectedIds={selectedIds}
              selectedVertex={selectedVertex}
              visibility={visibility}
              overlayOpacity={overlayOpacity}
              readOnly={readOnly}
              tool={readOnly ? 'select' : tool}
              drawShape={LABEL_SHAPE[drawLabel]}
              drawColor={swatchColor(drawLabel)}
              onDrawCommit={commitDrawing}
              drawCtlRef={drawCtlRef}
              onMagicScribble={handleMagicScribble}
              onMagicDetect={magicDetect}
              onMagicCommit={commitSegment}
              onMagicError={magicError}
              onCutLine={cutLine}
              onCutMiss={() => toast.push('Click on a line to split it.', 'info')}
              onJoinPick={handleJoinPick}
              pickRef={pickRef}
              onSelectAnnotation={(id) => {
                // Plain click = single select: replace the whole set.
                setSelectedId(id);
                setSelectedIds(id ? [id] : []);
                setSelectedVertex(null);
              }}
              onSelectVertex={selectVertex}
              onEraseStart={eraseStart}
              onErasePreview={erasePreview}
              onEraseCommit={eraseCommit}
              selectedVertices={vertexGroup}
              onMoveVertices={moveVertices}
              onBoxSelectVertices={boxSelectVertices}
              onMoveVertex={moveVertex}
              onInsertVertex={insertVertex}
              onCoord={(x, y) => setCoord({ x, y })}
            />
          )}
          <div className="coord-readout">
            x:{coord.x} y:{coord.y} · 0.025 m/px
          </div>
        </div>

        <aside className="side-panel">
          <section className="panel-section">
            <h3>{tool === 'draw' ? 'Draw as' : 'Class'}</h3>
            <div className="class-list">
              {CLASSES.map((c) => {
                const active = tool === 'draw' ? drawLabel === c.label : selected?.label === c.label;
                const disabled = tool === 'draw' ? readOnly : !selected || readOnly;
                return (
                  <button
                    key={c.key}
                    className="class-item"
                    aria-pressed={active}
                    disabled={disabled}
                    onClick={() => (tool === 'draw' ? setDrawLabel(c.label) : setClass(c.label))}
                  >
                    <span className="swatch" style={{ background: swatchColor(c.label) }} />
                    {c.name}
                    <span className="hotkey">{c.key}</span>
                  </button>
                );
              })}
            </div>
            {tool === 'draw' && (
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-xs)', marginTop: 6 }}>
                Drawing <strong>{LABEL_NAME[drawLabel]}</strong> as a{' '}
                {LABEL_SHAPE[drawLabel] === 'polyline' ? 'line' : 'area'}. Click to place
                points; double-click or Enter to finish.
              </p>
            )}
          </section>

          <section className="panel-section">
            <h3>Attributes</h3>
            {!selected && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-xs)' }}>
                Select a shape to edit.
              </p>
            )}
            {selectedIds.length > 1 && (
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-xs)' }}>
                {selectedIds.length} selected — class &amp; tag edits apply to all.
              </p>
            )}
            {selected?.label === 'row' && (
              <div className="attr-list">
                <label className="radio-row">
                  <input
                    type="radio"
                    name="row_structure"
                    disabled={readOnly}
                    checked={selected.attributes.row_structure !== 'disrupted'}
                    onChange={() => setAttr('row_structure', 'regular')}
                  />
                  regular <span className="hotkey">Q</span>
                </label>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="row_structure"
                    disabled={readOnly}
                    checked={selected.attributes.row_structure === 'disrupted'}
                    onChange={() => setAttr('row_structure', 'disrupted')}
                  />
                  disrupted <span className="hotkey">W</span>
                </label>
              </div>
            )}
            {selected?.label === 'interrow_area' && (
              <div className="attr-list">
                <label className="radio-row">
                  <input
                    type="radio"
                    name="interrow_cover"
                    disabled={readOnly}
                    checked={selected.attributes.interrow_cover !== 'mixed'}
                    onChange={() => setAttr('interrow_cover', 'bare_soil')}
                  />
                  bare_soil <span className="hotkey">Q</span>
                </label>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="interrow_cover"
                    disabled={readOnly}
                    checked={selected.attributes.interrow_cover === 'mixed'}
                    onChange={() => setAttr('interrow_cover', 'mixed')}
                  />
                  mixed <span className="hotkey">W</span>
                </label>
              </div>
            )}
            {selected && (
              <div className="tag-editor">
                {Object.keys(selected.attributes).length === 0 && (
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-xs)' }}>
                    No tags yet.
                  </p>
                )}
                {Object.entries(selected.attributes).map(([key, value]) => (
                  <div key={key} className="tag-row">
                    <span className="tag-key" title={key}>
                      {key}
                    </span>
                    <input
                      className="tag-value"
                      type="text"
                      disabled={readOnly}
                      value={value == null ? '' : String(value)}
                      onChange={(e) => setAttr(key, e.target.value)}
                    />
                    <button
                      type="button"
                      className="tag-del"
                      disabled={readOnly}
                      aria-label={`Remove tag ${key}`}
                      title={`Remove tag ${key}`}
                      onClick={() => removeAttr(key)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="tag-add">
                  <input
                    className="tag-key-input"
                    type="text"
                    placeholder="key"
                    aria-label="New tag key"
                    disabled={readOnly}
                    value={newTagKey}
                    onChange={(e) => setNewTagKey(e.target.value)}
                  />
                  <input
                    className="tag-value"
                    type="text"
                    placeholder="value"
                    aria-label="New tag value"
                    disabled={readOnly}
                    value={newTagValue}
                    onChange={(e) => setNewTagValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTagKey.trim()) {
                        setAttr(newTagKey.trim(), newTagValue);
                        setNewTagKey('');
                        setNewTagValue('');
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!newTagKey.trim() || readOnly}
                    onClick={() => {
                      setAttr(newTagKey.trim(), newTagValue);
                      setNewTagKey('');
                      setNewTagValue('');
                    }}
                  >
                    + add tag
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="panel-section">
            <div className="layers-head">
              <h3>Layers</h3>
              <button
                type="button"
                className="layer-btn"
                onClick={() => setVisibility(allVisible())}
              >
                Show all
              </button>
            </div>
            <label className="opacity-row">
              <span>Overlay opacity</span>
              <input
                type="range"
                onPointerUp={(e) => e.currentTarget.blur()}
                onKeyUp={(e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') e.currentTarget.blur(); }}
                min={0}
                max={100}
                step={5}
                value={Math.round(overlayOpacity * 100)}
                onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
                aria-label="Overlay opacity — dim to see the imagery under labels"
              />
              <span className="opacity-val">{Math.round(overlayOpacity * 100)}%</span>
            </label>
            <div className="layer-list">
              {ALL_LABELS.map((lbl) => (
                <div key={lbl} className="check-row">
                  <label className="check-row__label">
                    <input
                      type="checkbox"
                      checked={visibility[lbl]}
                      onChange={(e) =>
                        setVisibility((v) => ({ ...v, [lbl]: e.target.checked }))
                      }
                    />
                    <span className="swatch" style={{ background: swatchColor(lbl) }} />
                    {LABEL_NAME[lbl]}
                  </label>
                  <button
                    type="button"
                    className="layer-btn"
                    aria-label={`Show only ${LABEL_NAME[lbl]}`}
                    title={`Show only ${LABEL_NAME[lbl]}`}
                    onClick={() =>
                      setVisibility(
                        ALL_LABELS.reduce(
                          (acc, l) => ({ ...acc, [l]: l === lbl }),
                          {} as Record<Label, boolean>,
                        ),
                      )
                    }
                  >
                    Only
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <h3>Edit</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={undo} disabled={undoStack.length === 0 || readOnly}>
                Undo ⌘Z
              </Button>
              <Button size="sm" onClick={redo} disabled={redoStack.length === 0 || readOnly}>
                Redo ⌘⇧Z
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={deleteAnnotation}
                disabled={!selected || readOnly}
              >
                Delete shape
              </Button>
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-xs)', marginTop: 8 }}>
              {annotations.length} shapes ·{' '}
              {selectedIds.length > 1
                ? `${selectedIds.length} selected`
                : selected
                  ? `sel #${String(selectedId ?? '').slice(0, 6)}`
                  : 'none selected'}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
