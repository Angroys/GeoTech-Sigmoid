import type { Position } from "geojson";
import type { LngLatBoundsLike } from "maplibre-gl";

export const boundsOf = (positions: readonly Position[]): LngLatBoundsLike | null => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const [lng, lat] of positions) {
    if (lng === undefined || lat === undefined) continue;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  if (!Number.isFinite(west)) return null;
  return [
    [west, south],
    [east, north],
  ];
};
