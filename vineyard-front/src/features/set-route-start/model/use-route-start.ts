import type { Position } from "geojson";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { useSession } from "@/entities/session";
import type { RoutePurpose, SurveyId } from "@/entities/survey";
import { readItem, removeItem, writeItem } from "@/shared/lib/storage";

const storedStartSchema = z.object({
  lngLat: z.tuple([z.number(), z.number()]),
  requestedAt: z.iso.datetime(),
});

export type RouteStartRequest = { lngLat: Position; requestedAt: string };

const storageKey = (accountId: string, surveyId: SurveyId, purpose: RoutePurpose) =>
  `vineyard:route-start:v1:${accountId}:${surveyId}:${purpose}`;

const loadRequest = (key: string): RouteStartRequest | null => readItem(key, storedStartSchema);

export const useRouteStart = (surveyId: SurveyId, purpose: RoutePurpose) => {
  const session = useSession();
  const key = storageKey(session?.accountId ?? "guest", surveyId, purpose);
  const [request, setRequest] = useState<RouteStartRequest | null>(() => loadRequest(key));

  useEffect(() => {
    setRequest(loadRequest(key));
  }, [key]);

  const requestStart = useCallback(
    ([longitude = 0, latitude = 0]: Position) => {
      const next = { lngLat: [longitude, latitude], requestedAt: new Date().toISOString() };
      writeItem(key, next);
      setRequest(next);
    },
    [key],
  );

  const clearStart = useCallback(() => {
    removeItem(key);
    setRequest(null);
  }, [key]);

  return { request, requestStart, clearStart };
};
