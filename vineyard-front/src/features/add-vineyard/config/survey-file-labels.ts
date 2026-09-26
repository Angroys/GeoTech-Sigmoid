import type { SurveyFileKey } from "@/entities/survey";

export const SURVEY_FILE_LABELS = {
  blocks: "Vineyard block outlines",
  rows: "Row axes",
  canopy: "Vine canopies",
  interrows: "Inter-row areas",
  waste: "Waste",
  inspectionPoints: "Row gaps to inspect",
  inspectionRoute: "Inspection route",
  wasteRoute: "Waste collection route",
  start: "Starting point",
} as const satisfies Record<SurveyFileKey, string>;

export const SAMPLE_DATA_URL = "/data/siret3";
