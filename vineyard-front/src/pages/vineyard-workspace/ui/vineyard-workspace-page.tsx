import type { FC } from "react";

import type { Role } from "@/entities/role";
import { SurveyLoader, useSurvey, type Survey, type SurveySource } from "@/entities/survey";
import { MapLayersControl } from "@/features/toggle-map-layers";
import { useLocation } from "@/shared/lib/router";
import { WorkspaceLayout } from "@/shared/ui";
import { VineyardMap } from "@/widgets/vineyard-map";

import { useVineyardWorkspace } from "../model/use-vineyard-workspace";
import { WorkspacePanel } from "./workspace-panel";

type VineyardWorkspaceProps = { role: Role; source: SurveySource; survey: Survey; initialBlockId: string | null };

const VineyardWorkspace: FC<VineyardWorkspaceProps> = props => {
  const { role, source } = props;
  const workspace = useVineyardWorkspace(props);
  const survey = workspace.survey;

  return (
    <div data-role={role}>
      <WorkspaceLayout
        panel={<WorkspacePanel role={role} source={source} survey={survey} workspace={workspace} />}
        map={
          <VineyardMap
            source={source}
            survey={survey}
            routePurpose={workspace.routePurpose}
            requestedStart={workspace.routeStart.request?.lngLat ?? null}
            visibility={workspace.layers.visibility}
            selection={workspace.selection.selection}
            onSelect={workspace.selectOnMap}
            layersControl={
              <MapLayersControl
                visibility={workspace.layers.visibility}
                allLayers={workspace.layers.allLayers}
                hasRequestedStart={workspace.routeStart.request !== null}
                onToggle={workspace.layers.toggleLayer}
                onToggleAll={workspace.layers.toggleAllLayers}
              />
            }
            className="h-full"
          />
        }
      />
    </div>
  );
};

type VineyardWorkspacePageProps = { role: Role; source: SurveySource };

export const VineyardWorkspacePage: FC<VineyardWorkspacePageProps> = ({ role, source }) => {
  const surveyState = useSurvey(source);
  const { searchParams } = useLocation();

  return (
    <SurveyLoader state={surveyState}>
      {survey => {
        return (
          <VineyardWorkspace role={role} source={source} survey={survey} initialBlockId={searchParams.get("block")} />
        );
      }}
    </SurveyLoader>
  );
};
