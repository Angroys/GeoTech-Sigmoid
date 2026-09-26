import type { Role } from "@/entities/role";
import type { LayerVisibility, RoutePurpose } from "@/entities/survey";

type WorkspaceConfig = { routePurpose: RoutePurpose; initialLayers: LayerVisibility };

export const WORKSPACE_CONFIG = {
  owner: {
    routePurpose: "waste_collection",
    initialLayers: {
      blocks: true,
      interrows: true,
      canopy: true,
      rows: true,
      route: true,
      "route-evidence": true,
      waste: true,
      "inspection-points": true,
      "inferred-headlands": true,
      "supplied-passages": true,
      "forbidden-areas": true,
      "study-area": true,
    },
  },
  inspector: {
    routePurpose: "inspection",
    initialLayers: {
      blocks: true,
      interrows: false,
      canopy: false,
      rows: true,
      route: true,
      "route-evidence": true,
      waste: true,
      "inspection-points": true,
      "inferred-headlands": true,
      "supplied-passages": true,
      "forbidden-areas": true,
      "study-area": true,
    },
  },
} as const satisfies Record<Role, WorkspaceConfig>;
