import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { ParcelShape, TileSummary } from '../types';
import { useCollab } from '../collab';
import { CollabBar } from '../components/CollabBar';

// Tile grid laid out by its survey position (siret3_rRRR_cCCC), coloured by
// verification status — a live progress map of the whole area.
const STATUS_COLOR: Record<string, string> = {
  verified: '#22C55E',
  in_progress: '#F5A623',
  unchecked: '#3A4254',
  invalid: '#FF5A5A',
};
// Translucent tints so the imagery stays visible under the status colour.
const STATUS_TINT: Record<string, string> = {
  verified: 'rgba(34, 197, 94, 0.38)',
  in_progress: 'rgba(245, 166, 35, 0.30)',
  unchecked: 'rgba(0, 0, 0, 0)',
  invalid: 'rgba(255, 90, 90, 0.45)',
};
const STATUS_TEXT: Record<string, string> = {
  verified: 'Verified',
  in_progress: 'In progress',
  unchecked: 'Open',
  invalid: 'Invalid',
};

function parseRC(name: string): [number, number] | null {
  const m = /_r(\d+)_c(\d+)/.exec(name);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}

export function MapView() {
  const navigate = useNavigate();
  const { clientId } = useCollab();
  const [tiles, setTiles] = useState<TileSummary[]>([]);
  const [hover, setHover] = useState<TileSummary | null>(null);
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [showStatus, setShowStatus] = useState(true);
  const [parcels, setParcels] = useState<ParcelShape[]>([]);
  const [showParcels, setShowParcels] = useState(true);

  const toast = useToast();
  const [editParcels, setEditParcels] = useState(false);
  const [selParcel, setSelParcel] = useState<number | null>(null);
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const [dirtyParcel, setDirtyParcel] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIdx = useRef<number | null>(null);

  const loadParcels = useCallback(() => {
    api.mapParcels().then((r) => setParcels(r.parcels)).catch(() => {});
  }, []);
  useEffect(() => {
    loadParcels();
  }, [loadParcels]);

  const selectParcel = (id: number | null) => {
    if (dirtyParcel && !window.confirm('Discard unsaved changes to this parcel?')) return;
    setSelParcel(id);
    const pc = parcels.find((x) => x.id === id);
    setDraft(pc ? (pc.points.map((q) => [q[0], q[1]]) as [number, number][]) : null);
    setDirtyParcel(false);
  };
  const saveParcel = async () => {
    if (selParcel == null || !draft) return;
    try {
      await api.updateParcel(selParcel, draft);
      toast.push('Parcel saved', 'success');
      setDirtyParcel(false);
      loadParcels();
    } catch (e) {
      toast.push(`Save failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };
  const removeParcel = async () => {
    if (selParcel == null) return;
    if (!window.confirm('Delete this parcel?')) return;
    try {
      await api.deleteParcel(selParcel);
      toast.push('Parcel deleted', 'success');
      setSelParcel(null);
      setDraft(null);
      setDirtyParcel(false);
      loadParcels();
    } catch (e) {
      toast.push(`Delete failed: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };
  // Drag a parcel corner (grid units = px / cell).
  const onSvgMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragIdx.current == null || !draft || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / cellRef.current;
    const y = (e.clientY - r.top) / cellRef.current;
    const i = dragIdx.current;
    setDraft((d) => (d ? d.map((q, k) => (k === i ? [x, y] : q)) : d));
    setDirtyParcel(true);
  };
  const endDrag = () => {
    dragIdx.current = null;
  };
  // Double-click an edge midpoint handle to insert a corner; Alt+click a corner to remove it.
  const insertCorner = (after: number) => {
    if (!draft) return;
    const a = draft[after];
    const b = draft[(after + 1) % draft.length];
    const nd = [...draft];
    nd.splice(after + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    setDraft(nd);
    setDirtyParcel(true);
  };
  const removeCorner = (i: number) => {
    if (!draft || draft.length <= 3) return;
    setDraft(draft.filter((_, k) => k !== i));
    setDirtyParcel(true);
  };

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .listTiles()
        .then((r) => alive && setTiles(r.tiles))
        .catch(() => {});
    load();
    const t = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const grid = useMemo(() => {
    const placed = tiles
      .map((t) => ({ t, rc: parseRC(t.name) }))
      .filter((x): x is { t: TileSummary; rc: [number, number] } => !!x.rc);
    if (!placed.length) return null;
    const rows = placed.map((x) => x.rc[0]);
    const cols = placed.map((x) => x.rc[1]);
    return {
      placed,
      r0: Math.min(...rows),
      r1: Math.max(...rows),
      c0: Math.min(...cols),
      c1: Math.max(...cols),
    };
  }, [tiles]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { verified: 0, in_progress: 0, unchecked: 0, invalid: 0 };
    for (const t of tiles) c[t.verification_status] = (c[t.verification_status] ?? 0) + 1;
    return c;
  }, [tiles]);

  const nCols = grid ? grid.c1 - grid.c0 + 1 : 1;
  const nRows = grid ? grid.r1 - grid.r0 + 1 : 1;
  // Fit the grid into the viewport.
  const cell = Math.max(10, Math.min(34, Math.floor(Math.min((window.innerWidth - 80) / nCols, (window.innerHeight - 190) / nRows))));
  const cellRef = useRef(cell);
  cellRef.current = cell;
  const pct = tiles.length ? Math.round((100 * counts.verified) / tiles.length) : 0;

  return (
    <div className="page map-page">
      <header className="app-header">
        <h1>Progress map</h1>
        <span className="map-summary">
          {counts.verified}/{tiles.length} verified ({pct}%)
        </span>
        <span className="spacer" />
        <CollabBar />
      </header>
      <div className="map-legend">
        {(['verified', 'in_progress', 'unchecked', 'invalid'] as const).map((s) => (
          <span key={s} className="map-legend__item">
            <i style={{ background: STATUS_COLOR[s] }} /> {STATUS_TEXT[s]} ({counts[s] ?? 0})
          </span>
        ))}
        <span className="map-legend__item">
          <i className="map-legend__lock" /> being edited
        </span>
        <button
          type="button"
          className={`btn btn--sm ${editParcels ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => {
            if (editParcels) selectParcel(null);
            setEditParcels((v) => !v);
            setShowParcels(true);
          }}
        >
          {editParcels ? '✓ Done editing parcels' : '✎ Edit parcels'}
        </button>
        <label className="map-legend__toggle">
          <input type="checkbox" checked={showParcels} onChange={(e) => setShowParcels(e.target.checked)} />
          <i className="map-legend__parcel" /> Parcels ({new Set(parcels.map((p) => p.id)).size})
        </label>
        <label className="map-legend__toggle">
          <input type="checkbox" checked={showStatus} onChange={(e) => setShowStatus(e.target.checked)} /> Status colours
        </label>
        <label className="map-legend__toggle">
          <input type="checkbox" checked={onlyVerified} onChange={(e) => setOnlyVerified(e.target.checked)} /> Highlight verified only
        </label>
      </div>
      <div className="map-body">
        {grid && (
          <div
            className="map-grid"
            style={{
              width: nCols * cell,
              height: nRows * cell,
              // Real imagery mosaic of the whole area, stitched server-side.
              backgroundImage: 'url(/api/map/mosaic.jpg?cell=48)',
              backgroundSize: `${nCols * cell}px ${nRows * cell}px`,
            }}
          >
            {grid.placed.map(({ t, rc }) => {
              const st = t.verification_status;
              const dim = onlyVerified && st !== 'verified';
              const lock = t.locked_by;
              const mine = lock?.client_id === clientId;
              return (
                <button
                  key={t.name}
                  type="button"
                  className={`map-cell ${lock ? (mine ? 'is-mine' : 'is-locked') : ''} ${t.annotation_count === 0 ? 'is-empty' : ''}`}
                  style={{
                    left: (rc[1] - grid.c0) * cell,
                    top: (rc[0] - grid.r0) * cell,
                    width: cell,
                    height: cell,
                    background: dim
                      ? 'rgba(8, 10, 14, 0.62)'
                      : showStatus
                        ? STATUS_TINT[st] ?? 'transparent'
                        : 'transparent',
                    boxShadow: showStatus && st !== 'unchecked' && !dim
                      ? `inset 0 0 0 2px ${STATUS_COLOR[st]}`
                      : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                  }}
                  title={`${t.name} — ${STATUS_TEXT[st] ?? st}${lock ? ` — editing: ${lock.name}` : ''}${t.updated_by ? ` — by ${t.updated_by}` : ''} · ${t.annotation_count} shapes`}
                  onMouseEnter={() => setHover(t)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => navigate(`/tile/${encodeURIComponent(t.name)}`)}
                >
                  {lock && cell >= 18 ? <span className="map-cell__who">{lock.name.slice(0, 1).toUpperCase()}</span> : null}
                </button>
              );
            })}
            {showParcels && parcels.length > 0 && (
              <svg
                ref={svgRef}
                className={`map-parcels ${editParcels ? 'is-editing' : ''}`}
                width={nCols * cell}
                height={nRows * cell}
                onPointerMove={onSvgMove}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
              >
                {parcels.map((pc, k) => {
                  const isSel = editParcels && pc.id === selParcel;
                  const pts = isSel && draft ? draft : pc.points;
                  return (
                    <polygon
                      key={k}
                      className={isSel ? 'is-selected' : ''}
                      points={pts.map(([x, y]) => `${x * cell},${y * cell}`).join(' ')}
                      onClick={editParcels ? () => selectParcel(pc.id) : undefined}
                    />
                  );
                })}
                {editParcels && draft && (
                  <>
                    {draft.map((q, i) => {
                      const nq = draft[(i + 1) % draft.length];
                      return (
                        <circle
                          key={`m${i}`}
                          className="parcel-mid"
                          cx={((q[0] + nq[0]) / 2) * cell}
                          cy={((q[1] + nq[1]) / 2) * cell}
                          r={4}
                          onDoubleClick={() => insertCorner(i)}
                        >
                          <title>Double-click to add a corner</title>
                        </circle>
                      );
                    })}
                    {draft.map((q, i) => (
                      <circle
                        key={`v${i}`}
                        className="parcel-corner"
                        cx={q[0] * cell}
                        cy={q[1] * cell}
                        r={6}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (e.altKey) {
                            removeCorner(i);
                            return;
                          }
                          (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                          dragIdx.current = i;
                        }}
                      >
                        <title>Drag to move · Alt+click to remove</title>
                      </circle>
                    ))}
                  </>
                )}
              </svg>
            )}
          </div>
        )}
        <div className="map-info">
          {editParcels && (
            <div className="parcel-editor">
              <strong>Edit parcels</strong>
              {selParcel == null ? (
                <span className="muted">Click a parcel on the map to select it.</span>
              ) : (
                <>
                  <span>
                    Parcel #{selParcel} · {draft?.length ?? 0} corners
                    {(() => {
                      const a = parcels.find((x) => x.id === selParcel)?.area_m2;
                      return a ? ` · ${Math.round(a)} m²` : '';
                    })()}
                  </span>
                  <span className="muted">Drag corners · double-click a small dot to add a corner · Alt+click a corner to remove it</span>
                  <div className="parcel-editor__btns">
                    <button type="button" className="btn btn--sm btn--primary" disabled={!dirtyParcel} onClick={() => void saveParcel()}>
                      Save
                    </button>
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => selectParcel(null)}>
                      {dirtyParcel ? 'Cancel' : 'Close'}
                    </button>
                    <button type="button" className="btn btn--sm btn--danger" onClick={() => void removeParcel()}>
                      Delete parcel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {hover ? (
            <>
              <strong>{hover.name.replace('.tif', '')}</strong>
              <span>{STATUS_TEXT[hover.verification_status] ?? hover.verification_status}</span>
              <span>{hover.annotation_count} shapes</span>
              {hover.locked_by && <span>editing: {hover.locked_by.name}</span>}
              {hover.updated_by && <span>last: {hover.updated_by}</span>}
            </>
          ) : (
            <span className="muted">Hover a tile · click to open it</span>
          )}
        </div>
      </div>
    </div>
  );
}
