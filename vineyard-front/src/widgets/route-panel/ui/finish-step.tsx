import { FileText, Flag } from "lucide-react";
import type { FC } from "react";

import { cn } from "@/shared/lib/cn";
import { formatMetres, formatMinutes } from "@/shared/lib/format";
import { Button } from "@/shared/ui";

import type { StepGroupSummary } from "../model/use-route-stepper";
import { StepMarker } from "./step-marker";

type FinishStepProps = {
  isCurrent: boolean;
  returnLeg: StepGroupSummary;
  onOpenReport?: (() => void) | undefined;
};

export const FinishStep: FC<FinishStepProps> = ({ isCurrent, returnLeg, onOpenReport }) => {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-3" aria-current={isCurrent ? "step" : undefined}>
      <span className="pt-1">
        <StepMarker tone={isCurrent ? "current" : "upcoming"}>
          <Flag className="size-3.5" />
        </StepMarker>
      </span>
      <div className="px-2 py-1.5">
        <p className={cn("text-sm font-medium", isCurrent && "text-primary")}>
          {isCurrent ? "All stops reached. Walk back to the start" : "Back to the starting point"}
        </p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {formatMetres(returnLeg.distanceM)}, {formatMinutes(returnLeg.minutes)} from the last stop
        </p>
        {isCurrent && onOpenReport && (
          <Button type="button" size="sm" className="mt-3" onClick={onOpenReport}>
            <FileText aria-hidden />
            Create inspection report
          </Button>
        )}
      </div>
    </li>
  );
};
