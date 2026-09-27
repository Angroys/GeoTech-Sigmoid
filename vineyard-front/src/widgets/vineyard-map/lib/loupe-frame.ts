import type { Polygon, Position } from "geojson";

import type { LngLatBounds } from "@/entities/survey";

const METRES_PER_DEGREE = 111_320;
const CONTEXT_FACTOR = 2.5;
const MIN_SPAN_M = 2.5;

type LoupeFrame = { bounds: LngLatBounds; spanM: number; outline: string };

const extentOf = (ring: readonly Position[]) => {
  const lngs = ring.map(([lng = 0]) => lng);
  const lats = ring.map(([, lat = 0]) => lat);
  return { west: Math.min(...lngs), east: Math.max(...lngs), south: Math.min(...lats), north: Math.max(...lats) };
};

export const loupeFrameOf = (polygon: Polygon): LoupeFrame | null => {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length === 0) return null;

  const { west, east, south, north } = extentOf(ring);
  const centreLng = (west + east) / 2;
  const centreLat = (south + north) / 2;
  const metresPerLng = METRES_PER_DEGREE * Math.cos((centreLat * Math.PI) / 180);

  const widthM = (east - west) * metresPerLng;
  const heightM = (north - south) * METRES_PER_DEGREE;
  const spanM = Math.max(MIN_SPAN_M, Math.max(widthM, heightM) * CONTEXT_FACTOR);
  const halfLng = spanM / 2 / metresPerLng;
  const halfLat = spanM / 2 / METRES_PER_DEGREE;

  const bounds: LngLatBounds = [centreLng - halfLng, centreLat - halfLat, centreLng + halfLng, centreLat + halfLat];
  const outline = ring
    .map(([lng = 0, lat = 0]) => {
      const x = ((lng - bounds[0]) / (bounds[2] - bounds[0])) * 100;
      const y = ((bounds[3] - lat) / (bounds[3] - bounds[1])) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return { bounds, spanM, outline };
};
