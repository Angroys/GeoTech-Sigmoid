import { useEffect, useState } from "react";

import { findDelegation, type Delegation } from "@/entities/delegation";
import { useLocation } from "@/shared/lib/router";

export const useActiveDelegation = (): Delegation | null => {
  const { searchParams } = useLocation();
  const number = searchParams.get("delegation");
  const [delegation, setDelegation] = useState<Delegation | null>(null);

  useEffect(() => {
    setDelegation(null);
    if (!number) return;
    let isCurrent = true;
    findDelegation(number)
      .then(lookup => {
        if (isCurrent) setDelegation(lookup.delegation);
      })
      .catch(() => {
        if (isCurrent) setDelegation(null);
      });
    return () => {
      isCurrent = false;
    };
  }, [number]);

  return delegation;
};
