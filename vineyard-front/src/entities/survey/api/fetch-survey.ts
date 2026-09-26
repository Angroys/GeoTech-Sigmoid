import { z } from "zod";

import { assertNever } from "@/shared/lib/types";

import type { SurveySource } from "../config/sources";
import { assembleSurvey } from "../lib/assemble-survey";
import { SURVEY_FILE_NAMES, surveyFileSchemas, type SurveyFileKey, type SurveyFiles } from "../model/schema";
import type { Survey } from "../model/types";
import { readUploadedFiles } from "../model/uploaded-vineyards";

export class SurveyLoadError extends Error {
  override name = "SurveyLoadError";
}

const loadFile = async <S extends z.ZodType>(baseUrl: string, key: SurveyFileKey, schema: S): Promise<z.output<S>> => {
  const fileName = SURVEY_FILE_NAMES[key];

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/${fileName}`);
  } catch {
    throw new SurveyLoadError(`Could not reach the survey data. Check your connection and reload the page.`);
  }
  if (!response.ok) throw new SurveyLoadError(`${fileName} is missing from the survey data (HTTP ${response.status}).`);

  const result = schema.safeParse(await response.json());
  if (!result.success) {
    throw new SurveyLoadError(`${fileName} does not match the survey format.\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};

const loadRemoteFiles = async (baseUrl: string): Promise<SurveyFiles> => {
  const [blocks, rows, canopy, interrows, waste, inspectionPoints, inspectionRoute, wasteRoute, start] =
    await Promise.all([
      loadFile(baseUrl, "blocks", surveyFileSchemas.blocks),
      loadFile(baseUrl, "rows", surveyFileSchemas.rows),
      loadFile(baseUrl, "canopy", surveyFileSchemas.canopy),
      loadFile(baseUrl, "interrows", surveyFileSchemas.interrows),
      loadFile(baseUrl, "waste", surveyFileSchemas.waste),
      loadFile(baseUrl, "inspectionPoints", surveyFileSchemas.inspectionPoints),
      // Remote surveys are planned on demand against the walking constraints.
      // The old generated demo routes are not validated by the routing service.
      Promise.resolve(null),
      Promise.resolve(null),
      loadFile(baseUrl, "start", surveyFileSchemas.start),
    ]);
  return { blocks, rows, canopy, interrows, waste, inspectionPoints, inspectionRoute, wasteRoute, start };
};

const loadUploadedFiles = async (id: string): Promise<SurveyFiles> => {
  const files = await readUploadedFiles(id);
  if (!files) throw new SurveyLoadError("This vineyard's data is no longer stored in this browser.");
  return files;
};

const loadSurvey = async (source: SurveySource): Promise<Survey> => {
  switch (source.data.kind) {
    case "remote":
      return assembleSurvey(await loadRemoteFiles(source.data.url));
    case "uploaded":
      return assembleSurvey(await loadUploadedFiles(source.id));
    default:
      return assertNever(source.data);
  }
};

const surveyCache = new Map<string, Promise<Survey>>();

export const fetchSurvey = (source: SurveySource): Promise<Survey> => {
  const cached = surveyCache.get(source.id);
  if (cached) return cached;

  const request = loadSurvey(source);
  surveyCache.set(source.id, request);
  request.catch(() => surveyCache.delete(source.id));
  return request;
};
