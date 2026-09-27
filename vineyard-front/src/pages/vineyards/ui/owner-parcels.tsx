import { CircleAlert, LoaderCircle } from "lucide-react";
import type { FC } from "react";

import type { OwnerParcelsState } from "@/entities/parcel";
import type { SurveySource } from "@/entities/survey";
import { assertNever } from "@/shared/lib/types";

import { surveysOfParcel } from "../lib/surveys-of-parcel";
import { ParcelEntry } from "./parcel-entry";

type ParcelListProps = { state: Extract<OwnerParcelsState, { status: "ready" }>; sources: readonly SurveySource[] };

const ParcelList: FC<ParcelListProps> = ({ state, sources }) => {
  if (state.parcels.length === 0) {
    return (
      <p className="text-muted-foreground text-sm leading-relaxed">
        {state.source === "demo"
          ? "The cadastre service is not connected yet, so parcels can't be looked up for this account. The demo owner account has sample parcels."
          : "No parcels are registered in the cadastre under your IDNO/IDNP."}
      </p>
    );
  }
  return (
    <ul className="border-border divide-border bg-popover divide-y overflow-hidden rounded-xl border shadow-[0_1px_2px_rgb(29_36_32/0.06)]">
      {state.parcels.map(parcel => (
        <li key={parcel.cadastralNumber}>
          <ParcelEntry parcel={parcel} surveys={surveysOfParcel(sources, parcel.cadastralNumber)} role="owner" />
        </li>
      ))}
    </ul>
  );
};

type ParcelStateProps = { state: OwnerParcelsState; sources: readonly SurveySource[] };

const ParcelState: FC<ParcelStateProps> = ({ state, sources }) => {
  switch (state.status) {
    case "loading":
      return (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Looking up your parcels in the cadastre
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
      return <ParcelList state={state} sources={sources} />;
    default:
      return assertNever(state);
  }
};

type OwnerParcelsProps = { fiscalCode: string | null; state: OwnerParcelsState; sources: readonly SurveySource[] };

export const OwnerParcels: FC<OwnerParcelsProps> = ({ fiscalCode, state, sources }) => {
  return (
    <section aria-labelledby="owner-parcels" className="grid gap-4">
      <div>
        <h2 id="owner-parcels" className="text-lg font-semibold">
          Your parcels
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {fiscalCode
            ? `Found in the cadastre under IDNO/IDNP ${fiscalCode}.`
            : "Sign out and in again to look up your parcels in the cadastre."}
        </p>
      </div>
      <ParcelState state={state} sources={sources} />
    </section>
  );
};
