import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import type { ExportJob, TileSummary } from '../types';
import { Button } from '../components/Button';
import { SimpleProgress } from '../components/ProgressBar';
import { tokens } from '../tokens';
import { useToast } from '../components/Toast';

type Scope = 'all' | 'verified' | 'selection';

interface CardState {
  job: ExportJob | null;
  running: boolean;
  error: string | null;
}

const initial: CardState = { job: null, running: false, error: null };

function jobPercent(job: ExportJob | null): number {
  if (!job) return 0;
  if (typeof job.percent === 'number') return job.percent;
  if (typeof job.tiles_done === 'number' && typeof job.tiles_total === 'number' && job.tiles_total > 0) {
    return (job.tiles_done / job.tiles_total) * 100;
  }
  const done = ['done', 'completed', 'finished', 'success'].includes(job.status?.toLowerCase());
  return done ? 100 : 25;
}

function isDone(job: ExportJob | null): boolean {
  if (!job) return false;
  return ['done', 'completed', 'finished', 'success'].includes(job.status?.toLowerCase());
}
function isFailed(job: ExportJob | null): boolean {
  if (!job) return false;
  return ['error', 'failed'].includes(job.status?.toLowerCase());
}

export function ExportPanel() {
  const navigate = useNavigate();
  const toast = useToast();
  const [scope, setScope] = useState<Scope>('all');
  const [tiles, setTiles] = useState<TileSummary[]>([]);
  const [cvat, setCvat] = useState<CardState>(initial);
  const [masks, setMasks] = useState<CardState>(initial);
  const pollers = useRef<Record<string, number>>({});

  useEffect(() => {
    api.listTiles().then((r) => setTiles(r.tiles)).catch(() => setTiles([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  useEffect(() => {
    const p = pollers.current;
    return () => {
      Object.values(p).forEach((id) => window.clearInterval(id));
    };
  }, []);

  const scopeTiles = useCallback((): string[] | null => {
    if (scope === 'all') return null;
    if (scope === 'verified') {
      return tiles.filter((t) => t.verification_status === 'verified').map((t) => t.name);
    }
    // selection: not wired to a persistent multi-select in this MVP -> empty means none
    return [];
  }, [scope, tiles]);

  const startPoll = (jobId: string, set: React.Dispatch<React.SetStateAction<CardState>>) => {
    const tick = async () => {
      try {
        const job = await api.exportStatus(jobId);
        set((s) => ({ ...s, job }));
        if (isDone(job) || isFailed(job)) {
          window.clearInterval(pollers.current[jobId]);
          delete pollers.current[jobId];
          set((s) => ({ ...s, running: false, error: isFailed(job) ? 'Export job failed' : null }));
          if (isDone(job)) toast.push('Export ready', 'success');
        }
      } catch (e) {
        window.clearInterval(pollers.current[jobId]);
        delete pollers.current[jobId];
        set((s) => ({ ...s, running: false, error: e instanceof Error ? e.message : String(e) }));
      }
    };
    pollers.current[jobId] = window.setInterval(tick, 1500);
    void tick();
  };

  const run = async (
    kind: 'cvat' | 'masks',
    set: React.Dispatch<React.SetStateAction<CardState>>,
  ) => {
    set({ job: null, running: true, error: null });
    try {
      const sel = scopeTiles();
      const job =
        kind === 'cvat' ? await api.exportCvat(sel, false) : await api.exportMasks(sel);
      set({ job, running: true, error: null });
      if (isDone(job) || isFailed(job)) {
        set({ job, running: false, error: isFailed(job) ? 'Export job failed' : null });
        if (isDone(job)) toast.push('Export ready', 'success');
      } else {
        startPoll(job.job_id, set);
      }
    } catch (e) {
      set({ job: null, running: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const verifiedCount = tiles.filter((t) => t.verification_status === 'verified').length;

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="btn btn--ghost">
          ‹ Nav
        </Link>
        <h1>Export</h1>
      </header>
      <div className="app-body">
        <div className="export-page">
          <fieldset className="scope-row" style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
              Scope
            </legend>
            <label className="radio-row">
              <input
                type="radio"
                name="scope"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
              />
              All tiles ({tiles.length})
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="scope"
                checked={scope === 'verified'}
                onChange={() => setScope('verified')}
              />
              Verified only ({verifiedCount})
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="scope"
                checked={scope === 'selection'}
                onChange={() => setScope('selection')}
              />
              Current selection
            </label>
          </fieldset>

          <div className="export-cards">
            <ExportCard
              title="CVAT for images 1.1"
              description="annotations.xml (CVAT 1.1) — includes class + attributes, matching the pre-annotation input format."
              buttonLabel="Export CVAT"
              state={cvat}
              onRun={() => run('cvat', setCvat)}
            />
            <ExportCard
              title="GeoTIFF label mask"
              description="Per-tile rasterized class-coded masks; EPSG:32635 preserved."
              buttonLabel="Export masks"
              state={masks}
              onRun={() => run('masks', setMasks)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportCard({
  title,
  description,
  buttonLabel,
  state,
  onRun,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  state: CardState;
  onRun: () => void;
}) {
  const { job, running, error } = state;
  const done = isDone(job);
  const barColor = done ? tokens.status.verified.solid : tokens.status.inProgress.solid;
  const urls = job?.download_urls ?? [];
  return (
    <div className="export-card">
      <h3>{title}</h3>
      <p>{description}</p>
      <div>
        <Button variant="primary" onClick={onRun} loading={running} disabled={running}>
          {buttonLabel}
        </Button>
      </div>
      {(running || job) && !error && (
        <>
          <SimpleProgress percent={jobPercent(job)} color={barColor} />
          <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-secondary)' }}>
            {job
              ? `${job.status}${
                  typeof job.tiles_done === 'number' && typeof job.tiles_total === 'number'
                    ? ` (${job.tiles_done}/${job.tiles_total})`
                    : ''
                }`
              : 'starting…'}
          </span>
        </>
      )}
      {done && urls.length > 0 && (
        <div className="download-list" aria-live="polite">
          <strong style={{ fontSize: 'var(--fs-sm)', color: 'var(--success)' }}>
            ✓ Ready — download:
          </strong>
          {urls.map((u) => (
            <a key={u} href={api.downloadUrl(u)} download>
              {u.split('/').pop()}
            </a>
          ))}
        </div>
      )}
      {error && (
        <div className="error-band" role="alert">
          {error}
          <div style={{ marginTop: 6 }}>
            <Button variant="danger" size="sm" onClick={onRun}>
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
