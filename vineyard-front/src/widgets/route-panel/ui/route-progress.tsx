import type { FC } from "react";

import { formatCount } from "@/shared/lib/format";

type RouteProgressProps = {
  reachedCount: number;
  total: number;
  onStartOver: () => void;
};

export const RouteProgress: FC<RouteProgressProps> = ({ reachedCount, total, onStartOver }) => {
  const ratio = total > 0 ? reachedCount / total : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{formatCount(reachedCount)}</span> of{" "}
          <span className="tabular-nums">{formatCount(total)}</span> stops reached
        </p>
        {reachedCount > 0 && (
          <button
            type="button"
            onClick={onStartOver}
            className="text-primary focus-visible:ring-ring/50 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
          >
            Start over
          </button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Stops reached"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={reachedCount}
        className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
};
