import type { FeatureCollection, LineString, Point, Polygon, Position } from "geojson";
import { z } from "zod";

import { projectToSurveyCrs, reprojectLineString } from "@/shared/lib/geo";

import type { RoutePurpose } from "../config/routes";
import { surveyFileSchemas } from "../model/schema";
import type { Survey } from "../model/types";

const reportSchema = z.object({
  target_count: z.number(),
  visited_count: z.number(),
  coverage_ratio: z.number().nullable(),
  outside_length_m: z.number(),
  outside_supplied_length_m: z.number().default(0),
  path_mode: z.enum(["supplied", "demo_headlands"]).default("supplied"),
  closed: z.boolean(),
  warnings: z.array(z.string()),
  targets: z.array(z.object({ target_id: z.string(), reachable: z.boolean(), approach_distance_m: z.number() })),
});

export type RouteReport = z.infer<typeof reportSchema>;
export type RoutePathMode = RouteReport["path_mode"];

const resultSchema = z.object({ route: surveyFileSchemas.inspectionRoute.nullable(), report: reportSchema });

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

export const planSurveyRoute = async (
  survey: Survey,
  purpose: RoutePurpose,
  start: Position,
  surveyId: string,
  signal: AbortSignal,
  pathMode: RoutePathMode = "supplied",
) => {
  const projectedStart = projectToSurveyCrs(start);
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
      canopy: projectCollection(survey.canopy),
      inspection_points: projectCollection(survey.inspectionPoints),
      waste: projectCollection(survey.waste),
      ...(pathMode === "demo_headlands" ? { blocks: projectCollection(survey.blocks), rows: projectCollection(survey.rows) } : {}),
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const detail = z.object({ detail: z.string() }).safeParse(body);
    throw new Error(detail.success ? detail.data.detail : "The route inputs could not be processed.");
  }
  const result = resultSchema.parse(body);
  const feature = result.route?.features[0];
  const reachability = new Map(result.report.targets.map(target => [target.target_id, target.reachable]));
  const plannedSurvey: Survey = {
    ...survey,
    routes: {
      inspection: null,
      waste_collection: null,
      [purpose]: feature ? { ...feature, geometry: reprojectLineString(feature.geometry) } : null,
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
