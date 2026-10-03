import type { FC } from "react";

import { cn } from "@/shared/lib/cn";

import type { ControlType, Delegation, DelegationStatus } from "../model/types";

const CONTROL_TYPE_LABEL = {
  planned: "Planned control",
  unannounced: "Unannounced control",
} as const satisfies Record<ControlType, string>;

const STATUS_LABEL = {
  registered: "Registered",
  in_progress: "In progress",
  completed: "Completed",
} as const satisfies Record<DelegationStatus, string>;

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const formatDate = (isoDate: string) => DATE.format(new Date(`${isoDate}T00:00:00Z`));

type DelegationFactsProps = { delegation: Delegation };

export const DelegationFacts: FC<DelegationFactsProps> = ({ delegation }) => {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            delegation.controlType === "planned" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
          )}
        >
          {CONTROL_TYPE_LABEL[delegation.controlType]}
        </span>
        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs">
          {STATUS_LABEL[delegation.status]}
        </span>
        {delegation.isDemo && (
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs">Demo data</span>
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-xs">Operator</dt>
          <dd className="font-medium">
            {delegation.operator.name} <span className="text-muted-foreground font-normal tabular-nums">IDNO {delegation.operator.idno}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Starts</dt>
          <dd className="tabular-nums">
            {formatDate(delegation.startDate)}, for {delegation.durationDays} {delegation.durationDays === 1 ? "day" : "days"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Delegation no.</dt>
          <dd className="tabular-nums">{delegation.number}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">State Register of Controls no.</dt>
          <dd className="tabular-nums">{delegation.rscNumber}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground text-xs">Purpose and checklist</dt>
          <dd>
            {delegation.purpose}. {delegation.checklist}.
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground text-xs">Issued by</dt>
          <dd>
            {delegation.controlBody}. {delegation.legalBasis}.
          </dd>
        </div>
      </dl>
    </div>
  );
};
