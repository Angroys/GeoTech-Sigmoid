import { getProcessingStatus } from "../api/processing-api";
import { processingResultsUrl, type SurveySource } from "../config/sources";
import { updateUploadedSource } from "./uploaded-vineyards";

export const PROCESSING_POLL_MS = 30_000;

const syncOne = async (source: SurveySource) => {
  if (source.data.kind !== "processing" || source.data.state !== "processing") return;
  const { status, message } = await getProcessingStatus(source.id);

  if (status === "ready") {
    await updateUploadedSource(source.id, { data: { kind: "remote", url: processingResultsUrl(source.id) } });
  } else if (status === "failed") {
    await updateUploadedSource(source.id, {
      data: { ...source.data, state: "failed", message: message ?? "Processing failed." },
    });
  }
};

export const syncProcessingSources = async (sources: readonly SurveySource[]) => {
  await Promise.allSettled(sources.map(syncOne));
};
