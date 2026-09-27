import { CircleCheck } from "lucide-react";
import type { FC } from "react";

import { formatLngLat, formatUtm, isReadCoordinates, type CoordinateReading } from "@/shared/lib/geo";

type CoordinateReadBackProps = { reading: CoordinateReading };

export const CoordinateReadBack: FC<CoordinateReadBackProps> = ({ reading }) => {
  if (!isReadCoordinates(reading)) return null;

  return (
    <p className="text-primary flex gap-2 text-sm">
      <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="tabular-nums">
        Read as {formatLngLat(reading.lngLat)}. In EPSG:32635 that is {formatUtm(reading.utm)}.
      </span>
    </p>
  );
};
