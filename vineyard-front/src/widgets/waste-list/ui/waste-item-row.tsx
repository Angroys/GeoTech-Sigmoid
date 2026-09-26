import type { FC } from "react";

import { FEATURE_COLORS, type TargetId } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";
import { useScrollIntoView } from "@/shared/lib/dom";

import type { WasteItem } from "../model/use-waste-items";

type WasteItemRowProps = {
  item: WasteItem;
  isSelected: boolean;
  onSelect: (targetId: TargetId) => void;
};

export const WasteItemRow: FC<WasteItemRowProps> = ({ item, isSelected, onSelect }) => {
  const ref = useScrollIntoView<HTMLButtonElement>(isSelected);
  const routeNote =
    item.stopOrder !== null
      ? `Stop ${item.stopOrder}`
      : item.status === "unreachable"
        ? "Not reachable"
        : "Route being planned";

  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={() => onSelect(item.targetId)}
        aria-pressed={isSelected}
        className={cn(
          "focus-visible:ring-ring/50 grid w-full grid-cols-[0.75rem_1fr_auto] items-center gap-3 rounded-md py-1.5 pr-2 pl-8 text-left text-sm outline-none focus-visible:ring-[3px]",
          isSelected ? "bg-primary/10" : "hover:bg-muted",
        )}
      >
        <span className="size-3 rounded-[2px] border-2" style={{ borderColor: FEATURE_COLORS.waste }} aria-hidden />
        <span className="font-medium tabular-nums">{item.targetId}</span>
        <span
          className={cn(
            "text-xs tabular-nums",
            item.status === "unreachable" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {routeNote}
        </span>
      </button>
    </li>
  );
};
