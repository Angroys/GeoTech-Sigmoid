import type { Position } from "geojson";

import { projectToSurveyCrs } from "@/shared/lib/geo";

export const FAR_FROM_VINEYARD_M = 2_000;

export const distanceBetweenM = (a: Position, b: Position) => {
  const [ax = 0, ay = 0] = projectToSurveyCrs(a);
  const [bx = 0, by = 0] = projectToSurveyCrs(b);
  return Math.hypot(ax - bx, ay - by);
};
