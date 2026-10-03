import { CircleAlert, LoaderCircle } from "lucide-react";
import type { FC } from "react";

import {
  DelegationFacts,
  useInspectorDelegations,
  type Delegation,
  type InspectorDelegationsState,
} from "@/entities/delegation";
import { useOwnerParcels } from "@/entities/parcel";
import { useSession } from "@/entities/session";
import type { SurveySource } from "@/entities/survey";
import { assertNever } from "@/shared/lib/types";

import { surveysOfParcel } from "../lib/surveys-of-parcel";
import { ParcelEntry } from "./parcel-entry";

type DelegationParcelsProps = { delegation: Delegation; sources: readonly SurveySource[] };

const DelegationParcels: FC<DelegationParcelsProps> = ({ delegation, sources }) => {
  const state = useOwnerParcels(delegation.operator.idno);

  if (state.status === "loading") {
    return <p className="text-muted-foreground text-sm">Looking up the operator&rsquo;s parcels</p>;
  }
  if (state.status === "error") return <p className="text-destructive text-sm">{state.message}</p>;
  if (state.parcels.length === 0) {
    return <p className="text-muted-foreground text-sm">No vineyard parcels were found for this operator.</p>;
  }
  return (
    <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
      {state.parcels.map(parcel => (
        <li key={parcel.cadastralNumber}>
          <ParcelEntry
            parcel={parcel}
            surveys={surveysOfParcel(sources, parcel.cadastralNumber)}
            role="inspector"
            delegationNumber={delegation.number}
          />
        </li>
      ))}
    </ul>
  );
};

type DelegationCardProps = { delegation: Delegation; sources: readonly SurveySource[] };

const DelegationCard: FC<DelegationCardProps> = ({ delegation, sources }) => {
  return (
    <li className="border-border bg-popover grid gap-5 rounded-xl border p-4 shadow-[0_1px_2px_rgb(29_36_32/0.06)] sm:p-5">
      <DelegationFacts delegation={delegation} />
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">Parcels to inspect</h3>
        <DelegationParcels delegation={delegation} sources={sources} />
      </div>
    </li>
  );
};

type DelegationListProps = {
  state: InspectorDelegationsState;
  badgeNumber: string | null;
  sources: readonly SurveySource[];
};

const DelegationList: FC<DelegationListProps> = ({ state, badgeNumber, sources }) => {
  switch (state.status) {
    case "loading":
      return (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Reading your delegations from the State Register of Controls
        </p>
      );
    case "error":
      return (
        <p role="alert" className="text-destructive flex items-center gap-2 text-sm">
          <CircleAlert className="size-4" aria-hidden />
          {state.message}
        </p>
      );
    case "ready":
      if (state.delegations.length === 0) {
        return (
          <p className="text-muted-foreground text-sm">
            {badgeNumber
              ? `No delegations are registered for badge ${badgeNumber}.`
              : "Sign out and in again to read your delegations."}
            {state.source === "demo" && " The State Register of Controls is not connected yet."}
          </p>
        );
      }
      return (
        <ul className="grid gap-4">
          {state.delegations.map(delegation => (
            <DelegationCard key={delegation.number} delegation={delegation} sources={sources} />
          ))}
        </ul>
      );
    default:
      return assertNever(state);
  }
};

type InspectorControlsProps = { sources: readonly SurveySource[] };

export const InspectorControls: FC<InspectorControlsProps> = ({ sources }) => {
  const session = useSession();
  const badgeNumber = session?.inspector?.badgeNumber ?? null;
  const state = useInspectorDelegations(badgeNumber);

  return (
    <section aria-labelledby="my-controls" className="grid gap-4">
      <div>
        <h2 id="my-controls" className="text-lg font-semibold">
          My controls
        </h2>
        <p className="text-muted-foreground mt-1 max-w-[70ch] text-sm leading-relaxed">
          Delegations issued to you and registered in the State Register of Controls. They are assigned by the head of
          your control body; this list only reads them.
        </p>
      </div>
      <DelegationList state={state} badgeNumber={badgeNumber} sources={sources} />
    </section>
  );
};
