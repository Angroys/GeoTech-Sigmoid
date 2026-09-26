// Domain types matching the backend API contract.

export type VerificationStatus = 'unchecked' | 'in_progress' | 'verified';
export type ShapeType = 'polygon' | 'polyline' | 'box';
// Real backend labels
export type Label = 'row' | 'vineyard' | 'interrow_area' | 'waste';

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
  occluded?: boolean;
  z_order?: number;
}

// Write shape: annotation minus id/tile_name (tile from URL for PUT).
export type AnnotationIn = Omit<Annotation, 'id' | 'tile_name'>;

export interface TileSummary {
  name: string;
  verification_status: VerificationStatus;
  updated_at?: string | null;
  updated_by?: string | null;
  annotation_count: number;
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
