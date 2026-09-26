import type { FC } from "react";

import { ROW_STRUCTURE_STYLE, type RowId, type RowProperties } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";
import { useScrollIntoView } from "@/shared/lib/dom";
import { formatMetres } from "@/shared/lib/format";

type RowItemProps = {
  row: RowProperties;
  isSelected: boolean;
  onSelect: (rowId: RowId) => void;
};

export const RowItem: FC<RowItemProps> = ({ row, isSelected, onSelect }) => {
  const ref = useScrollIntoView<HTMLButtonElement>(isSelected);
  const structure = ROW_STRUCTURE_STYLE[row.row_structure];

  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={() => onSelect(row.row_id)}
        aria-pressed={isSelected}
        className={cn(
          "focus-visible:ring-ring/50 grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md py-1.5 pr-2 pl-8 text-left text-sm outline-none focus-visible:ring-[3px]",
          isSelected ? "bg-primary/10 text-foreground" : "hover:bg-muted",
        )}
      >
        <span className="font-medium tabular-nums">{row.row_id}</span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span
            className="border-foreground/20 size-2 rounded-full border"
            style={{ backgroundColor: structure.color }}
            aria-hidden
          />
          {structure.label}
        </span>
        <span className="w-16 text-right tabular-nums">{formatMetres(row.length_m)}</span>
      </button>
    </li>
  );
};
