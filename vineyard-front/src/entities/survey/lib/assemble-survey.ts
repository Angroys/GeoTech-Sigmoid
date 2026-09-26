import type { FeatureCollection, Geometry, LineString } from "geojson";

import { reprojectLineString, reprojectPoint, reprojectPolygon, reprojectPosition } from "@/shared/lib/geo";

import type { LngLatBounds } from "../config/sources";
import type { SurveyFiles } from "../model/schema";
import type { RouteProperties, Survey } from "../model/types";

type ParsedFeature<G, P> = { geometry: G; properties: P };

const toDisplayCollection = <SourceGeometry, DisplayGeometry extends Geometry, Properties>(
  features: ParsedFeature<SourceGeometry, Properties>[],
  reproject: (geometry: SourceGeometry) => DisplayGeometry,
): FeatureCollection<DisplayGeometry, Properties> => {
  return {
    type: "FeatureCollection",
    features: features.map(({ geometry, properties }) => {
      return { type: "Feature", geometry: reproject(geometry), properties };
    }),
  };
};

type RouteFile = { features: [ParsedFeature<LineString, RouteProperties>] };

const toDisplayRoute = (file: RouteFile | null) => {
  if (!file) return null;
  const [{ geometry, properties }] = file.features;
  return { type: "Feature" as const, geometry: reprojectLineString(geometry), properties };
};

type Ring = readonly (readonly [number, number])[];

const stripWidthM = (ring: Ring, areaM2: number) => {
  const perimeter = ring
    .slice(1)
    .reduce((total, [x, y], index) => total + Math.hypot(x - (ring[index]?.[0] ?? x), y - (ring[index]?.[1] ?? y)), 0);
  return (perimeter - Math.sqrt(Math.max(0, perimeter ** 2 - 16 * areaM2))) / 4;
};

export const assembleSurvey = (files: SurveyFiles): Survey => {
  const [startFeature] = files.start.features;
  return {
    blocks: toDisplayCollection(files.blocks.features, reprojectPolygon),
    rows: toDisplayCollection(files.rows.features, reprojectLineString),
    canopy: toDisplayCollection(files.canopy.features, reprojectPolygon),
    interrows: toDisplayCollection(
      files.interrows.features.map(({ geometry, properties }) => {
        const [outer = []] = geometry.coordinates;
        return { geometry, properties: { ...properties, width_m: stripWidthM(outer, properties.area_m2) } };
      }),
      reprojectPolygon,
    ),
    waste: toDisplayCollection(files.waste.features, reprojectPolygon),
    inspectionPoints: toDisplayCollection(files.inspectionPoints.features, reprojectPoint),
    routes: {
      inspection: toDisplayRoute(files.inspectionRoute),
      waste_collection: toDisplayRoute(files.wasteRoute),
    },
    routeMap: null,
    start: { type: "Feature", geometry: reprojectPoint(startFeature.geometry), properties: startFeature.properties },
    projectedStart: startFeature.geometry.coordinates,
  };
};

export const blocksBounds = (files: SurveyFiles): LngLatBounds => {
  const positions = files.blocks.features.flatMap(({ geometry }) => geometry.coordinates.flat()).map(reprojectPosition);
  const longitudes = positions.map(([lng = 0]) => lng);
  const latitudes = positions.map(([, lat = 0]) => lat);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
};
