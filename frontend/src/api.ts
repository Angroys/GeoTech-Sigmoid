import { apiUrl } from './config';
import type {
  ParcelShape,
  TilesResponse,
  TileGeo,
  TileStatus,
  Progress,
  Annotation,
  AnnotationIn,
  ExportJob,
  ImportResult,
  SamImportResult,
  VerificationStatus,
  SegmentHint,
  SegmentResponse,
  PresenceResponse,
  ClaimResponse,
  ReleaseResponse,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  // Some endpoints (DELETE) may return JSON; all are JSON per contract.
  return (await res.json()) as T;
}

export const api = {
  // Tiles
  listTiles: () => request<TilesResponse>('/api/tiles'),
  tileParcels: (name: string) =>
    request<{ tile_name: string; parcels: ParcelShape[] }>(`/api/tiles/${encodeURIComponent(name)}/parcels`),
  updateParcel: (id: number, points: [number, number][]) =>
    request<{ id: number; area_m2: number }>(`/api/parcels/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
    }),
  deleteParcel: (id: number) => request<{ ok: boolean }>(`/api/parcels/${id}`, { method: 'DELETE' }),
  mapParcels: () =>
    request<{ layout: { r0: number; c0: number; rows: number; cols: number }; parcels: ParcelShape[] }>('/api/parcels/map'),
  tileGeo: (name: string) => request<TileGeo>(`/api/tiles/${encodeURIComponent(name)}/geo`),
  rasterUrl: (name: string, thumb = false) =>
    apiUrl(`/api/tiles/${encodeURIComponent(name)}/raster.png${thumb ? '?thumb=1' : ''}`),

  // Annotations
  getAnnotations: (name: string) =>
    request<{ tile_name: string; annotations: Annotation[] }>(
      `/api/tiles/${encodeURIComponent(name)}/annotations`,
    ),
  putAnnotations: (name: string, annotations: AnnotationIn[]) =>
    request<{ tile_name: string; annotations: Annotation[] }>(
      `/api/tiles/${encodeURIComponent(name)}/annotations`,
      { method: 'PUT', body: JSON.stringify({ annotations }) },
    ),

  // Magic draw — auto-segment the object under a freehand scribble.
  // `path` = points in the SAME tile-pixel coord space as stored annotation
  // points (i.e. what MapCanvas.ll2p yields). Returned points share that space
  // and are added to an annotation with NO scaling.
  // `signal` lets callers abort a superseded request (hover-preview debounce
  // aborts the previous in-flight detect before firing the next).
  segment: (
    name: string,
    path: [number, number][],
    hint: SegmentHint = 'auto',
    signal?: AbortSignal,
  ) =>
    request<SegmentResponse>(`/api/tiles/${encodeURIComponent(name)}/segment`, {
      method: 'POST',
      body: JSON.stringify(hint && hint !== 'auto' ? { path, hint } : { path }),
      signal,
    }),

  // Status
  getStatus: (name: string) =>
    request<TileStatus>(`/api/tiles/${encodeURIComponent(name)}/status`),
  putStatus: (name: string, status: VerificationStatus, updated_by?: string) =>
    request<TileStatus>(`/api/tiles/${encodeURIComponent(name)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, updated_by }),
    }),

  // Progress
  progress: () => request<Progress>('/api/progress'),

  // Import
  // Omit both path and file to import the bundled example (no body).
  importExampleCvat: () => request<ImportResult>('/api/import/cvat', { method: 'POST' }),
  // Import SAM GeoJSON (EPSG:32635) pre-annotations. Omit dir to use the
  // server default (GEOTECH_SAM_DIR / <repo_root>/labels).
  importSamGeojson: (dir?: string) =>
    request<SamImportResult>('/api/import/geojson', {
      method: 'POST',
      body: JSON.stringify(dir ? { dir } : {}),
    }),

  // Export
  exportCvat: (tiles: string[] | null, include_images = false) =>
    request<ExportJob>('/api/export/cvat', {
      method: 'POST',
      body: JSON.stringify({ tiles, include_images }),
    }),
  exportMasks: (tiles: string[] | null) =>
    request<ExportJob>('/api/export/masks', {
      method: 'POST',
      body: JSON.stringify({ tiles }),
    }),
  exportStatus: (jobId: string) =>
    request<ExportJob>(`/api/export/${encodeURIComponent(jobId)}/status`),
  downloadUrl: (relPath: string) => apiUrl(relPath),

  // ---- Collaboration ----
  // Heartbeat. When `tile` is set it also refreshes THIS client's lock on that
  // tile (never steals). Returns everyone online + all current locks.
  presence: (client_id: string, name: string, tile: string | null) =>
    request<PresenceResponse>('/api/presence', {
      method: 'POST',
      body: JSON.stringify({ client_id, name, tile: tile ?? null }),
    }),
  // Try to take a tile's edit lock. ok:true = you hold it; ok:false =
  // someone else holds it (locked_by = them). `display` is the human name.
  claimTile: (name: string, client_id: string, display: string) =>
    request<ClaimResponse>(`/api/tiles/${encodeURIComponent(name)}/claim`, {
      method: 'POST',
      body: JSON.stringify({ client_id, name: display }),
    }),
  releaseTile: (name: string, client_id: string) =>
    request<ReleaseResponse>(`/api/tiles/${encodeURIComponent(name)}/release`, {
      method: 'POST',
      body: JSON.stringify({ client_id }),
    }),
};
