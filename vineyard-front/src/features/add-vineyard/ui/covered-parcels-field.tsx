import { LoaderCircle } from "lucide-react";
import type { FC } from "react";

import { CADASTRE_ATTRIBUTION, type Parcel } from "@/entities/parcel";
import { formatHectares } from "@/shared/lib/format";
import { assertNever } from "@/shared/lib/types";

import type { CoveredParcels } from "../model/use-covered-parcels";

const SQUARE_METRES_PER_HECTARE = 10_000;

type ParcelChoiceProps = { parcel: Parcel; isChecked: boolean; onToggle: () => void };

const ParcelChoice: FC<ParcelChoiceProps> = ({ parcel, isChecked, onToggle }) => {
  return (
    <li>
      <label className="hover:bg-muted/60 grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-md px-2 py-2">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={onToggle}
          className="accent-primary mt-0.5 size-4"
        />
        <span className="grid min-w-0 gap-0.5 text-sm">
          <span className="font-medium tabular-nums">{parcel.cadastralNumber}</span>
          <span className="text-muted-foreground truncate">
            {formatHectares(parcel.areaHectares * SQUARE_METRES_PER_HECTARE)} · {parcel.landUse}
          </span>
        </span>
      </label>
    </li>
  );
};

type CoveredParcelsListProps = { covered: CoveredParcels };

const CoveredParcelsList: FC<CoveredParcelsListProps> = ({ covered }) => {
  const { state, selected, toggle } = covered;
  switch (state.status) {
    case "idle":
      return null;
    case "searching":
      return (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Looking up the parcels under the image in the cadastre
        </p>
      );
    case "failed":
      return <p className="text-destructive text-sm">{state.message}</p>;
    case "found":
      if (state.parcels.length === 0) {
        return <p className="text-muted-foreground text-sm">The cadastre has no farmland or garden parcels of at least 0.15 ha under this image.</p>;
      }
      return (
        <div className="grid gap-2">
          <p className="text-muted-foreground text-sm">
            Parcels under the image that can hold a vineyard: farmland and gardens of at least 0.15 ha, farmland first.
            Tick the ones this survey is for.
            {state.isTruncated && ` The image covers more; the first ${state.parcels.length} are listed.`}
          </p>
          <ul className="border-border max-h-72 overflow-y-auto rounded-lg border p-1">
            {state.parcels.map(parcel => (
              <ParcelChoice
                key={parcel.cadastralNumber}
                parcel={parcel}
                isChecked={selected.has(parcel.cadastralNumber)}
                onToggle={() => toggle(parcel.cadastralNumber)}
              />
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">{CADASTRE_ATTRIBUTION}</p>
        </div>
      );
    default:
      return assertNever(state);
  }
};

type CoveredParcelsFieldProps = { covered: CoveredParcels };

export const CoveredParcelsField: FC<CoveredParcelsFieldProps> = ({ covered }) => {
  if (covered.state.status === "idle") return null;
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-[0.9375rem] font-semibold">Parcels in this survey</legend>
      <div aria-live="polite">
        <CoveredParcelsList covered={covered} />
      </div>
    </fieldset>
  );
};
