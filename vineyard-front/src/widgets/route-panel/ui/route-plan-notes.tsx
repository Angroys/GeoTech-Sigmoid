import { ChevronRight } from "lucide-react";
import type { FC, ReactNode } from "react";

type RoutePlanNotesProps = { children: ReactNode };

export const RoutePlanNotes: FC<RoutePlanNotesProps> = ({ children }) => {
  return (
    <details className="group mt-3">
      <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-sm outline-none focus-visible:ring-[3px] [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        How this route was planned
      </summary>
      <div className="mt-2 grid gap-3 pl-5">{children}</div>
    </details>
  );
};
