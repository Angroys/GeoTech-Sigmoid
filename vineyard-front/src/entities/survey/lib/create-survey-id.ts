import { randomUUID } from "@/shared/lib/crypto";

import { surveyIdSchema, type SurveyId } from "../config/sources";

const MAX_SLUG_LENGTH = 32;

export const createSurveyId = (name: string): SurveyId => {
  const slug =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, MAX_SLUG_LENGTH) || "vineyard";
  return surveyIdSchema.parse(`${slug}-${randomUUID().slice(0, 4)}`);
};
