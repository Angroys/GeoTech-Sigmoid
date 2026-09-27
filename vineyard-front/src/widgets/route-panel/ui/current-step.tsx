import { MapPin } from "lucide-react";
import type { FC, ReactNode } from "react";

import type { TargetId } from "@/entities/survey";
import { ReachedToggle } from "@/features/track-route-progress";
import { cn } from "@/shared/lib/cn";

import { describeStop } from "../lib/describe-stop";
import type { RouteStep } from "../model/use-route-stepper";
import { StepFacts } from "./step-facts";
import { StepMarker } from "./step-marker";
import { StopLocation } from "./stop-location";

type CurrentStepProps = {
  step: RouteStep;
  totalStops: number;
  speedKmh: number;
  isSelected: boolean;
  findings: ReactNode;
  onShow: (targetId: TargetId) => void;
  onReachedChange: (targetId: TargetId, isReached: boolean) => void;
};

export const CurrentStep: FC<CurrentStepProps> = ({
  step,
  totalStops,
  speedKmh,
  isSelected,
  findings,
  onShow,
  onReachedChange,
}) => {
  const { title } = describeStop(step.stop);

  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-3" aria-current="step">
      <span className="pt-3">
        <StepMarker tone="current">{step.stop.order}</StepMarker>
      </span>
      <section
        aria-label={`Current stop, ${step.stop.order} of ${totalStops}`}
        className={cn(
          "bg-popover grid gap-3 rounded-lg border p-3.5 shadow-[0_1px_2px_rgb(29_36_32/0.06)]",
          isSelected ? "border-primary" : "border-primary/30",
        )}
      >
        <button
          type="button"
          onClick={() => onShow(step.stop.targetId)}
          aria-label={`Show stop ${step.stop.order}, ${title}, on the map`}
          className="group/stop focus-visible:ring-ring/50 -m-1.5 rounded-md p-1.5 text-left outline-none focus-visible:ring-[3px]"
        >
          <span className="text-primary block text-xs font-medium tabular-nums">
            Walk here next, stop {step.stop.order} of {totalStops}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-base leading-snug font-semibold">
            {title}
            <MapPin className="text-muted-foreground group-hover/stop:text-primary size-4" aria-hidden />
          </span>
          <StopLocation stop={step.stop} className="text-sm" />
        </button>
        <StepFacts step={step} speedKmh={speedKmh} showTotal={false} />
        {findings}
        <div>
          <ReachedToggle
            isReached={step.isReached}
            onChange={isReached => onReachedChange(step.stop.targetId, isReached)}
          />
        </div>
      </section>
    </li>
  );
};
