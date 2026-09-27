import { ChevronRight } from "lucide-react";
import { useId, type FC, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { useScrollIntoView } from "@/shared/lib/dom";

type CollapsibleGroupProps = {
  title: string;
  summary: string;
  isExpanded: boolean;
  onToggle: () => void;
  isHighlighted?: boolean;
  action?: ReactNode;
  children: ReactNode;
};

export const CollapsibleGroup: FC<CollapsibleGroupProps> = ({
  title,
  summary,
  isExpanded,
  onToggle,
  isHighlighted = false,
  action,
  children,
}) => {
  const contentId = useId();
  const headerRef = useScrollIntoView<HTMLDivElement>(isHighlighted);

  return (
    <section aria-label={title}>
      <div ref={headerRef} className={cn("flex items-center gap-1 rounded-md", isHighlighted && "bg-primary/10")}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className="hover:bg-muted focus-visible:ring-ring/50 grid min-w-0 flex-1 grid-cols-[1rem_1fr] items-center gap-x-2 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-[3px]"
        >
          <ChevronRight
            className={cn(
              "text-muted-foreground size-4 transition-transform duration-150 motion-reduce:transition-none",
              isExpanded && "rotate-90",
            )}
            aria-hidden
          />
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-muted-foreground col-start-2 text-xs tabular-nums">{summary}</span>
        </button>
        {action}
      </div>

      {isExpanded && (
        <div id={contentId} className="mt-0.5">
          {children}
        </div>
      )}
    </section>
  );
};
