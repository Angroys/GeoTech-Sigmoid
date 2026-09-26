import { useMemo, type FC } from "react";

import {
  INTERROW_COVER_STYLE,
  INTERROW_COVERS,
  type InterrowCover,
  type InterrowId,
  type Survey,
  type SurveySelection,
  type VineyardId,
} from "@/entities/survey";
import { formatCount, formatHectares, formatWidth } from "@/shared/lib/format";
import { useExpandedKeys, useToggleSet } from "@/shared/lib/react";
import { CollapsibleGroup, FilterChips, LinkButton } from "@/shared/ui";

import { useInterrowGroups, type InterrowGroup } from "../model/use-interrow-groups";
import { InterrowItem } from "./interrow-item";

const describeGroup = (group: InterrowGroup) => {
  const covers = INTERROW_COVERS.filter(cover => group.coverCounts[cover] > 0)
    .map(cover => `${formatCount(group.coverCounts[cover])} ${INTERROW_COVER_STYLE[cover].label.toLowerCase()}`)
    .join(", ");
  return `${formatCount(group.interrows.length)} inter-rows, ${formatWidth(group.averageWidthM)} wide on average, ${formatHectares(group.areaM2)}: ${covers}`;
};

const blockOfSelection = (survey: Survey, selection: SurveySelection): VineyardId | null => {
  if (selection.kind !== "interrow") return null;
  return (
    survey.interrows.features.find(({ properties }) => properties.interrow_id === selection.interrowId)?.properties
      .vineyard_id ?? null
  );
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
  const { expanded, toggle, expandAll, collapseAll } = useExpandedKeys(focusedBlock);

  const selectedInterrowId = selection.kind === "interrow" ? selection.interrowId : null;
  const selectInterrow = (interrowId: InterrowId) => onSelect({ kind: "interrow", interrowId });
  const areAllExpanded = groups.length > 0 && groups.every(group => expanded.has(group.vineyardId));
  const toggleAll = () => (areAllExpanded ? collapseAll() : expandAll(groups.map(group => group.vineyardId)));

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
        {groups.length > 0 && (
          <LinkButton onClick={toggleAll}>{areAllExpanded ? "Collapse all" : "Expand all"}</LinkButton>
        )}
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
                isExpanded={expanded.has(group.vineyardId)}
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
