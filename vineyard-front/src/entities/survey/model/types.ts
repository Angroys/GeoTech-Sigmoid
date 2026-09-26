import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";
import type { z } from "zod";

import type { RoutePurpose } from "../config/routes";

import type {
  blockPropertiesSchema,
  canopyPropertiesSchema,
  inspectionPointPropertiesSchema,
  interrowIdSchema,
  interrowPropertiesSchema,
  routePropertiesSchema,
  rowIdSchema,
  rowPropertiesSchema,
  targetIdSchema,
  vineyardIdSchema,
  wastePropertiesSchema,
} from "./schema";

export type VineyardId = z.infer<typeof vineyardIdSchema>;
export type RowId = z.infer<typeof rowIdSchema>;
export type TargetId = z.infer<typeof targetIdSchema>;
export type InterrowId = z.infer<typeof interrowIdSchema>;

type BlockProperties = z.infer<typeof blockPropertiesSchema>;
export type RowProperties = z.infer<typeof rowPropertiesSchema>;
type CanopyProperties = z.infer<typeof canopyPropertiesSchema>;
export type InterrowProperties = z.infer<typeof interrowPropertiesSchema> & { width_m: number };
export type WasteProperties = z.infer<typeof wastePropertiesSchema>;
type InspectionPointProperties = z.infer<typeof inspectionPointPropertiesSchema>;
export type RouteProperties = z.infer<typeof routePropertiesSchema>;

export type RouteEvidenceKind = "outside_blocks" | "outside_supplied" | "outside_permitted";
export type RouteMap = {
  suppliedPassages: FeatureCollection<Polygon | MultiPolygon>;
  forbiddenAreas: FeatureCollection<Polygon | MultiPolygon>;
  studyArea: FeatureCollection<Polygon | MultiPolygon>;
  inferredHeadlands: FeatureCollection<Polygon | MultiPolygon>;
  routeEvidence: FeatureCollection<LineString | MultiLineString, { kind: RouteEvidenceKind; length_m: number }>;
};

export type Survey = {
  blocks: FeatureCollection<Polygon, BlockProperties>;
  rows: FeatureCollection<LineString, RowProperties>;
  canopy: FeatureCollection<Polygon, CanopyProperties>;
  interrows: FeatureCollection<Polygon, InterrowProperties>;
  waste: FeatureCollection<Polygon, WasteProperties>;
  inspectionPoints: FeatureCollection<Point, InspectionPointProperties>;
  routes: Record<RoutePurpose, Feature<LineString, RouteProperties> | null>;
  routeMap: RouteMap | null;
  start: Feature<Point>;
  projectedStart: Position;
};

export type SurveySelection =
  | { kind: "none" }
  | { kind: "block"; vineyardId: VineyardId }
  | { kind: "row"; rowId: RowId }
  | { kind: "interrow"; interrowId: InterrowId }
  | { kind: "target"; targetId: TargetId };

export const NO_SELECTION: SurveySelection = { kind: "none" };
