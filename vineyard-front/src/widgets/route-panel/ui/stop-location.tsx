import type { FC } from "react";

import type { RouteStop } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";

import { describeStop } from "../lib/describe-stop";

type StopLocationProps = { stop: RouteStop; className?: string };

export const StopLocation: FC<StopLocationProps> = ({ stop, className }) => {
  return (
    <span className={cn("text-muted-foreground flex min-w-0 items-baseline gap-2", className)}>
      <span className="truncate">{describeStop(stop).location}</span>
      <span className="text-foreground/70 shrink-0 tabular-nums">{stop.targetId}</span>
    </span>
  );
};
