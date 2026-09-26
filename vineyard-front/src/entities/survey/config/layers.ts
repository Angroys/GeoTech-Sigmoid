export const SURVEY_LAYERS = [
  { id: "blocks", label: "Block outlines" },
  { id: "interrows", label: "Inter-row areas" },
  { id: "canopy", label: "Canopy" },
  { id: "rows", label: "Row axes" },
  { id: "route", label: "Walking route" },
  { id: "waste", label: "Waste" },
  { id: "inspection-points", label: "Missing vines" },
] as const satisfies readonly { id: string; label: string }[];

export type SurveyLayerId = (typeof SURVEY_LAYERS)[number]["id"];

export type LayerVisibility = Record<SurveyLayerId, boolean>;
