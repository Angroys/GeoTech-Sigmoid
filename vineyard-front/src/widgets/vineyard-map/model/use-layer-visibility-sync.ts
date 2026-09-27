import type { Map as MaplibreMap } from "maplibre-gl";
import { useEffect } from "react";

import { SURVEY_LAYERS, type LayerVisibility } from "@/entities/survey";

import { SURVEY_MAP_LAYERS } from "../config/survey-layers";

export const useLayerVisibilitySync = (map: MaplibreMap | null, isReady: boolean, visibility: LayerVisibility) => {
  useEffect(() => {
    if (!map || !isReady) return;

    for (const { id } of SURVEY_LAYERS) {
      for (const layer of SURVEY_MAP_LAYERS[id]) {
        map.setLayoutProperty(layer.id, "visibility", visibility[id] ? "visible" : "none");
      }
    }
  }, [map, isReady, visibility]);
};
