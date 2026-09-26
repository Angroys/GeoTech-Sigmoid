import { useMemo, type FC, type ReactNode } from "react";

import { summarizeSurvey, type BlockSummary, type Survey } from "@/entities/survey";
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
  return <td className="py-1.5 pl-3 text-right tabular-nums">{children}</td>;
};

type BlockTableProps = { blocks: BlockSummary[] };

const BlockTable: FC<BlockTableProps> = ({ blocks }) => {
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
        {blocks.map(block => {
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
        <MeasurementRow label="Rows" value={formatCount(summary.rowCount)} />
        <MeasurementRow label="Total row length" value={formatMetres(summary.rowLengthM)} />
        <MeasurementRow label="Vine canopies" value={formatCount(summary.canopyCount)} />
        <MeasurementRow
          label="Inter-row area"
          value={formatHectares(summary.interrowAreaM2)}
          detail={formatSquareMetres(summary.interrowAreaM2)}
        />
      </dl>
      <BlockTable blocks={summary.blocks} />
    </div>
  );
};
