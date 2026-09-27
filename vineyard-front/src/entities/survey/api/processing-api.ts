import { z } from "zod";

import { ApiError } from "@/shared/api";

const API_BASE = "/api/surveys";

const createdSchema = z.object({ id: z.string().min(1) });
const statusSchema = z.object({
  status: z.enum(["uploading", "processing", "ready", "failed"]),
  message: z.string().nullable().optional(),
});
const errorSchema = z.object({ message: z.string() });

export type ProcessingStatus = z.output<typeof statusSchema>;

export type NewSurvey = { id: string; name: string; location: string; capturedOn: string; imageryUrl: string | null };

const OFFLINE = "The tile processing service could not be reached. Check your connection and try again.";

const request = async (path: string, init: RequestInit): Promise<Response> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(OFFLINE);
  }
  if (response.ok) return response;

  const body = errorSchema.safeParse(await response.json().catch(() => null));
  throw new ApiError(body.success ? body.data.message : `The processing service answered HTTP ${response.status}.`, response.status);
};

export const createProcessingSurvey = async (survey: NewSurvey, signal: AbortSignal) => {
  const response = await request("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(survey),
    signal,
  });
  const created = createdSchema.safeParse(await response.json());
  if (!created.success) throw new ApiError("The processing service returned an unexpected answer.");
  return created.data.id;
};

export const uploadTile = async (surveyId: string, tile: File, signal: AbortSignal) => {
  await request(`/${encodeURIComponent(surveyId)}/tiles/${encodeURIComponent(tile.name)}`, {
    method: "PUT",
    headers: { "Content-Type": "image/tiff" },
    body: tile,
    signal,
  });
};

export const startProcessing = async (surveyId: string, signal: AbortSignal) => {
  await request(`/${encodeURIComponent(surveyId)}/process`, { method: "POST", signal });
};

export const getProcessingStatus = async (surveyId: string): Promise<ProcessingStatus> => {
  const response = await request(`/${encodeURIComponent(surveyId)}`, { method: "GET" });
  const status = statusSchema.safeParse(await response.json());
  if (!status.success) throw new ApiError("The processing service returned an unexpected status.");
  return status.data;
};
