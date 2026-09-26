import type { FC } from "react";

import type { Role } from "@/entities/role";
import { ROUTE_COPY, type Survey, type SurveySource } from "@/entities/survey";
import { RouteStartControl } from "@/features/set-route-start";
import { LayerToggles } from "@/features/toggle-map-layers";
import { ScrollRevealProvider } from "@/shared/lib/dom";
import { CollapsiblePanelSection, PanelSection } from "@/shared/ui";
import { InterrowList } from "@/widgets/interrow-list";
import { MeasurementSheet } from "@/widgets/measurement-sheet";
import { RoutePanel } from "@/widgets/route-panel";
import { RowTable } from "@/widgets/row-table";
import { WasteList } from "@/widgets/waste-list";
import { WorkspaceHeader } from "@/widgets/workspace-header";

import type { VineyardWorkspaceState } from "../model/use-vineyard-workspace";

type WorkspacePanelProps = {
  role: Role;
  source: SurveySource;
  survey: Survey;
  workspace: VineyardWorkspaceState;
};

export const WorkspacePanel: FC<WorkspacePanelProps> = ({ role, source, survey, workspace }) => {
  const { routePurpose, layers, selection, routeStart, revealedList } = workspace;
  const listProps = { survey, selection: selection.selection, onSelect: selection.selectFromList };

  return (
    <ScrollRevealProvider isEnabled={selection.shouldRevealInLists}>
      <WorkspaceHeader role={role} source={source} />
      <PanelSection title="Measurements" description="Horizontal areas and lengths in EPSG:32635.">
        <MeasurementSheet survey={survey} />
      </PanelSection>
      <PanelSection title={ROUTE_COPY[routePurpose].title} description={ROUTE_COPY[routePurpose].description}>
        <RouteStartControl
          vineyardStart={survey.start.geometry.coordinates}
          request={routeStart.request}
          onRequest={routeStart.requestStart}
          onClear={routeStart.clearStart}
        />
        <RoutePanel {...listProps} purpose={routePurpose} />
      </PanelSection>
      <PanelSection title="Map layers">
        <LayerToggles
          visibility={layers.visibility}
          allLayers={layers.allLayers}
          onToggle={layers.toggleLayer}
          onToggleAll={layers.toggleAllLayers}
        />
      </PanelSection>
      <CollapsiblePanelSection
        title="Rows"
        description="Every row axis by block, with its structure and length."
        openWhen={revealedList === "rows"}
      >
        <RowTable {...listProps} />
      </CollapsiblePanelSection>
      <CollapsiblePanelSection
        title="Inter-row areas"
        description="The ground between the canopies of neighbouring rows, with its cover."
        openWhen={revealedList === "interrows"}
      >
        <InterrowList {...listProps} />
      </CollapsiblePanelSection>
      <CollapsiblePanelSection
        title="Waste"
        description="Visible waste in and around the vineyard."
        openWhen={revealedList === "waste"}
      >
        <WasteList {...listProps} routePurpose={routePurpose} />
      </CollapsiblePanelSection>
    </ScrollRevealProvider>
  );
};
