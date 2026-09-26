// Domain types matching the backend API contract.

export type VerificationStatus = 'unchecked' | 'in_progress' | 'verified' | 'invalid';
export type ShapeType = 'polygon' | 'polyline' | 'box';

// Active editing tool in the viewer. Mutually exclusive modes:
//  - 'select': click/multi-select shapes, move whole shapes, edit + multi-select
//             vertices, marquee-select vertices, double-click an edge to insert.
//  - 'cut':   click a polyline to split it at the click point; or draw a straight
//             cut line across a polygon to split it into two polygons.
//  - 'join':  click two annotations of the same kind to merge — two rows
//             (polylines) into one continuous polyline, or two same-label
//             polygons into one polygon.
//  - 'draw':  click to place vertices, drawing a new shape whose geometry
//             follows the chosen label's form (polyline for rows, polygon
//             otherwise). Finish with double-click / Enter / closing a polygon.
// All non-select tools are disabled in read-only mode.
export type Tool = 'select' | 'magic' | 'cut' | 'erase' | 'join' | 'draw';
// Real backend labels
export type Label = 'row' | 'vineyard' | 'interrow_area' | 'waste' | 'dead_vine';

export interface AnnotationAttributes {
  row_structure?: 'regular' | 'disrupted';
  interrow_cover?: 'bare_soil' | 'mixed';
  vineyard_id?: string | number;
  row_id?: string | number;
  [k: string]: unknown;
}

export interface Annotation {
  id: string;
  tile_name: string;
  label: Label;
  shape_type: ShapeType;
  points: [number, number][];
  attributes: AnnotationAttributes;
  source?: string;
  // Backend may send boolean or 0/1; magic-draw shapes set 0.
  occluded?: boolean | number;
  z_order?: number;
}

// ---- Magic-draw segmentation (POST /api/tiles/{name}/segment) ----
// Class hint the labeler can force when the auto guess is wrong.
export type SegmentHint = 'auto' | 'canopy' | 'waste' | 'road';

// Successful detection. `points` are in the SAME tile-pixel space as stored
// annotation points (i.e. what ll2p yields) — add them to an annotation with
// NO scaling.
export interface SegmentHit {
  shape_type: 'polygon' | 'polyline';
  points: [number, number][];
  label: Label;
  confidence: number;
  reason: string;
  found?: true;
}

// No object found under the scribble.
export interface SegmentMiss {
  found: false;
}

export type SegmentResponse = SegmentHit | SegmentMiss;

// Write shape: annotation minus id/tile_name (tile from URL for PUT).
export type AnnotationIn = Omit<Annotation, 'id' | 'tile_name'>;

// Who currently holds a tile's edit lock (null = free). Shared by tile
// summaries and the claim response.
export interface LockInfo {
  client_id: string;
  name: string;
}

export interface TileSummary {
  name: string;
  verification_status: VerificationStatus;
  updated_at?: string | null;
  updated_by?: string | null;
  annotation_count: number;
  // Collaboration: present when another (or this) client holds the edit lock.
  locked_by?: LockInfo | null;
}

// ---- Collaboration / presence ----
export interface PresenceUser {
  client_id: string;
  name: string;
  tile: string | null;
  idle_secs: number;
}

export interface PresenceLock {
  tile: string;
  client_id: string;
  name: string;
}

export interface PresenceResponse {
  users: PresenceUser[];
  locks: PresenceLock[];
}

export interface ClaimResponse {
  ok: boolean;
  locked_by: LockInfo | null;
}

export interface ReleaseResponse {
  ok: boolean;
}

export interface TilesResponse {
  tiles: TileSummary[];
  count: number;
}

export interface TileGeo {
  name: string;
  crs: string;
  width: number;
  height: number;
  transform: number[];
  bounds: number[];
  count: number;
  dtypes: unknown;
}

export interface TileStatus {
  name: string;
  verification_status: VerificationStatus;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface Progress {
  total: number;
  verified: number;
  in_progress: number;
  unchecked: number;
  percent_verified: number;
}

export interface ExportJob {
  job_id: string;
  status: string;
  artifacts?: unknown;
  download_urls?: string[];
  percent?: number;
  tiles_done?: number;
  tiles_total?: number;
  [k: string]: unknown;
}

export interface ImportResult {
  source: string;
  images: number;
  shapes_imported: number;
  labels: string[];
}

export interface SamImportResult {
  source: string;
  tiles: number;
  images: number;
  shapes_imported: number;
  skipped: number;
  labels: Record<string, number>;
}
