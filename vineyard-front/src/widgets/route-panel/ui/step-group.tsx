import { ChevronRight } from "lucide-react";
import { useEffect, useState, type FC, type ReactNode } from "react";

import { formatCount, formatDistance, formatMinutes } from "@/shared/lib/format";

import type { StepGroupSummary } from "../model/use-route-stepper";
import { StepMarker, type MarkerTone } from "./step-marker";

type StepGroupProps = {
  title: string;
  tone: MarkerTone;
  summary: StepGroupSummary;
  distanceLabel: string;
  containsSelection: boolean;
  children: ReactNode;
};

export const StepGroup: FC<StepGroupProps> = ({ title, tone, summary, distanceLabel, containsSelection, children }) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (containsSelection) setIsOpen(true);
  }, [containsSelection]);

  const stops = `${formatCount(summary.count)} ${summary.count === 1 ? "stop" : "stops"}`;
  const meta = `${stops}, ${formatDistance(summary.distanceM)} ${distanceLabel}, ${formatMinutes(summary.minutes)}`;

  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-3">
      <span className="pt-1">
        <StepMarker tone={tone}>{formatCount(summary.count)}</StepMarker>
      </span>
      <details open={isOpen} onToggle={event => setIsOpen(event.currentTarget.open)} className="group min-w-0">
        <summary className="hover:bg-muted focus-visible:ring-ring/50 flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 py-1.5 outline-none focus-visible:ring-[3px] [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-medium">{title}</span>
            <span className="text-muted-foreground block text-xs tabular-nums">{meta}</span>
          </span>
          <ChevronRight
            className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>
        <ol className="grid gap-0.5 pt-1 pb-2">{children}</ol>
      </details>
    </li>
  );
};
