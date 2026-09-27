import type { FC } from "react";

import { FINDING_LABEL } from "@/features/track-route-progress";
import { formatLngLat, formatUtm, projectToSurveyCrs } from "@/shared/lib/geo";

import type { ReportStop } from "../model/use-inspection-report";
import { formatClock } from "../lib/report-dates";

const KIND_LABEL = { inspection_point: "Missing vines", waste: "Waste" } as const;

const placeOf = ({ stop }: ReportStop) => {
  if (stop.kind === "inspection_point") return `${stop.vineyardId}, row ${stop.rowId}`;
  return stop.vineyardId ?? "Outside blocks";
};

type FindingsTableProps = { stops: readonly ReportStop[] };

export const FindingsTable: FC<FindingsTableProps> = ({ stops }) => {
  return (
    <table className="w-full border-collapse text-[0.75rem] leading-snug">
      <thead>
        <tr className="border-b border-black/40 text-left align-bottom">
          <th scope="col" className="py-1 pr-2 font-semibold">Nr.</th>
          <th scope="col" className="py-1 pr-2 font-semibold">Obiect / Target</th>
          <th scope="col" className="py-1 pr-2 font-semibold">Loc / Place</th>
          <th scope="col" className="py-1 pr-2 font-semibold">Coordonate / Coordinates</th>
          <th scope="col" className="py-1 pr-2 font-semibold">Ora / Time</th>
          <th scope="col" className="py-1 pr-2 font-semibold">Constatare / Finding</th>
          <th scope="col" className="py-1 font-semibold">Notă / Note</th>
        </tr>
      </thead>
      <tbody>
        {stops.map(reportStop => {
          const { stop, record } = reportStop;
          return (
            <tr key={stop.targetId} className="break-inside-avoid border-b border-black/15 align-top">
              <td className="py-1 pr-2 tabular-nums">{stop.order}</td>
              <td className="py-1 pr-2">
                <span className="block font-medium tabular-nums">{stop.targetId}</span>
                {KIND_LABEL[stop.kind]}
              </td>
              <td className="py-1 pr-2">{placeOf(reportStop)}</td>
              <td className="py-1 pr-2 tabular-nums">
                {formatUtm(projectToSurveyCrs(stop.position))}
                <span className="block text-black/55">{formatLngLat(stop.position)}</span>
              </td>
              <td className="py-1 pr-2 tabular-nums">{record.reachedAt ? formatClock(new Date(record.reachedAt)) : "Not reached"}</td>
              <td className="py-1 pr-2">{record.finding ? FINDING_LABEL[record.finding] : "—"}</td>
              <td className="py-1 break-words">{record.note}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
