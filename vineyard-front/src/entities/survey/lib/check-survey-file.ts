import { surveyFileSchemas, type SurveyFileKey } from "../model/schema";

export type SurveyFileCheck = { status: "valid"; featureCount: number } | { status: "invalid"; message: string };

export const checkSurveyFile = (key: SurveyFileKey, json: unknown): SurveyFileCheck => {
  const result = surveyFileSchemas[key].safeParse(json);
  if (result.success) return { status: "valid", featureCount: result.data.features.length };

  const [issue] = result.error.issues;
  const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return { status: "invalid", message: `${where}${issue?.message ?? "Not in the survey format."}` };
};
