import type { Position } from "geojson";
import { useEffect, useMemo, useRef, useState } from "react";

import { planSurveyRoute, type RoutePathMode, type RoutePurpose, type Survey } from "@/entities/survey";

type Result = Awaited<ReturnType<typeof planSurveyRoute>>;
type Calculation = {
  key: string;
  status: "calculating" | "ready" | "no_route" | "error";
  result?: Result;
  error?: string;
};

export const useRouteCalculation = (survey: Survey, surveyId: string, purpose: RoutePurpose, requestedStart: Position | null) => {
  const start = requestedStart ?? survey.start.geometry.coordinates;
  const [modeChoice, setModeChoice] = useState<{ surveyId: string; mode: RoutePathMode } | null>(null);
  const supportsDemoPaths = surveyId === "siret3";
  const pathMode = modeChoice?.surveyId === surveyId ? modeChoice.mode : supportsDemoPaths ? "demo_headlands" : "supplied";
  const setPathMode = (mode: RoutePathMode) => setModeChoice({ surveyId, mode });
  const key = JSON.stringify([surveyId, purpose, start, pathMode]);
  const [state, setState] = useState<Calculation | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    setState(null);
    return () => controller.current?.abort();
  }, [key, survey]);

  const calculate = async () => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setState({ key, status: "calculating" });
    try {
      const result = await planSurveyRoute(survey, purpose, start, surveyId, active.signal, pathMode);
      if (!active.signal.aborted) setState({ key, status: result.routeFile ? "ready" : "no_route", result });
    } catch (error) {
      if (!active.signal.aborted) {
        setState({ key, status: "error", error: error instanceof Error ? error.message : "Route calculation failed." });
      }
    }
  };

  const current = state?.key === key ? state : null;
  const effectiveSurvey = useMemo(() => {
    if (current?.result) return current.result.survey;
    if (!requestedStart && !current) return survey;
    // A saved route must not masquerade as a result for a different start or
    // as the result of a failed/in-progress calculation.
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
    supportsDemoPaths,
    pathMode,
    setPathMode,
    status: current?.status ?? "idle",
    error: current?.error,
    report: current?.result?.report,
    calculate,
    download,
  };
};
