import { useCallback, useState } from "react";

import { cadastralNumberSchema, findParcel, type Parcel, type ParcelSource } from "@/entities/parcel";
import { ApiError } from "@/shared/api";

export type ParcelLookupState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "found"; parcel: Parcel; source: ParcelSource }
  | { status: "not-found"; cadastralNumber: string; source: ParcelSource }
  | { status: "error"; message: string };

const INVALID_NUMBER = "Enter the 10-digit cadastral number, for example 3631204101.";

const normalizeCadastralNumber = (value: string) => value.replace(/[\s.-]/g, "");

export const useParcelLookup = () => {
  const [state, setState] = useState<ParcelLookupState>({ status: "idle" });

  const lookUp = useCallback(async (value: string) => {
    const number = cadastralNumberSchema.safeParse(normalizeCadastralNumber(value));
    if (!number.success) {
      setState({ status: "error", message: INVALID_NUMBER });
      return;
    }
    setState({ status: "searching" });
    try {
      const { parcel, source } = await findParcel(number.data);
      setState(parcel ? { status: "found", parcel, source } : { status: "not-found", cadastralNumber: number.data, source });
    } catch (error) {
      setState({ status: "error", message: error instanceof ApiError ? error.message : "The cadastre could not be searched." });
    }
  }, []);

  return { state, lookUp };
};
