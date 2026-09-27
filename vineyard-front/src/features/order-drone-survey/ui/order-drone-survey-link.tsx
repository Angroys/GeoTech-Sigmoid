import { ExternalLink } from "lucide-react";
import type { FC } from "react";

import { cn } from "@/shared/lib/cn";

import { DRONE_SERVICE } from "../config/drone-services";

type OrderDroneSurveyLinkProps = { className?: string };

export const OrderDroneSurveyLink: FC<OrderDroneSurveyLinkProps> = ({ className }) => {
  return (
    <a
      href={DRONE_SERVICE.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "border-border hover:bg-muted focus-visible:ring-ring/50 inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium outline-none focus-visible:ring-[3px]",
        className,
      )}
    >
      Order a drone survey
      <ExternalLink className="text-muted-foreground size-3.5" aria-hidden />
      <span className="sr-only">from {DRONE_SERVICE.name} (opens in a new tab)</span>
    </a>
  );
};
