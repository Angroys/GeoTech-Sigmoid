import { apiUrl } from './config';
import type {
  TilesResponse,
  TileGeo,
  TileStatus,
  Progress,
  Annotation,
  AnnotationIn,
  ExportJob,
  ImportResult,
  VerificationStatus,
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
};
