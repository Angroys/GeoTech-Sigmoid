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
import { useLayerVisibility } from "@/features/toggle-map-layers";
import { useRouteProgress } from "@/features/track-route-progress";

import { WORKSPACE_CONFIG } from "../config/workspace-config";
import { useWorkspaceTab } from "./use-workspace-tab";

const isVineyardOnly = (selection: SurveySelection) =>
  selection.kind === "block" || selection.kind === "row" || selection.kind === "interrow";

type WorkspaceOptions = { role: Role; source: SurveySource; survey: Survey; initialBlockId: string | null };

export const useVineyardWorkspace = ({ role, source, survey, initialBlockId }: WorkspaceOptions) => {
  const { routePurpose, initialLayers } = WORKSPACE_CONFIG[role];
  const layers = useLayerVisibility(initialLayers);
  const selection = useSurveySelection(blockSelection(survey, initialBlockId));
  const routeStart = useRouteStart(source.id, routePurpose);
  const tab = useWorkspaceTab();

  const stopIds = useMemo(
    () => getRouteStops(survey, routePurpose).map(stop => stop.targetId),
    [survey, routePurpose],
  );
  const progress = useRouteProgress(routePurpose, stopIds);

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
    routePurpose,
    layers,
    selection,
    selectOnMap,
    routeStart,
    tab,
    progress,
    stopCount: stopIds.length,
    isRoutePlanned,
    revealedList,
  };
};

export type VineyardWorkspaceState = ReturnType<typeof useVineyardWorkspace>;
