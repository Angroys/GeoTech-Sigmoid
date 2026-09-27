import { useEffect, useState } from "react";

import { findParcel, type Parcel } from "@/entities/parcel";
import { useLocation } from "@/shared/lib/router";

export type TargetParcelState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; parcel: Parcel }
  | { status: "missing"; cadastralNumber: string };

export const useTargetParcel = (): TargetParcelState => {
  const { searchParams } = useLocation();
  const cadastralNumber = searchParams.get("parcel");
  const [state, setState] = useState<TargetParcelState>({ status: cadastralNumber ? "loading" : "none" });

  useEffect(() => {
    if (!cadastralNumber) {
      setState({ status: "none" });
      return;
    }
    let isCurrent = true;
    setState({ status: "loading" });
    findParcel(cadastralNumber)
      .then(({ parcel }) => {
        if (!isCurrent) return;
        setState(parcel ? { status: "ready", parcel } : { status: "missing", cadastralNumber });
      })
      .catch(() => {
        if (isCurrent) setState({ status: "missing", cadastralNumber });
      });
    return () => {
      isCurrent = false;
    };
  }, [cadastralNumber]);

  return state;
};
