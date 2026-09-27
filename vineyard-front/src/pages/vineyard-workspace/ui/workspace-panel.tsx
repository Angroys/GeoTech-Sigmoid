import { Hourglass } from "lucide-react";
import type { FC } from "react";

import type { Role } from "@/entities/role";
import { ROUTE_COPY, type Survey, type SurveySource } from "@/entities/survey";
import { RouteStartControl } from "@/features/set-route-start";
import { ScrollRevealProvider } from "@/shared/lib/dom";
import { Button, CollapsiblePanelSection, PanelSection, PanelTabs, type PanelTab } from "@/shared/ui";
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
  const { routePurpose, routeStart, routeCalculation } = workspace;

  return (
    <PanelSection title={ROUTE_COPY[routePurpose].title} description={ROUTE_COPY[routePurpose].description}>
      <RouteStartControl
        vineyardStart={workspace.originalStart}
        request={routeStart.request}
        onRequest={routeStart.requestStart}
        onClear={routeStart.clearStart}
      />
      <div className="mb-5 grid gap-3">
        {routeCalculation.pathMode === "demo_headlands" && (
          <p className="text-muted-foreground text-sm">
            This demo survey connects its aisles with inferred paths at the row ends, so its routes are not validated for
            the challenge submission.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={routeCalculation.status === "calculating"} onClick={routeCalculation.calculate}>
            {routeCalculation.status === "calculating" ? "Calculating route…" : "Calculate route"}
          </Button>
          {routeCalculation.status === "ready" && (
            <Button size="sm" variant="outline" onClick={routeCalculation.download}>Download route</Button>
          )}
        </div>
        <div aria-live="polite" className="text-muted-foreground grid gap-2 text-sm">
          {routeCalculation.status === "idle" && <p>Calculate a route using the available walking areas and targets. Any route already shown is a saved preview.</p>}
          {routeCalculation.status === "calculating" && <p>Checking walking paths and arranging stops…</p>}
          {routeCalculation.error && <p role="alert" className="text-destructive">{routeCalculation.error}</p>}
          {routeCalculation.status === "no_route" && (
            <p className="text-foreground font-medium">{routeCalculation.report?.target_count === 0 ? "No targets to visit" : "No route available from this start"}</p>
          )}
          {routeCalculation.report && <>
            <p>{routeCalculation.report.visited_count} of {routeCalculation.report.target_count} supplied targets covered.{routeCalculation.status === "ready" && (routeCalculation.report.path_mode === "demo_headlands"
              ? ` Includes ${routeCalculation.report.outside_supplied_length_m.toFixed(1)} m outside supplied walking areas, on inferred demo paths.`
              : ` Distance outside permitted areas: ${routeCalculation.report.outside_length_m.toFixed(2)} m.`)}</p>
            {routeCalculation.status === "ready" && <div className="border-border grid gap-1.5 rounded-md border px-3 py-2.5">
              <p className="text-foreground font-medium">Map validation evidence</p>
              <p>
                Block outlines show planting context, not the walking boundary. The route has{" "}
                {routeCalculation.report.outside_blocks_length_m === null
                  ? "no block comparison because block geometry was not supplied"
                  : `${routeCalculation.report.outside_blocks_length_m.toFixed(1)} m outside block outlines`}.
              </p>
              <p>
                The complete final polyline has {routeCalculation.report.outside_length_m.toFixed(3)} m outside the
                selected permitted area
                {routeCalculation.report.outside_study_area_length_m === null
                  ? "."
                  : ` and ${routeCalculation.report.outside_study_area_length_m.toFixed(3)} m outside the study area.`}
              </p>
            </div>}
            {routeCalculation.report.warnings.map(warning => <p key={warning}>{warning}</p>)}
          </>}
        </div>
      </div>
      {survey.routes[routePurpose] && (
        <RoutePanel
          {...listPropsOf(props)}
          purpose={routePurpose}
          progress={workspace.progress}
          onOpenReport={workspace.report.canReport ? workspace.report.openReport : undefined}
        />
      )}
    </PanelSection>
  );
};

type RouteTabLabelProps = { workspace: VineyardWorkspaceState };

const RouteTabLabel: FC<RouteTabLabelProps> = ({ workspace }) => {
  if (!workspace.isRoutePlanned) {
    return (
      <>
        Route
        {workspace.routeCalculation.status === "calculating" && <Hourglass className="size-3.5" aria-label="being planned" />}
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
