import { useMemo } from "react";

import { agencyLabel } from "@/entities/agency";
import { useSession } from "@/entities/session";
import {
  getRouteStops,
  getUnreachableTargets,
  summarizeSurvey,
  type RoutePurpose,
  type RouteStop,
  type Survey,
  type SurveySource,
} from "@/entities/survey";
import { FINDING_LABEL, type Finding, type RouteProgressState, type StopRecord } from "@/features/track-route-progress";

import { reportNumberOf } from "../lib/report-number";
import { drawRoute } from "../lib/route-drawing";

export type ReportStop = { stop: RouteStop; record: StopRecord };

type FindingTotal = { label: string; count: number };

type ReportOptions = {
  source: SurveySource;
  survey: Survey;
  purpose: RoutePurpose;
  progress: RouteProgressState;
};

const timesOf = (stops: readonly ReportStop[]) =>
  stops
    .map(({ record }) => record.reachedAt)
    .filter(reachedAt => reachedAt !== null)
    .map(reachedAt => new Date(reachedAt))
    .sort((a, b) => a.getTime() - b.getTime());

const totalsOf = (stops: readonly ReportStop[]): FindingTotal[] => {
  const counts = new Map<Finding | null, number>();
  for (const { record } of stops) counts.set(record.finding, (counts.get(record.finding) ?? 0) + 1);
  return [...counts].map(([finding, count]) => ({ label: finding ? FINDING_LABEL[finding] : "No finding recorded", count }));
};

export const useInspectionReport = ({ source, survey, purpose, progress }: ReportOptions) => {
  const session = useSession();

  return useMemo(() => {
    const stops = getRouteStops(survey, purpose).map(stop => ({ stop, record: progress.recordOf(stop.targetId) }));
    const times = timesOf(stops);
    const startedAt = times[0] ?? null;
    const finishedAt = times.at(-1) ?? null;
    const route = survey.routes[purpose];
    const inspector = session?.inspector ?? null;

    return {
      number: reportNumberOf(source.id, startedAt ?? new Date()),
      createdAt: new Date(),
      startedAt,
      finishedAt,
      controlBody: inspector ? agencyLabel(inspector.agency) : null,
      inspector: { fullName: session?.fullName ?? null, badgeNumber: inspector?.badgeNumber ?? null },
      source,
      startPosition: survey.start.geometry.coordinates,
      routeLengthM: route?.properties.length_m ?? null,
      stops,
      reachedCount: stops.filter(({ record }) => record.isReached).length,
      totals: totalsOf(stops),
      unreachable: getUnreachableTargets(survey, purpose),
      measurements: summarizeSurvey(survey),
      drawing: drawRoute(
        survey,
        stops.map(({ stop }) => stop),
        route?.geometry.coordinates ?? null,
      ),
    };
  }, [source, survey, purpose, progress, session]);
};

export type InspectionReportData = ReturnType<typeof useInspectionReport>;
