import type { Role } from "@/entities/role";
import {
  blockSelection,
  listOfSelection,
  useSurveySelection,
  type Survey,
  type SurveySource,
} from "@/entities/survey";
import { useRouteStart } from "@/features/set-route-start";
import { useLayerVisibility } from "@/features/toggle-map-layers";

import { WORKSPACE_CONFIG } from "../config/workspace-config";

type WorkspaceOptions = { role: Role; source: SurveySource; survey: Survey; initialBlockId: string | null };

export const useVineyardWorkspace = ({ role, source, survey, initialBlockId }: WorkspaceOptions) => {
  const { routePurpose, initialLayers } = WORKSPACE_CONFIG[role];
  const layers = useLayerVisibility(initialLayers);
  const selection = useSurveySelection(blockSelection(survey, initialBlockId));
  const routeStart = useRouteStart(source.id, routePurpose);
  const revealedList = selection.shouldRevealInLists ? listOfSelection(survey, selection.selection) : null;

  return { routePurpose, layers, selection, routeStart, revealedList };
};

export type VineyardWorkspaceState = ReturnType<typeof useVineyardWorkspace>;
