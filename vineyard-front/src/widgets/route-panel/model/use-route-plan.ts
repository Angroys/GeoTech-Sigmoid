import { useMemo } from "react";

import {
  getRouteStops,
  getUnreachableTargets,
  walkingMinutes,
  type RoutePurpose,
  type Survey,
} from "@/entities/survey";

export type PlannedRoute = NonNullable<Survey["routes"][RoutePurpose]>;

export const useRoutePlan = (survey: Survey, purpose: RoutePurpose, route: PlannedRoute) => {
  return useMemo(() => {
    const { length_m: lengthM, baseline_length_m: baselineM, walking_speed_kmh: speedKmh } = route.properties;
    const stops = getRouteStops(survey, purpose);
    const savedM = Math.max(0, baselineM - lengthM);

    return {
      purpose,
      stops,
      stopIds: stops.map(stop => stop.targetId),
      unreachable: getUnreachableTargets(survey, purpose),
      lengthM,
      speedKmh,
      minutes: walkingMinutes(lengthM, speedKmh),
      savedM,
      savedRatio: baselineM > 0 ? savedM / baselineM : 0,
      savedMinutes: walkingMinutes(savedM, speedKmh),
      baselineKind: route.properties.baseline_kind,
    };
  }, [survey, purpose, route]);
};

export type RoutePlan = ReturnType<typeof useRoutePlan>;
