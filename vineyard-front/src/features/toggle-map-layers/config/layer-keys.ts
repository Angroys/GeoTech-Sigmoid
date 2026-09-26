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
  "route-evidence": { color: FEATURE_COLORS.outsideSupplied, shape: "line" },
  "inspection-points": { color: FEATURE_COLORS.inspectionPoint, shape: "dot" },
  waste: { color: FEATURE_COLORS.waste, shape: "box" },
  rows: { color: ROW_STRUCTURE_STYLE.regular.color, shape: "line" },
  interrows: { color: INTERROW_COVER_STYLE.bare_soil.color, shape: "area" },
  canopy: { color: FEATURE_COLORS.canopy, shape: "area" },
  "inferred-headlands": { color: FEATURE_COLORS.inferredHeadland, shape: "area" },
  "supplied-passages": { color: FEATURE_COLORS.suppliedPassage, shape: "area" },
  "forbidden-areas": { color: FEATURE_COLORS.forbiddenArea, shape: "area" },
  "study-area": { color: FEATURE_COLORS.studyArea, shape: "dashed-outline" },
  blocks: { color: FEATURE_COLORS.route, shape: "dashed-outline" },
} as const satisfies Record<SurveyLayerId, Omit<LayerKey, "label">>;

const ROUTE_START_KEY: LayerKey = { label: "Vineyard starting point", color: FEATURE_COLORS.route, shape: "ring" };
const REQUESTED_START_KEY: LayerKey = { label: "Your starting point", color: FEATURE_COLORS.route, shape: "dot" };
const ROUTE_EVIDENCE_KEYS: readonly LayerKey[] = [
  { label: "Outside blocks — context only", color: FEATURE_COLORS.outsideBlocks, shape: "line" },
  { label: "Outside supplied walking areas", color: FEATURE_COLORS.outsideSupplied, shape: "line" },
  { label: "Outside selected permitted area", color: FEATURE_COLORS.outsidePermitted, shape: "line" },
];

export const layerKeys = (layerId: SurveyLayerId, hasRequestedStart: boolean): readonly LayerKey[] => {
  switch (layerId) {
    case "rows":
      return ROW_STRUCTURES.map(value => ({ ...ROW_STRUCTURE_STYLE[value], shape: "line" }));
    case "interrows":
      return INTERROW_COVERS.map(value => ({ ...INTERROW_COVER_STYLE[value], shape: "area" }));
    case "route":
      return hasRequestedStart ? [ROUTE_START_KEY, REQUESTED_START_KEY] : [ROUTE_START_KEY];
    case "route-evidence":
      return ROUTE_EVIDENCE_KEYS;
    default:
      return [];
  }
};
