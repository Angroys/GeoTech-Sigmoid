import type { StyleSpecification } from "maplibre-gl";

import type { SurveySource } from "@/entities/survey";

export const MAPLIBRE_WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";

export const IMAGERY_MAX_ZOOM = 22;
export const FIT_PADDING_PX = 48;

const OUTSIDE_SURVEY_COLOR = "#dfe4dd";

const BACKGROUND_LAYER = {
  id: "background",
  type: "background",
  paint: { "background-color": OUTSIDE_SURVEY_COLOR },
} as const;

export const createBaseStyle = ({ imagery }: SurveySource): StyleSpecification => {
  if (!imagery) return { version: 8, sources: {}, layers: [BACKGROUND_LAYER] };

  return {
    version: 8,
    sources: {
      imagery: {
        type: "raster",
        tiles: [imagery.tileUrl],
        tileSize: 256,
        bounds: imagery.bounds,
        maxzoom: IMAGERY_MAX_ZOOM,
        attribution: imagery.attribution,
      },
    },
    layers: [BACKGROUND_LAYER, { id: "imagery", type: "raster", source: "imagery" }],
  };
};

export const FALLBACK_VIEW: { center: [number, number]; zoom: number } = { center: [28.6, 47.1], zoom: 8 };
