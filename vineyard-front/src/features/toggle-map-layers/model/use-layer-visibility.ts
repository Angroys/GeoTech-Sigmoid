import { useCallback, useMemo, useState } from "react";

import { SURVEY_LAYERS, type LayerVisibility, type SurveyLayerId } from "@/entities/survey";

export type AllLayersState = "all" | "none" | "some";

const setEveryLayer = (current: LayerVisibility, isVisible: boolean): LayerVisibility => {
  const next = { ...current };
  for (const { id } of SURVEY_LAYERS) next[id] = isVisible;
  return next;
};

const summarize = (visibility: LayerVisibility): AllLayersState => {
  const visibleCount = SURVEY_LAYERS.filter(({ id }) => visibility[id]).length;
  if (visibleCount === SURVEY_LAYERS.length) return "all";
  return visibleCount === 0 ? "none" : "some";
};

export const useLayerVisibility = (initialVisibility: LayerVisibility) => {
  const [visibility, setVisibility] = useState(initialVisibility);
  const allLayers = useMemo(() => summarize(visibility), [visibility]);

  const toggleLayer = useCallback((layerId: SurveyLayerId) => {
    setVisibility(current => {
      return { ...current, [layerId]: !current[layerId] };
    });
  }, []);

  const toggleAllLayers = useCallback(() => {
    setVisibility(current => setEveryLayer(current, summarize(current) !== "all"));
  }, []);

  return { visibility, allLayers, toggleLayer, toggleAllLayers };
};
