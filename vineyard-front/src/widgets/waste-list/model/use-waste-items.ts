import { useMemo } from "react";

import { getRouteStops, type RoutePurpose, type Survey, type TargetId, type VineyardId } from "@/entities/survey";

export const WASTE_STATUSES = ["on_route", "unreachable"] as const;
export type WasteStatus = (typeof WASTE_STATUSES)[number];

export const WASTE_STATUS_LABEL = {
  on_route: "On the route",
  unreachable: "Not reachable",
} as const satisfies Record<WasteStatus, string>;

export type WasteItem = {
  targetId: TargetId;
  vineyardId: VineyardId | null;
  stopOrder: number | null;
  status: WasteStatus;
};

export const NO_BLOCK = "no-block";
export type WasteGroupKey = VineyardId | typeof NO_BLOCK;

export type WasteGroup = {
  key: WasteGroupKey;
  vineyardId: VineyardId | null;
  items: WasteItem[];
  onRouteCount: number;
};

const groupKeyOf = (item: WasteItem): WasteGroupKey => item.vineyardId ?? NO_BLOCK;

const toGroups = (items: WasteItem[]): WasteGroup[] => {
  const byKey = new Map<WasteGroupKey, WasteItem[]>();
  for (const item of items) byKey.set(groupKeyOf(item), [...(byKey.get(groupKeyOf(item)) ?? []), item]);

  return [...byKey]
    .map(([key, groupItems]) => {
      return {
        key,
        vineyardId: groupItems[0]?.vineyardId ?? null,
        items: groupItems,
        onRouteCount: groupItems.filter(item => item.status === "on_route").length,
      };
    })
    .sort((a, b) => {
      if (a.vineyardId === null) return 1;
      if (b.vineyardId === null) return -1;
      return a.vineyardId.localeCompare(b.vineyardId);
    });
};

export const useWasteItems = (
  survey: Survey,
  routePurpose: RoutePurpose,
  visibleStatuses: ReadonlySet<WasteStatus>,
) => {
  const items = useMemo(() => {
    const stopOrder = new Map(getRouteStops(survey, routePurpose).map(stop => [stop.targetId, stop.order]));
    const list = survey.waste.features
      .map(({ properties }): WasteItem => {
        return {
          targetId: properties.waste_id,
          vineyardId: properties.vineyard_id,
          stopOrder: stopOrder.get(properties.waste_id) ?? null,
          status: properties.reachable ? "on_route" : "unreachable",
        };
      })
      .sort((a, b) => a.targetId.localeCompare(b.targetId));
    return list;
  }, [survey, routePurpose]);

  const statusCounts = useMemo(() => {
    return WASTE_STATUSES.map(status => {
      return { status, count: items.filter(item => item.status === status).length };
    });
  }, [items]);

  const groups = useMemo(
    () => toGroups(items.filter(item => visibleStatuses.has(item.status))),
    [items, visibleStatuses],
  );

  return { items, groups, statusCounts };
};
