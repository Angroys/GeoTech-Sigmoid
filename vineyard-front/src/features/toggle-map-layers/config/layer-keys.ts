import {
  FEATURE_COLORS,
  INTERROW_COVER_STYLE,
  INTERROW_COVERS,
  ROW_STRUCTURE_STYLE,
  ROW_STRUCTURES,
  type SurveyLayerId,
} from "@/entities/survey";

export type SwatchShape = "line" | "dashed-outline" | "area" | "dot" | "ring" | "box";

export type LayerKey = { label: string; color: string; shape: SwatchShape };

export const LAYER_SWATCH = {
  route: { color: FEATURE_COLORS.route, shape: "line" },
  "inspection-points": { color: FEATURE_COLORS.inspectionPoint, shape: "dot" },
  waste: { color: FEATURE_COLORS.waste, shape: "box" },
  rows: { color: ROW_STRUCTURE_STYLE.regular.color, shape: "line" },
  interrows: { color: INTERROW_COVER_STYLE.bare_soil.color, shape: "area" },
  canopy: { color: FEATURE_COLORS.canopy, shape: "area" },
  blocks: { color: FEATURE_COLORS.route, shape: "dashed-outline" },
} as const satisfies Record<SurveyLayerId, Omit<LayerKey, "label">>;

const ROUTE_START_KEY: LayerKey = { label: "Vineyard starting point", color: FEATURE_COLORS.route, shape: "ring" };
const REQUESTED_START_KEY: LayerKey = { label: "Your starting point", color: FEATURE_COLORS.route, shape: "dot" };

export const layerKeys = (layerId: SurveyLayerId, hasRequestedStart: boolean): readonly LayerKey[] => {
  switch (layerId) {
    case "rows":
      return ROW_STRUCTURES.map(value => ({ ...ROW_STRUCTURE_STYLE[value], shape: "line" }));
    case "interrows":
      return INTERROW_COVERS.map(value => ({ ...INTERROW_COVER_STYLE[value], shape: "area" }));
    case "route":
      return hasRequestedStart ? [ROUTE_START_KEY, REQUESTED_START_KEY] : [ROUTE_START_KEY];
    default:
      return [];
  }
};
