import { useEffect, useState } from "react";

import { fetchSurvey, SurveyLoadError } from "../api/fetch-survey";
import type { SurveySource } from "../config/sources";
import type { Survey } from "./types";

export type SurveyState =
  { status: "loading" } | { status: "ready"; survey: Survey } | { status: "error"; message: string };

const UNEXPECTED_ERROR = "The survey could not be opened. Reload the page to try again.";

export const useSurvey = (source: SurveySource): SurveyState => {
  const [state, setState] = useState<SurveyState>({ status: "loading" });

  useEffect(() => {
    let isCurrent = true;
    setState({ status: "loading" });

    fetchSurvey(source)
      .then(survey => {
        if (isCurrent) setState({ status: "ready", survey });
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setState({ status: "error", message: error instanceof SurveyLoadError ? error.message : UNEXPECTED_ERROR });
      });

    return () => {
      isCurrent = false;
    };
  }, [source]);

  return state;
};
