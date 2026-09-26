import "maplibre-gl/dist/maplibre-gl.css";

import type { Position } from "geojson";
import { useRef, type FC } from "react";

import type { LayerVisibility, RoutePurpose, Survey, SurveySelection, SurveySource } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";

import { useFeatureClicks } from "../model/use-feature-clicks";
import { useLayerVisibilitySync } from "../model/use-layer-visibility-sync";
import { useMapInstance } from "../model/use-map-instance";
import { useRequestedStartSync } from "../model/use-requested-start-sync";
import { useSelectionSync } from "../model/use-selection-sync";
import { useSurveyLayers } from "../model/use-survey-layers";
import { MapLegend } from "./map-legend";

type VineyardMapProps = {
  source: SurveySource;
  survey: Survey;
  routePurpose: RoutePurpose;
  requestedStart: Position | null;
  visibility: LayerVisibility;
  selection: SurveySelection;
  onSelect: (selection: SurveySelection) => void;
  className?: string;
};

export const VineyardMap: FC<VineyardMapProps> = ({
  source,
  survey,
  routePurpose,
  requestedStart,
  visibility,
  selection,
  onSelect,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const map = useMapInstance(containerRef, source);
  const isReady = useSurveyLayers(map, survey, routePurpose);

  useLayerVisibilitySync(map, isReady, visibility);
  useSelectionSync(map, isReady, survey, selection);
  useFeatureClicks(map, isReady, survey, onSelect);
  useRequestedStartSync(map, isReady, survey, requestedStart);

  return (
    <div className={cn("relative isolate overflow-hidden", className)}>
      <div className="absolute inset-0">
        <div
          ref={containerRef}
          className="h-full w-full"
          role="region"
          aria-label={`Map of the ${source.name} survey, captured ${source.capturedOn}`}
        />
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-md:hidden">
        <MapLegend visibility={visibility} hasRequestedStart={requestedStart !== null} />
      </div>
    </div>
  );
};
