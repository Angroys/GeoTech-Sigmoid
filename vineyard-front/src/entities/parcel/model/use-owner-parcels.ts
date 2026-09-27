import { useEffect, useState } from "react";

import { ApiError } from "@/shared/api";

import { searchOwnerParcels, type ParcelSearch } from "../api/cadastre-api";

export type OwnerParcelsState =
  | { status: "loading" }
  | ({ status: "ready" } & ParcelSearch)
  | { status: "error"; message: string };

const UNEXPECTED = "Your parcels could not be loaded from the cadastre. Reload the page to try again.";

export const useOwnerParcels = (fiscalCode: string | null): OwnerParcelsState => {
  const [state, setState] = useState<OwnerParcelsState>({ status: "loading" });

  useEffect(() => {
    if (!fiscalCode) {
      setState({ status: "ready", parcels: [], source: "demo" });
      return;
    }
    let isCurrent = true;
    setState({ status: "loading" });
    searchOwnerParcels(fiscalCode)
      .then(search => {
        if (isCurrent) setState({ status: "ready", ...search });
      })
      .catch((error: unknown) => {
        if (isCurrent) setState({ status: "error", message: error instanceof ApiError ? error.message : UNEXPECTED });
      });
    return () => {
      isCurrent = false;
    };
  }, [fiscalCode]);

  return state;
};
