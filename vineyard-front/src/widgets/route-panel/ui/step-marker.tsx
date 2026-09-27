import type { FC, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

export type MarkerTone = "done" | "current" | "upcoming";

type StepMarkerProps = {
  tone: MarkerTone;
  children: ReactNode;
  size?: "large" | "small";
};

const TONE_CLASS = {
  done: "bg-primary text-primary-foreground",
  current: "bg-popover text-primary ring-primary ring-2",
  upcoming: "bg-muted text-muted-foreground ring-border ring-1",
} as const satisfies Record<MarkerTone, string>;

export const StepMarker: FC<StepMarkerProps> = ({ tone, children, size = "large" }) => {
  return (
    <span
      className={cn(
        "relative z-[1] grid shrink-0 place-items-center rounded-full font-semibold tabular-nums",
        size === "large" ? "size-8 text-xs" : "size-6 text-[0.6875rem]",
        TONE_CLASS[tone],
      )}
      aria-hidden
    >
      {children}
    </span>
  );
};
