import type { Polygon } from "geojson";

const METRES_PER_DEGREE = 111_320;
const MARGIN_RATIO = 0.15;

export type ParcelFrame = { bounds: [west: number, south: number, east: number, north: number]; outline: string };

export const parcelFrameOf = (polygon: Polygon): ParcelFrame | null => {
  const ring = polygon.coordinates[0] ?? [];
  if (ring.length === 0) return null;

  const lngs = ring.map(([lng = 0]) => lng);
  const lats = ring.map(([, lat = 0]) => lat);
  const centreLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const centreLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const metresPerLng = METRES_PER_DEGREE * Math.cos((centreLat * Math.PI) / 180);

  const widthM = (Math.max(...lngs) - Math.min(...lngs)) * metresPerLng;
  const heightM = (Math.max(...lats) - Math.min(...lats)) * METRES_PER_DEGREE;
  const halfSpanM = (Math.max(widthM, heightM) * (1 + MARGIN_RATIO * 2)) / 2;
  const halfLng = halfSpanM / metresPerLng;
  const halfLat = halfSpanM / METRES_PER_DEGREE;

  const bounds: ParcelFrame["bounds"] = [
    centreLng - halfLng,
    centreLat - halfLat,
    centreLng + halfLng,
    centreLat + halfLat,
  ];
  const [west, south, east, north] = bounds;
  const outline = ring
    .map(([lng = 0, lat = 0]) => {
      const x = ((lng - west) / (east - west)) * 100;
      const y = ((north - lat) / (north - south)) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return { bounds, outline };
};
