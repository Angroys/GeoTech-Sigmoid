import { useMemo, type FC, type ReactNode } from "react";

import { summarizeSurvey, type Survey, type SurveySummary } from "@/entities/survey";
import { formatCount, formatHectares, formatMetres, formatSquareMetres } from "@/shared/lib/format";

type MeasurementRowProps = {
  label: string;
  value: string;
  detail?: string;
};

const MeasurementRow: FC<MeasurementRowProps> = ({ label, value, detail }) => {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-right tabular-nums">
        <span className="text-[0.9375rem] font-medium">{value}</span>
        {detail && <span className="text-muted-foreground block text-xs">{detail}</span>}
      </dd>
    </div>
  );
};

type NumericCellProps = { children: ReactNode };

const NumericCell: FC<NumericCellProps> = ({ children }) => {
  return <td className="py-1.5 pl-3 text-right align-top tabular-nums">{children}</td>;
};

type BlockTableProps = { summary: SurveySummary };

const BlockTable: FC<BlockTableProps> = ({ summary }) => {
  return (
    <table className="mt-4 w-full text-sm">
      <caption className="sr-only">Measurements by vineyard block</caption>
      <thead>
        <tr className="text-muted-foreground border-border border-b text-xs">
          <th scope="col" className="py-1.5 text-left font-medium">
            Block
          </th>
          <th scope="col" className="py-1.5 pl-3 text-right font-medium">
            Rows
          </th>
          <th scope="col" className="py-1.5 pl-3 text-right font-medium">
            Row length
          </th>
          <th scope="col" className="py-1.5 pl-3 text-right font-medium">
            Canopies
          </th>
          <th scope="col" className="py-1.5 pl-3 text-right font-medium">
            Inter-row
          </th>
        </tr>
      </thead>
      <tbody>
        {summary.blocks.map(block => {
          return (
            <tr key={block.vineyardId} className="border-border border-b last:border-b-0">
              <th scope="row" className="py-1.5 text-left font-medium">
                {block.vineyardId}
              </th>
              <NumericCell>{formatCount(block.rowCount)}</NumericCell>
              <NumericCell>{formatMetres(block.rowLengthM)}</NumericCell>
              <NumericCell>{formatCount(block.canopyCount)}</NumericCell>
              <NumericCell>{formatHectares(block.interrowAreaM2)}</NumericCell>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-foreground/20 border-t font-semibold">
          <th scope="row" className="py-1.5 text-left align-top">
            Total
          </th>
          <NumericCell>{formatCount(summary.rowCount)}</NumericCell>
          <NumericCell>{formatMetres(summary.rowLengthM)}</NumericCell>
          <NumericCell>{formatCount(summary.canopyCount)}</NumericCell>
          <NumericCell>
            {formatHectares(summary.interrowAreaM2)}
            <span className="text-muted-foreground block text-xs font-normal">
              {formatSquareMetres(summary.interrowAreaM2)}
            </span>
          </NumericCell>
        </tr>
      </tfoot>
    </table>
  );
};

type MeasurementSheetProps = { survey: Survey };

export const MeasurementSheet: FC<MeasurementSheetProps> = ({ survey }) => {
  const summary = useMemo(() => summarizeSurvey(survey), [survey]);

  return (
    <div>
      <dl className="divide-border divide-y">
        <MeasurementRow label="Vineyard blocks" value={formatCount(summary.blockCount)} />
        <MeasurementRow
          label="Canopy area"
          value={formatHectares(summary.canopyAreaM2)}
          detail={formatSquareMetres(summary.canopyAreaM2)}
        />
      </dl>
      <BlockTable summary={summary} />
    </div>
  );
};
