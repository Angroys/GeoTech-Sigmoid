import type { FC } from "react";

import { INTERROW_COVER_STYLE, type InterrowId, type InterrowProperties } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";
import { useScrollIntoView } from "@/shared/lib/dom";
import { formatSquareMetres, formatWidth } from "@/shared/lib/format";

type InterrowItemProps = {
  interrow: InterrowProperties;
  isSelected: boolean;
  onSelect: (interrowId: InterrowId) => void;
};

export const InterrowItem: FC<InterrowItemProps> = ({ interrow, isSelected, onSelect }) => {
  const ref = useScrollIntoView<HTMLButtonElement>(isSelected);
  const cover = INTERROW_COVER_STYLE[interrow.interrow_cover];

  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={() => onSelect(interrow.interrow_id)}
        aria-pressed={isSelected}
        className={cn(
          "focus-visible:ring-ring/50 grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md py-1.5 pr-2 pl-8 text-left text-sm outline-none focus-visible:ring-[3px]",
          isSelected ? "bg-primary/10" : "hover:bg-muted",
        )}
      >
        <span>
          <span className="block font-medium tabular-nums">{interrow.interrow_id}</span>
          <span className="text-muted-foreground block text-xs tabular-nums">
            {interrow.row_ids ? `Between ${interrow.row_ids[0]} and ${interrow.row_ids[1]}` : "Row association unavailable"}
          </span>
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: cover.color }} aria-hidden />
          {cover.label}
        </span>
        <span className="w-20 text-right tabular-nums">
          <span className="block">{formatWidth(interrow.width_m)} wide</span>
          <span className="text-muted-foreground block text-xs">{formatSquareMetres(interrow.area_m2)}</span>
        </span>
      </button>
    </li>
  );
};
