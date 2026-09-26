import { NO_SELECTION, type Survey, type SurveySelection } from "../model/types";

export const blockSelection = (survey: Survey, blockId: string | null): SurveySelection => {
  const block = survey.blocks.features.find(({ properties }) => properties.vineyard_id === blockId);
  return block ? { kind: "block", vineyardId: block.properties.vineyard_id } : NO_SELECTION;
};
