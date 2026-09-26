import { Hourglass } from "lucide-react";
import type { FC } from "react";

import type { Role } from "@/entities/role";
import { ROUTE_COPY, type Survey, type SurveySource } from "@/entities/survey";
import { RouteStartControl } from "@/features/set-route-start";
import { ScrollRevealProvider } from "@/shared/lib/dom";
import { CollapsiblePanelSection, PanelSection, PanelTabs, type PanelTab } from "@/shared/ui";
import { InterrowList } from "@/widgets/interrow-list";
import { MeasurementSheet } from "@/widgets/measurement-sheet";
import { RoutePanel } from "@/widgets/route-panel";
import { RowTable } from "@/widgets/row-table";
import { WasteList } from "@/widgets/waste-list";

import type { VineyardWorkspaceState } from "../model/use-vineyard-workspace";
import type { WorkspaceTab } from "../model/use-workspace-tab";
import { WorkspaceHeader } from "./workspace-header";

type TabContentProps = { survey: Survey; workspace: VineyardWorkspaceState };

const listPropsOf = ({ survey, workspace }: TabContentProps) => ({
  survey,
  selection: workspace.selection.selection,
  onSelect: workspace.selection.selectFromList,
});

const VineyardTab: FC<TabContentProps> = props => {
  const { survey, workspace } = props;
  const listProps = listPropsOf(props);

  return (
    <>
      <PanelSection title="Measurements" description="Horizontal areas and lengths in EPSG:32635.">
        <MeasurementSheet survey={survey} />
      </PanelSection>
      <CollapsiblePanelSection
        title="Rows"
        description="Every row axis by block, with its structure and length."
        openWhen={workspace.revealedList === "rows"}
      >
        <RowTable {...listProps} />
      </CollapsiblePanelSection>
      <CollapsiblePanelSection
        title="Inter-row areas"
        description="The ground between the canopies of neighbouring rows, with its cover."
        openWhen={workspace.revealedList === "interrows"}
      >
        <InterrowList {...listProps} />
      </CollapsiblePanelSection>
      <CollapsiblePanelSection
        title="Waste"
        description="Visible waste in and around the vineyard."
        openWhen={workspace.revealedList === "waste"}
      >
        <WasteList {...listProps} routePurpose={workspace.routePurpose} />
      </CollapsiblePanelSection>
    </>
  );
};

const RouteTab: FC<TabContentProps> = props => {
  const { survey, workspace } = props;
  const { routePurpose, routeStart } = workspace;

  return (
    <PanelSection title={ROUTE_COPY[routePurpose].title} description={ROUTE_COPY[routePurpose].description}>
      <RouteStartControl
        vineyardStart={survey.start.geometry.coordinates}
        request={routeStart.request}
        onRequest={routeStart.requestStart}
        onClear={routeStart.clearStart}
      />
      <RoutePanel {...listPropsOf(props)} purpose={routePurpose} progress={workspace.progress} />
    </PanelSection>
  );
};

type RouteTabLabelProps = { workspace: VineyardWorkspaceState };

const RouteTabLabel: FC<RouteTabLabelProps> = ({ workspace }) => {
  if (!workspace.isRoutePlanned) {
    return (
      <>
        Route
        <Hourglass className="size-3.5" aria-label="being planned" />
      </>
    );
  }
  return (
    <>
      Route
      <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-xs tabular-nums">
        {workspace.progress.reached.size}/{workspace.stopCount}
        <span className="sr-only"> stops reached</span>
      </span>
    </>
  );
};

type WorkspacePanelProps = {
  role: Role;
  source: SurveySource;
  survey: Survey;
  workspace: VineyardWorkspaceState;
};

export const WorkspacePanel: FC<WorkspacePanelProps> = ({ role, source, survey, workspace }) => {
  const tabs: PanelTab<WorkspaceTab>[] = [
    { id: "vineyard", label: "Vineyard", content: <VineyardTab survey={survey} workspace={workspace} /> },
    {
      id: "route",
      label: <RouteTabLabel workspace={workspace} />,
      content: <RouteTab survey={survey} workspace={workspace} />,
    },
  ];

  return (
    <ScrollRevealProvider isEnabled={workspace.selection.shouldRevealInLists}>
      <WorkspaceHeader role={role} source={source} />
      <PanelTabs
        label="Vineyard views"
        tabs={tabs}
        activeId={workspace.tab.activeTab}
        onChange={workspace.tab.selectTab}
      />
    </ScrollRevealProvider>
  );
};
