import type { FeatureCollection, Position } from "geojson";
import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { Survey } from "@/entities/survey";

import { FIT_PADDING_PX } from "../config/map-style";
import { SOURCE_IDS } from "../config/survey-layers";
import { boundsOf } from "../lib/bounds";
import { NO_FEATURES } from "./use-survey-layers";

const requestedStartData = (requestedStart: Position, vineyardStart: Position): FeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [requestedStart, vineyardStart] },
      properties: {},
    },
    { type: "Feature", geometry: { type: "Point", coordinates: requestedStart }, properties: {} },
  ],
});

const isGeoJsonSource = (source: unknown): source is GeoJSONSource =>
  typeof source === "object" && source !== null && "setData" in source && typeof source.setData === "function";

export const useRequestedStartSync = (
  map: MaplibreMap | null,
  isReady: boolean,
  survey: Survey,
  requestedStart: Position | null,
) => {
  const shownStart = useRef<Position | null>(null);

  useEffect(() => {
    if (!map || !isReady) return;
    const source = map.getSource(SOURCE_IDS.requestedStart);
    if (!isGeoJsonSource(source)) return;

    const vineyardStart = survey.start.geometry.coordinates;
    source.setData(requestedStart ? requestedStartData(requestedStart, vineyardStart) : NO_FEATURES);

    const isNewStart = requestedStart !== shownStart.current;
    shownStart.current = requestedStart;
    if (!requestedStart || !isNewStart) return;

    const blockCorners = survey.blocks.features.flatMap(block => block.geometry.coordinates.flat());
    const bounds = boundsOf([...blockCorners, requestedStart]);
    if (bounds) map.fitBounds(bounds, { padding: FIT_PADDING_PX, duration: 900 });
  }, [map, isReady, survey, requestedStart]);
};
