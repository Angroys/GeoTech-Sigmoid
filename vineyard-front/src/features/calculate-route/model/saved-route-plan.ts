import { EMPTY_ROUTE_MAP, routePlanResponseSchema, type RoutePlanResponse } from "@/entities/survey";
import { readItem, writeItem } from "@/shared/lib/storage";

const savedPlanSchema = routePlanResponseSchema.omit({ map: true });

const storageKey = (calculationKey: string) => `vineyard:route-plan:v1:${calculationKey}`;

export const loadSavedPlan = (calculationKey: string): RoutePlanResponse | null => {
  const saved = readItem(storageKey(calculationKey), savedPlanSchema);
  return saved ? { ...saved, map: EMPTY_ROUTE_MAP } : null;
};

export const savePlan = (calculationKey: string, { route, report }: RoutePlanResponse) =>
  writeItem(storageKey(calculationKey), { route, report });
