import { MapPin } from "lucide-react";
import type { FC } from "react";

import type { RowId, VineyardId } from "@/entities/survey";
import { formatCount, formatMetres } from "@/shared/lib/format";
import { CollapsibleGroup } from "@/shared/ui";

import type { BlockGroup as BlockGroupData } from "../model/use-block-groups";
import { RowItem } from "./row-item";

const describeBlock = ({ rows, rowLengthM, disruptedCount }: BlockGroupData) => {
  const parts = [`${formatCount(rows.length)} rows`, formatMetres(rowLengthM)];
  if (disruptedCount > 0) parts.push(`${formatCount(disruptedCount)} disrupted`);
  return parts.join(", ");
};

type ShowBlockButtonProps = {
  vineyardId: VineyardId;
  isSelected: boolean;
  onShow: (vineyardId: VineyardId) => void;
};

const ShowBlockButton: FC<ShowBlockButtonProps> = ({ vineyardId, isSelected, onShow }) => {
  return (
    <button
      type="button"
      onClick={() => onShow(vineyardId)}
      aria-pressed={isSelected}
      aria-label={`Show block ${vineyardId} on the map`}
      title="Show on the map"
      className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 grid size-9 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-[3px]"
    >
      <MapPin className="size-4" aria-hidden />
    </button>
  );
};

type BlockGroupProps = {
  group: BlockGroupData;
  isExpanded: boolean;
  isBlockSelected: boolean;
  selectedRowId: RowId | null;
  onToggle: (vineyardId: VineyardId) => void;
  onShowBlock: (vineyardId: VineyardId) => void;
  onSelectRow: (rowId: RowId) => void;
};

export const BlockGroup: FC<BlockGroupProps> = ({
  group,
  isExpanded,
  isBlockSelected,
  selectedRowId,
  onToggle,
  onShowBlock,
  onSelectRow,
}) => {
  return (
    <CollapsibleGroup
      title={`Block ${group.vineyardId}`}
      summary={describeBlock(group)}
      isExpanded={isExpanded}
      onToggle={() => onToggle(group.vineyardId)}
      isHighlighted={isBlockSelected}
      action={<ShowBlockButton vineyardId={group.vineyardId} isSelected={isBlockSelected} onShow={onShowBlock} />}
    >
      <ul className="grid">
        {group.rows.map(row => {
          return (
            <RowItem key={row.row_id} row={row} isSelected={row.row_id === selectedRowId} onSelect={onSelectRow} />
          );
        })}
      </ul>
    </CollapsibleGroup>
  );
};
