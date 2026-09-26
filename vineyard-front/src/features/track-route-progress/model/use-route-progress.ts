import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { useSession } from "@/entities/session";
import type { RoutePurpose, TargetId } from "@/entities/survey";
import { readItem, removeItem, writeItem } from "@/shared/lib/storage";

const storedProgressSchema = z.object({ reached: z.array(z.string()) });

const storageKey = (accountId: string, purpose: RoutePurpose) => `vineyard:route-progress:v1:${accountId}:${purpose}`;

const loadReached = (key: string, stopIds: readonly TargetId[]): ReadonlySet<TargetId> => {
  const stored = readItem(key, storedProgressSchema);
  if (!stored) return new Set();
  return new Set(stopIds.filter(stopId => stored.reached.includes(stopId)));
};

export const useRouteProgress = (purpose: RoutePurpose, stopIds: readonly TargetId[]) => {
  const session = useSession();
  const key = storageKey(session?.accountId ?? "guest", purpose);
  const [reached, setReached] = useState<ReadonlySet<TargetId>>(() => loadReached(key, stopIds));

  useEffect(() => {
    setReached(loadReached(key, stopIds));
  }, [key, stopIds]);

  const setStopReached = useCallback(
    (targetId: TargetId, isReached: boolean) => {
      const next = new Set(reached);
      if (isReached) next.add(targetId);
      else next.delete(targetId);
      writeItem(key, { reached: [...next] });
      setReached(next);
    },
    [key, reached],
  );

  const resetProgress = useCallback(() => {
    removeItem(key);
    setReached(new Set());
  }, [key]);

  return { reached, setStopReached, resetProgress };
};

export type RouteProgressState = ReturnType<typeof useRouteProgress>;
