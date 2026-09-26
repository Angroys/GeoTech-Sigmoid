import type { GeoJSON } from "geojson";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";

import type { RoutePurpose, Survey } from "@/entities/survey";

import { FIT_PADDING_PX } from "../config/map-style";
import { HIGHLIGHT_LAYERS, SOURCE_IDS, SURVEY_MAP_LAYERS } from "../config/survey-layers";
import { boundsOf } from "../lib/bounds";
import { isGeoJsonSource, NO_FEATURES } from "../lib/geojson-source";

const surveyEntries = (survey: Survey, routePurpose: RoutePurpose) => {
  const routeMap = survey.routeMap;
  return [
    [SOURCE_IDS.studyArea, routeMap?.studyArea ?? NO_FEATURES],
    [SOURCE_IDS.suppliedPassages, routeMap?.suppliedPassages ?? NO_FEATURES],
    [SOURCE_IDS.inferredHeadlands, routeMap?.inferredHeadlands ?? NO_FEATURES],
    [SOURCE_IDS.forbiddenAreas, routeMap?.forbiddenAreas ?? NO_FEATURES],
    [SOURCE_IDS.blocks, survey.blocks],
    [SOURCE_IDS.interrows, survey.interrows],
    [SOURCE_IDS.canopy, survey.canopy],
    [SOURCE_IDS.rows, survey.rows],
    [SOURCE_IDS.route, survey.routes[routePurpose] ?? NO_FEATURES],
    [SOURCE_IDS.routeEvidence, routeMap?.routeEvidence ?? NO_FEATURES],
    [SOURCE_IDS.waste, survey.waste],
    [SOURCE_IDS.inspectionPoints, survey.inspectionPoints],
    [SOURCE_IDS.start, survey.start],
  ] as const;
};

const setSourceData = (map: MaplibreMap, sourceId: string, data: GeoJSON) => {
  const existing = map.getSource(sourceId);
  if (isGeoJsonSource(existing)) existing.setData(data);
  else map.addSource(sourceId, { type: "geojson", data });
};

const addSourcesOnce = (map: MaplibreMap, survey: Survey, routePurpose: RoutePurpose) => {
  for (const [sourceId, data] of surveyEntries(survey, routePurpose)) setSourceData(map, sourceId, data);
  if (!map.getSource(SOURCE_IDS.requestedStart)) setSourceData(map, SOURCE_IDS.requestedStart, NO_FEATURES);
};

const addLayersOnce = (map: MaplibreMap) => {
  const layers = [...Object.values(SURVEY_MAP_LAYERS).flat(), ...HIGHLIGHT_LAYERS];
  for (const layer of layers) {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
};

const fitToBlocks = (map: MaplibreMap, survey: Survey) => {
  const blockBounds = boundsOf(survey.blocks.features.flatMap(block => block.geometry.coordinates.flat()));
  if (blockBounds) map.fitBounds(blockBounds, { padding: FIT_PADDING_PX, duration: 1200 });
};

export const useSurveyLayers = (map: MaplibreMap | null, survey: Survey, routePurpose: RoutePurpose) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!map) {
      setIsReady(false);
      return;
    }
    addSourcesOnce(map, survey, routePurpose);
    addLayersOnce(map);
    fitToBlocks(map, survey);
    setIsReady(true);
  }, [map, survey, routePurpose]);

  return isReady;
};
