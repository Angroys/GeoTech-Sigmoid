import type { FeatureCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon, Position } from "geojson";
import { z } from "zod";

import { projectToSurveyCrs, reprojectFeatureCollection, reprojectLineString } from "@/shared/lib/geo";

import type { RoutePurpose } from "../config/routes";
import { surveyFileSchemas } from "../model/schema";
import type { Survey } from "../model/types";

const reportSchema = z.object({
  target_count: z.number(),
  visited_count: z.number(),
  coverage_ratio: z.number().nullable(),
  outside_length_m: z.number(),
  outside_supplied_length_m: z.number().default(0),
  outside_blocks_length_m: z.number().nullable().default(null),
  outside_study_area_length_m: z.number().nullable().default(null),
  path_mode: z.enum(["supplied", "demo_headlands"]).default("supplied"),
  closed: z.boolean(),
  warnings: z.array(z.string()),
  targets: z.array(z.object({ target_id: z.string(), reachable: z.boolean(), approach_distance_m: z.number() })),
});

export type RouteReport = z.infer<typeof reportSchema>;
export type RoutePathMode = RouteReport["path_mode"];

const positionSchema = z.tuple([z.number(), z.number()]);
const polygonGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(positionSchema)) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(z.array(positionSchema))) }),
]);
const lineGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("LineString"), coordinates: z.array(positionSchema) }),
  z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(positionSchema)) }),
]);
const featureCollectionSchema = <GeometrySchema extends z.ZodType, PropertiesSchema extends z.ZodType>(
  geometry: GeometrySchema,
  properties: PropertiesSchema,
) => z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({ type: z.literal("Feature"), geometry, properties })),
});
const areaCollectionSchema = featureCollectionSchema(polygonGeometrySchema, z.record(z.string(), z.unknown()));
const routeEvidenceSchema = featureCollectionSchema(
  lineGeometrySchema,
  z.object({
    kind: z.enum(["outside_blocks", "outside_supplied", "outside_permitted"]),
    length_m: z.number().nonnegative(),
  }),
);
const mapSchema = z.object({
  supplied_passages: areaCollectionSchema,
  forbidden_areas: areaCollectionSchema,
  study_area: areaCollectionSchema,
  inferred_headlands: areaCollectionSchema,
  route_evidence: routeEvidenceSchema,
});
export const routePlanResponseSchema = z.object({
  route: surveyFileSchemas.inspectionRoute.nullable(),
  map: mapSchema,
  report: reportSchema,
});

export type RoutePlanResponse = z.output<typeof routePlanResponseSchema>;

const EMPTY_AREAS = { type: "FeatureCollection" as const, features: [] };

export const EMPTY_ROUTE_MAP: RoutePlanResponse["map"] = {
  supplied_passages: EMPTY_AREAS,
  forbidden_areas: EMPTY_AREAS,
  study_area: EMPTY_AREAS,
  inferred_headlands: EMPTY_AREAS,
  route_evidence: EMPTY_AREAS,
};

const projectCollection = (collection: FeatureCollection<Point | Polygon | LineString>) => ({
  type: "FeatureCollection",
  features: collection.features.map(feature => ({
    ...feature,
    geometry: feature.geometry.type === "Point"
      ? { ...feature.geometry, coordinates: projectToSurveyCrs(feature.geometry.coordinates) }
      : feature.geometry.type === "LineString"
      ? { ...feature.geometry, coordinates: feature.geometry.coordinates.map(projectToSurveyCrs) }
      : { ...feature.geometry, coordinates: feature.geometry.coordinates.map(ring => ring.map(projectToSurveyCrs)) },
  })),
});

export const requestRoutePlan = async (
  survey: Survey,
  purpose: RoutePurpose,
  start: Position,
  surveyId: string,
  signal: AbortSignal,
  pathMode: RoutePathMode = "supplied",
): Promise<RoutePlanResponse> => {
  const suppliedStart = survey.start.geometry.coordinates;
  const isSuppliedStart = start[0] === suppliedStart[0] && start[1] === suppliedStart[1];
  const projectedStart = isSuppliedStart ? survey.projectedStart : projectToSurveyCrs(start);
  const response = await fetch("/api/routes/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      crs: "EPSG:32635",
      purpose,
      path_mode: pathMode,
      start: projectedStart,
      constraint_set: surveyId === "siret3" ? "siret3" : null,
      interrows: projectCollection(survey.interrows),
      blocks: projectCollection(survey.blocks),
      canopy: projectCollection(survey.canopy),
      inspection_points: projectCollection(survey.inspectionPoints),
      waste: projectCollection(survey.waste),
      ...(pathMode === "demo_headlands" ? { rows: projectCollection(survey.rows) } : {}),
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const detail = z.object({ detail: z.string() }).safeParse(body);
    throw new Error(detail.success ? detail.data.detail : "The route inputs could not be processed.");
  }
  return routePlanResponseSchema.parse(body);
};

export const applyRoutePlan = (survey: Survey, purpose: RoutePurpose, result: RoutePlanResponse) => {
  const feature = result.route?.features[0];
  const reachability = new Map(result.report.targets.map(target => [target.target_id, target.reachable]));
  const plannedSurvey: Survey = {
    ...survey,
    routes: {
      inspection: null,
      waste_collection: null,
      [purpose]: feature ? { ...feature, geometry: reprojectLineString(feature.geometry) } : null,
    },
    routeMap: {
      suppliedPassages: reprojectFeatureCollection(
        result.map.supplied_passages as FeatureCollection<Polygon | MultiPolygon>,
      ),
      forbiddenAreas: reprojectFeatureCollection(result.map.forbidden_areas as FeatureCollection<Polygon | MultiPolygon>),
      studyArea: reprojectFeatureCollection(result.map.study_area as FeatureCollection<Polygon | MultiPolygon>),
      inferredHeadlands: reprojectFeatureCollection(
        result.map.inferred_headlands as FeatureCollection<Polygon | MultiPolygon>,
      ),
      routeEvidence: reprojectFeatureCollection(
        result.map.route_evidence as FeatureCollection<LineString | MultiLineString, {
          kind: "outside_blocks" | "outside_supplied" | "outside_permitted";
          length_m: number;
        }>,
      ),
    },
    inspectionPoints: {
      ...survey.inspectionPoints,
      features: survey.inspectionPoints.features.map(target => ({
        ...target,
        properties: { ...target.properties, reachable: reachability.get(target.properties.point_id) ?? target.properties.reachable },
      })),
    },
    waste: {
      ...survey.waste,
      features: survey.waste.features.map(target => ({
        ...target,
        properties: { ...target.properties, reachable: reachability.get(target.properties.waste_id) ?? target.properties.reachable },
      })),
    },
  };
  return {
    survey: plannedSurvey,
    report: result.report,
    routeFile: result.route ? {
      ...result.route,
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::32635" } },
    } : null,
  };
};

export const planSurveyRoute = async (
  survey: Survey,
  purpose: RoutePurpose,
  start: Position,
  surveyId: string,
  signal: AbortSignal,
  pathMode: RoutePathMode = "supplied",
) => applyRoutePlan(survey, purpose, await requestRoutePlan(survey, purpose, start, surveyId, signal, pathMode));
