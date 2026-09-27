import type { Polygon, Position } from "geojson";
import type { FC } from "react";

import { cn } from "@/shared/lib/cn";

const VIEW_SIZE = 100;
const MARGIN = 8;

const outlinePath = (polygon: Polygon) => {
  const ring = polygon.coordinates[0] ?? [];
  const latitude = ring.reduce((sum, [, lat = 0]) => sum + lat, 0) / Math.max(ring.length, 1);
  const lngScale = Math.cos((latitude * Math.PI) / 180);
  const points = ring.map(([lng = 0, lat = 0]): Position => [lng * lngScale, lat]);
  const xs = points.map(([x = 0]) => x);
  const ys = points.map(([, y = 0]) => y);
  const minX = Math.min(...xs);
  const maxY = Math.max(...ys);
  const span = Math.max(Math.max(...xs) - minX, maxY - Math.min(...ys)) || 1;
  const scale = (VIEW_SIZE - MARGIN * 2) / span;
  return points
    .map(([x = 0, y = 0], index) => `${index === 0 ? "M" : "L"}${(MARGIN + (x - minX) * scale).toFixed(2)} ${(MARGIN + (maxY - y) * scale).toFixed(2)}`)
    .join(" ");
};

type ParcelOutlineProps = { outline: Polygon; className?: string };

export const ParcelOutline: FC<ParcelOutlineProps> = ({ outline, className }) => {
  return (
    <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} aria-hidden className={cn("bg-muted", className)}>
      <path
        d={`${outlinePath(outline)} Z`}
        className="fill-primary/15 stroke-primary"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};
