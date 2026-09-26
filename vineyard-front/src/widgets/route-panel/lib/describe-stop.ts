import type { RouteStop } from "@/entities/survey";
import { assertNever } from "@/shared/lib/types";

export const describeStop = (stop: RouteStop) => {
  switch (stop.kind) {
    case "inspection_point":
      return { title: "Missing vines", location: `Row ${stop.rowId}, block ${stop.vineyardId}` };
    case "waste":
      return {
        title: "Waste",
        location: stop.vineyardId ? `Block ${stop.vineyardId}` : "More than 10 m from any block",
      };
    default:
      return assertNever(stop);
  }
};
