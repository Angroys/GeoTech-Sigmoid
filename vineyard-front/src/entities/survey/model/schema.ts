import { z } from "zod";

import { INTERROW_COVERS, ROW_STRUCTURES } from "../config/attributes";
import { ROUTE_PURPOSES } from "../config/routes";

export const vineyardIdSchema = z.string().min(1).brand<"VineyardId">();
export const rowIdSchema = z.string().min(1).brand<"RowId">();
export const targetIdSchema = z.string().min(1).brand<"TargetId">();
export const interrowIdSchema = z.string().min(1).brand<"InterrowId">();

const position = z.tuple([z.number(), z.number()]);

const point = z.object({ type: z.literal("Point"), coordinates: position });
const lineString = z.object({ type: z.literal("LineString"), coordinates: z.array(position).min(2) });
const polygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(position).min(4)).min(1),
});

const feature = <Geometry extends z.ZodType, Properties extends z.ZodType>(
  geometry: Geometry,
  properties: Properties,
) => z.object({ type: z.literal("Feature"), geometry, properties });

const featureCollection = <Geometry extends z.ZodType, Properties extends z.ZodType>(
  geometry: Geometry,
  properties: Properties,
) => z.object({ type: z.literal("FeatureCollection"), features: z.array(feature(geometry, properties)) });

const singleFeatureCollection = <Geometry extends z.ZodType, Properties extends z.ZodType>(
  geometry: Geometry,
  properties: Properties,
) => z.object({ type: z.literal("FeatureCollection"), features: z.tuple([feature(geometry, properties)]) });

export const blockPropertiesSchema = z.object({ vineyard_id: vineyardIdSchema });

export const rowPropertiesSchema = z.object({
  label: z.literal("row"),
  vineyard_id: vineyardIdSchema,
  row_id: rowIdSchema,
  row_structure: z.enum(ROW_STRUCTURES),
  length_m: z.number().nonnegative(),
});

export const canopyPropertiesSchema = z.object({
  label: z.literal("vineyard"),
  vineyard_id: vineyardIdSchema,
  row_id: rowIdSchema,
  area_m2: z.number().nonnegative(),
});

export const interrowPropertiesSchema = z.object({
  label: z.literal("interrow_area"),
  vineyard_id: vineyardIdSchema,
  interrow_id: interrowIdSchema,
  row_ids: z.tuple([rowIdSchema, rowIdSchema]),
  interrow_cover: z.enum(INTERROW_COVERS),
  area_m2: z.number().nonnegative(),
});

export const wastePropertiesSchema = z.object({
  label: z.literal("waste"),
  waste_id: targetIdSchema,
  vineyard_id: vineyardIdSchema.nullable(),
  reachable: z.boolean(),
});

export const inspectionPointPropertiesSchema = z.object({
  point_id: targetIdSchema,
  vineyard_id: vineyardIdSchema,
  row_id: rowIdSchema,
  reason: z.literal("row_gap"),
  reachable: z.boolean(),
});

export const routePropertiesSchema = z
  .object({
    purpose: z.enum(ROUTE_PURPOSES),
    length_m: z.number().nonnegative(),
    baseline_length_m: z.number().nonnegative(),
    baseline_kind: z.enum(["nearest_neighbour", "interrow_sweep"]).default("interrow_sweep"),
    path_mode: z.enum(["supplied", "demo_headlands"]).default("supplied"),
    outside_supplied_length_m: z.number().nonnegative().default(0),
    walking_speed_kmh: z.number().positive(),
    stop_ids: z.array(targetIdSchema),
    stop_distances_m: z.array(z.number().nonnegative()),
  })
  .refine(route => route.stop_distances_m.length === route.stop_ids.length, {
    message: "stop_distances_m needs one distance per stop in stop_ids",
  });

const emptyPropertiesSchema = z.object({}).strict();

export const surveyFileSchemas = {
  blocks: featureCollection(polygon, blockPropertiesSchema),
  rows: featureCollection(lineString, rowPropertiesSchema),
  canopy: featureCollection(polygon, canopyPropertiesSchema),
  interrows: featureCollection(polygon, interrowPropertiesSchema),
  waste: featureCollection(polygon, wastePropertiesSchema),
  inspectionPoints: featureCollection(point, inspectionPointPropertiesSchema),
  inspectionRoute: singleFeatureCollection(lineString, routePropertiesSchema),
  wasteRoute: singleFeatureCollection(lineString, routePropertiesSchema),
  start: singleFeatureCollection(point, emptyPropertiesSchema),
};

export type SurveyFileKey = keyof typeof surveyFileSchemas;

export const surveyFilesSchema = z.object({
  ...surveyFileSchemas,
  inspectionRoute: surveyFileSchemas.inspectionRoute.nullable(),
  wasteRoute: surveyFileSchemas.wasteRoute.nullable(),
});

export const SERVER_PLANNED_FILES = ["inspectionRoute", "wasteRoute"] as const satisfies readonly SurveyFileKey[];

export const isServerPlanned = (key: SurveyFileKey) => SERVER_PLANNED_FILES.some(planned => planned === key);
export type SurveyFiles = z.output<typeof surveyFilesSchema>;

export const SURVEY_FILE_KEYS = [
  "blocks",
  "rows",
  "canopy",
  "interrows",
  "waste",
  "inspectionPoints",
  "inspectionRoute",
  "wasteRoute",
  "start",
] as const satisfies readonly SurveyFileKey[];

export const SURVEY_FILE_NAMES = {
  blocks: "blocks.geojson",
  rows: "rows.geojson",
  canopy: "canopy.geojson",
  interrows: "interrows.geojson",
  waste: "waste.geojson",
  inspectionPoints: "inspection_points.geojson",
  inspectionRoute: "route.geojson",
  wasteRoute: "route_waste.geojson",
  start: "start.geojson",
} as const satisfies Record<SurveyFileKey, string>;

const FILE_KEY_BY_NAME = new Map<string, SurveyFileKey>(SURVEY_FILE_KEYS.map(key => [SURVEY_FILE_NAMES[key], key]));

export const surveyFileKeyOf = (fileName: string): SurveyFileKey | null =>
  FILE_KEY_BY_NAME.get(fileName.toLowerCase().replace(/\.json$/, ".geojson")) ?? null;
