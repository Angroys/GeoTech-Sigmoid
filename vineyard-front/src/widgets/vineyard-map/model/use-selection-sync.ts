import type { Map as MaplibreMap } from "maplibre-gl";
import { useEffect } from "react";

import { locateSelection, type Survey, type SurveySelection } from "@/entities/survey";
import { assertNever } from "@/shared/lib/types";

import { FIT_PADDING_PX } from "../config/map-style";
import { HIGHLIGHT_LAYER_IDS, NOTHING_SELECTED } from "../config/survey-layers";
import { boundsOf } from "../lib/bounds";

const SELECTION_MAX_ZOOM = 20;

type HighlightedIds = Record<"block" | "row" | "interrow" | "target", string>;

const NONE_HIGHLIGHTED: HighlightedIds = {
  block: NOTHING_SELECTED,
  row: NOTHING_SELECTED,
  interrow: NOTHING_SELECTED,
  target: NOTHING_SELECTED,
};

const highlightedIds = (selection: SurveySelection): HighlightedIds => {
  switch (selection.kind) {
    case "none":
      return NONE_HIGHLIGHTED;
    case "block":
      return { ...NONE_HIGHLIGHTED, block: selection.vineyardId };
    case "row":
      return { ...NONE_HIGHLIGHTED, row: selection.rowId };
    case "interrow":
      return { ...NONE_HIGHLIGHTED, interrow: selection.interrowId };
    case "target":
      return { ...NONE_HIGHLIGHTED, target: selection.targetId };
    default:
      return assertNever(selection);
  }
};

export const useSelectionSync = (
  map: MaplibreMap | null,
  isReady: boolean,
  survey: Survey,
  selection: SurveySelection,
) => {
  useEffect(() => {
    if (!map || !isReady) return;

    const { block, row, interrow, target } = highlightedIds(selection);
    map.setFilter(HIGHLIGHT_LAYER_IDS.block, ["==", ["get", "vineyard_id"], block]);
    map.setFilter(HIGHLIGHT_LAYER_IDS.row, ["==", ["get", "row_id"], row]);
    map.setFilter(HIGHLIGHT_LAYER_IDS.interrow, ["==", ["get", "interrow_id"], interrow]);
    map.setFilter(HIGHLIGHT_LAYER_IDS.waste, ["==", ["get", "waste_id"], target]);
    map.setFilter(HIGHLIGHT_LAYER_IDS.inspectionPoint, ["==", ["get", "point_id"], target]);

    const bounds = boundsOf(locateSelection(survey, selection));
    if (bounds) map.fitBounds(bounds, { padding: FIT_PADDING_PX * 2, maxZoom: SELECTION_MAX_ZOOM, duration: 700 });
  }, [map, isReady, survey, selection]);
};
