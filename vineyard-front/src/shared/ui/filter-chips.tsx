import type { FC } from "react";

import { cn } from "@/shared/lib/cn";

export type FilterChipOption<Value extends string> = {
  value: Value;
  label: string;
  count: number;
  color?: string;
};

type FilterChipsProps<Value extends string> = {
  label: string;
  options: readonly FilterChipOption<Value>[];
  active: ReadonlySet<Value>;
  onToggle: (value: Value) => void;
};

export const FilterChips = <Value extends string>({ label, options, active, onToggle }: FilterChipsProps<Value>) => {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(option => {
        const isActive = active.has(option.value);
        return (
          <FilterChip key={option.value} option={option} isActive={isActive} onToggle={() => onToggle(option.value)} />
        );
      })}
    </div>
  );
};

type FilterChipProps = {
  option: FilterChipOption<string>;
  isActive: boolean;
  onToggle: () => void;
};

const FilterChip: FC<FilterChipProps> = ({ option, isActive, onToggle }) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isActive}
      className={cn(
        "focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-[3px] motion-reduce:transition-none",
        isActive
          ? "border-primary/35 bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground bg-transparent",
      )}
    >
      {option.color && (
        <span
          className={cn("size-2 rounded-full", !isActive && "opacity-40")}
          style={{ backgroundColor: option.color }}
          aria-hidden
        />
      )}
      {option.label}
      <span className="text-muted-foreground tabular-nums">{option.count}</span>
    </button>
  );
};
