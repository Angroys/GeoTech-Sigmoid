import type { FC } from "react";

import { CADASTRE_ATTRIBUTION } from "../config/attribution";
import type { Parcel } from "../model/types";

const HECTARES = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type ParcelFactsProps = { parcel: Parcel };

export const ParcelFacts: FC<ParcelFactsProps> = ({ parcel }) => {
  return (
    <div className="grid gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground text-xs">Cadastral no.</span>
        <span className="font-semibold tabular-nums">{parcel.cadastralNumber}</span>
        {parcel.isDemo && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-px text-xs">Demo data</span>
        )}
      </p>
      <p className="text-muted-foreground text-sm">
        {parcel.location}. <span className="tabular-nums">{HECTARES.format(parcel.areaHectares)} ha</span>.{" "}
        {parcel.landUse}.
      </p>
      {!parcel.isDemo && <p className="text-muted-foreground text-xs">{CADASTRE_ATTRIBUTION}</p>}
    </div>
  );
};
