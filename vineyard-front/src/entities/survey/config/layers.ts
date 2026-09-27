export const SURVEY_LAYERS = [
  { id: "route", label: "Walking route" },
  { id: "inspection-points", label: "Missing vines" },
  { id: "waste", label: "Waste" },
  { id: "rows", label: "Row axes" },
  { id: "interrows", label: "Inter-row areas" },
  { id: "canopy", label: "Canopy" },
  { id: "blocks", label: "Block outlines" },
] as const satisfies readonly { id: string; label: string }[];

export type SurveyLayerId = (typeof SURVEY_LAYERS)[number]["id"];

export type LayerVisibility = Record<SurveyLayerId, boolean>;
