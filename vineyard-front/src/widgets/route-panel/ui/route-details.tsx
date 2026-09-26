import { ChevronRight } from "lucide-react";
import { useEffect, useState, type FC, type ReactNode } from "react";

import { formatCount } from "@/shared/lib/format";

import { describeStop } from "../lib/describe-stop";
import type { RouteStep } from "../model/use-route-stepper";

const describeProgress = (reachedCount: number, total: number, current: RouteStep | null) => {
  const reached = `${formatCount(reachedCount)} of ${formatCount(total)} stops reached`;
  if (!current) return `${reached}. Back to the start.`;
  return `${reached}. Next: stop ${current.stop.order}, ${describeStop(current.stop).title}, ${current.stop.targetId}`;
};

type RouteDetailsProps = {
  reachedCount: number;
  total: number;
  current: RouteStep | null;
  openWhen: boolean;
  children: ReactNode;
};

export const RouteDetails: FC<RouteDetailsProps> = ({ reachedCount, total, current, openWhen, children }) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (openWhen) setIsOpen(true);
  }, [openWhen]);

  return (
    <details
      open={isOpen}
      onToggle={event => setIsOpen(event.currentTarget.open)}
      className="group border-border mt-5 rounded-lg border"
    >
      <summary className="hover:bg-muted/60 focus-visible:ring-ring/50 flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3.5 py-3 outline-none focus-visible:ring-[3px] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Stops and details</span>
          <span className="text-muted-foreground block text-xs leading-snug tabular-nums">
            {describeProgress(reachedCount, total, current)}
          </span>
        </span>
        <ChevronRight
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="grid gap-4 px-3.5 pt-1 pb-4">{children}</div>
    </details>
  );
};
