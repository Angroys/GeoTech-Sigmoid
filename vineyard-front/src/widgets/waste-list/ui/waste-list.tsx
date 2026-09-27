import { useMemo, type FC } from "react";

import type { RoutePurpose, Survey, SurveySelection, TargetId } from "@/entities/survey";
import { formatCount, formatQuantity } from "@/shared/lib/format";
import { useExpandableGroups, useToggleSet } from "@/shared/lib/react";
import { CollapsibleGroup, ExpandAllToggle, FilterChips } from "@/shared/ui";

import {
  NO_BLOCK,
  useWasteItems,
  WASTE_STATUS_LABEL,
  WASTE_STATUSES,
  type WasteGroup,
  type WasteGroupKey,
  type WasteItem,
  type WasteStatus,
} from "../model/use-waste-items";
import { WasteItemRow } from "./waste-item-row";

const titleOf = (group: WasteGroup) => (group.vineyardId ? `Block ${group.vineyardId}` : "No block");

const describeGroup = (group: WasteGroup) => {
  const count = formatQuantity(group.items.length, "item", "items");
  const place = group.vineyardId ? "" : ", more than 10 m from any block";
  if (group.onRouteCount === group.items.length) {
    return `${count}${place}, ${group.items.length === 1 ? "on the route" : "all on the route"}`;
  }
  if (group.onRouteCount === 0) return `${count}${place}, not reachable`;
  return `${count}${place}, ${formatCount(group.onRouteCount)} on the route`;
};

const groupOfSelection = (items: WasteItem[], selection: SurveySelection): WasteGroupKey | null => {
  if (selection.kind !== "target") return null;
  const item = items.find(candidate => candidate.targetId === selection.targetId);
  if (!item) return null;
  return item.vineyardId ?? NO_BLOCK;
};

type WasteListProps = {
  survey: Survey;
  routePurpose: RoutePurpose;
  selection: SurveySelection;
  onSelect: (selection: SurveySelection) => void;
};

export const WasteList: FC<WasteListProps> = ({ survey, routePurpose, selection, onSelect }) => {
  const { active: visibleStatuses, toggle: toggleStatus } = useToggleSet<WasteStatus>(WASTE_STATUSES);
  const { items, groups, statusCounts } = useWasteItems(survey, routePurpose, visibleStatuses);
  const focusedGroup = useMemo(() => groupOfSelection(items, selection), [items, selection]);
  const groupKeys = useMemo(() => groups.map(group => group.key), [groups]);
  const { isExpanded, toggle, areAllExpanded, toggleAll } = useExpandableGroups<WasteGroupKey>(groupKeys, focusedGroup);

  const selectedTargetId = selection.kind === "target" ? selection.targetId : null;
  const selectItem = (targetId: TargetId) => onSelect({ kind: "target", targetId });

  if (items.length === 0) {
    return <p className="text-muted-foreground px-2 text-sm">No waste was found in this survey.</p>;
  }

  const chipOptions = statusCounts.map(({ status, count }) => {
    return { value: status, label: WASTE_STATUS_LABEL[status], count };
  });

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-4">
        <FilterChips
          label="Show waste by route status"
          options={chipOptions}
          active={visibleStatuses}
          onToggle={toggleStatus}
        />
        {groups.length > 0 && <ExpandAllToggle areAllExpanded={areAllExpanded} onToggle={toggleAll} />}
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground px-2 text-sm">No waste matches these filters.</p>
      ) : (
        <div className="grid gap-1">
          {groups.map(group => {
            return (
              <CollapsibleGroup
                key={group.key}
                title={titleOf(group)}
                summary={describeGroup(group)}
                isExpanded={isExpanded(group.key)}
                onToggle={() => toggle(group.key)}
              >
                <ul className="grid">
                  {group.items.map(item => {
                    return (
                      <WasteItemRow
                        key={item.targetId}
                        item={item}
                        isSelected={item.targetId === selectedTargetId}
                        onSelect={selectItem}
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
