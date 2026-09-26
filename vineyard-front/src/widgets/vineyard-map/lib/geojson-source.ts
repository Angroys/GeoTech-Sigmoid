import type { FeatureCollection } from "geojson";
import type { GeoJSONSource } from "maplibre-gl";

export const NO_FEATURES: FeatureCollection = { type: "FeatureCollection", features: [] };

export const isGeoJsonSource = (source: unknown): source is GeoJSONSource =>
  typeof source === "object" && source !== null && "setData" in source && typeof source.setData === "function";
