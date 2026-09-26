import type { AddLayerObject, ExpressionSpecification } from "maplibre-gl";

import { FEATURE_COLORS, INTERROW_COVER_STYLE, ROW_STRUCTURE_STYLE, type SurveyLayerId } from "@/entities/survey";

export const SOURCE_IDS = {
  studyArea: "route-study-area",
  suppliedPassages: "route-supplied-passages",
  inferredHeadlands: "route-inferred-headlands",
  forbiddenAreas: "route-forbidden-areas",
  blocks: "survey-blocks",
  interrows: "survey-interrows",
  canopy: "survey-canopy",
  rows: "survey-rows",
  route: "survey-route",
  routeEvidence: "route-evidence",
  waste: "survey-waste",
  inspectionPoints: "survey-inspection-points",
  start: "survey-start",
  requestedStart: "requested-start",
} as const;

export const HIGHLIGHT_LAYER_IDS = {
  block: "selected-block",
  interrow: "selected-interrow",
  row: "selected-row",
  inspectionPoint: "selected-inspection-point",
  waste: "selected-waste",
} as const;

export const CLICKABLE_LAYER_IDS = {
  inspectionPoint: "inspection-points-circle",
  waste: "waste-fill",
  row: "rows-line",
  interrow: "interrows-fill",
} as const;

const byZoom = (from: number, to: number): ExpressionSpecification => {
  return ["interpolate", ["linear"], ["zoom"], 16, from, 21, to];
};

const rowStructureColor: ExpressionSpecification = [
  "match",
  ["get", "row_structure"],
  "regular",
  ROW_STRUCTURE_STYLE.regular.color,
  "disrupted",
  ROW_STRUCTURE_STYLE.disrupted.color,
  ROW_STRUCTURE_STYLE.unassessable.color,
];

const interrowCoverColor: ExpressionSpecification = [
  "match",
  ["get", "interrow_cover"],
  "bare_soil",
  INTERROW_COVER_STYLE.bare_soil.color,
  "vegetation",
  INTERROW_COVER_STYLE.vegetation.color,
  "mixed",
  INTERROW_COVER_STYLE.mixed.color,
  INTERROW_COVER_STYLE.unassessable.color,
];

