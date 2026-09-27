import { expect, test } from "bun:test";

import { parseProcessingStatus } from "../api/processing-api";
import { surveyIdSchema } from "../config/sources";
import { nextDataForStatus, resultsOfStatus } from "./sync-processing";
import { uploadedSourceSchema } from "./uploaded-vineyards";

const FALLBACK_MESSAGE =
  "Results from precomputed run3c labels (fallback, not live inference): PROCESSING_FORCE_FALLBACK is set";
const id = surveyIdSchema.parse("e2e-t4");
const job = {
  kind: "processing" as const,
  state: "processing" as const,
  tileCount: 5,
  submittedAt: "2026-09-27T09:00:00.000Z",
  message: null,
};

test("parses backend status answers including the result source", () => {
  expect(parseProcessingStatus({ status: "uploading" })).toEqual({ status: "uploading" });
  expect(parseProcessingStatus({ status: "ready", message: FALLBACK_MESSAGE, source: "fallback" })).toEqual({
    status: "ready",
    message: FALLBACK_MESSAGE,
    source: "fallback",
  });
  expect(parseProcessingStatus({ status: "ready", source: "model" })?.source).toBe("model");
  expect(parseProcessingStatus({ status: "ready", source: "something-new" })?.source).toBeNull();
  expect(parseProcessingStatus({ status: "done" })).toBeNull();
  expect(parseProcessingStatus(null)).toBeNull();
});

test("derives the results origin from source, or from the fallback message when source is missing", () => {
  expect(resultsOfStatus({ status: "ready", source: "model" })).toEqual({ origin: "model", message: null });
  expect(resultsOfStatus({ status: "ready", message: FALLBACK_MESSAGE })).toEqual({
    origin: "fallback",
    message: FALLBACK_MESSAGE,
  });
  expect(resultsOfStatus({ status: "ready" })).toEqual({ origin: null, message: null });
});

test("a ready vineyard loads its own results and remembers where they came from", () => {
  const next = nextDataForStatus(id, job, { status: "ready", message: FALLBACK_MESSAGE, source: "fallback" });
  expect(next).toEqual({
    kind: "remote",
    url: "/api/surveys/e2e-t4/results",
    results: { origin: "fallback", message: FALLBACK_MESSAGE },
  });
});

test("a failed vineyard keeps the service message, and pending states keep waiting", () => {
  expect(nextDataForStatus(id, job, { status: "failed", message: "Tile r1 is not EPSG:32635." })).toEqual({
    ...job,
    state: "failed",
    message: "Tile r1 is not EPSG:32635.",
  });
  expect(nextDataForStatus(id, job, { status: "failed" })).toMatchObject({ message: "Processing failed." });
  expect(nextDataForStatus(id, job, { status: "processing" })).toBeNull();
  expect(nextDataForStatus(id, job, { status: "uploading" })).toBeNull();
});

test("stored vineyards accept the processed data location, with or without results origin", () => {
  const stored = {
    id: "e2e-t4",
    name: "E2E",
    location: "Sireți",
    capturedOn: "20 May 2025",
    groundSampleCm: null,
    areaHectares: null,
    imagery: null,
    uploadedBy: { accountId: "a1", fullName: "Owner" },
  };
  const next = nextDataForStatus(id, job, { status: "ready", source: "model" });
  expect(uploadedSourceSchema.safeParse({ ...stored, data: next }).success).toBe(true);
  expect(uploadedSourceSchema.safeParse({ ...stored, data: { kind: "remote", url: "/data/siret3" } }).success).toBe(true);
});
