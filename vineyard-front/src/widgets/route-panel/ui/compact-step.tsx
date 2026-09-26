import { useEffect, useState, type FC, type SyntheticEvent } from "react";

import type { TargetId } from "@/entities/survey";
import { ReachedToggle } from "@/features/track-route-progress";
import { cn } from "@/shared/lib/cn";
import { useScrollIntoView } from "@/shared/lib/dom";
import { formatDistance } from "@/shared/lib/format";

import { describeStop } from "../lib/describe-stop";
import type { RouteStep } from "../model/use-route-stepper";
import { StepFacts } from "./step-facts";
import { StepMarker } from "./step-marker";
import { StopLocation } from "./stop-location";

type CompactStepProps = {
  step: RouteStep;
  speedKmh: number;
  isSelected: boolean;
  isRevealed: boolean;
  onShow: (targetId: TargetId) => void;
  onReachedChange: (targetId: TargetId, isReached: boolean) => void;
};

export const CompactStep: FC<CompactStepProps> = ({
  step,
  speedKmh,
  isSelected,
  isRevealed,
  onShow,
  onReachedChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useScrollIntoView<HTMLLIElement>(isRevealed);
  const { title } = describeStop(step.stop);

  const toggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const isNowOpen = event.currentTarget.open;
    setIsOpen(isNowOpen);
    if (isNowOpen && !isSelected) onShow(step.stop.targetId);
  };

  useEffect(() => {
    if (isRevealed) setIsOpen(true);
  }, [isRevealed]);

  return (
    <li ref={ref}>
      <details open={isOpen} onToggle={toggle}>
        <summary
          className={cn(
            "focus-visible:ring-ring/50 grid cursor-pointer list-none grid-cols-[1.5rem_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-[3px] [&::-webkit-details-marker]:hidden",
            isSelected ? "bg-primary/10" : "hover:bg-muted",
          )}
        >
          <StepMarker tone={step.isReached ? "done" : "upcoming"} size="small">
            {step.stop.order}
          </StepMarker>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{title}</span>
            <StopLocation stop={step.stop} className="text-xs" />
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">{formatDistance(step.stop.distanceM)}</span>
        </summary>
        <div className="grid gap-3 px-2 pt-1 pb-3 pl-10">
          <StepFacts step={step} speedKmh={speedKmh} />
          <div>
            <ReachedToggle
              isReached={step.isReached}
              onChange={isReached => onReachedChange(step.stop.targetId, isReached)}
            />
          </div>
        </div>
      </details>
    </li>
  );
};
