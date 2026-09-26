import { useState } from "react";

import type { Survey, SurveySelection, TargetId } from "@/entities/survey";

export const useLoupeWaste = (survey: Survey, selection: SurveySelection) => {
  const [hiddenId, setHiddenId] = useState<TargetId | null>(null);
  const selectedId = selection.kind === "target" ? selection.targetId : null;
  const waste = survey.waste.features.find(feature => feature.properties.waste_id === selectedId) ?? null;

  const hide = () => setHiddenId(selectedId);
  const isHidden = waste !== null && hiddenId === waste.properties.waste_id;

  return { waste: isHidden ? null : waste, hide };
};
