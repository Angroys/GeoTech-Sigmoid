import type { Position } from "geojson";
import { Hourglass } from "lucide-react";
import type { FC } from "react";

import { formatLngLat } from "@/shared/lib/geo";

type RoutePendingProps = { start: Position };

export const RoutePending: FC<RoutePendingProps> = ({ start }) => {
  return (
    <div className="bg-muted flex gap-3 rounded-lg p-4">
      <Hourglass className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-sm leading-relaxed">
        <p className="font-medium">Being planned</p>
        <p className="text-muted-foreground">
          The server plans this route from the starting point at{" "}
          <span className="text-foreground tabular-nums">{formatLngLat(start)}</span>. Its stops appear here once it is
          ready.
        </p>
      </div>
    </div>
  );
};
