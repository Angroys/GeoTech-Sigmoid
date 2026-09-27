import { Map as MaplibreMap, NavigationControl, ScaleControl, setWorkerUrl } from "maplibre-gl";
import { useEffect, useState, type RefObject } from "react";

import type { SurveySource } from "@/entities/survey";

import {
  createBaseStyle,
  FALLBACK_VIEW,
  FIT_PADDING_PX,
  IMAGERY_MAX_ZOOM,
  MAPLIBRE_WORKER_URL,
} from "../config/map-style";

setWorkerUrl(MAPLIBRE_WORKER_URL);

export const useMapInstance = (containerRef: RefObject<HTMLDivElement | null>, source: SurveySource) => {
  const [map, setMap] = useState<MaplibreMap | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const instance = new MaplibreMap({
      container,
      style: createBaseStyle(source),
      ...(source.imagery
        ? { bounds: source.imagery.bounds, fitBoundsOptions: { padding: FIT_PADDING_PX } }
        : FALLBACK_VIEW),
      maxZoom: IMAGERY_MAX_ZOOM,
      attributionControl: { compact: true },
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");
    instance.once("load", () => setMap(instance));

    return () => {
      setMap(null);
      instance.remove();
    };
  }, [containerRef, source]);

  return map;
};
