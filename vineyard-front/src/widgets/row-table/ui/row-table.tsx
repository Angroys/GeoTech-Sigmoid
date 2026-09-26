import { useMemo, type FC } from "react";

import {
  ROW_STRUCTURE_STYLE,
  ROW_STRUCTURES,
  type RowId,
  type Survey,
  type SurveySelection,
  type VineyardId,
} from "@/entities/survey";
import { assertNever } from "@/shared/lib/types";
import { formatCount } from "@/shared/lib/format";
import { useExpandedKeys, useToggleSet } from "@/shared/lib/react";
import { FilterChips, LinkButton } from "@/shared/ui";

import { useBlockGroups } from "../model/use-block-groups";
import { BlockGroup } from "./block-group";

const blockOfSelection = (survey: Survey, selection: SurveySelection): VineyardId | null => {
  switch (selection.kind) {
    case "none":
    case "interrow":
    case "target":
      return null;
    case "block":
      return selection.vineyardId;
    case "row":
      return (
        survey.rows.features.find(({ properties }) => properties.row_id === selection.rowId)?.properties.vineyard_id ??
        null
      );
    default:
      return assertNever(selection);
  }
};

type RowTableProps = {
  survey: Survey;
  selection: SurveySelection;
  onSelect: (selection: SurveySelection) => void;
};

export const RowTable: FC<RowTableProps> = ({ survey, selection, onSelect }) => {
  const { active: visibleStructures, toggle: toggleStructure } = useToggleSet(ROW_STRUCTURES);
  const { groups, rowCount, structureCounts } = useBlockGroups(survey, visibleStructures);
  const focusedBlockId = useMemo(() => blockOfSelection(survey, selection), [survey, selection]);
  const { expanded, toggle: toggleBlock, expandAll, collapseAll } = useExpandedKeys(focusedBlockId);

  const areAllExpanded = groups.length > 0 && groups.every(group => expanded.has(group.vineyardId));
  const selectedRowId = selection.kind === "row" ? selection.rowId : null;
  const selectedBlockId = selection.kind === "block" ? selection.vineyardId : null;

  const showBlock = (vineyardId: VineyardId) => onSelect({ kind: "block", vineyardId });
  const selectRow = (rowId: RowId) => onSelect({ kind: "row", rowId });
  const toggleAll = () => (areAllExpanded ? collapseAll() : expandAll(groups.map(group => group.vineyardId)));

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
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{formatCount(groups.length)}</span>{" "}
          {groups.length === 1 ? "block" : "blocks"} with{" "}
          <span className="font-semibold tabular-nums">{formatCount(rowCount)}</span> {rowCount === 1 ? "row" : "rows"}
        </p>
        {groups.length > 0 && (
          <LinkButton onClick={toggleAll}>{areAllExpanded ? "Collapse all" : "Expand all"}</LinkButton>
        )}
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
                isExpanded={expanded.has(group.vineyardId)}
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
