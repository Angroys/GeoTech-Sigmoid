import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import type { TileSummary, Progress, VerificationStatus } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { ProgressBar } from '../components/ProgressBar';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

const STATUS_ORDER: VerificationStatus[] = ['unchecked', 'in_progress', 'verified'];
const STATUS_LABEL: Record<VerificationStatus, string> = {
  unchecked: 'Unchecked',
  in_progress: 'In progress',
  verified: 'Verified',
};

type SortKey = 'id' | 'status';

export function TileNavigator() {
  const navigate = useNavigate();
  const toast = useToast();
  const [tiles, setTiles] = useState<TileSummary[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<VerificationStatus>>(new Set());
  const [sort, setSort] = useState<SortKey>('id');
  const [importing, setImporting] = useState(false);

  const jumpRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, p] = await Promise.all([api.listTiles(), api.progress().catch(() => null)]);
      setTiles(t.tiles);
      if (p) setProgress(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFilter = (s: VerificationStatus) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const visible = useMemo(() => {
    let list = tiles;
    if (activeFilters.size > 0) {
      list = list.filter((t) => activeFilters.has(t.verification_status));
    }
    const sorted = [...list];
    if (sort === 'id') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort(
        (a, b) =>
          STATUS_ORDER.indexOf(a.verification_status) -
            STATUS_ORDER.indexOf(b.verification_status) || a.name.localeCompare(b.name),
      );
    }
    return sorted;
  }, [tiles, activeFilters, sort]);

  const openTile = useCallback(
    (name: string) => navigate(`/tile/${encodeURIComponent(name)}`),
    [navigate],
  );

  // Global keyboard: '/' focuses jump input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'SELECT';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        jumpRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onJumpKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const n = parseInt(jumpRef.current?.value ?? '', 10);
      // jump uses 1-based index over the full (unfiltered, id-sorted) tile list
      const idSorted = [...tiles].sort((a, b) => a.name.localeCompare(b.name));
      if (!Number.isNaN(n) && n >= 1 && n <= idSorted.length) {
        openTile(idSorted[n - 1].name);
      } else {
        toast.push(`No tile #${n} (1–${idSorted.length})`, 'error');
      }
    }
  };

  // Arrow-key focus movement across grid cards.
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const cards = Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>('.tile-card') ?? [],
    );
    if (cards.length === 0) return;
    const activeIdx = cards.indexOf(document.activeElement as HTMLElement);
    if (activeIdx === -1) {
      cards[0].focus();
      e.preventDefault();
      return;
    }
    // determine columns from layout
    const style = getComputedStyle(gridRef.current!);
    const cols = style.gridTemplateColumns.split(' ').length || 1;
    let next = activeIdx;
    if (e.key === 'ArrowRight') next = Math.min(activeIdx + 1, cards.length - 1);
    if (e.key === 'ArrowLeft') next = Math.max(activeIdx - 1, 0);
    if (e.key === 'ArrowDown') next = Math.min(activeIdx + cols, cards.length - 1);
    if (e.key === 'ArrowUp') next = Math.max(activeIdx - cols, 0);
    cards[next]?.focus();
    e.preventDefault();
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const r = await api.importExampleCvat();
      toast.push(`Imported ${r.shapes_imported} shapes across ${r.images} images`, 'success');
      await load();
    } catch (e) {
      toast.push(`Import failed: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>GeoTech-Sigmoid</h1>
        <span className="subtitle">Vineyard Annotation</span>
        <span className="spacer" />
        <Button variant="ghost" onClick={doImport} loading={importing}>
          Import example CVAT
        </Button>
        <Link to="/export" className="btn">
          Export
        </Link>
        <input
          ref={jumpRef}
          className="jump-input"
          type="number"
          min={1}
          placeholder="jump to # ↵"
          aria-label="Jump to tile number"
          onKeyDown={onJumpKey}
        />
      </header>

      <div className="nav-toolbar">
        <div className="progress-row">
          <ProgressBar
            verified={progress?.verified ?? 0}
            inProgress={progress?.in_progress ?? 0}
            total={progress?.total ?? tiles.length}
          />
          <span className="progress-readout mono">
            {progress
              ? `${progress.verified}/${progress.total} verified · ${progress.in_progress} in-progress · ${progress.unchecked} open`
              : `${tiles.length} tiles`}
          </span>
        </div>
        <div className="filterbar">
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-xs)' }}>
            Filter:
          </span>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              className="chip"
              aria-pressed={activeFilters.has(s)}
              onClick={() => toggleFilter(s)}
            >
              <StatusBadge status={s} />
            </button>
          ))}
          <span className="spacer" />
          <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
            Sort:{' '}
            <select
              className="select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort tiles"
            >
              <option value="id">ID</option>
              <option value="status">Status</option>
            </select>
          </label>
        </div>
      </div>

      <div className="app-body">
        {loading && <div className="empty-state">Loading tiles…</div>}
        {error && (
          <div className="empty-state">
            <div className="error-band">Failed to load: {error}</div>
            <p>
              <Button onClick={() => void load()}>Retry</Button> or{' '}
              <Button variant="primary" onClick={doImport} loading={importing}>
                Import example CVAT
              </Button>
            </p>
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="empty-state">
            <p>No tiles{activeFilters.size ? ' match the filter' : ''}.</p>
            {tiles.length === 0 && (
              <Button variant="primary" onClick={doImport} loading={importing}>
                Import example CVAT to get started
              </Button>
            )}
          </div>
        )}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div className="tile-grid" ref={gridRef} onKeyDown={onGridKey} role="grid">
          {visible.map((t, i) => (
            <button
              key={t.name}
              className="tile-card"
              onClick={() => openTile(t.name)}
              tabIndex={i === 0 ? 0 : -1}
              aria-label={`Tile ${t.name}, ${STATUS_LABEL[t.verification_status]}, ${t.annotation_count} annotations`}
            >
              <img
                className="tile-card__thumb"
                src={api.rasterUrl(t.name, true)}
                alt=""
                loading="lazy"
                width={128}
                height={128}
              />
              <div className="tile-card__meta">
                <span className="tile-card__id" title={t.name}>
                  {t.name.replace(/\.tif$/, '')}
                </span>
                <StatusBadge status={t.verification_status} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
