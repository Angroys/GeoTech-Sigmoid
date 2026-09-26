import type { MapGeoJSONFeature, MapMouseEvent, Map as MaplibreMap } from "maplibre-gl";
import { useEffect } from "react";

import { NO_SELECTION, type Survey, type SurveySelection } from "@/entities/survey";

import { CLICKABLE_LAYER_IDS } from "../config/survey-layers";

const CLICKABLE_LAYERS = Object.values(CLICKABLE_LAYER_IDS);

const toSelection = (feature: MapGeoJSONFeature, survey: Survey): SurveySelection => {
  const properties: Record<string, unknown> = feature.properties;

  switch (feature.layer.id) {
    case CLICKABLE_LAYER_IDS.inspectionPoint: {
      const match = survey.inspectionPoints.features.find(
        ({ properties: point }) => point.point_id === properties.point_id,
      );
      return match ? { kind: "target", targetId: match.properties.point_id } : NO_SELECTION;
    }
    case CLICKABLE_LAYER_IDS.waste: {
      const match = survey.waste.features.find(({ properties: waste }) => waste.waste_id === properties.waste_id);
      return match ? { kind: "target", targetId: match.properties.waste_id } : NO_SELECTION;
    }
    case CLICKABLE_LAYER_IDS.row: {
      const match = survey.rows.features.find(({ properties: row }) => row.row_id === properties.row_id);
      return match ? { kind: "row", rowId: match.properties.row_id } : NO_SELECTION;
    }
    case CLICKABLE_LAYER_IDS.interrow: {
      const match = survey.interrows.features.find(
        ({ properties: interrow }) => interrow.interrow_id === properties.interrow_id,
      );
      return match ? { kind: "interrow", interrowId: match.properties.interrow_id } : NO_SELECTION;
    }
    default:
      return NO_SELECTION;
  }
};

export const useFeatureClicks = (
  map: MaplibreMap | null,
  isReady: boolean,
  survey: Survey,
  onSelect: (selection: SurveySelection) => void,
) => {
  useEffect(() => {
    if (!map || !isReady) return;

    const visibleClickableLayers = () =>
      CLICKABLE_LAYERS.filter(id => map.getLayoutProperty(id, "visibility") !== "none");

    const handleClick = (event: MapMouseEvent) => {
      const [topmost] = map.queryRenderedFeatures(event.point, { layers: visibleClickableLayers() });
      onSelect(topmost ? toSelection(topmost, survey) : NO_SELECTION);
    };
    const handleMove = (event: MapMouseEvent) => {
      const isOverFeature = map.queryRenderedFeatures(event.point, { layers: visibleClickableLayers() }).length > 0;
      map.getCanvas().style.cursor = isOverFeature ? "pointer" : "";
    };

    map.on("click", handleClick);
    map.on("mousemove", handleMove);
    return () => {
      map.off("click", handleClick);
      map.off("mousemove", handleMove);
    };
  }, [map, isReady, survey, onSelect]);
};
