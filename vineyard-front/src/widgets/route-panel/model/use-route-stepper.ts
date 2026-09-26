import { useMemo } from "react";

import { walkingMinutes, type RouteStop, type TargetId } from "@/entities/survey";

import type { RoutePlan } from "./use-route-plan";

export type RouteStep = {
  stop: RouteStop;
  isReached: boolean;
  legM: number;
};

export type StepGroupSummary = { count: number; distanceM: number; minutes: number };

export const useRouteStepper = (plan: RoutePlan, reached: ReadonlySet<TargetId>) => {
  return useMemo(() => {
    const steps: RouteStep[] = plan.stops.map((stop, index) => {
      return {
        stop,
        isReached: reached.has(stop.targetId),
        legM: stop.distanceM - (plan.stops[index - 1]?.distanceM ?? 0),
      };
    });

    const current = steps.find(step => !step.isReached) ?? null;
    const reachedSteps = steps.filter(step => step.isReached);
    const upcomingSteps = steps.filter(step => !step.isReached && step !== current);

    const walkedM = Math.max(0, ...reachedSteps.map(step => step.stop.distanceM));
    const lastStopM = plan.stops.at(-1)?.distanceM ?? 0;
    const remainingM = current ? lastStopM - current.stop.distanceM : 0;
    const returnLegM = plan.lengthM - lastStopM;

    const summarize = (count: number, distanceM: number): StepGroupSummary => {
      return { count, distanceM, minutes: walkingMinutes(distanceM, plan.speedKmh) };
    };

    return {
      current,
      reachedSteps,
      upcomingSteps,
      reachedSummary: summarize(reachedSteps.length, walkedM),
      upcomingSummary: summarize(upcomingSteps.length, remainingM),
      returnLeg: summarize(0, returnLegM),
      isComplete: plan.stops.length > 0 && current === null,
    };
  }, [plan, reached]);
};

export type RouteStepper = ReturnType<typeof useRouteStepper>;
