import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { TileSummary } from '../types';
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
          </div>
        )}
        <div className="map-info">
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
