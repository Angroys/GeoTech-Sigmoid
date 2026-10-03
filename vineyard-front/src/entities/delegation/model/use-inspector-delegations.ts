import { useEffect, useState } from "react";

import { ApiError } from "@/shared/api";

import { listInspectorDelegations, type DelegationList } from "../api/rsc-api";

export type InspectorDelegationsState =
  | { status: "loading" }
  | ({ status: "ready" } & DelegationList)
  | { status: "error"; message: string };

const UNEXPECTED = "Your control delegations could not be loaded. Reload the page to try again.";

export const useInspectorDelegations = (badgeNumber: string | null): InspectorDelegationsState => {
  const [state, setState] = useState<InspectorDelegationsState>({ status: "loading" });

  useEffect(() => {
    if (!badgeNumber) {
      setState({ status: "ready", delegations: [], source: "demo" });
      return;
    }
    let isCurrent = true;
    setState({ status: "loading" });
    listInspectorDelegations(badgeNumber)
      .then(list => {
        if (isCurrent) setState({ status: "ready", ...list });
      })
      .catch((error: unknown) => {
        if (isCurrent) setState({ status: "error", message: error instanceof ApiError ? error.message : UNEXPECTED });
      });
    return () => {
      isCurrent = false;
    };
  }, [badgeNumber]);

  return state;
};
