import { useEffect, useState } from "react";

import { BUILT_IN_SOURCES, isProcessing, type SurveySource } from "../config/sources";
import { PROCESSING_POLL_MS, syncProcessingSources } from "./sync-processing";
import { listUploadedSources, subscribeToUploads } from "./uploaded-vineyards";

export const useSurveySources = () => {
  const [uploaded, setUploaded] = useState<SurveySource[] | null>(null);

  useEffect(() => {
    let isCurrent = true;
    const load = () => {
      listUploadedSources()
        .then(sources => {
          if (isCurrent) setUploaded(sources);
        })
        .catch(() => {
          if (isCurrent) setUploaded([]);
        });
    };
    load();
    const unsubscribe = subscribeToUploads(load);
    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const pending = (uploaded ?? []).filter(isProcessing);
    if (pending.length === 0) return;
    void syncProcessingSources(pending);
    const timer = window.setInterval(() => void syncProcessingSources(pending), PROCESSING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [uploaded]);

  return { sources: [...BUILT_IN_SOURCES, ...(uploaded ?? [])], isLoading: uploaded === null };
};

export const useSurveySource = (id: string) => {
  const { sources, isLoading } = useSurveySources();
  const source = sources.find(candidate => candidate.id === id) ?? null;
  return { source, isLoading: source === null && isLoading };
};
