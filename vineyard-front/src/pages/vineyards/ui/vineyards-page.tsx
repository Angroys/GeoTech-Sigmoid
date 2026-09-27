import type { FC } from "react";

import type { Role } from "@/entities/role";
import { ROUTE_COPY, useSurveySources, type SurveySource } from "@/entities/survey";
import { ROUTES } from "@/shared/config";
import { AppLink } from "@/shared/ui";
import { AppHeader } from "@/widgets/app-header";

import { surveysOutside } from "../lib/surveys-of-parcel";
import { useSessionParcels } from "../model/use-session-parcels";
import { InspectorParcelSearch } from "./inspector-parcel-search";
import { OwnerParcels } from "./owner-parcels";
import { VineyardEntry } from "./vineyard-entry";

const ROUTE_OF_ROLE = { owner: "waste_collection", inspector: "inspection" } as const;

type SurveyListProps = { title: string; description: string; sources: readonly SurveySource[]; role: Role };

const SurveyList: FC<SurveyListProps> = ({ title, description, sources, role }) => {
  if (sources.length === 0) return null;
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      <ul className="border-border divide-border bg-popover divide-y overflow-hidden rounded-xl border shadow-[0_1px_2px_rgb(29_36_32/0.06)]">
        {sources.map(source => (
          <li key={source.id}>
            <VineyardEntry source={source} role={role} />
          </li>
        ))}
      </ul>
    </section>
  );
};

type RoleContentProps = { sources: readonly SurveySource[] };

const OwnerContent: FC<RoleContentProps> = ({ sources }) => {
  const { fiscalCode, state } = useSessionParcels();
  const ownedNumbers = state.status === "ready" ? state.parcels.map(parcel => parcel.cadastralNumber) : [];

  return (
    <>
      <OwnerParcels fiscalCode={fiscalCode} state={state} sources={sources} />
      <SurveyList
        title="Other surveys"
        description="Surveys that aren't linked to one of your parcels."
        sources={surveysOutside(sources, ownedNumbers)}
        role="owner"
      />
      <AppLink
        href={ROUTES.addVineyard}
        className="text-primary focus-visible:ring-ring/50 justify-self-start rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
      >
        Add a survey that isn&rsquo;t linked to a parcel
      </AppLink>
    </>
  );
};

const InspectorContent: FC<RoleContentProps> = ({ sources }) => {
  return (
    <>
      <InspectorParcelSearch sources={sources} />
      <SurveyList
        title="All vineyards"
        description="Every surveyed vineyard in the register."
        sources={sources}
        role="inspector"
      />
    </>
  );
};

type VineyardsPageProps = { role: Role };

export const VineyardsPage: FC<VineyardsPageProps> = ({ role }) => {
  const { sources } = useSurveySources();
  const routeName = ROUTE_COPY[ROUTE_OF_ROLE[role]].title.toLowerCase();

  return (
    <div data-role={role} className="min-h-dvh">
      <AppHeader role={role} />

      <main className="mx-auto grid max-w-6xl gap-10 px-4 pt-10 pb-16 sm:px-8">
        <div>
          <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.02em]">Vineyards</h1>
          <p className="text-muted-foreground mt-2 max-w-[60ch] text-[0.9375rem] leading-relaxed">
            Choose a vineyard to open its map, measurements and {routeName}.
          </p>
        </div>
        {role === "owner" ? <OwnerContent sources={sources} /> : <InspectorContent sources={sources} />}
      </main>
    </div>
  );
};
