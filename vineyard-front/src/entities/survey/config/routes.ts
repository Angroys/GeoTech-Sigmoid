export const ROUTE_PURPOSES = ["inspection", "waste_collection"] as const;
export type RoutePurpose = (typeof ROUTE_PURPOSES)[number];

type RouteCopy = { title: string; description: string };

export const ROUTE_COPY = {
  inspection: {
    title: "Inspection route",
    description: "Visits every reachable row gap with missing vines and every waste item, then returns to the start.",
  },
  waste_collection: {
    title: "Waste collection route",
    description: "Visits every reachable waste item, then returns to the start.",
  },
} as const satisfies Record<RoutePurpose, RouteCopy>;
