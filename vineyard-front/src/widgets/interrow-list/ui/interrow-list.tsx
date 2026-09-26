import { useMemo, type FC } from "react";

import {
  blockOfSelection,
  INTERROW_COVER_STYLE,
  INTERROW_COVERS,
  type InterrowCover,
  type InterrowId,
  type Survey,
  type SurveySelection,
} from "@/entities/survey";
import { formatCount, formatHectares, formatQuantity, formatWidth } from "@/shared/lib/format";
import { useExpandableGroups, useToggleSet } from "@/shared/lib/react";
import { CollapsibleGroup, ExpandAllToggle, FilterChips } from "@/shared/ui";

import { useInterrowGroups, type InterrowGroup } from "../model/use-interrow-groups";
import { InterrowItem } from "./interrow-item";

const describeGroup = (group: InterrowGroup) => {
  const covers = INTERROW_COVERS.filter(cover => group.coverCounts[cover] > 0)
    .map(cover => `${formatCount(group.coverCounts[cover])} ${INTERROW_COVER_STYLE[cover].label.toLowerCase()}`)
    .join(", ");
  return `${formatQuantity(group.interrows.length, "inter-row", "inter-rows")}, ${formatWidth(group.averageWidthM)} wide on average, ${formatHectares(group.areaM2)}: ${covers}`;
};

type InterrowListProps = {
  survey: Survey;
  selection: SurveySelection;
  onSelect: (selection: SurveySelection) => void;
};

export const InterrowList: FC<InterrowListProps> = ({ survey, selection, onSelect }) => {
  const { active: visibleCovers, toggle: toggleCover } = useToggleSet<InterrowCover>(INTERROW_COVERS);
  const { groups, coverCounts } = useInterrowGroups(survey, visibleCovers);
  const focusedBlock = useMemo(() => blockOfSelection(survey, selection), [survey, selection]);
  const blockIds = useMemo(() => groups.map(group => group.vineyardId), [groups]);
  const { isExpanded, toggle, areAllExpanded, toggleAll } = useExpandableGroups(blockIds, focusedBlock);

  const selectedInterrowId = selection.kind === "interrow" ? selection.interrowId : null;
  const selectInterrow = (interrowId: InterrowId) => onSelect({ kind: "interrow", interrowId });

  const chipOptions = coverCounts.map(({ cover, count }) => {
    return { value: cover, label: INTERROW_COVER_STYLE[cover].label, count, color: INTERROW_COVER_STYLE[cover].color };
  });

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-4">
        <FilterChips
          label="Show inter-row areas by ground cover"
          options={chipOptions}
          active={visibleCovers}
          onToggle={toggleCover}
        />
        {groups.length > 0 && <ExpandAllToggle areAllExpanded={areAllExpanded} onToggle={toggleAll} />}
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground px-2 text-sm">No inter-row areas match these filters.</p>
      ) : (
        <div className="grid gap-1">
          {groups.map(group => {
            return (
              <CollapsibleGroup
                key={group.vineyardId}
                title={`Block ${group.vineyardId}`}
                summary={describeGroup(group)}
                isExpanded={isExpanded(group.vineyardId)}
                onToggle={() => toggle(group.vineyardId)}
              >
                <ul className="grid">
                  {group.interrows.map(interrow => {
                    return (
                      <InterrowItem
                        key={interrow.interrow_id}
                        interrow={interrow}
                        isSelected={interrow.interrow_id === selectedInterrowId}
                        onSelect={selectInterrow}
                      />
                    );
                  })}
                </ul>
              </CollapsibleGroup>
            );
          })}
        </div>
      )}
    </div>
  );
};
