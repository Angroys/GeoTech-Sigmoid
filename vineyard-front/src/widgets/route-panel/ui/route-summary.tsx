import { CircleAlert } from "lucide-react";
import type { FC } from "react";

import { formatKilometres, formatMetres, formatMinutes, formatPercent } from "@/shared/lib/format";

import type { RoutePlan } from "../model/use-route-plan";

type RouteSummaryProps = { plan: RoutePlan };

export const RouteSummary: FC<RouteSummaryProps> = ({ plan }) => {
  return (
    <div>
      <p>
        <span className="block text-[2.25rem] leading-none font-semibold tracking-[-0.03em] whitespace-nowrap tabular-nums">
          {formatKilometres(plan.lengthM)}
        </span>
        <span className="text-muted-foreground mt-1.5 block text-sm">
          About {formatMinutes(plan.minutes)} on foot at {plan.speedKmh} km/h, {plan.stops.length} stops
        </span>
      </p>
      <p className="mt-3 text-sm leading-relaxed">
        {formatMetres(plan.savedM)} ({formatPercent(plan.savedRatio)}) shorter than an estimated walk along every
        inter-row, which saves about {formatMinutes(plan.savedMinutes)}.
      </p>
    </div>
  );
};

type UnreachableNoticeProps = { plan: RoutePlan };

export const UnreachableNotice: FC<UnreachableNoticeProps> = ({ plan }) => {
  const count = plan.unreachable.length;
  if (count === 0) return null;

  const ids = plan.unreachable.map(target => target.targetId).join(", ");
  return (
    <p className="border-border mt-4 flex gap-2.5 rounded-md border px-3 py-2.5 text-sm leading-snug">
      <CircleAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {count === 1 ? "1 target has" : `${count} targets have`} no passable way in and {count === 1 ? "is" : "are"}{" "}
        left off the route: {ids}.
      </span>
    </p>
  );
};
