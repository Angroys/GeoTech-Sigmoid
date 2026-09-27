import type { Position } from "geojson";

import type { RouteStop, Survey } from "@/entities/survey";
import { projectToSurveyCrs } from "@/shared/lib/geo";

const MARGIN_RATIO = 0.06;
const NICE_LENGTHS_M = [10, 20, 50, 100, 200, 500, 1000];

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export type DrawnStop = { order: number; x: number; y: number };

export type RouteDrawing = {
  viewBox: string;
  unit: number;
  blocks: string[];
  route: string | null;
  start: { x: number; y: number };
  stops: DrawnStop[];
  scaleBar: { x: number; y: number; lengthM: number };
};

const boundsOf = (points: readonly Position[]): Bounds => {
  const xs = points.map(([x = 0]) => x);
  const ys = points.map(([, y = 0]) => y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
};

const niceLength = (spanM: number) =>
  [...NICE_LENGTHS_M].reverse().find(length => length <= spanM / 4) ?? NICE_LENGTHS_M[0] ?? 10;

export const drawRoute = (survey: Survey, stops: readonly RouteStop[], routeLine: Position[] | null): RouteDrawing => {
  const project = (lngLat: Position) => projectToSurveyCrs(lngLat);
  const blockRings = survey.blocks.features.map(block => (block.geometry.coordinates[0] ?? []).map(project));
  const line = routeLine?.map(project) ?? null;
  const start = project(survey.start.geometry.coordinates);
  const stopPoints = stops.map(stop => project(stop.position));

  const bounds = boundsOf([...blockRings.flat(), ...(line ?? []), start, ...stopPoints]);
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const margin = span * MARGIN_RATIO;
  const toSvg = ([x = 0, y = 0]: Position) => ({ x: x - bounds.minX + margin, y: bounds.maxY - y + margin });
  const toPath = (points: readonly Position[]) =>
    points.map(point => toSvg(point)).map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");

  const width = bounds.maxX - bounds.minX + margin * 2;
  const height = bounds.maxY - bounds.minY + margin * 2;

  return {
    viewBox: `0 0 ${width.toFixed(2)} ${height.toFixed(2)}`,
    unit: span / 100,
    blocks: blockRings.map(ring => `${toPath(ring)} Z`),
    route: line ? toPath(line) : null,
    start: toSvg(start),
    stops: stops.map((stop, index) => ({ order: stop.order, ...toSvg(stopPoints[index] ?? start) })),
    scaleBar: { x: margin, y: height - margin / 2, lengthM: niceLength(span) },
  };
};
