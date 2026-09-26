import type { FC } from "react";

import { vineyardUrl, type Role } from "@/entities/role";
import type { Survey, SurveySource } from "@/entities/survey";
import { AppLink } from "@/shared/ui";

import { useVineyardFacts } from "../model/use-vineyard-facts";

type VineyardFactsProps = { survey: Survey; source: SurveySource; role: Role };

export const VineyardFacts: FC<VineyardFactsProps> = ({ survey, source, role }) => {
  const { facts, blocks } = useVineyardFacts(survey, role);

  return (
    <div className="grid gap-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {facts.map(fact => {
          return (
            <div key={fact.label}>
              <dt className="text-muted-foreground text-xs">{fact.label}</dt>
              <dd className="text-[0.9375rem] font-semibold tabular-nums">{fact.value}</dd>
            </div>
          );
        })}
      </dl>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground mr-1 text-xs">Open a block</span>
        {blocks.map(block => {
          return (
            <AppLink
              key={block.vineyardId}
              href={vineyardUrl(role, source.id, block.vineyardId)}
              className="border-border hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-ring/50 inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-0.5 text-xs outline-none focus-visible:ring-[3px]"
            >
              <span className="font-semibold">{block.vineyardId}</span>
              <span className="text-muted-foreground tabular-nums">{block.rowCount} rows</span>
            </AppLink>
          );
        })}
      </div>
    </div>
  );
};
