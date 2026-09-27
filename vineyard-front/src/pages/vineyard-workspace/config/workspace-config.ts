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
      waste: true,
      "inspection-points": true,
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
      waste: true,
      "inspection-points": true,
    },
  },
} as const satisfies Record<Role, WorkspaceConfig>;
