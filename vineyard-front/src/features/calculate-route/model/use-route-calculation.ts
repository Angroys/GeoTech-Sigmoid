import type { Position } from "geojson";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyRoutePlan,
  requestRoutePlan,
  type RoutePathMode,
  type RoutePlanResponse,
  type RoutePurpose,
  type Survey,
} from "@/entities/survey";

import { loadSavedPlan, savePlan } from "./saved-route-plan";

type Result = ReturnType<typeof applyRoutePlan>;
type Calculation = {
  key: string;
  inputSurvey: Survey;
  status: "calculating" | "ready" | "no_route" | "error";
  result?: Result;
  error?: string;
};

const DEMO_SURVEY_ID = "siret3";

const pathModeFor = (surveyId: string): RoutePathMode =>
  surveyId === DEMO_SURVEY_ID ? "demo_headlands" : "supplied";

const finishedCalculation = (key: string, survey: Survey, purpose: RoutePurpose, plan: RoutePlanResponse): Calculation => {
  const result = applyRoutePlan(survey, purpose, plan);
  return { key, inputSurvey: survey, status: result.routeFile ? "ready" : "no_route", result };
};

const restoredCalculation = (key: string, survey: Survey, purpose: RoutePurpose): Calculation | null => {
  const saved = loadSavedPlan(key);
  return saved ? finishedCalculation(key, survey, purpose, saved) : null;
};

export const useRouteCalculation = (survey: Survey, surveyId: string, purpose: RoutePurpose, requestedStart: Position | null) => {
  const start = requestedStart ?? survey.start.geometry.coordinates;
  const pathMode = pathModeFor(surveyId);
  const key = JSON.stringify([surveyId, purpose, start, pathMode]);
  const [state, setState] = useState<Calculation | null>(() => restoredCalculation(key, survey, purpose));
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    setState(restoredCalculation(key, survey, purpose));
    return () => controller.current?.abort();
  }, [key, survey, purpose]);

  const calculate = async () => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setState({ key, inputSurvey: survey, status: "calculating" });
    try {
      const plan = await requestRoutePlan(survey, purpose, start, surveyId, active.signal, pathMode);
      if (active.signal.aborted) return;
      savePlan(key, plan);
      setState(finishedCalculation(key, survey, purpose, plan));
    } catch (error) {
      if (!active.signal.aborted) {
        setState({
          key,
          inputSurvey: survey,
          status: "error",
          error: error instanceof Error ? error.message : "Route calculation failed.",
        });
      }
    }
  };

  const current = state?.key === key && state.inputSurvey === survey ? state : null;
  const effectiveSurvey = useMemo(() => {
    if (current?.result) return current.result.survey;
    if (!requestedStart && !current) return survey;
    return { ...survey, routes: { ...survey.routes, [purpose]: null } };
  }, [survey, purpose, requestedStart, current]);

  const download = () => {
    if (!current?.result?.routeFile) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.result.routeFile)], { type: "application/geo+json" }));
    const link = document.createElement("a");
    link.href = url;
    const prefix = current.result.report.path_mode === "demo_headlands" ? "demo_" : "";
    link.download = prefix + (purpose === "inspection" ? "route.geojson" : "route_waste.geojson");
    link.click();
    URL.revokeObjectURL(url);
  };

  return {
    survey: effectiveSurvey,
    pathMode,
    status: current?.status ?? "idle",
    error: current?.error,
    report: current?.result?.report,
    calculate,
    download,
  };
};
