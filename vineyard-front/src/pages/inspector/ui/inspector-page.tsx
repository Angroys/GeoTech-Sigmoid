import type { FC } from "react";

import {
  blockSelection,
  listOfSelection,
  ROUTE_COPY,
  SurveyLoader,
  useSurvey,
  useSurveySelection,
  type LayerVisibility,
  type Survey,
  type SurveySource,
} from "@/entities/survey";
import { RouteStartControl, useRouteStart } from "@/features/set-route-start";
import { LayerToggles, useLayerVisibility } from "@/features/toggle-map-layers";
import { ScrollRevealProvider } from "@/shared/lib/dom";
import { useLocation } from "@/shared/lib/router";
import { CollapsiblePanelSection, PanelSection, WorkspaceLayout } from "@/shared/ui";
import { MeasurementSheet } from "@/widgets/measurement-sheet";
import { RoutePanel } from "@/widgets/route-panel";
import { VineyardMap } from "@/widgets/vineyard-map";
import { WasteList } from "@/widgets/waste-list";
import { WorkspaceHeader } from "@/widgets/workspace-header";

const ROUTE_PURPOSE = "inspection";

const INSPECTOR_LAYERS: LayerVisibility = {
  blocks: true,
  interrows: false,
  canopy: false,
  rows: true,
  route: true,
  waste: true,
  "inspection-points": true,
};

type InspectorWorkspaceProps = { source: SurveySource; survey: Survey; initialBlockId: string | null };

const InspectorWorkspace: FC<InspectorWorkspaceProps> = ({ source, survey, initialBlockId }) => {
  const { visibility, allLayers, toggleLayer, toggleAllLayers } = useLayerVisibility(INSPECTOR_LAYERS);
  const { selection, shouldRevealInLists, selectFromMap, selectFromList } = useSurveySelection(
    blockSelection(survey, initialBlockId),
  );
  const routeStart = useRouteStart(source.id, ROUTE_PURPOSE);
  const revealedList = shouldRevealInLists ? listOfSelection(survey, selection) : null;

  const panel = (
    <ScrollRevealProvider isEnabled={shouldRevealInLists}>
      <WorkspaceHeader role="inspector" source={source} />
      <PanelSection title="Measurements" description="Horizontal areas and lengths in EPSG:32635.">
        <MeasurementSheet survey={survey} />
      </PanelSection>
      <PanelSection title={ROUTE_COPY[ROUTE_PURPOSE].title} description={ROUTE_COPY[ROUTE_PURPOSE].description}>
        <RouteStartControl
          vineyardStart={survey.start.geometry.coordinates}
          request={routeStart.request}
          onRequest={routeStart.requestStart}
          onClear={routeStart.clearStart}
        />
        <RoutePanel survey={survey} purpose={ROUTE_PURPOSE} selection={selection} onSelect={selectFromList} />
      </PanelSection>
      <CollapsiblePanelSection
        title="Waste"
        description="Visible waste in and around the vineyard."
        openWhen={revealedList === "waste"}
      >
        <WasteList survey={survey} routePurpose={ROUTE_PURPOSE} selection={selection} onSelect={selectFromList} />
      </CollapsiblePanelSection>
      <PanelSection title="Map layers">
        <LayerToggles
          visibility={visibility}
          allLayers={allLayers}
          onToggle={toggleLayer}
          onToggleAll={toggleAllLayers}
        />
      </PanelSection>
    </ScrollRevealProvider>
  );

  return (
    <div data-role="inspector">
      <WorkspaceLayout
        panel={panel}
        map={
          <VineyardMap
            source={source}
            survey={survey}
            routePurpose={ROUTE_PURPOSE}
            requestedStart={routeStart.request?.lngLat ?? null}
            visibility={visibility}
            selection={selection}
            onSelect={selectFromMap}
            className="h-full"
          />
        }
      />
    </div>
  );
};

type InspectorPageProps = { source: SurveySource };

export const InspectorPage: FC<InspectorPageProps> = ({ source }) => {
  const surveyState = useSurvey(source);
  const { searchParams } = useLocation();

  return (
    <SurveyLoader state={surveyState}>
      {survey => {
        return <InspectorWorkspace source={source} survey={survey} initialBlockId={searchParams.get("block")} />;
      }}
    </SurveyLoader>
  );
};