export const SURVEY_MAP_LAYERS = {
  "study-area": [
    {
      id: "study-area-outline",
      type: "line",
      source: SOURCE_IDS.studyArea,
      paint: {
        "line-color": FEATURE_COLORS.studyArea,
        "line-width": byZoom(1.5, 3),
        "line-dasharray": [4, 2],
        "line-opacity": 0.95,
      },
    },
  ],
  "supplied-passages": [
    {
      id: "supplied-passages-fill",
      type: "fill",
      source: SOURCE_IDS.suppliedPassages,
      paint: { "fill-color": FEATURE_COLORS.suppliedPassage, "fill-opacity": 0.24 },
    },
    {
      id: "supplied-passages-outline",
      type: "line",
      source: SOURCE_IDS.suppliedPassages,
      paint: { "line-color": FEATURE_COLORS.suppliedPassage, "line-width": byZoom(0.8, 2), "line-opacity": 0.9 },
    },
  ],
  "inferred-headlands": [
    {
      id: "inferred-headlands-fill",
      type: "fill",
      source: SOURCE_IDS.inferredHeadlands,
      paint: { "fill-color": FEATURE_COLORS.inferredHeadland, "fill-opacity": 0.28 },
    },
    {
      id: "inferred-headlands-outline",
      type: "line",
      source: SOURCE_IDS.inferredHeadlands,
      paint: {
        "line-color": FEATURE_COLORS.inferredHeadland,
        "line-width": byZoom(0.8, 2),
        "line-dasharray": [2, 1.5],
      },
    },
  ],
  "forbidden-areas": [
    {
      id: "forbidden-areas-fill",
      type: "fill",
      source: SOURCE_IDS.forbiddenAreas,
      paint: { "fill-color": FEATURE_COLORS.forbiddenArea, "fill-opacity": 0.3 },
    },
    {
      id: "forbidden-areas-outline",
      type: "line",
      source: SOURCE_IDS.forbiddenAreas,
      paint: { "line-color": FEATURE_COLORS.forbiddenArea, "line-width": byZoom(1, 2.5) },
    },
  ],
  blocks: [
    {
      id: "blocks-outline",
      type: "line",
      source: SOURCE_IDS.blocks,
      paint: {
        "line-color": FEATURE_COLORS.blockOutline,
        "line-width": 1.5,
        "line-dasharray": [3, 2],
        "line-opacity": 0.9,
      },
    },
  ],
  interrows: [
    {
      id: CLICKABLE_LAYER_IDS.interrow,
      type: "fill",
      source: SOURCE_IDS.interrows,
      paint: { "fill-color": interrowCoverColor, "fill-opacity": 0.4 },
    },
  ],
  canopy: [
    {
      id: "canopy-fill",
      type: "fill",
      source: SOURCE_IDS.canopy,
      paint: { "fill-color": FEATURE_COLORS.canopy, "fill-opacity": 0.6 },
    },
  ],
  rows: [
    {
      id: CLICKABLE_LAYER_IDS.row,
      type: "line",
      source: SOURCE_IDS.rows,
      layout: { "line-cap": "round" },
      paint: { "line-color": rowStructureColor, "line-width": byZoom(0.8, 3) },
    },
  ],
  route: [
    {
      id: "requested-start-link",
      type: "line",
      source: SOURCE_IDS.requestedStart,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": FEATURE_COLORS.routeCasing,
        "line-width": byZoom(3, 5),
        "line-dasharray": [0.1, 2],
      },
    },
    {
      id: "route-casing",
      type: "line",
      source: SOURCE_IDS.route,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": FEATURE_COLORS.routeCasing, "line-width": byZoom(4, 9), "line-opacity": 0.85 },
    },
    {
      id: "route-line",
      type: "line",
      source: SOURCE_IDS.route,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": FEATURE_COLORS.route, "line-width": byZoom(2, 5) },
    },
    {
      id: "route-start",
      type: "circle",
      source: SOURCE_IDS.start,
      paint: {
        "circle-radius": byZoom(5, 9),
        "circle-color": FEATURE_COLORS.routeCasing,
        "circle-stroke-color": FEATURE_COLORS.route,
        "circle-stroke-width": 3,
      },
    },
    {
      id: "requested-start-halo",
      type: "circle",
      source: SOURCE_IDS.requestedStart,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": byZoom(11, 18),
        "circle-color": FEATURE_COLORS.route,
        "circle-opacity": 0.18,
        "circle-stroke-color": FEATURE_COLORS.route,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.5,
      },
    },
    {
      id: "requested-start-point",
      type: "circle",
      source: SOURCE_IDS.requestedStart,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": byZoom(4.5, 7),
        "circle-color": FEATURE_COLORS.route,
        "circle-stroke-color": FEATURE_COLORS.routeCasing,
        "circle-stroke-width": 2.5,
      },
    },
  ],
  "route-evidence": [
    {
      id: "route-outside-blocks",
      type: "line",
      source: SOURCE_IDS.routeEvidence,
      filter: ["==", ["get", "kind"], "outside_blocks"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": FEATURE_COLORS.outsideBlocks,
        "line-width": byZoom(4, 8),
        "line-dasharray": [1, 1.5],
        "line-opacity": 0.85,
      },
    },
    {
      id: "route-outside-supplied",
      type: "line",
      source: SOURCE_IDS.routeEvidence,
      filter: ["==", ["get", "kind"], "outside_supplied"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": FEATURE_COLORS.outsideSupplied,
        "line-width": byZoom(3, 7),
        "line-dasharray": [1.5, 1],
      },
    },
    {
      id: "route-outside-permitted",
      type: "line",
      source: SOURCE_IDS.routeEvidence,
      filter: ["==", ["get", "kind"], "outside_permitted"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": FEATURE_COLORS.outsidePermitted, "line-width": byZoom(5, 10) },
    },
  ],
  waste: [
    {
      id: CLICKABLE_LAYER_IDS.waste,
      type: "fill",
      source: SOURCE_IDS.waste,
      paint: { "fill-color": FEATURE_COLORS.waste, "fill-opacity": 0.3 },
    },
    {
      id: "waste-outline",
      type: "line",
      source: SOURCE_IDS.waste,
      paint: { "line-color": FEATURE_COLORS.waste, "line-width": 2 },
    },
  ],
  "inspection-points": [
    {
      id: CLICKABLE_LAYER_IDS.inspectionPoint,
      type: "circle",
      source: SOURCE_IDS.inspectionPoints,
      paint: {
        "circle-radius": byZoom(3.5, 8),
        "circle-color": FEATURE_COLORS.inspectionPoint,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    },
  ],
} as const satisfies Record<SurveyLayerId, readonly AddLayerObject[]>;

export const NOTHING_SELECTED = "";

export const HIGHLIGHT_LAYERS: readonly AddLayerObject[] = [
  {
    id: HIGHLIGHT_LAYER_IDS.block,
    type: "line",
    source: SOURCE_IDS.blocks,
    filter: ["==", ["get", "vineyard_id"], NOTHING_SELECTED],
    layout: { "line-join": "round" },
    paint: { "line-color": FEATURE_COLORS.selection, "line-width": 3.5 },
  },
  {
    id: HIGHLIGHT_LAYER_IDS.interrow,
    type: "line",
    source: SOURCE_IDS.interrows,
    filter: ["==", ["get", "interrow_id"], NOTHING_SELECTED],
    layout: { "line-join": "round" },
    paint: { "line-color": FEATURE_COLORS.selection, "line-width": 3 },
  },
  {
    id: HIGHLIGHT_LAYER_IDS.row,
    type: "line",
    source: SOURCE_IDS.rows,
    filter: ["==", ["get", "row_id"], NOTHING_SELECTED],
    layout: { "line-cap": "round" },
    paint: { "line-color": FEATURE_COLORS.selection, "line-width": byZoom(3, 7) },
  },
  {
    id: HIGHLIGHT_LAYER_IDS.waste,
    type: "line",
    source: SOURCE_IDS.waste,
    filter: ["==", ["get", "waste_id"], NOTHING_SELECTED],
    paint: { "line-color": FEATURE_COLORS.selection, "line-width": 4 },
  },
  {
    id: HIGHLIGHT_LAYER_IDS.inspectionPoint,
    type: "circle",
    source: SOURCE_IDS.inspectionPoints,
    filter: ["==", ["get", "point_id"], NOTHING_SELECTED],
    paint: {
      "circle-radius": byZoom(9, 16),
      "circle-opacity": 0,
      "circle-stroke-color": FEATURE_COLORS.selection,
      "circle-stroke-width": 3,
    },
  },
];
