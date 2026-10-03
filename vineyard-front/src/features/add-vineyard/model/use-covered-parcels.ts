import { useCallback, useEffect, useState } from "react";

import { findParcelsInBounds, type Parcel } from "@/entities/parcel";
import type { LngLatBounds } from "@/entities/survey";
import { ApiError } from "@/shared/api";

export type CoveredParcelsState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "found"; parcels: Parcel[]; isTruncated: boolean }
  | { status: "failed"; message: string };

export const useCoveredParcels = (bounds: LngLatBounds | null, preselected: readonly string[]) => {
  const [state, setState] = useState<CoveredParcelsState>({ status: "idle" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(preselected));
  const boundsKey = bounds?.join(",") ?? null;

  useEffect(() => {
    if (!bounds) {
      setState({ status: "idle" });
      return;
    }
    let isCurrent = true;
    setState({ status: "searching" });
    findParcelsInBounds(bounds)
      .then(({ parcels, isTruncated }) => {
        if (isCurrent) setState({ status: "found", parcels, isTruncated });
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "The cadastre could not be searched.";
        if (isCurrent) setState({ status: "failed", message });
      });
    return () => {
      isCurrent = false;
    };
  }, [boundsKey]);

  const toggle = useCallback((cadastralNumber: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(cadastralNumber)) next.delete(cadastralNumber);
      else next.add(cadastralNumber);
      return next;
    });
  }, []);

  return { state, selected, toggle };
};

export type CoveredParcels = ReturnType<typeof useCoveredParcels>;
