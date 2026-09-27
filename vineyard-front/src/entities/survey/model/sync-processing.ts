import { ApiError } from "@/shared/api";

import { getProcessingStatus, type ProcessingStatus } from "../api/processing-api";
import {
  processingResultsUrl,
  type ProcessingResults,
  type SurveyId,
  type SurveySource,
} from "../config/sources";
import { updateUploadedSource } from "./uploaded-vineyards";

export const PROCESSING_POLL_MS = 30_000;

const NOT_FOUND = 404;
const FALLBACK_HINT = /fallback/i;
export const FORGOTTEN_BY_SERVICE =
  "The processing service no longer has this vineyard. Remove it and upload the tiles again.";

export const resultsOfStatus = ({ source, message }: ProcessingStatus): ProcessingResults => {
  const origin = source ?? (message && FALLBACK_HINT.test(message) ? "fallback" : null);
  return { origin, message: message ?? null };
};

/** The stored data location a processing vineyard moves to for a status answer, or null to keep waiting. */
export const nextDataForStatus = (
  id: SurveyId,
  job: Extract<SurveySource["data"], { kind: "processing" }>,
  status: ProcessingStatus,
): SurveySource["data"] | null => {
  switch (status.status) {
    case "ready":
      return { kind: "remote", url: processingResultsUrl(id), results: resultsOfStatus(status) };
    case "failed":
      return { ...job, state: "failed", message: status.message || "Processing failed." };
    default:
      return null;
  }
};

const readStatus = async (id: SurveyId): Promise<ProcessingStatus> => {
  try {
    return await getProcessingStatus(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === NOT_FOUND) {
      return { status: "failed", message: FORGOTTEN_BY_SERVICE };
    }
    throw error;
  }
};

const syncOne = async (source: SurveySource) => {
  if (source.data.kind !== "processing" || source.data.state !== "processing") return;
  const next = nextDataForStatus(source.id, source.data, await readStatus(source.id));
  if (next) await updateUploadedSource(source.id, { data: next });
};

export const syncProcessingSources = async (sources: readonly SurveySource[]) => {
  await Promise.allSettled(sources.map(syncOne));
};
