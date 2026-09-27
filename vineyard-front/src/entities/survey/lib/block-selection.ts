import { assertNever } from "@/shared/lib/types";

import { NO_SELECTION, type Survey, type SurveySelection, type VineyardId } from "../model/types";

export const blockSelection = (survey: Survey, blockId: string | null): SurveySelection => {
  const block = survey.blocks.features.find(({ properties }) => properties.vineyard_id === blockId);
  return block ? { kind: "block", vineyardId: block.properties.vineyard_id } : NO_SELECTION;
};

const blockOfRow = (survey: Survey, rowId: string) =>
  survey.rows.features.find(row => row.properties.row_id === rowId)?.properties.vineyard_id ?? null;

const blockOfInterrow = (survey: Survey, interrowId: string) =>
  survey.interrows.features.find(interrow => interrow.properties.interrow_id === interrowId)?.properties
    .vineyard_id ?? null;

export const blockOfSelection = (survey: Survey, selection: SurveySelection): VineyardId | null => {
  switch (selection.kind) {
    case "none":
    case "target":
      return null;
    case "block":
      return selection.vineyardId;
    case "row":
      return blockOfRow(survey, selection.rowId);
    case "interrow":
      return blockOfInterrow(survey, selection.interrowId);
    default:
      return assertNever(selection);
  }
};
