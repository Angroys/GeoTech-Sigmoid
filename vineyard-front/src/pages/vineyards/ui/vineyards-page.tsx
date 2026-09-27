import { Plus } from "lucide-react";
import type { FC } from "react";

import type { Role } from "@/entities/role";
import { ROUTE_COPY, useSurveySources } from "@/entities/survey";
import { ROUTES } from "@/shared/config";
import { AppLink } from "@/shared/ui";
import { AppHeader } from "@/widgets/app-header";

import { VineyardEntry } from "./vineyard-entry";

const ROUTE_OF_ROLE = { owner: "waste_collection", inspector: "inspection" } as const;

type VineyardsPageProps = { role: Role };

export const VineyardsPage: FC<VineyardsPageProps> = ({ role }) => {
  const { sources } = useSurveySources();
  const routeName = ROUTE_COPY[ROUTE_OF_ROLE[role]].title.toLowerCase();
  const canAdd = role === "owner";

  return (
    <div data-role={role} className="min-h-dvh">
      <AppHeader role={role} />

      <main className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.02em]">Vineyards</h1>
            <p className="text-muted-foreground mt-2 max-w-[60ch] text-[0.9375rem] leading-relaxed">
              Choose a vineyard to open its map, measurements and {routeName}.
            </p>
          </div>
          {canAdd && (
            <AppLink
              href={ROUTES.addVineyard}
              className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px]"
            >
              <Plus className="size-4" aria-hidden />
              Add vineyard
            </AppLink>
          )}
        </div>

        <ul className="border-border divide-border bg-popover mt-8 divide-y overflow-hidden rounded-xl border shadow-[0_1px_2px_rgb(29_36_32/0.06)]">
          {sources.map(source => {
            return (
              <li key={source.id}>
                <VineyardEntry source={source} role={role} />
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
};
