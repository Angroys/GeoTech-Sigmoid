import { useCallback, useEffect, useRef, useState } from "react";

import { createProcessingSurvey, startProcessing, uploadTile, type SurveyId } from "@/entities/survey";
import { ApiError } from "@/shared/api";

const PARALLEL_UPLOADS = 3;
const ATTEMPTS_PER_TILE = 2;

export type UploadProgress =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "uploading"; doneCount: number; tileCount: number; sentBytes: number; totalBytes: number }
  | { phase: "starting" };

type UploadRequest = {
  surveyId: SurveyId;
  name: string;
  location: string;
  capturedOn: string;
  imageryUrl: string | null;
  tiles: readonly File[];
};

export const isRetryable = (error: unknown) =>
  !(error instanceof ApiError && error.status !== null && error.status >= 400 && error.status < 500);

const uploadWithRetry = async (surveyId: SurveyId, tile: File, signal: AbortSignal) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await uploadTile(surveyId, tile, signal);
      return;
    } catch (error) {
      if (signal.aborted || attempt >= ATTEMPTS_PER_TILE || !isRetryable(error)) throw error;
    }
  }
};

export const useTileUpload = () => {
  const [progress, setProgress] = useState<UploadProgress>({ phase: "idle" });
  const controller = useRef<AbortController | null>(null);
  const isRunning = progress.phase !== "idle";

  useEffect(() => {
    if (!isRunning) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isRunning]);

  const upload = useCallback(async ({ surveyId, tiles, ...survey }: UploadRequest) => {
    const active = new AbortController();
    controller.current = active;
    const { signal } = active;
    const totalBytes = tiles.reduce((sum, tile) => sum + tile.size, 0);

    try {
      setProgress({ phase: "creating" });
      await createProcessingSurvey({ id: surveyId, ...survey }, signal);

      let doneCount = 0;
      let sentBytes = 0;
      const report = () =>
        setProgress({ phase: "uploading", doneCount, tileCount: tiles.length, sentBytes, totalBytes });
      report();

      const queue = [...tiles];
      const worker = async () => {
        for (let tile = queue.shift(); tile; tile = queue.shift()) {
          await uploadWithRetry(surveyId, tile, signal);
          doneCount += 1;
          sentBytes += tile.size;
          report();
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, tiles.length) }, worker));

      setProgress({ phase: "starting" });
      await startProcessing(surveyId, signal);
    } finally {
      controller.current = null;
      setProgress({ phase: "idle" });
    }
  }, []);

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { progress, upload, cancel };
};
