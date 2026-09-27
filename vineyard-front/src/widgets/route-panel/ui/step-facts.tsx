import type { FC } from "react";

import { walkingMinutes } from "@/entities/survey";
import { formatMetres, formatMinutes } from "@/shared/lib/format";
import { formatLngLat, formatUtm, projectToSurveyCrs } from "@/shared/lib/geo";

import type { RouteStep } from "../model/use-route-stepper";

export const distanceWithTime = (metres: number, speedKmh: number) =>
  `${formatMetres(metres)}, ${formatMinutes(walkingMinutes(metres, speedKmh))}`;

type FactProps = { label: string; value: string; detail?: string };

const Fact: FC<FactProps> = ({ label, value, detail }) => {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">
        {value}
        {detail && <span className="text-muted-foreground block text-xs">{detail}</span>}
      </dd>
    </div>
  );
};

type StepFactsProps = {
  step: RouteStep;
  speedKmh: number;
  showTotal?: boolean;
};

export const StepFacts: FC<StepFactsProps> = ({ step, speedKmh, showTotal = true }) => {
  const { stop, legM } = step;
  return (
    <dl className="grid gap-1 text-sm">
      <Fact
        label={stop.order === 1 ? "From the start" : "From the previous stop"}
        value={distanceWithTime(legM, speedKmh)}
      />
      {showTotal && stop.order > 1 && (
        <Fact label="Total from the start" value={distanceWithTime(stop.distanceM, speedKmh)} />
      )}
      <Fact
        label="Coordinates"
        value={formatLngLat(stop.position)}
        detail={`${formatUtm(projectToSurveyCrs(stop.position))}, EPSG:32635`}
      />
    </dl>
  );
};
