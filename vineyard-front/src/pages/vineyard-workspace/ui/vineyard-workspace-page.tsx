import type { FC } from "react";

import type { Role } from "@/entities/role";
import { SurveyLoader, useSurvey, type Survey, type SurveySource } from "@/entities/survey";
import { useLocation } from "@/shared/lib/router";
import { WorkspaceLayout } from "@/shared/ui";
import { VineyardMap } from "@/widgets/vineyard-map";

import { useVineyardWorkspace } from "../model/use-vineyard-workspace";
import { WorkspacePanel } from "./workspace-panel";

type VineyardWorkspaceProps = { role: Role; source: SurveySource; survey: Survey; initialBlockId: string | null };

const VineyardWorkspace: FC<VineyardWorkspaceProps> = props => {
  const { role, source, survey } = props;
  const workspace = useVineyardWorkspace(props);

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
            onSelect={workspace.selection.selectFromMap}
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
