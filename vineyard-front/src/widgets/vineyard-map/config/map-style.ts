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

const PROCESSING_RESULTS = /^\/api\/surveys\/([a-z0-9-]+)\/results$/;

/** Uploaded tiles are the survey's orthomosaic: the processing service renders them as map tiles. */
export const uploadedImageryTileUrl = ({ data }: SurveySource, origin: string): string | null => {
  const match = data.kind === "remote" ? PROCESSING_RESULTS.exec(data.url) : null;
  return match ? `${origin}/api/surveys/${match[1]}/imagery/{z}/{x}/{y}.png` : null;
};

export const createBaseStyle = (source: SurveySource): StyleSpecification => {
  const { imagery } = source;
  if (!imagery) {
    const tileUrl = typeof window === "undefined" ? null : uploadedImageryTileUrl(source, window.location.origin);
    if (!tileUrl) return { version: 8, sources: {}, layers: [BACKGROUND_LAYER] };
    return {
      version: 8,
      sources: {
        imagery: {
          type: "raster",
          tiles: [tileUrl],
          tileSize: 256,
          maxzoom: IMAGERY_MAX_ZOOM,
          attribution: `${source.name} uploaded tiles`,
        },
      },
      layers: [BACKGROUND_LAYER, { id: "imagery", type: "raster", source: "imagery" }],
    };
  }

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
