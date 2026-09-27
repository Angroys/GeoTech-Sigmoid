import { useMemo, type FC } from "react";

import {
  blockOfSelection,
  ROW_STRUCTURE_STYLE,
  ROW_STRUCTURES,
  type RowId,
  type Survey,
  type SurveySelection,
  type VineyardId,
} from "@/entities/survey";
import { formatQuantity } from "@/shared/lib/format";
import { useExpandableGroups, useToggleSet } from "@/shared/lib/react";
import { ExpandAllToggle, FilterChips } from "@/shared/ui";

import { useBlockGroups } from "../model/use-block-groups";
import { BlockGroup } from "./block-group";

type RowTableProps = {
  survey: Survey;
  selection: SurveySelection;
  onSelect: (selection: SurveySelection) => void;
};

export const RowTable: FC<RowTableProps> = ({ survey, selection, onSelect }) => {
  const { active: visibleStructures, toggle: toggleStructure } = useToggleSet(ROW_STRUCTURES);
  const { groups, rowCount, structureCounts } = useBlockGroups(survey, visibleStructures);
  const focusedBlockId = useMemo(() => blockOfSelection(survey, selection), [survey, selection]);
  const blockIds = useMemo(() => groups.map(group => group.vineyardId), [groups]);
  const { isExpanded, toggle: toggleBlock, areAllExpanded, toggleAll } = useExpandableGroups(blockIds, focusedBlockId);

  const selectedRowId = selection.kind === "row" ? selection.rowId : null;
  const selectedBlockId = selection.kind === "block" ? selection.vineyardId : null;

  const showBlock = (vineyardId: VineyardId) => onSelect({ kind: "block", vineyardId });
  const selectRow = (rowId: RowId) => onSelect({ kind: "row", rowId });

  const chipOptions = structureCounts.map(({ structure, count }) => {
    return {
      value: structure,
      label: ROW_STRUCTURE_STYLE[structure].label,
      count,
      color: ROW_STRUCTURE_STYLE[structure].color,
    };
  });

  return (
    <div className="grid gap-3">
      <FilterChips
        label="Show rows by structure"
        options={chipOptions}
        active={visibleStructures}
        onToggle={toggleStructure}
      />

      <div className="flex items-center justify-between gap-4 px-2">
        <p className="text-sm tabular-nums">
          {formatQuantity(groups.length, "block", "blocks")} with {formatQuantity(rowCount, "row", "rows")}
        </p>
        {groups.length > 0 && <ExpandAllToggle areAllExpanded={areAllExpanded} onToggle={toggleAll} />}
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground px-2 text-sm">No rows match these filters.</p>
      ) : (
        <div className="grid gap-1">
          {groups.map(group => {
            return (
              <BlockGroup
                key={group.vineyardId}
                group={group}
                isExpanded={isExpanded(group.vineyardId)}
                isBlockSelected={group.vineyardId === selectedBlockId}
                selectedRowId={selectedRowId}
                onToggle={toggleBlock}
                onShowBlock={showBlock}
                onSelectRow={selectRow}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
