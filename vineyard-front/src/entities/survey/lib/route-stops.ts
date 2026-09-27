import type { Position } from "geojson";

import { assertNever } from "@/shared/lib/types";

import type { RoutePurpose } from "../config/routes";
import type { RowId, Survey, SurveySelection, TargetId, VineyardId } from "../model/types";

type StopBase = {
  order: number;
  targetId: TargetId;
  position: Position;
  distanceM: number;
};

export type InspectionStop = StopBase & { kind: "inspection_point"; vineyardId: VineyardId; rowId: RowId };
export type WasteStop = StopBase & { kind: "waste"; vineyardId: VineyardId | null };
export type RouteStop = InspectionStop | WasteStop;

export type UnreachableTarget = { kind: RouteStop["kind"]; targetId: TargetId; vineyardId: VineyardId | null };

const MINUTES_PER_HOUR = 60;
const METRES_PER_KILOMETRE = 1000;

const ringCentre = (ring: Position[]): Position => {
  const corners = ring.slice(0, -1);
  const total = corners.reduce<[number, number]>(
    ([x, y], [cornerX = 0, cornerY = 0]) => {
      return [x + cornerX, y + cornerY];
    },
    [0, 0],
  );
  return [total[0] / corners.length, total[1] / corners.length];
};

const buildTargetIndex = (survey: Survey) => {
  const index = new Map<
    TargetId,
    Omit<InspectionStop, "order" | "distanceM"> | Omit<WasteStop, "order" | "distanceM">
  >();
  for (const { geometry, properties } of survey.inspectionPoints.features) {
    index.set(properties.point_id, {
      kind: "inspection_point",
      targetId: properties.point_id,
      vineyardId: properties.vineyard_id,
      rowId: properties.row_id,
      position: geometry.coordinates,
    });
  }
  for (const { geometry, properties } of survey.waste.features) {
    const [outerRing = []] = geometry.coordinates;
    index.set(properties.waste_id, {
      kind: "waste",
      targetId: properties.waste_id,
      vineyardId: properties.vineyard_id,
      position: ringCentre(outerRing),
    });
  }
  return index;
};

export const getRouteStops = (survey: Survey, purpose: RoutePurpose): RouteStop[] => {
  const targets = buildTargetIndex(survey);
  const route = survey.routes[purpose];
  if (!route) return [];
  const { stop_ids: stopIds, stop_distances_m: stopDistances } = route.properties;
  return stopIds.flatMap((targetId, index) => {
    const target = targets.get(targetId);
    return target ? [{ ...target, order: index + 1, distanceM: stopDistances[index] ?? 0 }] : [];
  });
};

export const getUnreachableTargets = (survey: Survey, purpose: RoutePurpose): UnreachableTarget[] => {
  const inspection = survey.inspectionPoints.features
    .filter(({ properties }) => !properties.reachable)
    .map(({ properties }): UnreachableTarget => {
      return { kind: "inspection_point", targetId: properties.point_id, vineyardId: properties.vineyard_id };
    });
  const waste = survey.waste.features
    .filter(({ properties }) => !properties.reachable)
    .map(({ properties }): UnreachableTarget => {
      return { kind: "waste", targetId: properties.waste_id, vineyardId: properties.vineyard_id };
    });
  return purpose === "inspection" ? [...inspection, ...waste] : waste;
};

export const walkingMinutes = (lengthM: number, speedKmh: number) =>
  (lengthM / METRES_PER_KILOMETRE / speedKmh) * MINUTES_PER_HOUR;

export const locateSelection = (survey: Survey, selection: SurveySelection): Position[] => {
  switch (selection.kind) {
    case "none":
      return [];
    case "block":
      return survey.blocks.features
        .filter(({ properties }) => properties.vineyard_id === selection.vineyardId)
        .flatMap(({ geometry }) => geometry.coordinates.flat());
    case "row":
      return (
        survey.rows.features.find(({ properties }) => properties.row_id === selection.rowId)?.geometry.coordinates ?? []
      );
    case "interrow":
      return survey.interrows.features
        .filter(({ properties }) => properties.interrow_id === selection.interrowId)
        .flatMap(({ geometry }) => geometry.coordinates.flat());
    case "target": {
      const target = buildTargetIndex(survey).get(selection.targetId);
      return target ? [target.position] : [];
    }
    default:
      return assertNever(selection);
  }
};
