import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";

import type { RoutePurpose, Survey } from "@/entities/survey";

import { FIT_PADDING_PX } from "../config/map-style";
import { HIGHLIGHT_LAYERS, SOURCE_IDS, SURVEY_MAP_LAYERS } from "../config/survey-layers";
import { boundsOf } from "../lib/bounds";

export const NO_FEATURES: FeatureCollection = { type: "FeatureCollection", features: [] };

const surveyEntries = (survey: Survey, routePurpose: RoutePurpose) => {
  return [
    [SOURCE_IDS.blocks, survey.blocks],
    [SOURCE_IDS.interrows, survey.interrows],
    [SOURCE_IDS.canopy, survey.canopy],
    [SOURCE_IDS.rows, survey.rows],
    [SOURCE_IDS.route, survey.routes[routePurpose] ?? NO_FEATURES],
    [SOURCE_IDS.waste, survey.waste],
    [SOURCE_IDS.inspectionPoints, survey.inspectionPoints],
    [SOURCE_IDS.start, survey.start],
  ] as const;
};

const isGeoJsonSource = (source: unknown): source is GeoJSONSource =>
  typeof source === "object" && source !== null && "setData" in source && typeof source.setData === "function";

const addLayersOnce = (map: MaplibreMap) => {
  const layers = [...Object.values(SURVEY_MAP_LAYERS).flat(), ...HIGHLIGHT_LAYERS];
  for (const layer of layers) {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
};

export const useSurveyLayers = (map: MaplibreMap | null, survey: Survey, routePurpose: RoutePurpose) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!map) {
      setIsReady(false);
      return;
    }

    for (const [sourceId, data] of surveyEntries(survey, routePurpose)) {
      const existing = map.getSource(sourceId);
      if (isGeoJsonSource(existing)) existing.setData(data);
      else map.addSource(sourceId, { type: "geojson", data });
    }
    if (!map.getSource(SOURCE_IDS.requestedStart)) {
      map.addSource(SOURCE_IDS.requestedStart, { type: "geojson", data: NO_FEATURES });
    }
    addLayersOnce(map);

    const blockBounds = boundsOf(survey.blocks.features.flatMap(block => block.geometry.coordinates.flat()));
    if (blockBounds) map.fitBounds(blockBounds, { padding: FIT_PADDING_PX, duration: 1200 });

    setIsReady(true);
  }, [map, survey, routePurpose]);

  return isReady;
};
