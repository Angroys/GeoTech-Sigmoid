import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import type { Annotation, AnnotationIn, Label, TileStatus, VerificationStatus } from '../types';
import { MapCanvas } from '../viewer/MapCanvas';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { overlayStyle } from '../tokens';

type Point = [number, number];

// Class palette for the panel. Maps UI classes -> backend labels.
const CLASSES: { key: number; label: Label; name: string }[] = [
  { key: 1, label: 'row', name: 'rows' },
  { key: 2, label: 'vineyard', name: 'canopies' },
  { key: 3, label: 'interrow_area', name: 'inter-row' },
];
const ALL_LABELS: Label[] = ['row', 'vineyard', 'interrow_area', 'waste'];
const LABEL_NAME: Record<Label, string> = {
  row: 'rows',
  vineyard: 'canopies',
  interrow_area: 'inter-row',
  waste: 'waste',
};

function swatchColor(label: Label): string {
  return overlayStyle(label, {}).stroke;
}

export function TileViewer() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<VerificationStatus>('unchecked');
  const [visibility, setVisibility] = useState<Record<Label, boolean>>({
    row: true,
    vineyard: true,
    interrow_area: true,
    waste: true,
  });
  const [height, setHeight] = useState(2048);
  const [width, setWidth] = useState(2048);
  const [coord, setCoord] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tileOrder, setTileOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref of state used inside keyboard handler to avoid stale closures.
  const stateRef = useRef({
    annotations,
    selectedId,
    selectedVertex,
    undoStack,
    redoStack,
    dirty,
  });
  stateRef.current = { annotations, selectedId, selectedVertex, undoStack, redoStack, dirty };

  const selected = useMemo(
    () => annotations.find((a) => a.id === selectedId) ?? null,
    [annotations, selectedId],
  );

  // Load tile data.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
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
      setAnnotations(ann.annotations);
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

  useEffect(() => {
    api.listTiles().then((r) => setTileOrder(r.tiles.map((t) => t.name).sort())).catch(() => {});
  }, []);

  // ---- Mutation helpers with undo/redo ----
  const commit = useCallback((updater: (prev: Annotation[]) => Annotation[]) => {
    setAnnotations((prev) => {
      const next = updater(prev);
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
    const { selectedId: sid, selectedVertex: sv } = stateRef.current;
    if (sid == null || sv == null) return;
    commit((prev) =>
      prev.map((a) => {
        if (a.id !== sid) return a;
        const min = a.shape_type === 'polyline' ? 2 : 3;
        if (a.points.length <= min) return a;
        return { ...a, points: a.points.filter((_, i) => i !== sv) };
      }),
    );
    setSelectedVertex(null);
  }, [commit]);

  const deleteAnnotation = useCallback(() => {
    const { selectedId: sid } = stateRef.current;
    if (sid == null) return;
    commit((prev) => prev.filter((a) => a.id !== sid));
    setSelectedId(null);
    setSelectedVertex(null);
  }, [commit]);

  const setClass = useCallback(
    (label: Label) => {
      const { selectedId: sid } = stateRef.current;
      if (sid == null) return;
      commit((prev) => prev.map((a) => (a.id === sid ? { ...a, label } : a)));
    },
    [commit],
  );

  const setAttr = useCallback(
    (key: 'row_structure' | 'interrow_cover', value: string) => {
      const { selectedId: sid } = stateRef.current;
      if (sid == null) return;
      commit((prev) =>
        prev.map((a) =>
          a.id === sid ? { ...a, attributes: { ...a.attributes, [key]: value } } : a,
        ),
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

  // ---- Save / verify / navigation ----
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const payload: AnnotationIn[] = stateRef.current.annotations.map((a) => ({
        label: a.label,
        shape_type: a.shape_type,
        points: a.points,
        attributes: a.attributes,
        source: a.source,
        occluded: a.occluded,
        z_order: a.z_order,
      }));
      const res = await api.putAnnotations(name, payload);
      setAnnotations(res.annotations);
      setDirty(false);
      setUndoStack([]);
      setRedoStack([]);
      // Saving edits implies work in progress.
      if (status === 'unchecked') {
        try {
          await api.putStatus(name, 'in_progress');
          setStatus('in_progress');
        } catch {
          /* non-fatal */
        }
      }
      toast.push('Saved', 'success');
    } catch (e) {
      toast.push(`Save failed: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [name, status, toast]);

  const verify = useCallback(async () => {
    try {
      await api.putStatus(name, 'verified');
      setStatus('verified');
      toast.push('Marked verified', 'success');
    } catch (e) {
      toast.push(`Verify failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  }, [name, toast]);

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
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
        return;
      const meta = e.metaKey || e.ctrlKey;

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

      switch (e.key) {
        case '1':
          setClass('row');
          break;
        case '2':
          setClass('vineyard');
          break;
        case '3':
          setClass('interrow_area');
          break;
        case 'q':
        case 'Q':
          toggleAttrForCurrentClass('A');
          break;
        case 'w':
        case 'W':
          toggleAttrForCurrentClass('B');
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
          if (stateRef.current.selectedVertex != null) deleteVertex();
          else if (stateRef.current.selectedId != null) deleteAnnotation();
          break;
        case 'Escape':
          if (stateRef.current.selectedId != null) {
            setSelectedId(null);
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
        <Button variant="primary" onClick={() => void save()} loading={saving} title="Save (⌘S)">
          Save ⌘S
        </Button>
        <Button variant="verify" onClick={() => void verify()} title="Mark verified (V)">
          ✓ Verify
        </Button>
      </div>

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
              selectedVertex={selectedVertex}
              visibility={visibility}
              onSelectAnnotation={(id) => {
                setSelectedId(id);
                setSelectedVertex(null);
              }}
              onSelectVertex={setSelectedVertex}
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
            <h3>Class</h3>
            <div className="class-list">
              {CLASSES.map((c) => (
                <button
                  key={c.key}
                  className="class-item"
                  aria-pressed={selected?.label === c.label}
                  disabled={!selected}
                  onClick={() => setClass(c.label)}
                >
                  <span className="swatch" style={{ background: swatchColor(c.label) }} />
                  {c.name}
                  <span className="hotkey">{c.key}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <h3>Attributes</h3>
            {!selected && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-xs)' }}>
                Select a shape to edit.
              </p>
            )}
            {selected?.label === 'row' && (
              <div className="attr-list">
                <label className="radio-row">
                  <input
                    type="radio"
                    name="row_structure"
                    checked={selected.attributes.row_structure !== 'disrupted'}
                    onChange={() => setAttr('row_structure', 'regular')}
                  />
                  regular <span className="hotkey">Q</span>
                </label>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="row_structure"
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
                    checked={selected.attributes.interrow_cover !== 'mixed'}
                    onChange={() => setAttr('interrow_cover', 'bare_soil')}
                  />
                  bare_soil <span className="hotkey">Q</span>
                </label>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="interrow_cover"
                    checked={selected.attributes.interrow_cover === 'mixed'}
                    onChange={() => setAttr('interrow_cover', 'mixed')}
                  />
                  mixed <span className="hotkey">W</span>
                </label>
              </div>
            )}
            {selected && selected.label !== 'row' && selected.label !== 'interrow_area' && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-xs)' }}>
                No attributes for {LABEL_NAME[selected.label]}.
              </p>
            )}
          </section>

          <section className="panel-section">
            <h3>Layers</h3>
            <div className="layer-list">
              {ALL_LABELS.map((lbl) => (
                <label key={lbl} className="check-row">
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
              ))}
            </div>
          </section>

          <section className="panel-section">
            <h3>Edit</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={undo} disabled={undoStack.length === 0}>
                Undo ⌘Z
              </Button>
              <Button size="sm" onClick={redo} disabled={redoStack.length === 0}>
                Redo ⌘⇧Z
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={deleteAnnotation}
                disabled={!selected}
              >
                Delete shape
              </Button>
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-xs)', marginTop: 8 }}>
              {annotations.length} shapes · {selected ? `sel #${selectedId?.slice(0, 6)}` : 'none selected'}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
