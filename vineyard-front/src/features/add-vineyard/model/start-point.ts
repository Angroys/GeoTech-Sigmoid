import type { Position } from "geojson";

import type { SurveyFiles } from "@/entities/survey";

export const START_SOURCES = ["file", "pasted"] as const;
export type StartSource = (typeof START_SOURCES)[number];

export const START_TOLERANCE_M = 5;

export const startFileFrom = ([easting = 0, northing = 0]: Position): SurveyFiles["start"] => {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [easting, northing] }, properties: {} }],
  };
};

const distanceM = ([ax = 0, ay = 0]: Position, [bx = 0, by = 0]: Position) => Math.hypot(ax - bx, ay - by);

export const routeOffsetFromStart = (
  files: Pick<SurveyFiles, "inspectionRoute" | "wasteRoute">,
  start: Position,
): number | null => {
  const routes = [files.inspectionRoute, files.wasteRoute].filter(route => route !== null);
  if (routes.length === 0) return null;
  const ends = routes.flatMap(route => {
    const line = route.features[0].geometry.coordinates;
    return [line[0], line.at(-1)].filter(point => point !== undefined);
  });
  return Math.max(0, ...ends.map(end => distanceM(end, start)));
};
