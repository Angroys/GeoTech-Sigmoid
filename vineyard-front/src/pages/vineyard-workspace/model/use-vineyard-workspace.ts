import { useCallback, useMemo } from "react";

import type { Role } from "@/entities/role";
import {
  blockSelection,
  getRouteStops,
  listOfSelection,
  useSurveySelection,
  type Survey,
  type SurveySelection,
  type SurveySource,
} from "@/entities/survey";
import { useRouteStart } from "@/features/set-route-start";
import { useRouteCalculation } from "@/features/calculate-route";
import { useLayerVisibility } from "@/features/toggle-map-layers";
import { useRouteProgress } from "@/features/track-route-progress";

import { WORKSPACE_CONFIG } from "../config/workspace-config";
import { useReportView } from "./use-report-view";
import { useWorkspaceTab } from "./use-workspace-tab";

const isVineyardOnly = (selection: SurveySelection) =>
  selection.kind === "block" || selection.kind === "row" || selection.kind === "interrow";

type WorkspaceOptions = { role: Role; source: SurveySource; survey: Survey; initialBlockId: string | null };

export const useVineyardWorkspace = ({ role, source, survey: originalSurvey, initialBlockId }: WorkspaceOptions) => {
  const { routePurpose, initialLayers } = WORKSPACE_CONFIG[role];
  const layers = useLayerVisibility(initialLayers);
  const routeStart = useRouteStart(source.id, routePurpose);
  const routeCalculation = useRouteCalculation(originalSurvey, source.id, routePurpose, routeStart.request?.lngLat ?? null);
  const survey = routeCalculation.survey;
  const selection = useSurveySelection(blockSelection(survey, initialBlockId));
  const tab = useWorkspaceTab();
  const report = useReportView(role);

  const stopIds = useMemo(
    () => getRouteStops(survey, routePurpose).map(stop => stop.targetId),
    [survey, routePurpose],
  );
  const progress = useRouteProgress(source.id, routePurpose, stopIds);

  const { selectFromMap } = selection;
  const { selectTab } = tab;
  const selectOnMap = useCallback(
    (next: SurveySelection) => {
      if (isVineyardOnly(next)) selectTab("vineyard");
      selectFromMap(next);
    },
    [selectFromMap, selectTab],
  );

  const revealedList = selection.shouldRevealInLists ? listOfSelection(survey, selection.selection) : null;
  const isRoutePlanned = survey.routes[routePurpose] !== null;

  return {
    survey,
    originalStart: originalSurvey.start.geometry.coordinates,
    routeCalculation,
    routePurpose,
    layers,
    selection,
    selectOnMap,
    routeStart,
    tab,
    report,
    progress,
    stopCount: stopIds.length,
    isRoutePlanned,
    revealedList,
  };
};

export type VineyardWorkspaceState = ReturnType<typeof useVineyardWorkspace>;
