import { assertNever } from "@/shared/lib/types";

import type { Survey, SurveySelection } from "../model/types";

export type SelectionList = "rows" | "interrows" | "waste" | "stops";

export const listOfSelection = (survey: Survey, selection: SurveySelection): SelectionList | null => {
  switch (selection.kind) {
    case "none":
      return null;
    case "block":
    case "row":
      return "rows";
    case "interrow":
      return "interrows";
    case "target":
      return survey.waste.features.some(({ properties }) => properties.waste_id === selection.targetId)
        ? "waste"
        : "stops";
    default:
      return assertNever(selection);
  }
};
