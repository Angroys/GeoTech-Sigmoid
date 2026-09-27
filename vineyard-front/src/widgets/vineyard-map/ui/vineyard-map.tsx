import "maplibre-gl/dist/maplibre-gl.css";

import type { Position } from "geojson";
import { useRef, type FC, type ReactNode } from "react";

import type { LayerVisibility, RoutePurpose, Survey, SurveySelection, SurveySource } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";

import { useFeatureClicks } from "../model/use-feature-clicks";
import { useLayerVisibilitySync } from "../model/use-layer-visibility-sync";
import { useLoupeWaste } from "../model/use-loupe-waste";
import { useMapInstance } from "../model/use-map-instance";
import { useRequestedStartSync } from "../model/use-requested-start-sync";
import { useSelectionSync } from "../model/use-selection-sync";
import { useSurveyLayers } from "../model/use-survey-layers";
import { WasteLoupe } from "./waste-loupe";

type VineyardMapProps = {
  source: SurveySource;
  survey: Survey;
  routePurpose: RoutePurpose;
  requestedStart: Position | null;
  visibility: LayerVisibility;
  selection: SurveySelection;
  onSelect: (selection: SurveySelection) => void;
  layersControl: ReactNode;
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
  layersControl,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const map = useMapInstance(containerRef, source);
  const isReady = useSurveyLayers(map, survey, routePurpose);

  useLayerVisibilitySync(map, isReady, visibility);
  useSelectionSync(map, isReady, survey, selection);
  useFeatureClicks(map, isReady, survey, onSelect);
  useRequestedStartSync(map, isReady, survey, requestedStart);
  const loupe = useLoupeWaste(survey, selection);

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
      <div className="pointer-events-none absolute top-3 bottom-3 left-3 z-10 flex flex-col justify-start">
        <div className="pointer-events-auto flex min-h-0 flex-col">{layersControl}</div>
      </div>
      {loupe.waste && source.imagery && (
        <div className="absolute right-3 bottom-20 z-10">
          <WasteLoupe
            key={loupe.waste.properties.waste_id}
            waste={loupe.waste}
            imagery={source.imagery}
            onClose={loupe.hide}
          />
        </div>
      )}
    </div>
  );
};
