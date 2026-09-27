import type { FC } from "react";

import type { SurveySource } from "@/entities/survey";
import { ParcelSearchForm, useParcelLookup, type ParcelLookupState } from "@/features/find-parcel";
import { assertNever } from "@/shared/lib/types";

import { surveysOfParcel } from "../lib/surveys-of-parcel";
import { ParcelEntry } from "./parcel-entry";

type LookupResultProps = { state: ParcelLookupState; sources: readonly SurveySource[] };

const LookupResult: FC<LookupResultProps> = ({ state, sources }) => {
  switch (state.status) {
    case "idle":
    case "searching":
    case "error":
      return null;
    case "not-found":
      return (
        <p className="text-sm">
          No parcel {state.cadastralNumber} was found
          {state.source === "demo" ? " in the demo data; the cadastre service is not connected yet." : " in the cadastre."}
        </p>
      );
    case "found":
      return (
        <div className="border-border bg-popover overflow-hidden rounded-xl border shadow-[0_1px_2px_rgb(29_36_32/0.06)]">
          <ParcelEntry
            parcel={state.parcel}
            surveys={surveysOfParcel(sources, state.parcel.cadastralNumber)}
            role="inspector"
          />
        </div>
      );
    default:
      return assertNever(state);
  }
};

type InspectorParcelSearchProps = { sources: readonly SurveySource[] };

export const InspectorParcelSearch: FC<InspectorParcelSearchProps> = ({ sources }) => {
  const { state, lookUp } = useParcelLookup();

  return (
    <section aria-labelledby="parcel-search" className="grid gap-4">
      <h2 id="parcel-search" className="text-lg font-semibold">
        Look up a parcel
      </h2>
      <ParcelSearchForm
        isSearching={state.status === "searching"}
        error={state.status === "error" ? state.message : undefined}
        onSearch={value => void lookUp(value)}
      />
      <div aria-live="polite">
        <LookupResult state={state} sources={sources} />
      </div>
    </section>
  );
};
